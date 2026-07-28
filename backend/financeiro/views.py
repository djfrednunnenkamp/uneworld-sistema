"""Endpoints do módulo Financeiro (agregação no backend, gated por permissão).
Tudo em Decimal; consolida em BRL; SÓ previsto (ver services)."""
from decimal import Decimal

from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from users_api.permissions import RequirePermission
from . import services as S


@api_view(['GET'])
@permission_classes([RequirePermission('financeiro_view', 'financeiro_receivables')])
def receivables(request):
    return Response(S.receivables_report(request.user, S.parse_filters(request)))


@api_view(['GET'])
@permission_classes([RequirePermission('financeiro_view', 'financeiro_payables')])
def payables(request):
    return Response(S.payables_report(request.user, S.parse_filters(request)))


@api_view(['GET'])
@permission_classes([RequirePermission('financeiro_view', 'financeiro_cashflow')])
def cashflow(request):
    opening = Decimal(str(request.query_params.get('opening') or '0') or '0')
    return Response(S.cashflow_report(request.user, S.parse_filters(request), opening=opening))


@api_view(['GET'])
@permission_classes([RequirePermission('financeiro_view')])
def meta(request):
    """Opções de filtro (formas de pagamento, categorias, moedas presentes)."""
    from config_api.models import ConfigPaymentMethod, ConfigCostCategory
    methods = list(ConfigPaymentMethod.objects.values_list('name', flat=True))
    cats = list(ConfigCostCategory.objects.values_list('name', flat=True))
    return Response({
        'methods': methods, 'categories': cats,
        'statuses_receivable': ['previsto', 'vencido', 'recebido'],
        'statuses_payable': ['previsto', 'vencido', 'sem_data'],
    })
