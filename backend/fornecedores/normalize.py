"""Normalização e validação dos dados de fornecedor.

Funções puras (sem acesso a banco) reutilizadas pelo serializer, pelo
importador e pelos testes. Mantém CPF/CNPJ/código como TEXTO (identificadores),
nunca como número — para não perder zeros à esquerda.
"""
import re
import unicodedata

# ── Catálogos oficiais ────────────────────────────────────────────────────────
STATUS_CHOICES = [
    ('ativo',   'Ativo'),
    ('inativo', 'Inativo'),
]

# Categoria = seleção padronizada (enum). As variações do arquivo antigo são
# normalizadas para estas chaves oficiais; ver CATEGORY_ALIASES.
CATEGORY_CHOICES = [
    ('operadora',     'Operadora'),
    ('receptivo',     'Receptivo'),
    ('hotel',         'Hotel'),
    ('consolidador',  'Consolidador'),
    ('cia_aerea',     'Cia Aérea'),
    ('locadora',      'Locadora'),
    ('outros',        'Outros'),
]
CATEGORY_KEYS = {k for k, _ in CATEGORY_CHOICES}
CATEGORY_LABELS = {k: v for k, v in CATEGORY_CHOICES}


def _fold(s):
    """minúsculas, sem acentos e sem pontuação/espaços extras — só p/ comparar."""
    if not s:
        return ''
    s = unicodedata.normalize('NFKD', str(s))
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = s.lower().strip()
    s = re.sub(r'[.\-_/]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


# Map de comparação "folded" → chave oficial. Cobre Cia Aerea/Aérea/Cia. Aérea.
_CATEGORY_ALIASES = {
    'operadora': 'operadora',
    'receptivo': 'receptivo',
    'hotel': 'hotel',
    'hoteis': 'hotel',
    'consolidador': 'consolidador',
    'consolidadora': 'consolidador',
    'cia aerea': 'cia_aerea',
    'cia aereas': 'cia_aerea',
    'companhia aerea': 'cia_aerea',
    'aerea': 'cia_aerea',
    'airline': 'cia_aerea',
    'locadora': 'locadora',
    'locadora de veiculos': 'locadora',
    'rent a car': 'locadora',
    'outros': 'outros',
    'outro': 'outros',
}


def normalize_category(raw):
    """Devolve a chave oficial da categoria. Vazio → ''. Desconhecida → 'outros'.

    Retorna (key, matched) — matched=False quando caiu no fallback 'outros' por
    não reconhecer o valor (para o importador emitir aviso, sem bloquear).
    """
    f = _fold(raw)
    if not f:
        return '', True
    if f in _CATEGORY_ALIASES:
        return _CATEGORY_ALIASES[f], True
    if f in CATEGORY_KEYS:
        return f, True
    # Começa com "cia" → companhia aérea (cobre "cia. aérea", "cia aerea x").
    if f.startswith('cia') or 'aerea' in f:
        return 'cia_aerea', True
    return 'outros', False


_STATUS_ATIVO = {'ativo', 'ativa', 'active', 'activo', 'a', '1', 'sim', 's', 'true', 'habilitado'}
_STATUS_INATIVO = {'inativo', 'inativa', 'inactive', 'i', '0', 'nao', 'n', 'false', 'desabilitado', 'bloqueado'}


def normalize_status(raw, default='ativo'):
    """'ativo' | 'inativo'. Vazio/desconhecido → default ('ativo')."""
    f = _fold(raw)
    if not f:
        return default
    if f in _STATUS_ATIVO:
        return 'ativo'
    if f in _STATUS_INATIVO:
        return 'inativo'
    return default


def only_digits(s):
    """Só dígitos — para CPF/CNPJ. None/'' → ''. Preserva zeros à esquerda."""
    return re.sub(r'\D', '', str(s or ''))


def normalize_airline_abbr(s):
    """Abreviatura de Cia — maiúsculas, sem espaços nas pontas."""
    return (str(s or '').strip().upper())


def clean_text(s):
    """Trim; espaços internos colapsados; preserva acentos. None → ''."""
    if s is None:
        return ''
    s = str(s).strip()
    return re.sub(r'\s+', ' ', s)


# ── Validação de CPF/CNPJ (algoritmos oficiais) ───────────────────────────────
def validate_cpf(value):
    """True se o CPF (só dígitos ou formatado) for válido. Vazio NÃO é validado
    aqui (chame só quando preenchido)."""
    cpf = only_digits(value)
    if len(cpf) != 11 or cpf == cpf[0] * 11:
        return False
    for i in (9, 10):
        s = sum(int(cpf[n]) * ((i + 1) - n) for n in range(i))
        d = (s * 10) % 11
        d = 0 if d == 10 else d
        if d != int(cpf[i]):
            return False
    return True


def validate_cnpj(value):
    """True se o CNPJ (só dígitos ou formatado) for válido."""
    cnpj = only_digits(value)
    if len(cnpj) != 14 or cnpj == cnpj[0] * 14:
        return False
    def dv(base, weights):
        s = sum(int(d) * w for d, w in zip(base, weights))
        r = s % 11
        return 0 if r < 2 else 11 - r
    d1 = dv(cnpj[:12], [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    d2 = dv(cnpj[:13], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return d1 == int(cnpj[12]) and d2 == int(cnpj[13])


def format_cpf(value):
    d = only_digits(value)
    if len(d) != 11:
        return d
    return f'{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}'


def format_cnpj(value):
    d = only_digits(value)
    if len(d) != 14:
        return d
    return f'{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}'


def dedup_key_name(name, city, country):
    """Chave secundária de duplicidade: nome+cidade+país normalizados."""
    return '|'.join(_fold(x) for x in (name, city, country))
