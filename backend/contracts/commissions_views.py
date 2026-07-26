"""Endpoints de Comissões dos Vendedores. Só agregados (nunca despeja contratos
crus pro front). Segurança: `commissions_view` obrigatório; sem `commissions_view_all`
o usuário só vê as PRÓPRIAS vendas (base_queryset já filtra → sem IDOR). Export
exige `commissions_export` e é auditado."""
from datetime import date

from django.http import HttpResponse
from django.utils.dateparse import parse_date
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from users_api.permissions import RequirePermission, has_any_perm
from . import commissions as C


def _filters(request):
    q = request.query_params
    return dict(
        situacao=q.get('situacao') or C.DEFAULT_SITUACAO,
        date_from=parse_date(q.get('from') or '') or None,
        date_to=parse_date(q.get('to') or '') or None,
        year=q.get('year') or None,
        month=q.get('month') or None,
        seller_id=q.get('seller') or None,
        agency_id=q.get('agency') or None,
        itinerary_id=q.get('itinerary') or None,
    )


def _filtered(request):
    return C.apply_filters(C.base_queryset(request.user), **_filters(request))


@api_view(['GET'])
@permission_classes([IsAuthenticated, RequirePermission('commissions_view', 'panels_view')])
def commissions_summary(request):
    """Cards: totais do período + comparação com o período anterior de mesmo tamanho."""
    f = _filters(request)
    cur = C.summarize(C.apply_filters(C.base_queryset(request.user), **f))
    prev = None
    # Comparação: mesmo tamanho de janela imediatamente anterior (quando há intervalo).
    if f['date_from'] and f['date_to']:
        one = date.resolution          # 1 dia
        span = (f['date_to'] - f['date_from'])
        prev_to = f['date_from'] - one
        pf = dict(f, date_from=prev_to - span, date_to=prev_to)
        prev = C.summarize(C.apply_filters(C.base_queryset(request.user), **pf))
    return Response({
        'period': {'from': f['date_from'], 'to': f['date_to'], 'year': f['year'],
                   'situacao': f['situacao'], 'sale_date_field': 'contract_date (fallback: criação)'},
        'summary': cur, 'previous': prev,
        'can_view_all': C.can_view_all(request.user),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, RequirePermission('commissions_view')])
def commissions_by_seller(request):
    """Ranking de vendedores (respeita o escopo/own do usuário)."""
    return Response({'sellers': C.by_seller(_filtered(request))})


@api_view(['GET'])
@permission_classes([IsAuthenticated, RequirePermission('commissions_view', 'panels_view')])
def commissions_timeseries(request):
    """Série mensal da métrica escolhida (?metric=)."""
    metric = request.query_params.get('metric') or 'final_brl'
    if metric not in C.METRICS:
        metric = 'final_brl'
    series = C.timeseries(_filtered(request), metric)
    resp = {'metric': metric, 'series': series}
    # Projeção opcional (?projection=1): só quando há histórico suficiente (≥3 meses).
    if request.query_params.get('projection') == '1':
        resp['projection'] = C.linear_projection([float(s['value']) for s in series],
                                                 int(request.query_params.get('horizon') or 3))
    return Response(resp)


@api_view(['GET'])
@permission_classes([IsAuthenticated, RequirePermission('commissions_view', 'panels_view')])
def commissions_by_dimension(request):
    """Ranking por DIMENSÃO (vendedor/agência/roteiro/categoria/moeda/etapa)."""
    dim = request.query_params.get('dimension') or 'seller'
    if dim not in ('seller', 'agency', 'itinerary', 'category', 'currency', 'stage'):
        dim = 'seller'
    metric = request.query_params.get('metric') or 'final_brl'
    return Response({'dimension': dim, 'metric': metric, 'rows': C.by_dimension(_filtered(request), dim, metric)})


@api_view(['GET'])
@permission_classes([IsAuthenticated, RequirePermission('commissions_view', 'panels_view')])
def commissions_year_comparison(request):
    """Comparação ano×ano (série mensal por ano). ?years=2024,2025 (default = 3 mais
    recentes com dados). Usa os filtros de negócio, ignorando ano/mês/dia."""
    metric = request.query_params.get('metric') or 'final_brl'
    raw = (request.query_params.get('years') or '').strip()
    years = [int(y) for y in raw.split(',') if y.strip().isdigit()] or C.available_years(request.user)[:3]
    f = _filters(request)
    # Base: filtros de negócio, SEM recorte de tempo (o ano vem da comparação).
    base = C.apply_filters(C.base_queryset(request.user), situacao=f['situacao'],
                           seller_id=f['seller_id'], agency_id=f['agency_id'], itinerary_id=f['itinerary_id'])
    return Response(C.year_comparison(base, years, metric))


@api_view(['GET'])
@permission_classes([IsAuthenticated, RequirePermission('commissions_view', 'panels_view')])
def commissions_insights(request):
    """Insights determinísticos do período (fato/comparação/tendência/hipótese)."""
    f = _filters(request)
    filtered = C.apply_filters(C.base_queryset(request.user), **f)
    summ = C.summarize(filtered)
    prev = None
    if f['date_from'] and f['date_to']:
        one = date.resolution
        span = f['date_to'] - f['date_from']
        prev_to = f['date_from'] - one
        prev = C.summarize(C.apply_filters(C.base_queryset(request.user), **dict(f, date_from=prev_to - span, date_to=prev_to)))
    series = C.timeseries(filtered, 'final_brl')
    return Response({'insights': C.build_insights(summ, prev, series)})


@api_view(['GET'])
@permission_classes([IsAuthenticated, RequirePermission('commissions_view', 'panels_view')])
def commissions_ai_context(request):
    """Gera um TEXTO estruturado (markdown) para colar numa IA — só agregados, sem
    PII. Auditado. Não envia nada a IA externa; é o usuário quem copia."""
    f = _filters(request)
    filtered = C.apply_filters(C.base_queryset(request.user), **f)
    summ = C.summarize(filtered)
    series = C.timeseries(filtered, 'final_brl')
    sellers = C.by_seller(filtered)[:10]
    roteiros = C.by_dimension(filtered, 'itinerary', 'final_brl')[:5]
    insights = C.build_insights(summ, None, series)

    lo = f['date_from'].isoformat() if f['date_from'] else (str(f['year']) if f['year'] else 'todo o período')
    hi = f['date_to'].isoformat() if f['date_to'] else ''
    L = []
    L.append('Você é um analista comercial de uma operadora turística.')
    L.append('Analise os dados abaixo considerando período, filtros, moeda e definições.')
    L.append('')
    L.append('Responda: 1) principais crescimentos/quedas; 2) melhor vendedor; 3) meses de atenção; '
             '4) sinais de sazonalidade; 5) hipóteses a investigar; 6) ações comerciais; 7) limitações dos dados.')
    L.append('')
    L.append('## Definições')
    L.append('- Valor NET = soma do roteiro SEM a comissão da operadora.')
    L.append('- Valor de venda = NET + comissão da operadora (markup).')
    L.append('- Preço final = valor de venda + comissão da agência (o cliente paga).')
    L.append('- Comissão do vendedor = % do vendedor × (preço final − taxas).')
    L.append('- Tudo em BRL pelo câmbio gravado no contrato (não o de hoje).')
    L.append(f'- Situação considerada: {f["situacao"]}. Data da venda = data do contrato.')
    L.append(f'- Período: {lo}{(" a " + hi) if hi else ""}.')
    L.append('')
    L.append('## Resumo (BRL)')
    for k, lbl in [('final_brl', 'Preço final'), ('sale_brl', 'Valor de venda'), ('net_brl', 'Valor NET'),
                   ('agency_commission_brl', 'Comissão da agência'), ('seller_commission_brl', 'Comissão dos vendedores')]:
        L.append(f'- {lbl}: R$ {summ[k]}')
    L.append(f'- Contratos: {summ["contracts"]} · Passageiros: {summ["passengers"]} · Ticket médio: R$ {summ["avg_ticket_contract_brl"]}')
    L.append('')
    L.append('## Evolução mensal (preço final, BRL)')
    for s in series:
        L.append(f'- {s["period"]}: R$ {s["final_brl"]} ({s["contracts"]} contratos)')
    L.append('')
    L.append('## Top vendedores (preço final, BRL)')
    for r in sellers:
        L.append(f'- {r["seller_name"]}: R$ {r["final_brl"]} · {r["contracts"]} contratos · {r["share_pct"]}%')
    L.append('')
    L.append('## Top roteiros (preço final, BRL)')
    for r in roteiros:
        L.append(f'- {r["label"]}: R$ {r["final_brl"]} · {r["contracts"]} contratos')
    if insights:
        L.append('')
        L.append('## Observações determinísticas')
        for i in insights:
            L.append(f'- ({i["type"]}) {i["text"]}')
    text = '\n'.join(L)

    from audit.tracking import log_event
    log_event('download', model_name='Contract', model_label='Contexto de IA — comissões',
              object_id='', object_repr='Contexto de IA gerado',
              changes={'Período': f'{lo}{(" a " + hi) if hi else ""}', 'Tamanho (chars)': len(text)},
              user=request.user)
    return Response({'text': text, 'chars': len(text)})


@api_view(['GET'])
@permission_classes([IsAuthenticated, RequirePermission('commissions_view', 'panels_view')])
def commissions_meta(request):
    """Opções dos filtros: anos disponíveis (não fixos) e se pode ver todos."""
    return Response({
        'years': C.available_years(request.user),
        'can_view_all': C.can_view_all(request.user),
        'can_export': has_any_perm(request.user, 'commissions_export'),
        'situacoes': [
            {'value': 'confirmadas', 'label': 'Vendas confirmadas (em pagamento em diante)'},
            {'value': 'pendentes', 'label': 'Em andamento (antes do pagamento)'},
            {'value': 'pagas', 'label': 'Pagas'},
            {'value': 'canceladas', 'label': 'Canceladas'},
            {'value': 'todas', 'label': 'Todas'},
        ],
        'metrics': [
            {'value': 'final_brl', 'label': 'Preço final'},
            {'value': 'sale_brl', 'label': 'Valor de venda'},
            {'value': 'net_brl', 'label': 'Valor NET'},
            {'value': 'agency_commission_brl', 'label': 'Comissão da agência'},
            {'value': 'seller_commission_brl', 'label': 'Comissão do vendedor'},
            {'value': 'contracts', 'label': 'Contratos'},
            {'value': 'passengers', 'label': 'Passageiros'},
        ],
        'dimensions': [
            {'value': 'seller', 'label': 'Vendedor'},
            {'value': 'agency', 'label': 'Agência'},
            {'value': 'itinerary', 'label': 'Roteiro'},
            {'value': 'category', 'label': 'Categoria do roteiro'},
            {'value': 'currency', 'label': 'Moeda'},
            {'value': 'stage', 'label': 'Situação do contrato'},
        ],
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, RequirePermission('commissions_view')])
def commissions_seller_contracts(request, seller_id):
    """Detalhamento: os contratos de UM vendedor (drill-down). IDOR-safe: se o
    usuário não pode ver todos, base_queryset já limita às vendas dele — pedir
    outro `seller_id` volta vazio. Dados pessoais dos passageiros NÃO são expostos
    (só a contagem)."""
    can_pax_names = has_any_perm(request.user, 'passengers_view_full', 'passengers_view')
    f = _filters(request)
    f['seller_id'] = str(seller_id) if str(seller_id) != '0' else None  # 0 = "sem vendedor"
    qs = C.apply_filters(C.base_queryset(request.user), **f)
    if str(seller_id) == '0':
        qs = qs.filter(seller__isnull=True, created_by__isnull=True)
    rows = []
    for c in qs.order_by('-created_at'):
        fin = C.contract_financials(c)
        main = c.guests.select_related('passenger').first() if can_pax_names else None
        rows.append({
            'id': c.id, 'reservation_number': c.reservation_number,
            'itinerary': (c.itinerary.name if c.itinerary_id else None),
            'sale_date': fin['sale_date'], 'departure_date': c.departure_date,
            'signed_at': c.signed_at, 'stage': c.stage, 'status': c.status,
            'passengers': fin['passengers'],
            'main_passenger': (str(main.passenger) if main and main.passenger_id else None),
            'agency_name': fin['agency_name'],
            'currency': fin['currency'], 'exchange_rate': str(fin['exchange_rate']) if fin['exchange_rate'] else None,
            'net_brl': str(fin['net_brl']) if fin['net_brl'] is not None else None,
            'net_usd': str(fin['net_usd']) if fin['net_usd'] is not None else None,
            'sale_brl': str(fin['sale_brl']) if fin['sale_brl'] is not None else None,
            'sale_usd': str(fin['sale_usd']) if fin['sale_usd'] is not None else None,
            'final_brl': str(fin['final_brl']) if fin['final_brl'] is not None else None,
            'final_usd': str(fin['final_usd']) if fin['final_usd'] is not None else None,
            'agency_commission_brl': str(fin['agency_commission_brl']),
            'agency_commission_usd': str(fin['agency_commission_usd']),
            'seller_commission_brl': str(fin['seller_commission_brl']),
            'seller_commission_pct': fin['seller_commission_pct'],
            'has_value': fin['has_value'], 'has_margin': fin['has_margin'],
        })
    return Response({'seller_id': seller_id, 'contracts': rows})


@api_view(['GET'])
@permission_classes([IsAuthenticated, RequirePermission('commissions_export')])
def commissions_export(request):
    """Exporta o ranking (CSV) respeitando filtros/escopo/permissões. Auditado."""
    import csv, io
    f = _filters(request)
    rows = C.by_seller(C.apply_filters(C.base_queryset(request.user), **f))
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=';')
    w.writerow(['Vendedor', 'Contratos', 'Passageiros',
                'Valor NET (BRL)', 'Valor NET (USD)',
                'Valor de venda (BRL)', 'Valor de venda (USD)',
                'Preço final c/ comissão da agência (BRL)', 'Preço final (USD)',
                'Nossa comissão (BRL)', 'Comissão da agência (BRL)',
                'Comissão do vendedor (%)', 'Comissão do vendedor (BRL)',
                'Ticket médio (BRL)', 'Participação (%)'])
    for r in rows:
        w.writerow([r['seller_name'], r['contracts'], r['passengers'],
                    r['net_brl'], r['net_usd'], r['sale_brl'], r['sale_usd'],
                    r['final_brl'], r['final_usd'], r['operator_commission_brl'],
                    r['agency_commission_brl'], r.get('seller_commission_pct') or '', r['seller_commission_brl'],
                    r['avg_ticket_brl'], r['share_pct']])
    content = buf.getvalue().encode('utf-8-sig')   # BOM p/ acentos no Excel

    lo = (f['date_from'].isoformat() if f['date_from'] else (str(f['year']) if f['year'] else 'tudo'))
    hi = (f['date_to'].isoformat() if f['date_to'] else '')
    fname = f'comissoes-vendedores-{lo}{("-a-" + hi) if hi else ""}.csv'

    from audit.tracking import log_event
    log_event('download', model_name='Contract', model_label='Comissões dos vendedores',
              object_id='', object_repr=fname, user=request.user,
              changes={'Exportação': fname, 'Vendedores': len(rows), 'Situação': f['situacao']})

    resp = HttpResponse(content, content_type='text/csv; charset=utf-8')
    resp['Content-Disposition'] = f'attachment; filename="{fname}"'
    resp['X-Content-Type-Options'] = 'nosniff'
    return resp
