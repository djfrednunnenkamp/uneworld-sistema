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
    if metric not in ('net_brl', 'sale_brl', 'final_brl', 'agency_commission_brl', 'contracts', 'passengers'):
        metric = 'final_brl'
    return Response({'metric': metric, 'series': C.timeseries(_filtered(request), metric)})


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
