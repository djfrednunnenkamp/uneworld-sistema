"""Financeiro — fonte ÚNICA de agregação (Decimal, consolida em BRL onde há cotação,
agrupa por moeda quando não há). SÓ o PREVISTO por enquanto (não há baixa de parcela
nem de custo no sistema): 'recebido' é aproximado pelo estágio 'faturado' do contrato;
'pago' de custo ainda não existe. Nada é inventado — o que não dá pra derivar é marcado.

Entradas (recebíveis)  ← ContractInstallment (due_date + value_brl já em BRL).
Saídas (contas a pagar) ← ItineraryCostItem.payment_schedule (data + %), valor no custo.
"""
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone

from contracts.models import Contract, ContractInstallment
from itineraries.models import ItineraryCostItem
from config_api.models import ConfigExchangeRate
from users_api.permissions import agency_scope_ids, has_any_perm

CENT = Decimal('0.01')


def today():
    return timezone.localdate()


def _d(v):
    try:
        return Decimal(str(v))
    except Exception:
        return Decimal('0')


# ── Cotação ESTIMADA (config atual) moeda→BRL — só para custos em moeda estrangeira.
# Cache SÓ dentro de uma requisição (evita consultar a mesma moeda várias vezes ao
# iterar itens). NUNCA persiste entre requisições: `payables_rows` limpa no início,
# então a cada carregamento a cotação é lida fresca do banco — é isso que faz o
# valor em BRL acompanhar, ao vivo, uma mudança da taxa em Configurações › Câmbio.
_RATE_CACHE = {}


def brl_rate(currency):
    """Taxa moeda→BRL (config atual, ESTIMADA). BRL/vazio = 1. None = sem cotação."""
    cur = (currency or 'BRL').upper()
    if cur in ('BRL', ''):
        return Decimal('1')
    if cur in _RATE_CACHE:
        return _RATE_CACHE[cur]
    row = (ConfigExchangeRate.objects.filter(from_currency__iexact=cur, to_currency__iexact='BRL')
           .order_by('-is_favorite', '-id').first())
    rate = _d(row.rate) if (row and row.rate) else None
    _RATE_CACHE[cur] = rate
    return rate


def clear_rate_cache():
    _RATE_CACHE.clear()


# ── Filtros compartilhados ──────────────────────────────────────────────────
def parse_filters(request):
    q = request.query_params
    f = {'from': q.get('from') or None, 'to': q.get('to') or None,
         'method': q.get('method') or None, 'agency': q.get('agency') or None,
         'seller': q.get('seller') or None, 'itinerary': q.get('itinerary') or None,
         'category': q.get('category') or None, 'supplier': q.get('supplier') or None,
         'currency': q.get('currency') or None}
    return f


def _in_range(d, f):
    if d is None:
        return False
    if f.get('from') and str(d) < f['from']:
        return False
    if f.get('to') and str(d) > f['to']:
        return False
    return True


def _clamp_past(f, can_past):
    """Sem a permissão de ver o passado, empurra o início do período para HOJE —
    o usuário só enxerga de hoje em diante (nada vencido/histórico). Devolve uma
    CÓPIA do filtro (não muta o original)."""
    f = dict(f or {})
    if not can_past:
        t = str(today())
        if not f.get('from') or f['from'] < t:
            f['from'] = t
    return f


# ── ENTRADAS PREVISTAS (recebíveis) ─────────────────────────────────────────
def receivables_qs(user, f):
    qs = (ContractInstallment.objects
          .filter(contract__is_deleted=False, contract__status='ativo',
                  due_date__isnull=False, value_brl__isnull=False)
          .select_related('contract', 'contract__agency', 'contract__seller', 'contract__itinerary'))
    scope = agency_scope_ids(user)
    if scope is not None:
        qs = qs.filter(contract__agency_id__in=scope)
    if f.get('from'):
        qs = qs.filter(due_date__gte=f['from'])
    if f.get('to'):
        qs = qs.filter(due_date__lte=f['to'])
    if f.get('agency'):
        qs = qs.filter(contract__agency_id=f['agency'])
    if f.get('seller'):
        qs = qs.filter(contract__seller_id=f['seller'])
    if f.get('itinerary'):
        qs = qs.filter(contract__itinerary_id=f['itinerary'])
    if f.get('method'):
        qs = qs.filter(payment_method=f['method'])
    return qs


def _rec_status(inst, t):
    # Aproximação (não há baixa por parcela): contrato faturado = recebido; senão
    # vencido se passou da data; senão previsto.
    if inst.contract.stage == 'faturado':
        return 'recebido'
    if inst.due_date and inst.due_date < t:
        return 'vencido'
    return 'previsto'


def receivables_report(user, f, limit=300, can_past=True):
    f = _clamp_past(f, can_past)
    t = today()
    rows = list(receivables_qs(user, f))
    method_of = lambda i: (i.payment_method or i.contract.payment_type or '—')
    cards = {k: Decimal('0') for k in ('hoje', 'd7', 'mes', 'prox_mes', 'ano', 'recebido_mes', 'pendente', 'vencido')}
    by_month = defaultdict(lambda: {'previsto': Decimal('0'), 'recebido': Decimal('0'), 'vencido': Decimal('0')})
    by_method = defaultdict(lambda: {'brl': Decimal('0'), 'count': 0})
    mes_ini = t.replace(day=1)
    prox_mes = (mes_ini + timedelta(days=32)).replace(day=1)
    fim_prox = (prox_mes + timedelta(days=32)).replace(day=1)
    fim_ano = date(t.year, 12, 31)
    detail = []
    for inst in rows:
        v = _d(inst.value_brl)
        st = _rec_status(inst, t)
        mkey = inst.due_date.strftime('%Y-%m')
        by_month[mkey][st if st != 'recebido' else 'recebido'] += v
        by_method[method_of(inst)]['brl'] += v
        by_method[method_of(inst)]['count'] += 1
        if st == 'recebido':
            if mes_ini <= inst.due_date <= t or inst.due_date.strftime('%Y-%m') == t.strftime('%Y-%m'):
                cards['recebido_mes'] += v
        else:
            cards['pendente'] += v
            if st == 'vencido':
                cards['vencido'] += v
            if inst.due_date == t:
                cards['hoje'] += v
            if t <= inst.due_date <= t + timedelta(days=7):
                cards['d7'] += v
            if mes_ini <= inst.due_date < prox_mes:
                cards['mes'] += v
            if prox_mes <= inst.due_date < fim_prox:
                cards['prox_mes'] += v
            if inst.due_date <= fim_ano and inst.due_date >= t:
                cards['ano'] += v
        if len(detail) < limit:
            c = inst.contract
            detail.append({
                'id': inst.id, 'contract_id': c.id, 'reservation': c.reservation_number,
                'due_date': str(inst.due_date), 'kind': inst.kind, 'number': inst.installment_number,
                'status': st, 'value_brl': str(v.quantize(CENT)), 'method': method_of(inst),
                'agency': c.agency.name if c.agency_id else None, 'agency_id': c.agency_id,
                'seller': (c.seller.first_name or c.seller.username) if c.seller_id else None,
                'itinerary': c.itinerary.name if c.itinerary_id else None, 'itinerary_id': c.itinerary_id,
                'passengers': c.guests.count(), 'stage': c.stage,
            })
    timeline = [{'month': m, **{k: str(v.quantize(CENT)) for k, v in by_month[m].items()}}
                for m in sorted(by_month)]
    methods = sorted(({'method': k, 'brl': str(v['brl'].quantize(CENT)), 'count': v['count']}
                      for k, v in by_method.items()), key=lambda x: Decimal(x['brl']), reverse=True)
    total_prev = sum((Decimal(m['previsto']) + Decimal(m['vencido']) for m in timeline), Decimal('0'))
    return {
        'cards': {k: str(v.quantize(CENT)) for k, v in cards.items()},
        'timeline': timeline, 'methods': methods, 'detail': detail,
        'count': len(rows), 'currency': 'BRL',
        'note_realizado': 'Recebido é aproximado pelo estágio "faturado" (não há baixa por parcela).',
    }


# ── CONTAS A PAGAR (payables) do payment_schedule dos custos ────────────────
def _item_gross(it):
    v = _d(it.unit_value) * _d(it.quantity)
    tv = _d(it.tax_value)
    if it.tax_kind == 'percent':
        v = v * (Decimal('1') + tv / Decimal('100'))
    else:
        v = v + tv
    return v


def payables_rows(user, f):
    clear_rate_cache()             # cotação lida fresca a cada requisição (nunca stale)
    scope = agency_scope_ids(user)
    if scope is not None:          # usuário de agência não vê custos internos
        return []
    items = (ItineraryCostItem.objects.filter(is_active=True)
             .exclude(payment_schedule=[]).select_related('itinerary'))
    if f.get('itinerary'):
        items = items.filter(itinerary_id=f['itinerary'])
    if f.get('category'):
        items = items.filter(category=f['category'])
    t = today()
    out = []
    for it in items:
        gross = _item_gross(it)
        cur = (it.currency or (it.itinerary.base_currency if it.itinerary_id else '') or 'BRL').upper()
        if f.get('currency') and cur != f['currency'].upper():
            continue
        if f.get('supplier') and (it.supplier or '').strip().lower() != f['supplier'].strip().lower():
            continue
        rate = brl_rate(cur)
        for idx, p in enumerate(it.payment_schedule or []):
            due = p.get('due_date') or ''
            if not _in_range(due or None, f):
                if f.get('from') or f.get('to'):
                    continue
            pct = _d(p.get('percent'))
            amt = (gross * pct / Decimal('100')).quantize(CENT)
            amt_brl = (amt * rate).quantize(CENT) if rate is not None else None
            st = 'sem_data' if not due else ('vencido' if due < str(t) else 'previsto')
            out.append({
                'item_id': it.id, 'idx': idx, 'itinerary_id': it.itinerary_id,
                'itinerary': it.itinerary.name if it.itinerary_id else None,
                'trip_start': str(it.itinerary.start_date) if (it.itinerary_id and it.itinerary.start_date) else None,
                'description': it.description, 'category': it.category, 'supplier': it.supplier or '',
                'due_date': due, 'percent': str(pct), 'note': p.get('note') or '',
                'currency': cur, 'amount': str(amt), 'amount_brl': (str(amt_brl) if amt_brl is not None else None),
                'has_rate': amt_brl is not None, 'status': st,
            })
    return out


def payables_report(user, f, limit=400, can_past=True):
    f = _clamp_past(f, can_past)
    t = today()
    rows = payables_rows(user, f)
    cards = {k: Decimal('0') for k in ('hoje', 'amanha', 'd7', 'mes', 'prox_mes', 'ano', 'vencido', 'sem_data', 'sem_cotacao')}
    by_month = defaultdict(lambda: {'previsto': Decimal('0'), 'vencido': Decimal('0')})
    by_currency = defaultdict(lambda: {'orig': Decimal('0'), 'brl': Decimal('0'), 'count': 0})
    by_supplier = defaultdict(lambda: Decimal('0'))
    by_category = defaultdict(lambda: Decimal('0'))
    mes_ini = t.replace(day=1)
    prox_mes = (mes_ini + timedelta(days=32)).replace(day=1)
    fim_prox = (prox_mes + timedelta(days=32)).replace(day=1)
    fim_ano = date(t.year, 12, 31)
    for r in rows:
        cur = r['currency']
        amt = _d(r['amount'])
        brl = _d(r['amount_brl']) if r['amount_brl'] is not None else None
        by_currency[cur]['orig'] += amt
        by_currency[cur]['count'] += 1
        if brl is not None:
            by_currency[cur]['brl'] += brl
            by_supplier[r['supplier'] or '—'] += brl
            by_category[r['category'] or 'Outros'] += brl
        else:
            cards['sem_cotacao'] += Decimal('1')
        if not r['due_date']:
            cards['sem_data'] += (brl or Decimal('0'))
            continue
        d = r['due_date']
        dd = date.fromisoformat(d)
        if brl is not None:
            by_month[d[:7]]['vencido' if r['status'] == 'vencido' else 'previsto'] += brl
        add = brl or Decimal('0')
        if r['status'] == 'vencido':
            cards['vencido'] += add
        if d == str(t):
            cards['hoje'] += add
        if dd == t + timedelta(days=1):
            cards['amanha'] += add
        if t <= dd <= t + timedelta(days=7):
            cards['d7'] += add
        if mes_ini <= dd < prox_mes:
            cards['mes'] += add
        if prox_mes <= dd < fim_prox:
            cards['prox_mes'] += add
        if t <= dd <= fim_ano:
            cards['ano'] += add
    timeline = [{'month': m, **{k: str(v.quantize(CENT)) for k, v in by_month[m].items()}} for m in sorted(by_month)]
    return {
        'cards': {k: str(v.quantize(CENT)) for k, v in cards.items()},
        'timeline': timeline,
        'by_currency': sorted(({'currency': k, 'orig': str(v['orig'].quantize(CENT)),
                                'brl': str(v['brl'].quantize(CENT)), 'count': v['count']}
                               for k, v in by_currency.items()), key=lambda x: x['currency']),
        'by_supplier': sorted(({'supplier': k, 'brl': str(v.quantize(CENT))} for k, v in by_supplier.items()),
                              key=lambda x: Decimal(x['brl']), reverse=True)[:15],
        'by_category': sorted(({'category': k, 'brl': str(v.quantize(CENT))} for k, v in by_category.items()),
                              key=lambda x: Decimal(x['brl']), reverse=True),
        'detail': rows[:limit], 'count': len(rows),
        'note_fx': 'Custos em moeda estrangeira convertidos pela cotação ATUAL (estimada); itens sem cotação BRL ficam fora do consolidado.',
        'note_realizado': 'Não há baixa de pagamento — tudo é PREVISTO (pago ainda não é rastreado).',
    }


# ── FLUXO DE CAIXA (previsto): entradas − saídas por mês, em BRL ────────────
def cashflow_report(user, f, opening=Decimal('0'), can_past=True):
    f = _clamp_past(f, can_past)
    # Reusa os agregados mensais dos dois lados.
    t = today()
    rec_rows = list(receivables_qs(user, f))
    inflow = defaultdict(Decimal)
    for inst in rec_rows:
        inflow[inst.due_date.strftime('%Y-%m')] += _d(inst.value_brl)
    pay = payables_rows(user, f)
    outflow = defaultdict(Decimal)
    no_fx = Decimal('0')
    for r in pay:
        if not r['due_date']:
            continue
        if r['amount_brl'] is None:
            no_fx += _d(r['amount'])
            continue
        outflow[r['due_date'][:7]] += _d(r['amount_brl'])
    months = sorted(set(inflow) | set(outflow))
    acc = _d(opening)
    series = []
    min_saldo = None
    min_month = None
    for m in months:
        i = inflow.get(m, Decimal('0'))
        o = outflow.get(m, Decimal('0'))
        net = i - o
        acc += net
        if min_saldo is None or acc < min_saldo:
            min_saldo = acc
            min_month = m
        series.append({'month': m, 'in': str(i.quantize(CENT)), 'out': str(o.quantize(CENT)),
                       'net': str(net.quantize(CENT)), 'accumulated': str(acc.quantize(CENT))})
    tot_in = sum(inflow.values(), Decimal('0'))
    tot_out = sum(outflow.values(), Decimal('0'))
    return {
        'series': series,
        'cards': {
            'entradas': str(tot_in.quantize(CENT)), 'saidas': str(tot_out.quantize(CENT)),
            'resultado': str((tot_in - tot_out).quantize(CENT)),
            'menor_saldo': str(min_saldo.quantize(CENT)) if min_saldo is not None else None,
            'menor_saldo_mes': min_month, 'opening': str(_d(opening).quantize(CENT)),
        },
        'currency': 'BRL', 'uncovered_fx': str(no_fx.quantize(CENT)),
        'note': 'Projeção (previsto). Saídas em moeda estrangeira usam cotação estimada; sem saldo bancário integrado — resultado é variação líquida projetada.',
    }
