"""Importação de agências por CSV.

MESMO fluxo do importador de fornecedores (fornecedores/importer.py): um passo
de ANÁLISE (classifica cada linha, sem gravar) e um passo de APLICAÇÃO
(transacional). O servidor SEMPRE re-normaliza e re-classifica a partir dos
dados crus — nunca confia na normalização feita no front.

Aceita tanto o modelo oficial (endpoint /template/) quanto o relatório de
agências do Infotravel (colunas "Id;Nome;Razão Social;Email;CNPJ;...") — os
cabeçalhos reconhecidos estão em HEADER_ALIASES.

Sem dependências externas (só stdlib csv/io). CPF/CNPJ/CEP são tratados como
TEXTO (identificadores) para preservar zeros à esquerda.
"""
import csv
import io
import re
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

# Helpers puros compartilhados com o importador de fornecedores.
from fornecedores.normalize import (
    _fold, only_digits, validate_cpf, validate_cnpj, clean_text,
    format_cpf, format_cnpj,
)

from .models import Agency

MAX_ROWS = 20000              # trava de segurança contra arquivos gigantes
MAX_BYTES = 12 * 1024 * 1024  # 12 MB

# Colunas canônicas na ordem oficial (usada no modelo e na exportação).
CANON_COLUMNS = [
    ('name',            'Nome Fantasia'),
    ('company_name',    'Razão Social'),
    ('status',          'Status'),
    ('cnpj',            'CNPJ'),
    ('cpf',             'CPF'),
    ('email',           'E-mail'),
    ('phone',           'Telefone'),
    ('mobile',          'Celular'),
    ('website',         'Website'),
    ('responsible',     'Responsável'),
    ('commission_rate', 'Comissão %'),
    ('promoter',        'Promotor'),
    ('cep',             'CEP'),
    ('street',          'Endereço'),
    ('number',          'Número'),
    ('complement',      'Complemento'),
    ('neighborhood',    'Bairro'),
    ('city',            'Cidade'),
    ('state',           'Estado'),
    ('country',         'País'),
    ('pix_key_type',    'Tipo Chave PIX'),
    ('pix_key',         'Chave PIX'),
    ('notes',           'Observações'),
]
CANON_LABELS = {k: v for k, v in CANON_COLUMNS}

# Cabeçalhos aceitos (após _fold_header) → campo canônico. Cobre o modelo
# oficial E o relatório do Infotravel (incl. variações sem acento/mojibake).
HEADER_ALIASES = {
    # Identificação
    'nome fantasia': 'name', 'nome fantasma': 'name', 'nome': 'name',
    'fantasia': 'name', 'agencia': 'name',
    'razao social': 'company_name', 'razao': 'company_name', 'company': 'company_name',
    'status': 'status', 'situacao': 'status', 'ativo?': 'status', 'ativo': 'status',
    # A "Unidade Categoria" do Infotravel carrega "Desativado" p/ inativas.
    'unidade categoria': 'unit_category',
    'cnpj': 'cnpj',
    'cpf': 'cpf',
    # Contato
    'e mail': 'email', 'email': 'email',
    'telefone': 'phone', 'fone': 'phone',
    'celular': 'mobile',
    'website': 'website', 'site': 'website',
    'responsavel': 'responsible', 'contato': 'responsible',
    # Financeiro / comercial
    'comissao %': 'commission_rate', 'comissao': 'commission_rate',
    'promotor': 'promoter', 'promotora': 'promoter',
    # Endereço
    'cep': 'cep',
    'endereco': 'street', 'endereao': 'street', 'logradouro': 'street', 'rua': 'street',
    'numero': 'number',
    'complemento': 'complement',
    'bairro': 'neighborhood',
    'cidade': 'city',
    'estado': 'state', 'uf': 'state',
    'pais': 'country',
    # PIX
    'tipo chave pix': 'pix_key_type', 'tipo de chave pix': 'pix_key_type',
    'chave pix': 'pix_key', 'pix': 'pix_key',
    # Observações
    'observacoes': 'notes', 'observacao': 'notes', 'obs': 'notes',
}

STATUS_LABELS = {'active': 'Ativa', 'pending': 'Pendente', 'inactive': 'Inativa'}
_STATUS_ACTIVE   = {'sim', 's', 'ativo', 'ativa', 'active', '1', 'true', 'yes'}
_STATUS_INACTIVE = {'nao', 'n', 'inativo', 'inativa', 'inactive', '0', 'false',
                    'desativado', 'desativada', 'bloqueado', 'bloqueada'}
_STATUS_PENDING  = {'pendente', 'pending'}

_EMAIL_RE = re.compile(r'^[^@\s;,]+@[^@\s;,]+\.[^@\s;,]+$')


class ImportError_(ValueError):
    """Erro geral de arquivo (aborta tudo antes de qualquer linha)."""


def _fold_header(h):
    """_fold + remove qualquer caractere fora de [a-z0-9? ] — tolera cabeçalhos
    com acentos perdidos/mojibake ("RazÃ£o Social" → "razao social")."""
    f = _fold(h)
    f = re.sub(r'[^a-z0-9? ]', '', f)
    return re.sub(r'\s+', ' ', f).strip()


def _detect_delimiter(sample):
    counts = {d: sample.count(d) for d in (';', ',', '\t', '|')}
    best = max(counts, key=counts.get)
    return best if counts[best] > 0 else ','


def parse_csv_bytes(data):
    """bytes → (rows, mapping). rows = lista de dicts {campo canônico: valor cru}.
    mapping = {campo canônico: cabeçalho original} das colunas reconhecidas.
    Aceita UTF-8 com/sem BOM e latin-1 como fallback. Detecta o separador."""
    if data is None:
        raise ImportError_('Arquivo vazio.')
    if len(data) > MAX_BYTES:
        raise ImportError_('Arquivo muito grande (máx. 12 MB).')
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        text = data.decode('latin-1')
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    if not text.strip():
        raise ImportError_('Arquivo vazio.')

    first_line = text.split('\n', 1)[0]
    delim = _detect_delimiter(first_line)
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    try:
        header = next(reader)
    except StopIteration:
        raise ImportError_('Arquivo sem cabeçalho.')

    col_field = []
    mapping = {}
    for h in header:
        field = HEADER_ALIASES.get(_fold_header(h))
        col_field.append(field)
        if field and field not in mapping:
            mapping[field] = (h or '').strip()

    if 'name' not in mapping and 'company_name' not in mapping:
        raise ImportError_('Coluna "Nome" ou "Razão Social" não encontrada no arquivo.')

    rows = []
    ncols = len(header)
    for values in reader:
        if not any((v or '').strip() for v in values):
            continue  # linha totalmente vazia
        raw = {}
        for i, field in enumerate(col_field):
            if not field:
                continue
            val = values[i] if i < len(values) else ''
            if field not in raw:      # 1ª coluna reconhecida vence
                raw[field] = val
        # Linha com número de colunas diferente do cabeçalho: aspas ou
        # separador sobrando no meio do texto. Os valores estão DESLOCADOS
        # (nome cai no campo do e-mail etc.) — melhor recusar a linha do que
        # gravar lixo. `_ncols` vira erro em analyze_rows.
        if len(values) != ncols:
            raw['_ncols'] = (len(values), ncols)
        rows.append(raw)
        if len(rows) > MAX_ROWS:
            raise ImportError_(f'Arquivo excede o limite de {MAX_ROWS} linhas.')
    return rows, mapping


# ── Normalizações específicas de agência ─────────────────────────────────────

_SCI_NOTATION_RE = re.compile(r'^\d+[.,]?\d*e\+?\d+$', re.IGNORECASE)
SCI_NOTATION_MSG = 'corrompido pelo Excel (notação científica) — campo ignorado.'


def _normalize_document(raw, validate):
    """Devolve (digits, warning). Documento inválido vira AVISO (não erro) e é
    descartado — o relatório do Infotravel costuma vir com CNPJ corrompido pelo
    Excel em notação científica ("1,85299E+13"), impossível de recuperar."""
    txt = clean_text(raw)
    if not txt:
        return '', ''
    if _SCI_NOTATION_RE.match(txt.replace(' ', '')):
        return '', SCI_NOTATION_MSG
    digits = only_digits(txt)
    if not digits:
        return '', ''
    if not validate(digits):
        return '', 'inválido — campo ignorado.'
    return digits, ''


def normalize_status(raw, unit_category=''):
    """'active' | 'pending' | 'inactive'. A "Unidade Categoria" Desativado do
    Infotravel força inativa mesmo com Ativo?=Sim."""
    if 'desativado' in _fold(unit_category):
        return 'inactive'
    f = _fold(raw)
    if not f:
        return 'active'
    if f in _STATUS_INACTIVE:
        return 'inactive'
    if f in _STATUS_PENDING:
        return 'pending'
    if f in _STATUS_ACTIVE:
        return 'active'
    return 'active'


def parse_commission(raw):
    """"12%", "12,5", "13" → Decimal. Retorna (valor|None, warning)."""
    txt = clean_text(raw)
    if not txt:
        return None, ''
    m = re.search(r'[-+]?\d+(?:[.,]\d+)?', txt)
    if not m:
        return None, f'Comissão "{txt}" não reconhecida — ignorada.'
    try:
        val = Decimal(m.group(0).replace(',', '.'))
    except InvalidOperation:
        return None, f'Comissão "{txt}" não reconhecida — ignorada.'
    if val < 0 or val > 100:
        return None, f'Comissão "{txt}" fora de 0–100% — ignorada.'
    return val, ''


_PIX_TYPES = {'cpf', 'cnpj', 'email', 'telefone', 'aleatorio'}


def normalize_pix(raw_type, raw_key):
    """Melhor esforço: extrai uma chave PIX plausível e deduz o tipo. Textos
    como "Aguardando PIX" são descartados em silêncio."""
    key = clean_text(raw_key)
    ptype = _fold(raw_type).replace('aleatoria', 'aleatorio')
    ptype = ptype if ptype in _PIX_TYPES else ''
    if not key:
        return '', ''
    # E-mail no meio do texto ("e-mail: fulano@x.com")
    m = re.search(r'[^@\s;,]+@[^@\s;,]+\.[^@\s;,]+', key)
    if m:
        return (ptype or 'email'), m.group(0)
    digits = only_digits(key)
    if digits and _SCI_NOTATION_RE.match(key.replace(' ', '')):
        return '', ''            # corrompido pelo Excel
    if len(digits) == 14 and validate_cnpj(digits):
        return (ptype or 'cnpj'), digits
    if len(digits) == 11 and validate_cpf(digits):
        return (ptype or 'cpf'), digits
    if 10 <= len(digits) <= 13:
        return (ptype or 'telefone'), digits
    # Sem cara de chave (ex.: "Aguardando PIX", nome de banco…) → descarta.
    if not re.fullmatch(r'[A-Za-z0-9\-]{20,}', key):
        return '', ''
    return (ptype or 'aleatorio'), key[:200]


def _cut(s, n):
    return (s or '')[:n]


def normalize_row(raw):
    """Normaliza uma linha crua. Retorna (normalized, errors, warnings)."""
    errors, warnings = [], []

    name         = _cut(clean_text(raw.get('name')), 200)
    company_name = _cut(clean_text(raw.get('company_name')), 200)
    if not name and not company_name:
        errors.append('Nome e Razão Social em branco.')

    doc_corrupted = False
    cnpj, w = _normalize_document(raw.get('cnpj'), validate_cnpj)
    if w:
        warnings.append(f'CNPJ {w}')
        doc_corrupted = doc_corrupted or w == SCI_NOTATION_MSG
    cpf, w = _normalize_document(raw.get('cpf'), validate_cpf)
    if w:
        warnings.append(f'CPF {w}')
        doc_corrupted = doc_corrupted or w == SCI_NOTATION_MSG

    # Tipo de pessoa derivado do documento: só CPF → física; senão jurídica.
    person_type = 'fisica' if (cpf and not cnpj) else 'juridica'

    status = normalize_status(raw.get('status'), raw.get('unit_category'))

    email = clean_text(raw.get('email')).lower()
    if email and not _EMAIL_RE.match(email):
        warnings.append(f'E-mail "{email}" inválido — campo ignorado.')
        email = ''

    website = clean_text(raw.get('website'))
    if website and '://' not in website:
        website = 'https://' + website.lstrip('/')

    commission, w = parse_commission(raw.get('commission_rate'))
    if w:
        warnings.append(w)

    pix_key_type, pix_key = normalize_pix(raw.get('pix_key_type'), raw.get('pix_key'))

    normalized = {
        'name': name,
        'company_name': company_name,
        'status': status,
        'person_type': person_type,
        'cnpj': cnpj,
        'cpf': cpf,
        'email': _cut(email, 254),
        'phone': _cut(clean_text(raw.get('phone')), 20),
        'mobile': _cut(clean_text(raw.get('mobile')), 20),
        'website': _cut(website, 300),
        'responsible': _cut(clean_text(raw.get('responsible')), 200),
        'commission_rate': commission,
        'promoter_name': clean_text(raw.get('promoter')),
        'cep': _cut(clean_text(raw.get('cep')), 10),
        'street': _cut(clean_text(raw.get('street')), 200),
        'number': _cut(clean_text(raw.get('number')), 20),
        'complement': _cut(clean_text(raw.get('complement')), 100),
        'neighborhood': _cut(clean_text(raw.get('neighborhood')), 100),
        'city': _cut(clean_text(raw.get('city')), 100),
        'state': _cut(clean_text(raw.get('state')), 50),
        'country': _cut(clean_text(raw.get('country')), 100) or 'Brasil',
        'pix_key_type': pix_key_type,
        'pix_key': _cut(pix_key, 200),
        'notes': clean_text(raw.get('notes')),
        'doc_corrupted': doc_corrupted,
    }
    return normalized, errors, warnings


_LEGAL_SUFFIX_RE = re.compile(
    r'\b(ltda|limitada|me|epp|eireli|s ?a|s/a|sa|cia|companhia|eppme)\b')


def name_key(name, company_name=''):
    """Nome reduzido à sua essência, para comparar cadastros.

    Tira acento, pontuação e sufixo societário, e colapsa espaços — assim
    "MECATUR VIAGENS LTDA" e "Mecatur Viagens" viram a mesma chave, mas
    "KAYSER VIAGENS - UNIDADE FELIZ" e "KAYSER VIAGENS - UNIDADE NOVA
    PETRÓPOLIS" continuam diferentes (são duas filiais)."""
    f = _fold(name or company_name)
    f = re.sub(r'[^a-z0-9 ]', ' ', f)
    f = _LEGAL_SUFFIX_RE.sub(' ', f)
    return re.sub(r'\s+', ' ', f).strip()


def email_name_key(email, name, company_name=''):
    """Identificador de fallback quando não há CNPJ/CPF: e-mail + nome.

    Vale '' se faltar um dos dois (aí não dá para identificar nada)."""
    e = (email or '').strip().lower()
    n = name_key(name, company_name)
    return f'{e}|{n}' if e and n else ''


def dedup_key_name(name, company_name, city):
    """Chave secundária de duplicidade: nome de exibição + cidade normalizados."""
    return '|'.join(_fold(x) for x in (name or company_name, city))


class PromoterIndex:
    """Resolve o nome do promotor do CSV ("Luciano - Promotor") para um usuário
    marcado como promotor (UserPermissions.is_promoter)."""
    def __init__(self):
        from django.contrib.auth.models import User
        self.by_full, self.by_first = {}, {}
        qs = (User.objects.filter(is_active=True, permissions__is_promoter=True)
                          .values('id', 'first_name', 'last_name'))
        for u in qs:
            full = _fold(f"{u['first_name']} {u['last_name']}")
            first = _fold(u['first_name'])
            if full:
                self.by_full.setdefault(full, u['id'])
            if first:
                self.by_first.setdefault(first, set()).add(u['id'])

    def find(self, raw):
        """Retorna (user_id|None). Tenta o nome completo e vai encurtando; por
        fim tenta só o primeiro nome (se for único entre os promotores)."""
        f = _fold(raw)
        f = re.sub(r'\bpromotora?\b', '', f)
        f = re.sub(r'\s+', ' ', f).strip()
        if not f:
            return None
        tokens = f.split(' ')
        for k in range(len(tokens), 0, -1):
            cand = ' '.join(tokens[:k])
            if cand in self.by_full:
                return self.by_full[cand]
        ids = self.by_first.get(tokens[0])
        if ids and len(ids) == 1:
            return next(iter(ids))
        return None


class ExistingIndex:
    """Índices em memória das agências atuais, p/ achar duplicidade em O(1)."""
    def __init__(self):
        self.by_cnpj, self.by_cpf, self.by_email_name, self.by_name = {}, {}, {}, {}
        qs = (Agency.objects.filter(is_deleted=False).exclude(status='rascunho')
                    .values('id', 'cnpj', 'cpf', 'email', 'name', 'company_name', 'city'))
        for r in qs:
            if r['cnpj']:
                self.by_cnpj.setdefault(only_digits(r['cnpj']), r['id'])
            if r['cpf']:
                self.by_cpf.setdefault(only_digits(r['cpf']), r['id'])
            key = email_name_key(r['email'], r['name'], r['company_name'])
            if key:
                self.by_email_name.setdefault(key, r['id'])
            self.by_name.setdefault(
                dedup_key_name(r['name'], r['company_name'], r['city']), r['id'])

    def find_strong(self, n):
        """Match forte por identificador (CNPJ > CPF > e-mail+nome).

        E-mail SOZINHO não identifica agência: o mesmo e-mail aparece em
        filiais da mesma rede e em agências diferentes do mesmo dono. Ver
        `email_name_key`."""
        if n['cnpj'] and n['cnpj'] in self.by_cnpj:
            return self.by_cnpj[n['cnpj']], 'CNPJ'
        if n['cpf'] and n['cpf'] in self.by_cpf:
            return self.by_cpf[n['cpf']], 'CPF'
        key = email_name_key(n['email'], n['name'], n['company_name'])
        if key and key in self.by_email_name:
            return self.by_email_name[key], 'e-mail e nome'
        return None, ''

    def find_name(self, n):
        return self.by_name.get(dedup_key_name(n['name'], n['company_name'], n['city']))


def analyze_rows(raw_rows):
    """Classifica cada linha. Retorna (results, summary).

    action ∈ {'new','update','duplicate','error'}:
      - error     → tem erro (não será aplicada)
      - update    → match forte (CNPJ/CPF/e-mail) numa agência existente
      - duplicate → sem match forte, mas nome+cidade batem (possível duplicidade)
      - new       → não existe
    """
    idx = ExistingIndex()
    promoters = PromoterIndex()
    results = []
    seen_strong = {}   # identificador → linha (duplicidade DENTRO do arquivo)
    seen_email  = {}   # e-mail → linha (só aviso: e-mail é compartilhado)
    seen_target = {}   # id de agência existente → linha (evita sobrescrita)
    counts = {'new': 0, 'update': 0, 'duplicate': 0, 'error': 0, 'total': 0,
              'corrupted_docs': 0}

    for i, raw in enumerate(raw_rows):
        line = i + 2  # +1 header, +1 base-1
        normalized, errors, warnings = normalize_row(raw)

        if raw.get('_ncols'):
            got, expected = raw['_ncols']
            errors.append(
                f'Linha malformada: {got} colunas, mas o cabeçalho tem {expected} — '
                f'os campos estão deslocados (aspas ou separador sobrando no meio '
                f'de um texto). Corrija esta linha no arquivo e importe de novo.')

        # Promotor: resolve por nome contra os usuários-promotores.
        promoter_id = None
        if normalized['promoter_name']:
            promoter_id = promoters.find(normalized['promoter_name'])
            if promoter_id is None:
                warnings.append(
                    f'Promotor "{normalized["promoter_name"]}" não encontrado — deixado em branco.')
        normalized['promoter_id'] = promoter_id

        existing_id, matched_by = idx.find_strong(normalized)

        # Duplicidade dentro do próprio arquivo. Só bloqueia quando as duas
        # linhas são MESMO o mesmo cadastro: mesmo CNPJ, mesmo CPF, ou mesmo
        # e-mail COM o mesmo nome. E-mail sozinho não conta — matriz e filial
        # compartilham e-mail, e um dono com duas agências também.
        if not errors:
            keys = [('CNPJ', f'cnpj:{normalized["cnpj"]}' if normalized['cnpj'] else ''),
                    ('CPF', f'cpf:{normalized["cpf"]}' if normalized['cpf'] else ''),
                    ('e-mail e nome',
                     f'en:{email_name_key(normalized["email"], normalized["name"], normalized["company_name"])}'
                     if email_name_key(normalized['email'], normalized['name'],
                                       normalized['company_name']) else '')]
            for label, key in keys:
                if not key:
                    continue
                if key in seen_strong:
                    errors.append(
                        f'Linha duplicada no arquivo (mesmo {label} da linha {seen_strong[key]}).')
                    break
                seen_strong[key] = line

        # Duas linhas caindo sobre a MESMA agência já cadastrada: a segunda
        # sobrescreveria a primeira em silêncio.
        if not errors and existing_id:
            if existing_id in seen_target:
                errors.append(
                    f'Esta linha e a linha {seen_target[existing_id]} atualizariam a mesma '
                    f'agência já cadastrada (casaram por {matched_by}) — mantenha só uma.')
            else:
                seen_target[existing_id] = line

        # E-mail repetido com nome diferente: legítimo (filial, mesmo dono),
        # mas vale o aviso para o operador conferir.
        if not errors and normalized['email']:
            other = seen_email.get(normalized['email'])
            if other:
                warnings.append(
                    f'Mesmo e-mail da linha {other}, com nome diferente — '
                    f'serão duas agências. Se for a mesma, remova uma.')
            else:
                seen_email[normalized['email']] = line

        # `matched_by` explica POR QUE a linha casou com um cadastro existente.
        # Fica num campo próprio (não em warnings): o selo da linha já diz
        # "Atualizar"/"Duplicada", e assim o filtro "com aviso" continua
        # apontando só problemas de verdade (documento corrompido, promotor
        # não encontrado, e-mail inválido…).
        if errors:
            action = 'error'
        elif existing_id:
            action = 'update'
        elif idx.find_name(normalized):
            action = 'duplicate'
            matched_by = 'nome e cidade'
        else:
            action = 'new'

        counts[action] += 1
        counts['total'] += 1
        if normalized['doc_corrupted']:
            counts['corrupted_docs'] += 1
        results.append({
            'line': line,
            'raw': raw,
            'normalized': {**normalized,
                           'commission_rate': (str(normalized['commission_rate'])
                                               if normalized['commission_rate'] is not None else ''),
                           'status_label': STATUS_LABELS.get(normalized['status'], ''),
                           'cnpj_display': format_cnpj(normalized['cnpj']) if normalized['cnpj'] else '',
                           'cpf_display': format_cpf(normalized['cpf']) if normalized['cpf'] else ''},
            'existing_id': existing_id,
            'action': action,
            'matched_by': matched_by,
            'errors': errors,
            'warnings': warnings,
        })
    return results, counts


# Campos gravados na aplicação (identidade/contato/endereço/PIX/observações).
EDITABLE = [
    'name', 'company_name', 'status', 'person_type', 'cnpj', 'cpf', 'email',
    'phone', 'mobile', 'website', 'responsible', 'cep', 'street', 'number',
    'complement', 'neighborhood', 'city', 'state', 'country',
    'pix_key_type', 'pix_key', 'notes',
]


@transaction.atomic
def apply_rows(raw_rows, mode, user):
    """Aplica a importação. mode ∈ {'create','upsert','delete'}:
      - create → cria só as novas (ignora existentes)
      - upsert → cria novas e atualiza as que casaram por identificador forte
      - delete → NÃO cria nada; manda para a lixeira as agências do arquivo que
                 casaram com um cadastro existente (soft-delete, reversível)

    Transacional: erro geral desfaz tudo. Linhas com erro são puladas. Cada
    gravação passa pelo save() normal → auditada automaticamente (origem CSV
    via header X-Audit-Source). Importação NÃO provisiona usuário admin da
    agência (isso é só do fluxo de cadastro manual). Retorna o resumo.
    """
    results, _counts = analyze_rows(raw_rows)
    summary = {'total': len(results), 'created': 0, 'updated': 0, 'deleted': 0,
               'skipped': 0, 'duplicated': 0, 'errors': 0, 'error_rows': []}

    for r in results:
        n, action = r['normalized'], r['action']
        if action == 'error':
            summary['errors'] += 1
            summary['error_rows'].append({
                'line': r['line'],
                'name': n.get('name') or n.get('company_name') or '',
                'errors': r['errors'],
            })
            continue

        # Modo excluir: só mexe em quem foi encontrado; o resto é ignorado
        # (não existe "excluir uma agência que não está cadastrada").
        if mode == 'delete':
            if action != 'update':
                summary['skipped'] += 1
                continue
            obj = Agency.objects.filter(pk=r['existing_id'], is_deleted=False).first()
            if not obj:
                summary['skipped'] += 1
                continue
            obj.is_deleted = True
            obj.deleted_at = timezone.now()
            obj.save(update_fields=['is_deleted', 'deleted_at'])
            summary['deleted'] += 1
            continue

        commission = Decimal(n['commission_rate']) if n['commission_rate'] else None

        if action == 'update':
            if mode != 'upsert':
                summary['skipped'] += 1
                continue
            obj = Agency.objects.filter(pk=r['existing_id'], is_deleted=False).first()
            if not obj:
                obj = Agency(created_by=user)   # sumiu no meio do caminho → cria
            for f in EDITABLE:
                setattr(obj, f, n[f])
            if commission is not None:
                obj.commission_rate = commission
            if n['promoter_id']:
                obj.promoter_id = n['promoter_id']
            if obj.created_by is None:
                obj.created_by = user
            obj.save()
            summary['updated'] += 1
            continue

        # 'new' ou 'duplicate' → cria
        obj = Agency(created_by=user, **{f: n[f] for f in EDITABLE})
        obj.commission_rate = commission
        obj.promoter_id = n['promoter_id']
        obj.save()
        summary['created'] += 1
        if action == 'duplicate':
            summary['duplicated'] += 1

    return summary
