"""Cartão: descobrir se o contrato é pago no cartão e por qual adquirente.

Quem paga no cartão não paga o valor cheio para a operadora: a adquirente
desconta a taxa dela, e essa taxa depende de DOIS números — o contrato de
adquirência (o gateway) e em quantas vezes a venda foi parcelada. Por isso a
escolha é do financeiro, na conferência, e não do vendedor: é ali que se sabe
por onde a venda vai passar.

O contrato não guarda a bandeira do cartão (o cliente ainda nem passou o
cartão quando o contrato é conferido), então a taxa aparece como faixa: da
menor à maior entre as bandeiras que aquele gateway opera naquela parcela.
"""
from decimal import Decimal

# As formas de pagamento que abrem a escolha de gateway.
KINDS_DE_CARTAO = ('cartao_credito', 'cartao_debito')


def _metodos_de_cartao():
    """{nome minúsculo da forma de pagamento: kind} — só as de cartão."""
    from config_api.models import ConfigPaymentMethod
    return {m.name.strip().lower(): m.kind
            for m in ConfigPaymentMethod.objects.filter(kind__in=KINDS_DE_CARTAO)}


def dados_do_cartao(contract):
    """Bloco 'card' da conferência do financeiro. Devolve None quando o contrato
    não tem nenhuma parcela paga no cartão — aí não há o que escolher."""
    from config_api.models import PaymentGateway

    cartoes = _metodos_de_cartao()
    if not cartoes:
        return None

    linhas = [i for i in contract.installments.all()
              if (i.payment_method or '').strip().lower() in cartoes]
    if not linhas:
        return None

    nome_da_forma = (linhas[0].payment_method or '').strip()
    kind = cartoes[nome_da_forma.lower()]
    # Débito não parcela: a taxa dele mora na linha 0 da tabela.
    parcelas = 0 if kind == 'cartao_debito' else max(1, len(linhas))
    valor_brl = sum((i.value_brl or Decimal('0')) for i in linhas)

    opcoes = []
    for gw in PaymentGateway.objects.filter(is_active=True).prefetch_related('fees'):
        taxas = sorted(f.percent for f in gw.fees.all() if f.installments == parcelas)
        opcao = {'id': gw.id, 'name': gw.name,
                 'fee_min': str(taxas[0]) if taxas else None,
                 'fee_max': str(taxas[-1]) if taxas else None,
                 'custo_brl': None}
        if taxas:
            # O custo mostrado é o do pior caso: a bandeira mais cara daquele
            # gateway. Subestimar a taxa na conferência é o erro que dói.
            opcao['custo_brl'] = str((valor_brl * taxas[-1] / 100).quantize(Decimal('0.01')))
        opcoes.append(opcao)

    return {
        'method_name': nome_da_forma,
        # A cobrança é gerada por venda, com o valor daquela venda: o link é
        # deste contrato, não do gateway.
        'payment_url': contract.payment_url or '',
        'kind': kind,
        'installments': parcelas,
        'value_brl': str(valor_brl),
        'gateway_id': contract.payment_gateway_id,
        'options': opcoes,
    }


def taxas_dos_contratos(contract_ids):
    """{contract_id: {'gateway', 'installments', 'pct'}} para os contratos pagos
    no cartão — a taxa que a adquirente desconta de cada parcela deles.

    O que entra em caixa não é o que o cliente paga: a adquirente fica com a
    taxa. Quem faz o fluxo de caixa precisa ver o líquido, não o bruto.

    A taxa é do CONTRATO, não da parcela: a adquirente cobra pelo plano (12x
    custa tanto), e desconta isso de cada repasse. Como a bandeira só se sabe
    quando o cliente passa o cartão, usamos a mais cara daquele gateway naquele
    plano — errar para menos no caixa é o erro que dói.
    """
    from collections import defaultdict

    from config_api.models import GatewayFee
    from .models import Contract, ContractInstallment

    ids = list(contract_ids)
    if not ids:
        return {}
    cartoes = _metodos_de_cartao()
    if not cartoes:
        return {}

    # Quantas parcelas de cartão cada contrato tem — o plano contratado.
    plano = defaultdict(int)
    for cid, metodo in ContractInstallment.objects.filter(contract_id__in=ids).values_list(
            'contract_id', 'payment_method'):
        if (metodo or '').strip().lower() in cartoes:
            plano[cid] += 1

    contratos = {c.id: c for c in Contract.objects.filter(id__in=plano.keys())
                 .select_related('payment_gateway')}

    # Uma consulta só para todas as combinações (gateway, nº de parcelas).
    pares = set()
    for cid, n in plano.items():
        c = contratos.get(cid)
        if c and c.payment_gateway_id:
            pares.add((c.payment_gateway_id, n))
    maior = {}
    if pares:
        for gid, parcelas, pct in GatewayFee.objects.filter(
                gateway_id__in={p[0] for p in pares},
                installments__in={p[1] for p in pares}).values_list(
                'gateway_id', 'installments', 'percent'):
            chave = (gid, parcelas)
            if pct > maior.get(chave, Decimal('-1')):
                maior[chave] = pct

    saida = {}
    for cid, n in plano.items():
        c = contratos.get(cid)
        if not c:
            continue
        gw = c.payment_gateway
        saida[cid] = {
            'gateway': gw.name if gw else None,
            'installments': n,
            'pct': maior.get((c.payment_gateway_id, n)) if gw else None,
        }
    return saida


def e_cartao(payment_method):
    """A forma de pagamento daquela parcela é cartão?"""
    return (payment_method or '').strip().lower() in _metodos_de_cartao()
