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
#
# Regra do negócio: só conta como VENDIDO DE FATO quando o contrato já passou pela
# revisão E pela verificação do financeiro — ou seja, de "Em pagamento" em diante
# (em_pagamento e faturado). Antes disso (enviado/assinado/revisão/a faturar) é
# venda em andamento (pendente), ainda não confirmada.
CONFIRMED_STAGES = {'em_pagamento', 'faturado'}
PENDING_STAGES   = {'enviado', 'assinado', 'revisao', 'aprovado', 'a_faturar'}
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


def apply_filters(qs, *, situacao=None, date_from=None, date_to=None, year=None, month=None,
                  seller_id=None, agency_id=None, itinerary_id=None):
    """Filtros comuns. A data usada é a DATA DA VENDA = contract_date (senão a data
    de criação) — anotada como `sale_date`. Ano/mês filtram por essa data; para o dia
    exato use date_from/date_to."""
    fn = SITUACAO_FILTERS.get(situacao or DEFAULT_SITUACAO, SITUACAO_FILTERS[DEFAULT_SITUACAO])
    qs = fn(qs)
    if year:
        qs = qs.filter(sale_date__year=int(year))
    if month:
        qs = qs.filter(sale_date__month=int(month))
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


# ── Financeiro por contrato — TRÊS valores (regra do negócio) ───────────────
# 1) Valor NET   = soma do roteiro SEM a comissão da operadora.
# 2) Valor de venda = NET + nossa comissão (markup da operadora).      = final − comissão da agência
# 3) Preço final = NET + nossa comissão + comissão da agência.          = Contract.total (o cliente paga)
# O markup da operadora é "por divisão" (venda = net / fator) — o fator vem da config
# de preço do roteiro ligado ao contrato; então NET = venda × fator. Sem essa config,
# o NET fica = venda (nossa comissão desconhecida = 0) e o contrato é marcado.
# Tudo em BRL usa o CÂMBIO GRAVADO no contrato (nunca o de hoje). USD é o valor cru.
def commission_usd(contract):
    """Comissão bruta da AGÊNCIA em USD — subtotal por pessoa (sem taxas) × %.
    Espelha ContractSerializer._commission_usd (fonte única da regra)."""
    rate = contract.agency.commission_rate if contract.agency_id else None
    if not rate:
        return Decimal('0')
    subtotal = sum((l.value_per_person_usd or Decimal('0')) * l.quantity
                   for l in contract.accommodation_lines.all())
    comm = Decimal(subtotal) * (rate / Decimal('100'))
    return comm.quantize(CENT) if comm else Decimal('0')


def operator_factor(contract):
    """Fator do markup da OPERADORA (venda = net / fator ⇒ net = venda × fator).
    Vem da config de preço do roteiro ligado ao contrato. None quando indisponível
    (roteiro/config ausente) ou fator fora de (0, 1]."""
    cfg = getattr(contract.itinerary, 'pricing', None) if contract.itinerary_id else None
    if not cfg or cfg.margin_percent is None:
        return None
    m = Decimal(cfg.margin_percent)
    f = m if cfg.margin_mode == 'decimal' else (m / Decimal('100'))
    return f if (Decimal('0') < f <= Decimal('1')) else None


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
    """Os três valores em BRL e USD (Decimal). `has_value` = contrato tem total
    calculado; `has_margin` = deu pra achar o markup da operadora (senão NET=venda)."""
    rate = contract.exchange_rate or Decimal('0')
    comm_usd = commission_usd(contract)
    comm_brl = (comm_usd * rate).quantize(CENT) if rate else Decimal('0')
    final_usd = contract.total_usd
    final_brl = contract.total_brl
    has_value = final_brl is not None
    # Venda (nossa venda, sem a comissão da agência) = final − comissão da agência.
    sale_usd = (final_usd - comm_usd) if final_usd is not None else None
    sale_brl = (final_brl - comm_brl) if final_brl is not None else None
    # NET = venda × fator (markup da operadora). Sem fator → NET = venda.
    factor = operator_factor(contract)
    has_margin = factor is not None and sale_brl is not None
    if has_margin:
        net_brl = (sale_brl * factor).quantize(CENT)
        net_usd = (sale_usd * factor).quantize(CENT) if sale_usd is not None else None
    else:
        net_brl, net_usd = sale_brl, sale_usd
    op_brl = (sale_brl - net_brl) if (sale_brl is not None and net_brl is not None) else Decimal('0')
    op_usd = (sale_usd - net_usd) if (sale_usd is not None and net_usd is not None) else Decimal('0')
    sid, sname, savatar = effective_seller(contract)
    return {
        'net_brl': net_brl, 'net_usd': net_usd,
        'sale_brl': sale_brl, 'sale_usd': sale_usd,
        'final_brl': final_brl, 'final_usd': final_usd,
        'operator_commission_brl': op_brl, 'operator_commission_usd': op_usd,
        'agency_commission_brl': comm_brl, 'agency_commission_usd': comm_usd,
        'has_value': has_value, 'has_margin': has_margin,
        'currency': contract.base_currency or 'USD',
        'exchange_rate': rate or None,
        'passengers': getattr(contract, '_pax', None) if getattr(contract, '_pax', None) is not None else contract.guests.count(),
        'sale_date': getattr(contract, 'sale_date', None) or contract.contract_date or (contract.created_at.date() if contract.created_at else None),
        'seller_id': sid, 'seller_name': sname or 'Sem vendedor atribuído', 'seller_avatar': savatar,
        'agency_id': contract.agency_id, 'agency_name': (contract.agency.name if contract.agency_id else None),
    }


# Chaves de dinheiro somadas (cada uma em BRL e USD).
_MONEY_KEYS = ['net', 'sale', 'final', 'operator_commission', 'agency_commission']


def _blank_agg():
    a = {'contracts': 0, 'passengers': 0, 'missing_value': 0, 'missing_margin': 0}
    for k in _MONEY_KEYS:
        a[f'{k}_brl'] = Decimal('0')
        a[f'{k}_usd'] = Decimal('0')
    return a


def _add(agg, fin):
    agg['contracts'] += 1
    agg['passengers'] += int(fin['passengers'] or 0)
    for k in _MONEY_KEYS:
        agg[f'{k}_brl'] += fin.get(f'{k}_brl') or Decimal('0')
        agg[f'{k}_usd'] += fin.get(f'{k}_usd') or Decimal('0')
    if not fin['has_value']:
        agg['missing_value'] += 1
    if fin['has_value'] and not fin['has_margin']:
        agg['missing_margin'] += 1


def _money(d):
    return str((d or Decimal('0')).quantize(CENT))


def _money_out(agg):
    """Serializa as chaves de dinheiro (brl+usd) do agregado para string."""
    out = {}
    for k in _MONEY_KEYS:
        out[f'{k}_brl'] = _money(agg[f'{k}_brl'])
        out[f'{k}_usd'] = _money(agg[f'{k}_usd'])
    return out


def summarize(qs):
    """Totais consolidados do conjunto (para os cards)."""
    agg = _blank_agg()
    for c in qs:
        _add(agg, contract_financials(c))
    contracts = agg['contracts']
    avg_c = (agg['final_brl'] / contracts).quantize(CENT) if contracts else Decimal('0')
    avg_p = (agg['final_brl'] / agg['passengers']).quantize(CENT) if agg['passengers'] else Decimal('0')
    return {
        'contracts': contracts, 'passengers': agg['passengers'],
        **_money_out(agg),
        'avg_ticket_contract_brl': _money(avg_c),
        'avg_ticket_passenger_brl': _money(avg_p),
        'missing_value': agg['missing_value'], 'missing_margin': agg['missing_margin'],
    }


def by_seller(qs):
    """Agregado por vendedor (ranking). Contratos sem vendedor caem em id=None.
    Participação (%) é sobre o PREÇO FINAL."""
    groups = {}
    for c in qs:
        fin = contract_financials(c)
        key = fin['seller_id']
        g = groups.setdefault(key, {'seller_id': key, 'seller_name': fin['seller_name'],
                                    'seller_avatar': fin['seller_avatar'], **_blank_agg()})
        _add(g, fin)
    total_final = sum((g['final_brl'] for g in groups.values()), Decimal('0'))
    rows = []
    for g in groups.values():
        contracts = g['contracts']
        share = (g['final_brl'] / total_final * 100).quantize(CENT) if total_final else Decimal('0')
        rows.append({
            'seller_id': g['seller_id'], 'seller_name': g['seller_name'], 'seller_avatar': g.get('seller_avatar'),
            'contracts': contracts, 'passengers': g['passengers'],
            **_money_out(g),
            'avg_ticket_brl': _money((g['final_brl'] / contracts).quantize(CENT) if contracts else Decimal('0')),
            'share_pct': str(share), 'missing_value': g['missing_value'], 'missing_margin': g['missing_margin'],
        })
    rows.sort(key=lambda r: Decimal(r['final_brl']), reverse=True)
    return rows


def timeseries(qs, metric='final_brl'):
    """Série mensal (YYYY-MM) da métrica escolhida — para o gráfico de evolução.
    metric ∈ net_brl|sale_brl|final_brl|agency_commission_brl|contracts|passengers."""
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
        val = b[metric] if metric in ('contracts', 'passengers') else _money(b.get(metric, Decimal('0')))
        out.append({'period': key, 'value': val, 'contracts': b['contracts'], 'passengers': b['passengers'], **_money_out(b)})
    return out


def available_years(user):
    """Anos com contratos visíveis a este usuário (para o filtro — NUNCA fixos)."""
    qs = base_queryset(user)
    ys = qs.dates('contract_date', 'year')
    years = sorted({d.year for d in ys} | {c.year for c in qs.dates('created_at', 'year')}, reverse=True)
    return years or [date.today().year]
