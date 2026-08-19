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
        'statuses_receivable': ['previsto', 'parcial', 'vencido', 'recebido'],
        'statuses_payable': ['previsto', 'vencido', 'sem_data'],
        'can': {
            'receivables': _can_tab(u, 'financeiro_receivables'),
            'payables': _can_tab(u, 'financeiro_payables'),
            'cashflow': _can_tab(u, 'financeiro_cashflow'),
            'past': _can_past(u),
        },
        'today': str(S.today()),
    })


def _parcela_do_usuario(request, pk):
    """A parcela, já limitada ao que este usuário pode alcançar (escopo de agência)."""
    from contracts.models import ContractInstallment
    qs = (ContractInstallment.objects.select_related('contract')
          .filter(contract__is_deleted=False))
    scope = agency_scope_ids(request.user)
    if scope is not None:
        qs = qs.filter(contract__agency_id__in=scope)
    return get_object_or_404(qs, pk=pk)


def _liquido(inst):
    """Valor líquido previsto da parcela — é o teto do que pode ser recebido."""
    return S.liquido_das_parcelas([inst])[inst.id][2]


def _rotulo(inst):
    c = inst.contract
    nome = 'Entrada' if inst.kind == 'entrada' else f'Parcela {inst.installment_number or ""}'.strip()
    return f'{nome} — contrato {c.reservation_number or c.id}'


def _resumo(inst):
    """Estado da parcela depois de mexer nos recebimentos (o front usa direto)."""
    liquido = _liquido(inst)
    pagamentos = list(inst.payments.select_related('created_by').order_by('paid_at', 'id'))
    recebido = sum((Decimal(str(p.value_brl)) for p in pagamentos), Decimal('0'))
    return {
        'id': inst.id,
        'received_real': bool(pagamentos),
        'received_brl': str(recebido.quantize(S.CENT)),
        'balance_brl': str((liquido - recebido).quantize(S.CENT)),
        'value_brl': str(liquido.quantize(S.CENT)),
        'status': S._rec_status(inst, liquido, recebido, S.today()),
        'payments': [{
            'id': p.id, 'paid_at': str(p.paid_at),
            'value_brl': str(Decimal(str(p.value_brl)).quantize(S.CENT)),
            'note': p.note or '',
            'by': ((p.created_by.first_name or p.created_by.username) if p.created_by_id else None),
        } for p in pagamentos],
    }


@api_view(['POST'])
def add_receivable_payment(request, pk):
    """Lança um RECEBIMENTO na parcela.

    Corpo: {value?: '960,16', date?: 'AAAA-MM-DD', note?: str}
    - `value` em branco = entrou o saldo inteiro (quita a parcela).
    - `date` em branco = hoje.

    A soma dos recebimentos NUNCA passa do líquido da parcela: receber mais do
    que se cobrou não é recebimento, é outra coisa (e o excedente entraria como
    dinheiro que a tela não sabe de onde veio). Pagar MENOS é normal — a parcela
    fica "parcial" e o saldo continua a receber.

    Ver o Financeiro não dá direito de mexer no dinheiro: exige `financeiro_settle`.
    """
    if not _can_tab(request.user, 'financeiro_receivables'):
        return _deny()
    if not has_any_perm(request.user, 'financeiro_settle'):
        return Response({'detail': 'Você não tem permissão para dar baixa em parcelas.'}, status=403)

    from contracts.models import ContractInstallmentPayment
    inst = _parcela_do_usuario(request, pk)
    liquido = _liquido(inst)
    ja = sum((Decimal(str(p.value_brl)) for p in inst.payments.all()), Decimal('0'))
    saldo = liquido - ja
    if saldo <= 0:
        return Response({'error': 'Esta parcela já está totalmente recebida.'}, status=400)

    bruto = request.data.get('value')
    if bruto in (None, ''):
        valor = saldo
    else:
        try:
            valor = Decimal(str(bruto).replace('.', '').replace(',', '.')
                            if ',' in str(bruto) else str(bruto))
        except (InvalidOperation, ValueError):
            return Response({'error': 'Valor recebido inválido.'}, status=400)
    valor = valor.quantize(S.CENT)
    if valor <= 0:
        return Response({'error': 'O valor recebido precisa ser maior que zero.'}, status=400)
    if valor > saldo:
        return Response({'error': (f'O valor não pode passar do que falta receber nesta parcela '
                                   f'(R$ {saldo.quantize(S.CENT)}).')}, status=400)

    data = (request.data.get('date') or '').strip()
    if data:
        from datetime import date as _date
        try:
            quando = _date.fromisoformat(data)
        except ValueError:
            return Response({'error': 'Data inválida (use AAAA-MM-DD).'}, status=400)
    else:
        quando = S.today()

    pg = ContractInstallmentPayment.objects.create(
        installment=inst, paid_at=quando, value_brl=valor,
        note=(request.data.get('note') or '').strip()[:300], created_by=request.user)

    log_event('create', model_name='ContractInstallmentPayment', model_label='Recebimento de parcela',
              object_id=pg.id, object_repr=_rotulo(inst),
              changes={'recebimento': {
                  'valor': str(valor), 'data': str(quando),
                  'observacao': pg.note,
                  'restante': str((saldo - valor).quantize(S.CENT)),
              }},
              user=request.user)
    return Response(_resumo(inst))


@api_view(['DELETE'])
def delete_receivable_payment(request, pk, payment_id):
    """Apaga um recebimento — o valor volta a ser saldo a receber."""
    if not _can_tab(request.user, 'financeiro_receivables'):
        return _deny()
    if not has_any_perm(request.user, 'financeiro_settle'):
        return Response({'detail': 'Você não tem permissão para dar baixa em parcelas.'}, status=403)

    inst = _parcela_do_usuario(request, pk)
    pg = get_object_or_404(inst.payments, pk=payment_id)
    dados = {'valor': str(pg.value_brl), 'data': str(pg.paid_at), 'observacao': pg.note}
    pg.delete()
    log_event('delete', model_name='ContractInstallmentPayment', model_label='Recebimento de parcela',
              object_id=payment_id, object_repr=_rotulo(inst),
              changes={'recebimento_apagado': dados}, user=request.user)
    return Response(_resumo(inst))
