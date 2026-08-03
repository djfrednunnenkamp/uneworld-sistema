"""Serviço central de COMISSÕES DOS VENDEDORES — fonte única de verdade dos números.

Tudo aqui deriva dos CONTRATOS reais; nada é inventado. Cards, tabela, gráficos,
detalhamento e exportação usam ESTAS funções, então "soma dos vendedores == total
consolidado" por construção.

Definições financeiras (confirmadas no modelo/serializer de contratos):
  • O cliente paga  = Contract.total_brl = Valor de venda + Taxas (a comissão da
    agência NÃO é somada — já está embutida no nosso markup).
  • Valor de venda = Preço final = o que o cliente paga − taxas = NET + nossa comissão.
  • Valor NET      = Valor de venda × fator (markup). Sem fator → NET == venda.
  • Comissão da agência = subtotal por pessoa (SEM taxas) × agency.commission_rate% —
    é uma FATIA do valor de venda (sai da NOSSA margem, informativa; não é cobrada do
    cliente). Convertida a BRL pelo câmbio DO CONTRATO.
  Sem agência/sem taxa cadastrada → comissão 0.

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
                          'created_by', 'created_by__permissions', 'itinerary', 'itinerary__category')
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
    """Vendedor da operadora efetivo: seller, senão o criador.
    (id, nome, avatar_url, comissão% do vendedor)."""
    u = contract.seller or contract.created_by
    if not u:
        return (None, '', None, None)
    name = f'{u.first_name} {u.last_name}'.strip() or u.email or u.username
    perms = getattr(u, 'permissions', None)
    avatar = perms.avatar.url if (perms and perms.avatar) else None
    pct = perms.seller_commission_percent if perms else None
    return (u.id, name, avatar, pct)


def taxes_usd(contract):
    """Soma das TAXAS por linha de acomodação (taxes_usd × quantidade), em USD."""
    return sum((l.taxes_usd or Decimal('0')) * l.quantity for l in contract.accommodation_lines.all())


def contract_financials(contract):
    """Os três valores em BRL e USD (Decimal). `has_value` = contrato tem total
    calculado; `has_margin` = deu pra achar o markup da operadora (senão NET=venda)."""
    rate = contract.exchange_rate or Decimal('0')
    comm_usd = commission_usd(contract)                     # comissão da AGÊNCIA (fatia informativa)
    comm_brl = (comm_usd * rate).quantize(CENT) if rate else Decimal('0')
    tx_usd = taxes_usd(contract)
    tx_brl = (tx_usd * rate).quantize(CENT) if rate else Decimal('0')
    client_usd = contract.total_usd                         # o que o cliente PAGA = venda + taxas
    client_brl = contract.total_brl
    has_value = client_brl is not None
    # Valor de venda = PREÇO FINAL = o que o cliente paga MENOS as taxas (= NET +
    # nossa comissão). A comissão da agência NÃO é somada — já está embutida no nosso
    # markup; ela é uma fatia deste valor de venda (sai da nossa margem).
    sale_usd = (client_usd - tx_usd) if client_usd is not None else None
    sale_brl = (client_brl - tx_brl) if client_brl is not None else None
    final_usd, final_brl = sale_usd, sale_brl               # "Preço final" = só a venda
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
    # Comissão do VENDEDOR = % do vendedor × valor de venda (sem taxas).
    sid, sname, savatar, spct = effective_seller(contract)
    if spct and sale_brl is not None:
        p = Decimal(spct) / Decimal('100')
        sc_brl = (sale_brl * p).quantize(CENT)
        sc_usd = (sale_usd * p).quantize(CENT) if sale_usd is not None else Decimal('0')
    else:
        sc_brl, sc_usd = Decimal('0'), Decimal('0')
    return {
        'net_brl': net_brl, 'net_usd': net_usd,
        'sale_brl': sale_brl, 'sale_usd': sale_usd,
        'final_brl': final_brl, 'final_usd': final_usd,
        'taxes_brl': tx_brl, 'taxes_usd': tx_usd,
        'client_total_brl': client_brl, 'client_total_usd': client_usd,
        'operator_commission_brl': op_brl, 'operator_commission_usd': op_usd,
        'agency_commission_brl': comm_brl, 'agency_commission_usd': comm_usd,
        'seller_commission_brl': sc_brl, 'seller_commission_usd': sc_usd,
        'seller_commission_pct': (str(spct) if spct is not None else None),
        'has_value': has_value, 'has_margin': has_margin,
        'currency': contract.base_currency or 'USD',
        'exchange_rate': rate or None,
        'passengers': getattr(contract, '_pax', None) if getattr(contract, '_pax', None) is not None else contract.guests.count(),
        'sale_date': getattr(contract, 'sale_date', None) or contract.contract_date or (contract.created_at.date() if contract.created_at else None),
        'seller_id': sid, 'seller_name': sname or 'Sem vendedor atribuído', 'seller_avatar': savatar,
        'agency_id': contract.agency_id, 'agency_name': (contract.agency.name if contract.agency_id else None),
    }


# Chaves de dinheiro somadas (cada uma em BRL e USD).
_MONEY_KEYS = ['net', 'sale', 'final', 'operator_commission', 'agency_commission', 'seller_commission']


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
                                    'seller_avatar': fin['seller_avatar'],
                                    'seller_commission_pct': fin['seller_commission_pct'], **_blank_agg()})
        _add(g, fin)
    total_final = sum((g['final_brl'] for g in groups.values()), Decimal('0'))
    rows = []
    for g in groups.values():
        contracts = g['contracts']
        share = (g['final_brl'] / total_final * 100).quantize(CENT) if total_final else Decimal('0')
        rows.append({
            'seller_id': g['seller_id'], 'seller_name': g['seller_name'], 'seller_avatar': g.get('seller_avatar'),
            'seller_commission_pct': g.get('seller_commission_pct'),
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


# ── Métricas / dimensões (construtor de análises) ───────────────────────────
STAGE_LABEL_BR = {
    'em_edicao': 'Rascunho', 'enviado': 'Enviado', 'assinado': 'Assinado',
    'revisao': 'Em revisão', 'aprovado': 'Aprovado', 'a_faturar': 'A faturar',
    'em_pagamento': 'Em pagamento', 'faturado': 'Pago',
}
# Métricas numéricas que os gráficos/rankings podem usar.
METRICS = ['net_brl', 'sale_brl', 'final_brl', 'agency_commission_brl',
           'seller_commission_brl', 'operator_commission_brl', 'contracts', 'passengers']


def metric_value(agg, metric):
    """Valor numérico (Decimal) de uma métrica a partir de um agregado."""
    if metric in ('contracts', 'passengers'):
        return Decimal(agg.get(metric, 0))
    return agg.get(metric, Decimal('0'))


def _dim_key_label(dimension, contract, fin):
    """(chave, rótulo) de um contrato para a dimensão escolhida."""
    if dimension == 'seller':
        return (fin['seller_id'], fin['seller_name'])
    if dimension == 'agency':
        return (contract.agency_id, contract.agency.name if contract.agency_id else 'Sem agência')
    if dimension == 'itinerary':
        return (contract.itinerary_id, contract.itinerary.name if contract.itinerary_id else 'Sem roteiro')
    if dimension == 'category':
        cat = contract.itinerary.category if contract.itinerary_id else None
        return ((cat.id if cat else None), cat.name if cat else 'Sem categoria')
    if dimension == 'currency':
        c = (contract.base_currency or 'USD'); return (c, c)
    if dimension == 'stage':
        return (contract.stage, STAGE_LABEL_BR.get(contract.stage, contract.stage))
    return (fin['seller_id'], fin['seller_name'])


def by_dimension(qs, dimension='seller', metric='final_brl', can_view_values=True):
    """Ranking agregando por uma DIMENSÃO (vendedor/agência/roteiro/categoria/moeda/
    etapa). Ordena pela métrica escolhida. `pct` = participação de cada linha NA
    métrica escolhida. Sem `can_view_values`, os valores em R$/US$ são OMITIDOS
    (só rótulo, contagens e percentual) — controle por permissão panels_view_values."""
    groups = {}
    for c in qs:
        fin = contract_financials(c)
        key, label = _dim_key_label(dimension, c, fin)
        g = groups.setdefault(key, {'key': key, 'label': label, **_blank_agg()})
        # Logo da agência (ranking por agência) — para o front exibir via media.js.
        if dimension == 'agency' and 'logo' not in g:
            g['logo'] = (c.agency.logo.url if (c.agency_id and c.agency.logo) else None)
        _add(g, fin)
    total_final = sum((g['final_brl'] for g in groups.values()), Decimal('0'))
    rows = []
    for g in groups.values():
        contracts = g['contracts']
        share = (g['final_brl'] / total_final * 100).quantize(CENT) if total_final else Decimal('0')
        row = {'key': g['key'], 'label': g['label'], 'contracts': contracts, 'passengers': g['passengers'],
               **_money_out(g),
               'avg_ticket_brl': _money((g['final_brl'] / contracts).quantize(CENT) if contracts else Decimal('0')),
               'share_pct': str(share)}
        if dimension == 'agency':
            row['logo'] = g.get('logo')
        rows.append(row)
    m = metric if metric in METRICS else 'final_brl'
    rows.sort(key=lambda r: (Decimal(r[m]) if m in ('contracts', 'passengers') else Decimal(r[m])), reverse=True)
    # Participação (%) de cada linha NA métrica escolhida — sempre disponível.
    total_m = sum((Decimal(r[m]) for r in rows), Decimal('0'))
    for r in rows:
        r['pct'] = str((Decimal(r[m]) / total_m * 100).quantize(CENT)) if total_m else '0'
    # Sem permissão de valores: remove os campos em dinheiro (mantém rótulo, contagens e %).
    if not can_view_values:
        money_fields = {f'{k}_brl' for k in _MONEY_KEYS} | {f'{k}_usd' for k in _MONEY_KEYS} | {'avg_ticket_brl'}
        rows = [{k: v for k, v in r.items() if k not in money_fields} for r in rows]
    return rows


def year_comparison(qs_base, years, metric='final_brl'):
    """Série mensal (12 meses) da métrica para CADA ano — comparação ano×ano.
    `qs_base` já vem com os filtros de negócio (situação/vendedor/etc.), SEM ano/mês.
    Retorna séries por ano + totais + crescimento YoY."""
    m = metric if metric in METRICS else 'final_brl'
    yset = set(int(y) for y in years)
    buckets = {y: {mo: _blank_agg() for mo in range(1, 13)} for y in yset}
    for c in qs_base:
        fin = contract_financials(c)
        d = fin['sale_date']
        if not d or d.year not in yset:
            continue
        _add(buckets[d.year][d.month], fin)
    def val(agg):
        v = metric_value(agg, m)
        return v if m in ('contracts', 'passengers') else v.quantize(CENT)
    series = {}
    totals = {}
    for y in sorted(yset):
        series[y] = [{'month': mo, 'value': (str(val(buckets[y][mo])) if m not in ('contracts', 'passengers') else int(val(buckets[y][mo])))} for mo in range(1, 13)]
        tot = sum((metric_value(buckets[y][mo], m) for mo in range(1, 13)), Decimal('0'))
        totals[y] = str(tot.quantize(CENT)) if m not in ('contracts', 'passengers') else int(tot)
    # Crescimento YoY dos totais (cada ano vs. o ano anterior presente na lista).
    yoy = {}
    ordered = sorted(yset)
    for i, y in enumerate(ordered):
        if i == 0:
            yoy[y] = None; continue
        prev = Decimal(str(totals[ordered[i - 1]])); cur = Decimal(str(totals[y]))
        yoy[y] = str(((cur - prev) / prev * 100).quantize(CENT)) if prev else None
    return {'metric': m, 'years': ordered, 'series': series, 'totals': totals, 'yoy': yoy}


def linear_projection(values, horizon=3):
    """Projeção simples por REGRESSÃO LINEAR sobre os meses com histórico. Retorna
    None se houver menos de 3 pontos. Intervalo = ± desvio-padrão dos resíduos.
    Método explicável; NÃO é garantia (só tendência)."""
    ys = [float(v) for v in values]
    n = len(ys)
    if n < 3:
        return None
    xs = list(range(n))
    mx = sum(xs) / n; my = sum(ys) / n
    den = sum((x - mx) ** 2 for x in xs) or 1.0
    slope = sum((xs[i] - mx) * (ys[i] - my) for i in range(n)) / den
    intercept = my - slope * mx
    resid = [ys[i] - (intercept + slope * xs[i]) for i in range(n)]
    var = sum(r ** 2 for r in resid) / max(1, n - 2)
    sd = var ** 0.5
    out = []
    for i in range(horizon):
        x = n + i
        yhat = intercept + slope * x
        out.append({'index': x, 'value': round(max(0.0, yhat), 2),
                    'low': round(max(0.0, yhat - 1.96 * sd), 2), 'high': round(max(0.0, yhat + 1.96 * sd), 2)})
    return {'method': 'Regressão linear simples (mínimos quadrados)',
            'history_points': n, 'slope_per_month': round(slope, 2),
            'note': 'Tendência estatística sobre o histórico do período — não é garantia; '
                    'sazonalidade não é modelada. Intervalo ≈ 95% (±1,96·desvio dos resíduos).',
            'forecast': out}


def build_insights(summary, previous, series):
    """Insights DETERMINÍSTICOS a partir dos números reais (fato/comparação/tendência).
    Nada de causalidade — só o que os dados mostram."""
    out = []
    D = lambda v: Decimal(str(v or 0))
    if previous and D(previous.get('final_brl')) > 0:
        cur, prev = D(summary['final_brl']), D(previous['final_brl'])
        pct = ((cur - prev) / prev * 100).quantize(CENT)
        verb = 'cresceu' if pct >= 0 else 'caiu'
        out.append({'type': 'comparação', 'text': f'O preço final vendido {verb} {abs(pct)}% vs. o período anterior.'})
    if series:
        best = max(series, key=lambda s: Decimal(str(s.get('final_brl', 0))))
        out.append({'type': 'fato', 'text': f'{best["period"]} foi o mês de maior valor vendido no período ('
                                            f'R$ {best.get("final_brl")}).'})
        # Tendência: 3 quedas seguidas no final.
        vals = [Decimal(str(s.get('final_brl', 0))) for s in series]
        if len(vals) >= 4 and vals[-1] < vals[-2] < vals[-3]:
            out.append({'type': 'tendência', 'text': 'Há queda no valor vendido nos últimos 3 meses do período — investigar.'})
    if D(summary.get('missing_margin')) > 0:
        out.append({'type': 'hipótese', 'text': f'{summary["missing_margin"]} contrato(s) sem markup do roteiro — '
                                                'o Valor NET desses está igual ao Valor de venda.'})
    return out
