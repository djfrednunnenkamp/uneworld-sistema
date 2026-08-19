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

# Só entra no financeiro o que o cliente já se comprometeu a pagar: assinado o
# contrato, a parcela é dinheiro a receber. Antes disso é intenção — o contrato
# ainda pode ser recusado, reeditado ou simplesmente não voltar assinado.
STAGES_FIRMADOS = ('assinado', 'conf_pagamento', 'em_pagamento', 'faturado')
# As etapas anteriores, na ordem em que o contrato as percorre. Vê-las é útil
# para saber o que ESTÁ POR VIR — daí a chave ligar/desligar na tela.
STAGES_A_CAMINHO = ('em_edicao', 'revisao', 'a_faturar', 'aprovado', 'enviado')
# O caminho do contrato, em ordem. Serve para o "desta etapa em diante": quem
# planeja caixa raciocina por corte no funil ("do para-assinar em diante"), nao
# marcando etapas soltas.
ORDEM_DAS_ETAPAS = STAGES_A_CAMINHO + STAGES_FIRMADOS


def etapas_a_partir_de(etapa):
    "As etapas de `etapa` em diante. Etapa desconhecida = todas."
    try:
        return list(ORDEM_DAS_ETAPAS[ORDEM_DAS_ETAPAS.index(etapa):])
    except ValueError:
        return list(ORDEM_DAS_ETAPAS)


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
         'currency': q.get('currency') or None,
         # Recebíveis: quais etapas do contrato entram. Vazio = só os firmados.
         'stages': [e for e in (q.get('stages') or '').split(',') if e] or None,
         'from_stage': q.get('from_stage') or None,
         'a_caminho': (q.get('a_caminho') or '').lower() in ('1', 'true', 'sim')}
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
    # Etapas escolhidas na tela > a chave "o que está por vir" > só os firmados.
    if f.get('stages'):
        qs = qs.filter(contract__stage__in=f['stages'])
    elif f.get('from_stage'):
        qs = qs.filter(contract__stage__in=etapas_a_partir_de(f['from_stage']))
    elif not f.get('a_caminho'):
        qs = qs.filter(contract__stage__in=STAGES_FIRMADOS)
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


def liquido_das_parcelas(rows):
    """{id da parcela: (bruto, taxa, liquido)} — o financeiro trabalha com o
    LÍQUIDO.

    O que entra em caixa é o que o cliente paga menos o que a adquirente
    desconta. Somar o bruto em qualquer lugar (cartão, gráfico, fluxo de caixa)
    é prometer um dinheiro que não chega.
    """
    from contracts.card_payment import e_cartao, taxas_dos_contratos
    taxas = taxas_dos_contratos({i.contract_id for i in rows})
    saida = {}
    for inst in rows:
        bruto = _d(inst.value_brl)
        info = taxas.get(inst.contract_id) if e_cartao(inst.payment_method) else None
        pct = info['pct'] if info else None
        taxa = (bruto * pct / 100).quantize(CENT) if pct is not None else Decimal('0')
        saida[inst.id] = (bruto, taxa, bruto - taxa, pct, (info or {}).get('gateway'))
    return saida


def recebido_das_parcelas(rows):
    """{id da parcela: (total recebido, [recebimentos])} — uma consulta só."""
    from contracts.models import ContractInstallmentPayment
    saida = defaultdict(lambda: [Decimal('0'), []])
    qs = (ContractInstallmentPayment.objects
          .filter(installment_id__in=[i.id for i in rows])
          .select_related('created_by').order_by('paid_at', 'id'))
    for p in qs:
        alvo = saida[p.installment_id]
        alvo[0] += _d(p.value_brl)
        alvo[1].append(p)
    return saida


def _rec_status(inst, liquido, recebido, t):
    """'recebido' | 'parcial' | 'vencido' | 'previsto'.

    Manda o que ENTROU: quitou a parcela, é recebida; entrou parte, é parcial
    (e o saldo continua sendo dinheiro a receber). Sem recebimento nenhum,
    continua valendo a velha aproximação pelo estágio "faturado" do contrato —
    ela existe porque a baixa é nova e o histórico não tem lançamento algum; o
    campo `received_real` no detalhe diz qual dos dois respondeu.
    """
    if recebido > 0:
        return 'recebido' if recebido >= liquido - CENT else 'parcial'
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
    # Cartão: o que entra em caixa é o valor MENOS a taxa da adquirente.
    liquidos = liquido_das_parcelas(rows)
    recebimentos = recebido_das_parcelas(rows)
    cards = {k: Decimal('0') for k in ('hoje', 'd7', 'mes', 'prox_mes', 'ano', 'recebido_mes', 'pendente', 'vencido',
                                      'taxas', 'bruto')}
    by_month = defaultdict(lambda: {'previsto': Decimal('0'), 'recebido': Decimal('0'), 'vencido': Decimal('0')})
    by_method = defaultdict(lambda: {'brl': Decimal('0'), 'count': 0})
    mes_ini = t.replace(day=1)
    prox_mes = (mes_ini + timedelta(days=32)).replace(day=1)
    fim_prox = (prox_mes + timedelta(days=32)).replace(day=1)
    fim_ano = date(t.year, 12, 31)
    detail = []
    for inst in rows:
        bruto, fee, v, pct, gateway = liquidos[inst.id]
        # `v` é o LÍQUIDO: daqui para baixo, todo total do financeiro usa ele.
        recebido, pagamentos = recebimentos[inst.id]
        recebido = min(recebido, v)          # a view impede passar; aqui é cinto e suspensório
        saldo = v - recebido                 # o que AINDA falta entrar desta parcela
        st = _rec_status(inst, v, recebido, t)
        cards['taxas'] += fee
        cards['bruto'] += bruto
        mkey = inst.due_date.strftime('%Y-%m')
        # No gráfico, a parcela paga pela metade aparece dos DOIS lados: a parte
        # que entrou como recebida, a que falta como previsto/vencido.
        if st == 'recebido':
            by_month[mkey]['recebido'] += v
        elif st == 'parcial':
            by_month[mkey]['recebido'] += recebido
            by_month[mkey]['vencido' if (inst.due_date and inst.due_date < t) else 'previsto'] += saldo
        else:
            by_month[mkey][st] += v
        by_method[method_of(inst)]['brl'] += v
        by_method[method_of(inst)]['count'] += 1
        # O que entrou conta no mês em que ENTROU (data do recebimento), não no
        # do vencimento — é quando o dinheiro apareceu na conta.
        for pg in pagamentos:
            if pg.paid_at.strftime('%Y-%m') == t.strftime('%Y-%m'):
                cards['recebido_mes'] += _d(pg.value_brl)
        if st == 'recebido':
            if not pagamentos:   # recebida só pela aproximação do estágio faturado
                if inst.due_date.strftime('%Y-%m') == t.strftime('%Y-%m'):
                    cards['recebido_mes'] += v
        else:
            # Parcial: o que pesa nos cards de "a receber" é só o SALDO.
            cards['pendente'] += saldo
            if st in ('vencido',) or (st == 'parcial' and inst.due_date < t):
                cards['vencido'] += saldo
            if inst.due_date == t:
                cards['hoje'] += saldo
            if t <= inst.due_date <= t + timedelta(days=7):
                cards['d7'] += saldo
            if mes_ini <= inst.due_date < prox_mes:
                cards['mes'] += saldo
            if prox_mes <= inst.due_date < fim_prox:
                cards['prox_mes'] += saldo
            if inst.due_date <= fim_ano and inst.due_date >= t:
                cards['ano'] += saldo
        if len(detail) < limit:
            c = inst.contract
            detail.append({
                'id': inst.id, 'contract_id': c.id, 'reservation': c.reservation_number,
                'due_date': str(inst.due_date), 'kind': inst.kind, 'number': inst.installment_number,
                'status': st, 'value_brl': str(v.quantize(CENT)), 'method': method_of(inst),
                'agency': c.agency.name if c.agency_id else None, 'agency_id': c.agency_id,
                'agency_logo': (c.agency.logo.url if (c.agency_id and c.agency.logo) else None),
                'seller': (c.seller.first_name or c.seller.username) if c.seller_id else None,
                'itinerary': c.itinerary.name if c.itinerary_id else None, 'itinerary_id': c.itinerary_id,
                'passengers': c.guests.count(), 'stage': c.stage,
                # Por onde a venda passa e o que ela custa. `gateway` é None
                # quando a forma não é cartão (boleto, Pix: sem taxa aqui).
                'gateway': gateway,
                'fee_pct': str(pct) if pct is not None else None,
                'fee_brl': str(fee) if pct is not None else None,
                'gross_brl': str(bruto.quantize(CENT)),
                'detail_text': inst.detail or '',
                # Contrato assinado (quando já existe): o pop-up da parcela
                # mostra o PDF do lado esquerdo, pelo visualizador padrão.
                'signed_file': (c.signed_file.url if c.signed_file else None),
                'signed_at': (str(c.signed_at.date()) if c.signed_at else None),
                # Recebimentos: `received_real` separa o dinheiro lançado de
                # verdade da aproximação pelo estágio do contrato.
                'received_real': bool(pagamentos),
                'received_brl': str(recebido.quantize(CENT)),
                'balance_brl': str(saldo.quantize(CENT)),
                'payments': [{
                    'id': pg.id, 'paid_at': str(pg.paid_at),
                    'value_brl': str(_d(pg.value_brl).quantize(CENT)),
                    'note': pg.note or '',
                    'by': ((pg.created_by.first_name or pg.created_by.username) if pg.created_by_id else None),
                } for pg in pagamentos],
            })
    # Quanto há em cada etapa, ignorando o filtro de etapa — é o que permite à
    # tela dizer o tamanho do que está de fora antes de a pessoa clicar.
    sem_etapa = dict(f); sem_etapa['stages'] = None; sem_etapa['from_stage'] = None; sem_etapa['a_caminho'] = True
    todas = list(receivables_qs(user, sem_etapa))
    liq_todas = liquido_das_parcelas(todas)
    por_etapa = defaultdict(lambda: {'brl': Decimal('0'), 'n': 0})
    for inst in todas:
        e = por_etapa[inst.contract.stage]
        e['brl'] += liq_todas[inst.id][2]      # líquido, como todo o resto
        e['n'] += 1
    stage_totals = [{'stage': etapa, 'brl': str(dados['brl'].quantize(CENT)), 'count': dados['n'],
                     'firmado': etapa in STAGES_FIRMADOS}
                    for etapa, dados in sorted(por_etapa.items(), key=lambda kv: -kv[1]['brl'])]

    timeline = [{'month': m, **{k: str(v.quantize(CENT)) for k, v in by_month[m].items()}}
                for m in sorted(by_month)]
    methods = sorted(({'method': k, 'brl': str(v['brl'].quantize(CENT)), 'count': v['count']}
                      for k, v in by_method.items()), key=lambda x: Decimal(x['brl']), reverse=True)
    total_prev = sum((Decimal(m['previsto']) + Decimal(m['vencido']) for m in timeline), Decimal('0'))
    return {
        'cards': {k: str(v.quantize(CENT)) for k, v in cards.items()},
        'timeline': timeline, 'methods': methods, 'detail': detail,
        'count': len(rows), 'currency': 'BRL',
        'stage_totals': stage_totals,
        'stage_order': list(ORDEM_DAS_ETAPAS),
        'note_etapas': ('Por padrão só entram contratos assinados — antes da assinatura a parcela '
                        'ainda é intenção, não dinheiro a receber.'),
        'note_liquido': ('Todos os totais são LÍQUIDOS: o valor já vem menos a taxa da adquirente, '
                         'que é o que de fato entra na conta.'),
        'note_taxas': ('A taxa do cartão é a da bandeira mais cara do gateway naquele plano — '
                       'a bandeira só se sabe quando o cliente passa o cartão.'),
        'note_realizado': ('Recebido é o que foi LANÇADO na parcela (data e valor). Pagamento parcial deixa a '
                           'parcela como "parcial" e o saldo segue como dinheiro a receber. Sem lançamento '
                           'nenhum, ainda vale a aproximação antiga pelo estágio "faturado" do contrato.'),
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
    # O que entra é o líquido: o bruto no fluxo de caixa promete um dinheiro
    # que a adquirente já reteve.
    liq = liquido_das_parcelas(rec_rows)
    inflow = defaultdict(Decimal)
    for inst in rec_rows:
        inflow[inst.due_date.strftime('%Y-%m')] += liq[inst.id][2]
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
