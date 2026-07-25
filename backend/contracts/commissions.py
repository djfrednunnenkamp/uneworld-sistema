"""Serviço central de COMISSÕES DOS VENDEDORES — fonte única de verdade dos números.

Tudo aqui deriva dos CONTRATOS reais; nada é inventado. Cards, tabela, gráficos,
detalhamento e exportação usam ESTAS funções, então "soma dos vendedores == total
consolidado" por construção.

Definições financeiras (confirmadas no modelo/serializer de contratos):
  • Valor vendido  = Contract.total_brl  (valor final ao cliente; comissão embutida)
  • Comissão da agência = comissão bruta = subtotal por pessoa (SEM taxas) ×
    agency.commission_rate% , convertida a BRL pelo câmbio DO CONTRATO. É a MESMA
    fórmula de ContractSerializer._commission_usd/_recalc_totals (embutida no total).
  • Valor NET      = valor vendido − comissão da agência (o que a operadora recebe).
  Sem agência/sem taxa cadastrada → comissão 0 e NET == vendido.

Comissão INDIVIDUAL do vendedor: NÃO existe regra no sistema (nem campo, nem base,
nem percentual). Não é inventada aqui — fica como pendência de configuração.

Moeda: consolidamos em BRL usando o câmbio JÁ GRAVADO em cada contrato (nunca o
câmbio atual). Dinheiro é sempre Decimal.
"""
from decimal import Decimal
from datetime import date

from django.db.models import Q, Count
from django.db.models.functions import Coalesce, TruncDate

from users_api.permissions import agency_scope_ids, has_any_perm
from .models import Contract

CENT = Decimal('0.01')

# ── Política de STATUS: o que conta como venda ──────────────────────────────
# Etapas do contrato (Contract.STAGE_CHOICES): em_edicao → enviado → assinado/
# revisao → a_faturar → em_pagamento → faturado. status: rascunho/ativo/cancelado.
CONFIRMED_STAGES = {'assinado', 'revisao', 'aprovado', 'a_faturar', 'em_pagamento', 'faturado'}
PENDING_STAGES   = {'enviado'}          # enviado p/ assinatura, ainda não fechado
PAID_STAGES      = {'faturado'}         # pagos (financeiro concluiu)

# Grupos que a UI pode pedir via ?situacao=
SITUACAO_FILTERS = {
    'confirmadas': lambda qs: qs.filter(status='ativo', stage__in=CONFIRMED_STAGES),
    'pendentes':   lambda qs: qs.filter(status='ativo', stage__in=PENDING_STAGES),
    'pagas':       lambda qs: qs.filter(status='ativo', stage__in=PAID_STAGES),
    'canceladas':  lambda qs: qs.filter(status='cancelado'),
    'todas':       lambda qs: qs,
}
DEFAULT_SITUACAO = 'confirmadas'


def can_view_all(user):
    """Ver as vendas de TODOS os vendedores? Senão, vê só as próprias."""
    return has_any_perm(user, 'commissions_view_all')


# ── Queryset base (segurança: escopo de agência + "só as próprias") ─────────
def base_queryset(user):
    """Contratos que ESTE usuário pode ver em Comissões. Aplica o escopo de agência
    (usuário de agência só vê a própria) e, sem `commissions_view_all`, limita às
    vendas do próprio usuário (seller OU created_by) — proteção contra IDOR."""
    qs = (Contract.objects.filter(is_deleted=False)
          .select_related('agency', 'seller', 'seller__permissions',
                          'created_by', 'created_by__permissions', 'itinerary')
          .prefetch_related('accommodation_lines')
          .annotate(_pax=Count('guests', distinct=True),
                    sale_date=Coalesce('contract_date', TruncDate('created_at'))))
    scope = agency_scope_ids(user)
    if scope is not None:
        qs = qs.filter(agency_id__in=scope)
    if not can_view_all(user):
        qs = qs.filter(Q(seller=user) | Q(created_by=user))
    return qs


def apply_filters(qs, *, situacao=None, date_from=None, date_to=None, year=None,
                  seller_id=None, agency_id=None, itinerary_id=None):
    """Filtros comuns. A data usada é a DATA DA VENDA = contract_date (senão a data
    de criação) — anotada como `sale_date`."""
    fn = SITUACAO_FILTERS.get(situacao or DEFAULT_SITUACAO, SITUACAO_FILTERS[DEFAULT_SITUACAO])
    qs = fn(qs)
    if year:
        qs = qs.filter(sale_date__year=int(year))
    if date_from:
        qs = qs.filter(sale_date__gte=date_from)
    if date_to:
        qs = qs.filter(sale_date__lte=date_to)
    if agency_id:
        qs = qs.filter(agency_id=agency_id)
    if itinerary_id:
        qs = qs.filter(itinerary_id=itinerary_id)
    if seller_id:
        # Vendedor efetivo = seller OU (na falta) created_by.
        qs = qs.filter(Q(seller_id=seller_id) | (Q(seller__isnull=True) & Q(created_by_id=seller_id)))
    return qs


# ── Financeiro por contrato (mesma fórmula do serializer) ───────────────────
def commission_usd(contract):
    """Comissão bruta da agência em USD — subtotal por pessoa (sem taxas) × %.
    Espelha ContractSerializer._commission_usd (fonte única da regra)."""
    rate = contract.agency.commission_rate if contract.agency_id else None
    if not rate:
        return Decimal('0')
    subtotal = sum((l.value_per_person_usd or Decimal('0')) * l.quantity
                   for l in contract.accommodation_lines.all())
    comm = Decimal(subtotal) * (rate / Decimal('100'))
    return comm.quantize(CENT) if comm else Decimal('0')


def effective_seller(contract):
    """Vendedor da operadora efetivo: seller, senão o criador. (id, nome, avatar_url)."""
    u = contract.seller or contract.created_by
    if not u:
        return (None, '', None)
    name = f'{u.first_name} {u.last_name}'.strip() or u.email or u.username
    perms = getattr(u, 'permissions', None)
    avatar = perms.avatar.url if (perms and perms.avatar) else None
    return (u.id, name, avatar)


def contract_financials(contract):
    """Dict com os valores da venda em BRL/USD (Decimal). `has_value` marca contratos
    sem total calculado (aparecem como 'requer revisão', nunca somem)."""
    rate = contract.exchange_rate or Decimal('0')
    comm_usd = commission_usd(contract)
    comm_brl = (comm_usd * rate).quantize(CENT) if rate else Decimal('0')
    sold_brl = contract.total_brl
    sold_usd = contract.total_usd
    net_brl = (sold_brl - comm_brl) if sold_brl is not None else None
    sid, sname, savatar = effective_seller(contract)
    return {
        'sold_brl': sold_brl, 'sold_usd': sold_usd,
        'agency_commission_brl': comm_brl, 'agency_commission_usd': comm_usd,
        'net_brl': net_brl,
        'has_value': sold_brl is not None,
        'currency': contract.base_currency or 'USD',
        'exchange_rate': rate or None,
        'passengers': getattr(contract, '_pax', None) if getattr(contract, '_pax', None) is not None else contract.guests.count(),
        'sale_date': getattr(contract, 'sale_date', None) or contract.contract_date or (contract.created_at.date() if contract.created_at else None),
        'seller_id': sid, 'seller_name': sname or 'Sem vendedor atribuído', 'seller_avatar': savatar,
        'agency_id': contract.agency_id, 'agency_name': (contract.agency.name if contract.agency_id else None),
    }


def _blank_agg():
    return {'contracts': 0, 'passengers': 0,
            'sold_brl': Decimal('0'), 'net_brl': Decimal('0'),
            'agency_commission_brl': Decimal('0'), 'missing_value': 0}


def _add(agg, fin):
    agg['contracts'] += 1
    agg['passengers'] += int(fin['passengers'] or 0)
    agg['sold_brl'] += fin['sold_brl'] or Decimal('0')
    agg['net_brl'] += fin['net_brl'] or Decimal('0')
    agg['agency_commission_brl'] += fin['agency_commission_brl'] or Decimal('0')
    if not fin['has_value']:
        agg['missing_value'] += 1


def _money(d):
    return str((d or Decimal('0')).quantize(CENT))


def summarize(qs):
    """Totais consolidados do conjunto (para os cards)."""
    agg = _blank_agg()
    for c in qs:
        _add(agg, contract_financials(c))
    contracts = agg['contracts']
    avg_contract = (agg['sold_brl'] / contracts).quantize(CENT) if contracts else Decimal('0')
    avg_pax = (agg['sold_brl'] / agg['passengers']).quantize(CENT) if agg['passengers'] else Decimal('0')
    return {
        'contracts': contracts, 'passengers': agg['passengers'],
        'sold_brl': _money(agg['sold_brl']), 'net_brl': _money(agg['net_brl']),
        'agency_commission_brl': _money(agg['agency_commission_brl']),
        'avg_ticket_contract_brl': _money(avg_contract),
        'avg_ticket_passenger_brl': _money(avg_pax),
        'missing_value': agg['missing_value'],
    }


def by_seller(qs):
    """Agregado por vendedor (ranking). Contratos sem vendedor caem em id=None."""
    groups = {}
    for c in qs:
        fin = contract_financials(c)
        key = fin['seller_id']
        g = groups.setdefault(key, {'seller_id': key, 'seller_name': fin['seller_name'],
                                    'seller_avatar': fin['seller_avatar'], **_blank_agg()})
        _add(g, fin)
    total_sold = sum((g['sold_brl'] for g in groups.values()), Decimal('0'))
    rows = []
    for g in groups.values():
        contracts = g['contracts']
        share = (g['sold_brl'] / total_sold * 100).quantize(CENT) if total_sold else Decimal('0')
        rows.append({
            'seller_id': g['seller_id'], 'seller_name': g['seller_name'], 'seller_avatar': g.get('seller_avatar'),
            'contracts': contracts, 'passengers': g['passengers'],
            'sold_brl': _money(g['sold_brl']), 'net_brl': _money(g['net_brl']),
            'agency_commission_brl': _money(g['agency_commission_brl']),
            'avg_ticket_brl': _money((g['sold_brl'] / contracts).quantize(CENT) if contracts else Decimal('0')),
            'share_pct': str(share), 'missing_value': g['missing_value'],
        })
    rows.sort(key=lambda r: Decimal(r['sold_brl']), reverse=True)
    return rows


def timeseries(qs, metric='sold_brl'):
    """Série mensal (YYYY-MM) da métrica escolhida — para o gráfico de evolução.
    metric ∈ sold_brl|net_brl|agency_commission_brl|contracts|passengers."""
    buckets = {}
    for c in qs:
        fin = contract_financials(c)
        d = fin['sale_date']
        if not d:
            continue
        key = f'{d.year:04d}-{d.month:02d}'
        b = buckets.setdefault(key, _blank_agg())
        _add(b, fin)
    out = []
    for key in sorted(buckets):
        b = buckets[key]
        if metric in ('contracts', 'passengers'):
            val = b[metric]
        else:
            val = str(b.get(metric, Decimal('0')).quantize(CENT))
        out.append({'period': key, 'value': val,
                    'contracts': b['contracts'], 'passengers': b['passengers'],
                    'sold_brl': _money(b['sold_brl']), 'net_brl': _money(b['net_brl']),
                    'agency_commission_brl': _money(b['agency_commission_brl'])})
    return out


def available_years(user):
    """Anos com contratos visíveis a este usuário (para o filtro — NUNCA fixos)."""
    qs = base_queryset(user)
    ys = qs.dates('contract_date', 'year')
    years = sorted({d.year for d in ys} | {c.year for c in qs.dates('created_at', 'year')}, reverse=True)
    return years or [date.today().year]
