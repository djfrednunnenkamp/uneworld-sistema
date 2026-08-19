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
from decimal import Decimal, InvalidOperation

from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.response import Response

from audit.tracking import log_event
from users_api.permissions import has_any_perm, agency_scope_ids
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


@api_view(['POST'])
def settle_receivable(request, pk):
    """Baixa da parcela: marca como RECEBIDA ou desfaz a baixa.

    Corpo: {received: bool, date?: 'YYYY-MM-DD', value?: '1234.56', note?: str}
    - received=true  → carimba received_at (padrão: hoje), quem baixou e, se
      informados, o valor que entrou de fato e uma observação.
    - received=false → limpa tudo; a parcela volta a ser previsão.

    Ver o Financeiro não dá direito de mexer no dinheiro: além de
    financeiro_view + financeiro_receivables (para chegar à tela), exige
    `financeiro_settle`. Usuário de agência só alcança as próprias parcelas.
    """
    from contracts.models import ContractInstallment

    if not _can_tab(request.user, 'financeiro_receivables'):
        return _deny()
    if not has_any_perm(request.user, 'financeiro_settle'):
        return Response({'detail': 'Você não tem permissão para dar baixa em parcelas.'}, status=403)

    qs = ContractInstallment.objects.select_related('contract').filter(contract__is_deleted=False)
    scope = agency_scope_ids(request.user)
    if scope is not None:
        qs = qs.filter(contract__agency_id__in=scope)
    inst = get_object_or_404(qs, pk=pk)

    received = bool(request.data.get('received'))
    antes = str(inst.received_at) if inst.received_at else ''

    if received:
        data = (request.data.get('date') or '').strip()
        if data:
            from datetime import date as _date
            try:
                inst.received_at = _date.fromisoformat(data)
            except ValueError:
                return Response({'error': 'Data inválida (use AAAA-MM-DD).'}, status=400)
        else:
            inst.received_at = S.today()
        valor = request.data.get('value')
        if valor in (None, ''):
            inst.received_value_brl = None
        else:
            try:
                inst.received_value_brl = Decimal(str(valor).replace(',', '.'))
            except (InvalidOperation, ValueError):
                return Response({'error': 'Valor recebido inválido.'}, status=400)
            if inst.received_value_brl < 0:
                return Response({'error': 'O valor recebido não pode ser negativo.'}, status=400)
        inst.received_note = (request.data.get('note') or '').strip()[:300]
        inst.received_by = request.user
    else:
        inst.received_at = None
        inst.received_value_brl = None
        inst.received_note = ''
        inst.received_by = None

    inst.save(update_fields=['received_at', 'received_value_brl', 'received_note', 'received_by'])

    c = inst.contract
    rotulo = 'Entrada' if inst.kind == 'entrada' else f'Parcela {inst.installment_number or ""}'.strip()
    log_event('update', model_name='ContractInstallment', model_label='Parcela do contrato',
              object_id=inst.id,
              object_repr=f'{rotulo} — contrato {c.reservation_number or c.id}',
              changes={'baixa': {
                  'de': antes or 'não recebida',
                  'para': str(inst.received_at) if inst.received_at else 'não recebida',
                  'valor': str(inst.received_value_brl) if inst.received_value_brl is not None else '',
                  'observacao': inst.received_note,
              }},
              user=request.user)

    return Response({
        'id': inst.id,
        'received_real': bool(inst.received_at),
        'received_at': str(inst.received_at) if inst.received_at else None,
        'received_value_brl': str(inst.received_value_brl) if inst.received_value_brl is not None else None,
        'received_note': inst.received_note,
        'received_by': (request.user.first_name or request.user.username) if inst.received_at else None,
    })
