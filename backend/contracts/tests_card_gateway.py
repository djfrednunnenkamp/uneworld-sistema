"""Cartão na conferência do financeiro: qual adquirente leva esta venda.

Quem paga no cartão não entrega o valor cheio — a adquirente desconta a taxa
dela, e a taxa depende do contrato de adquirência e do nº de parcelas. Quem
sabe por onde a venda vai passar é o financeiro, na conferência.
"""
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import Client, TestCase

from config_api.models import CardBrand, ConfigPaymentMethod, GatewayFee, PaymentGateway
from contracts.card_payment import dados_do_cartao
from contracts.models import Contract, ContractInstallment


class CartaoNaConferenciaTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_superuser('fin', 'f@f.com', 'pw12345678')
        self.c = Client(); self.c.force_login(self.user)
        self.metodo = ConfigPaymentMethod.objects.create(name='Cartão de crédito', kind='cartao_credito')
        ConfigPaymentMethod.objects.create(name='Pix', kind='pix')
        self.visa = CardBrand.objects.create(name='Visa')
        self.elo  = CardBrand.objects.create(name='Elo')
        self.stone = PaymentGateway.objects.create(name='Stone')
        self.cielo = PaymentGateway.objects.create(name='Cielo')
        for gw, base in ((self.stone, Decimal('3')), (self.cielo, Decimal('4'))):
            for n in (1, 2, 3):
                GatewayFee.objects.create(gateway=gw, brand=self.visa, installments=n, percent=base + n)
                GatewayFee.objects.create(gateway=gw, brand=self.elo,  installments=n, percent=base + n + 1)
        self.contract = Contract.objects.create(stage='a_faturar')

    def parcelas(self, quantas, metodo='Cartão de crédito', valor=Decimal('100')):
        for n in range(1, quantas + 1):
            ContractInstallment.objects.create(contract=self.contract, kind='parcela',
                                               installment_number=n, value_brl=valor,
                                               payment_method=metodo, order=n)

    # ── o que a tela recebe ──
    def test_sem_cartao_nao_ha_o_que_escolher(self):
        self.parcelas(2, metodo='Pix')
        self.assertIsNone(dados_do_cartao(self.contract))

    def test_cartao_traz_os_gateways_com_a_taxa_daquela_parcela(self):
        self.parcelas(3)
        d = dados_do_cartao(self.contract)
        self.assertEqual(d['installments'], 3)
        self.assertEqual(Decimal(d['value_brl']), Decimal('300'))
        por_nome = {o['name']: o for o in d['options']}
        # Stone em 3x: Visa 6%, Elo 7% → a faixa é essa.
        self.assertEqual((por_nome['Stone']['fee_min'], por_nome['Stone']['fee_max']), ('6.000', '7.000'))
        # O custo mostrado é o do pior caso (a bandeira mais cara): 7% de 300.
        self.assertEqual(por_nome['Stone']['custo_brl'], '21.00')
        self.assertEqual(por_nome['Cielo']['custo_brl'], '24.00')

    def test_gateway_sem_taxa_para_aquela_parcela_aparece_sem_numero(self):
        self.parcelas(3)
        self.stone.fees.filter(installments=3).delete()
        d = dados_do_cartao(self.contract)
        stone = next(o for o in d['options'] if o['name'] == 'Stone')
        self.assertIsNone(stone['fee_min'])
        self.assertIsNone(stone['custo_brl'])   # sem taxa, não se inventa custo

    def test_debito_usa_a_linha_do_a_vista(self):
        ConfigPaymentMethod.objects.create(name='Cartão de débito', kind='cartao_debito')
        self.parcelas(1, metodo='Cartão de débito')
        self.assertEqual(dados_do_cartao(self.contract)['installments'], 0)

    def test_gateway_fora_de_uso_nao_e_oferecido(self):
        self.parcelas(1)
        self.cielo.is_active = False; self.cielo.save()
        nomes = [o['name'] for o in dados_do_cartao(self.contract)['options']]
        self.assertEqual(nomes, ['Stone'])

    # ── a gravação ──
    def liberar(self, **extra):
        return self.c.post(f'/api/contracts/{self.contract.id}/finance-approve/',
                           {'receipt_payer': 'cliente', **extra})

    def test_sem_escolher_o_gateway_nao_passa(self):
        self.parcelas(2)
        r = self.liberar()
        self.assertEqual(r.status_code, 400)
        self.contract.refresh_from_db()
        self.assertEqual(self.contract.stage, 'a_faturar')    # não avançou

    def test_escolha_gravada_e_contrato_segue(self):
        self.parcelas(2)
        r = self.liberar(payment_gateway=self.stone.id)
        self.assertEqual(r.status_code, 200, r.content)
        self.contract.refresh_from_db()
        self.assertEqual(self.contract.payment_gateway_id, self.stone.id)
        self.assertEqual(self.contract.stage, 'enviado')

    def test_gateway_inventado_e_recusado(self):
        self.parcelas(2)
        self.assertEqual(self.liberar(payment_gateway=99999).status_code, 400)

    def test_sem_cartao_a_escolha_nao_e_exigida(self):
        self.parcelas(2, metodo='Pix')
        r = self.liberar()
        self.assertEqual(r.status_code, 200, r.content)
        self.contract.refresh_from_db()
        self.assertEqual(self.contract.stage, 'enviado')

    def test_deixou_de_ser_cartao_limpa_a_escolha_antiga(self):
        self.contract.payment_gateway = self.stone
        self.contract.save(update_fields=['payment_gateway'])
        self.parcelas(2, metodo='Pix')
        self.liberar()
        self.contract.refresh_from_db()
        self.assertIsNone(self.contract.payment_gateway_id)
