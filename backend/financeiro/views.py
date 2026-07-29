"""Endpoints do módulo Financeiro (agregação no backend, gated por permissão).
Tudo em Decimal; consolida em BRL; SÓ previsto (ver services).

Permissões (padrão do sistema, boolean por chave, revalidadas SEMPRE no backend):
  financeiro_view        → acessar o módulo (pré-requisito de tudo)
  financeiro_receivables → aba "Entradas previstas"
  financeiro_payables    → aba "Contas a pagar"
  financeiro_cashflow    → aba "Fluxo de caixa"
  financeiro_past        → ver dados de datas PASSADAS (senão, só de hoje em diante)
Cada aba exige `financeiro_view` E a chave da própria aba (semântica E, não OU).
"""
from decimal import Decimal

from rest_framework.decorators import api_view
from rest_framework.response import Response

from users_api.permissions import has_any_perm
from . import services as S


def _can_tab(user, tab):
    """Acesso a uma aba = acessar o módulo E ter a permissão da aba (superuser tudo)."""
    return has_any_perm(user, 'financeiro_view') and has_any_perm(user, tab)


def _deny():
    return Response({'detail': 'Você não tem permissão para ver esta aba do Financeiro.'}, status=403)


def _can_past(user):
    return has_any_perm(user, 'financeiro_view') and has_any_perm(user, 'financeiro_past')


@api_view(['GET'])
def receivables(request):
    if not _can_tab(request.user, 'financeiro_receivables'):
        return _deny()
    f = S.parse_filters(request)
    return Response(S.receivables_report(request.user, f, can_past=_can_past(request.user)))


@api_view(['GET'])
def payables(request):
    if not _can_tab(request.user, 'financeiro_payables'):
        return _deny()
    f = S.parse_filters(request)
    return Response(S.payables_report(request.user, f, can_past=_can_past(request.user)))


@api_view(['GET'])
def cashflow(request):
    if not _can_tab(request.user, 'financeiro_cashflow'):
        return _deny()
    opening = Decimal(str(request.query_params.get('opening') or '0') or '0')
    f = S.parse_filters(request)
    return Response(S.cashflow_report(request.user, f, opening=opening, can_past=_can_past(request.user)))


@api_view(['GET'])
def meta(request):
    """Opções de filtro + o que ESTE usuário pode ver (o front usa `can` para
    mostrar só as abas permitidas e limitar o filtro de data quando não pode ver
    o passado)."""
    if not has_any_perm(request.user, 'financeiro_view'):
        return _deny()
    from config_api.models import ConfigPaymentMethod, ConfigCostCategory
    methods = list(ConfigPaymentMethod.objects.values_list('name', flat=True))
    cats = list(ConfigCostCategory.objects.values_list('name', flat=True))
    u = request.user
    return Response({
        'methods': methods, 'categories': cats,
        'statuses_receivable': ['previsto', 'vencido', 'recebido'],
        'statuses_payable': ['previsto', 'vencido', 'sem_data'],
        'can': {
            'receivables': _can_tab(u, 'financeiro_receivables'),
            'payables': _can_tab(u, 'financeiro_payables'),
            'cashflow': _can_tab(u, 'financeiro_cashflow'),
            'past': _can_past(u),
        },
        'today': str(S.today()),
    })
