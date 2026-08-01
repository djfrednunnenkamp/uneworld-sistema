"""Importação de fornecedores por CSV.

Fluxo espelhado no importador de geografia (config_api): um passo de ANÁLISE
(classifica cada linha, sem gravar) e um passo de APLICAÇÃO (transacional). O
servidor SEMPRE re-normaliza e re-classifica a partir dos dados crus — nunca
confia na normalização feita no front.

Sem dependências externas (só stdlib csv/io). CPF/CNPJ/código são tratados
como TEXTO (identificadores) para preservar zeros à esquerda.
"""
import csv
import io

from django.db import transaction

from .models import Fornecedor
from .normalize import (
    _fold, only_digits, validate_cpf, validate_cnpj, normalize_status,
    normalize_category, normalize_airline_abbr, clean_text,
    dedup_key_name, CATEGORY_LABELS,
)

MAX_ROWS = 20000            # trava de segurança contra arquivos gigantes
MAX_BYTES = 12 * 1024 * 1024  # 12 MB

# Colunas canônicas na ordem oficial (usada no modelo e na exportação).
CANON_COLUMNS = [
    ('name',             'Nome'),
    ('status',           'Status'),
    ('category',         'Categoria'),
    ('airline_abbr',     'Abreviatura Cia'),
    ('city',             'Cidade'),
    ('country',          'País'),
    ('cpf',              'CPF'),
    ('cnpj',             'CNPJ'),
    ('company_name',     'Razão Social'),
    ('supplier_network', 'Rede Fornecedor'),
]
CANON_LABELS = {k: v for k, v in CANON_COLUMNS}

# Cabeçalhos aceitos (folded) → campo canônico.
HEADER_ALIASES = {
    'nome': 'name', 'name': 'name', 'fornecedor': 'name',
    'status': 'status', 'situacao': 'status',
    'categoria': 'category', 'category': 'category', 'tipo': 'category',
    'abreviatura cia': 'airline_abbr', 'abreviatura': 'airline_abbr',
    'sigla': 'airline_abbr', 'sigla cia': 'airline_abbr', 'cia': 'airline_abbr',
    'cidade': 'city', 'city': 'city',
    'pais': 'country', 'country': 'country',
    'cpf': 'cpf',
    'cnpj': 'cnpj',
    'razao social': 'company_name', 'razao': 'company_name', 'company': 'company_name',
    'rede fornecedor': 'supplier_network', 'rede': 'supplier_network',
}


class ImportError_(ValueError):
    """Erro geral de arquivo (aborta tudo antes de qualquer linha)."""


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
    # utf-8-sig remove o BOM; se falhar, tenta latin-1 (planilhas antigas).
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

    # Mapeia cada coluna do arquivo para um campo canônico (ou None).
    col_field = []
    mapping = {}
    for h in header:
        field = HEADER_ALIASES.get(_fold(h))
        col_field.append(field)
        if field and field not in mapping:
            mapping[field] = (h or '').strip()

    if 'name' not in mapping:
        raise ImportError_('Coluna "Nome" não encontrada no arquivo.')

    rows = []
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
        rows.append(raw)
        if len(rows) > MAX_ROWS:
            raise ImportError_(f'Arquivo excede o limite de {MAX_ROWS} linhas.')
    return rows, mapping


def normalize_row(raw):
    """Normaliza uma linha crua. Retorna (normalized, errors, warnings)."""
    errors, warnings = [], []

    name = clean_text(raw.get('name'))
    if not name:
        errors.append('Nome em branco.')

    status = normalize_status(raw.get('status'))
    if raw.get('status') and _fold(raw.get('status')) and status == 'ativo' \
            and _fold(raw.get('status')) not in ('ativo', 'ativa', 'active', 'a', '1', 'sim', 's', 'true', 'habilitado'):
        warnings.append(f'Status "{clean_text(raw.get("status"))}" não reconhecido — assumido Ativo.')

    category, matched = normalize_category(raw.get('category'))
    if raw.get('category') and not matched:
        warnings.append(f'Categoria "{clean_text(raw.get("category"))}" não reconhecida — classificada como Outros.')

    cpf = only_digits(raw.get('cpf'))
    if cpf and not validate_cpf(cpf):
        errors.append('CPF inválido.')

    cnpj = only_digits(raw.get('cnpj'))
    if cnpj and not validate_cnpj(cnpj):
        errors.append('CNPJ inválido.')

    # Tipo de pessoa derivado do documento: só CPF → física; senão jurídica.
    person_type = 'fisica' if (cpf and not cnpj) else 'juridica'

    normalized = {
        'name': name,
        'status': status,
        'category': category,
        'person_type': person_type,
        'airline_abbr': normalize_airline_abbr(raw.get('airline_abbr')),
        'city': clean_text(raw.get('city')),
        'country': clean_text(raw.get('country')),
        'cpf': cpf,
        'cnpj': cnpj,
        'company_name': clean_text(raw.get('company_name')),
        'supplier_network': clean_text(raw.get('supplier_network')),
    }
    return normalized, errors, warnings


class ExistingIndex:
    """Índices em memória dos fornecedores atuais, p/ achar duplicidade em O(1)."""
    def __init__(self):
        self.by_cnpj, self.by_cpf, self.by_name = {}, {}, {}
        qs = Fornecedor.objects.filter(is_deleted=False).values(
            'id', 'cnpj', 'cpf', 'name', 'city', 'country')
        for r in qs:
            if r['cnpj']:
                self.by_cnpj.setdefault(r['cnpj'], r['id'])
            if r['cpf']:
                self.by_cpf.setdefault(r['cpf'], r['id'])
            self.by_name.setdefault(dedup_key_name(r['name'], r['city'], r['country']), r['id'])

    def find_strong(self, n):
        """Match forte por identificador (CNPJ > CPF)."""
        if n['cnpj'] and n['cnpj'] in self.by_cnpj:
            return self.by_cnpj[n['cnpj']], 'CNPJ'
        if n['cpf'] and n['cpf'] in self.by_cpf:
            return self.by_cpf[n['cpf']], 'CPF'
        return None, ''

    def find_name(self, n):
        return self.by_name.get(dedup_key_name(n['name'], n['city'], n['country']))


def analyze_rows(raw_rows):
    """Classifica cada linha. Retorna (results, summary).

    action ∈ {'new','update','duplicate','error'}:
      - error     → tem erro (não será aplicada)
      - update    → match forte (código/CNPJ/CPF) num existente
      - duplicate → sem match forte, mas nome+cidade+país batem (possível duplicidade)
      - new       → não existe
    """
    idx = ExistingIndex()
    results = []
    seen_strong = {}   # detecta duplicidade DENTRO do arquivo
    counts = {'new': 0, 'update': 0, 'duplicate': 0, 'error': 0, 'total': 0}

    for i, raw in enumerate(raw_rows):
        line = i + 2  # +1 header, +1 base-1
        normalized, errors, warnings = normalize_row(raw)

        existing_id, matched_by = idx.find_strong(normalized)

        # Duplicidade dentro do próprio arquivo (mesmo identificador forte).
        strong_key = normalized['cnpj'] or normalized['cpf']
        if strong_key and not errors:
            if strong_key in seen_strong:
                errors.append(f'Linha duplicada no arquivo (mesmo identificador da linha {seen_strong[strong_key]}).')
            else:
                seen_strong[strong_key] = line

        if errors:
            action = 'error'
        elif existing_id:
            action = 'update'
            warnings.append(f'Fornecedor existente encontrado por {matched_by} — será atualizado.')
        elif idx.find_name(normalized):
            action = 'duplicate'
            warnings.append('Já existe um fornecedor com nome, cidade e país iguais — confira se não é duplicado.')
        else:
            action = 'new'

        counts[action] += 1
        counts['total'] += 1
        results.append({
            'line': line,
            'raw': raw,
            'normalized': {**normalized,
                           'status_label': 'Ativo' if normalized['status'] == 'ativo' else 'Inativo',
                           'category_label': CATEGORY_LABELS.get(normalized['category'], '')},
            'existing_id': existing_id,
            'action': action,
            'errors': errors,
            'warnings': warnings,
        })
    return results, counts


@transaction.atomic
def apply_rows(raw_rows, mode, user):
    """Aplica a importação. mode ∈ {'create','upsert'}:
      - create → cria só os novos (ignora existentes)
      - upsert → cria novos e atualiza os que casaram por identificador forte

    Transacional: erro geral desfaz tudo. Linhas com erro são puladas. Cada
    gravação passa pelo save() normal → auditada automaticamente (origem CSV
    via header X-Audit-Source). Retorna o resumo com contagens e erros.
    """
    results, _counts = analyze_rows(raw_rows)
    summary = {'total': len(results), 'created': 0, 'updated': 0,
               'skipped': 0, 'duplicated': 0, 'errors': 0, 'error_rows': []}
    editable = {'name', 'status', 'category', 'person_type', 'airline_abbr', 'city', 'country',
                'cpf', 'cnpj', 'company_name', 'supplier_network'}

    for r in results:
        n, action = r['normalized'], r['action']
        if action == 'error':
            summary['errors'] += 1
            summary['error_rows'].append({'line': r['line'], 'name': n.get('name', ''),
                                          'errors': r['errors']})
            continue
        if action == 'update':
            if mode != 'upsert':
                summary['skipped'] += 1
                continue
            obj = Fornecedor.objects.filter(pk=r['existing_id'], is_deleted=False).first()
            if not obj:
                # sumiu no meio do caminho → cria como novo
                obj = Fornecedor(created_by=user)
            for f in editable:
                setattr(obj, f, n[f])
            if obj.created_by is None:
                obj.created_by = user
            obj.save()
            summary['updated'] += 1
            continue
        # 'new' ou 'duplicate' → cria
        obj = Fornecedor(created_by=user, **{f: n[f] for f in editable})
        obj.save()
        summary['created'] += 1
        if action == 'duplicate':
            summary['duplicated'] += 1

    return summary
