"""Testes do módulo Financeiro (agregação PREVISTA). Cobrem: recebíveis dos
contratos, contas a pagar do payment_schedule (com conversão de moeda por
cotação estimada e flag de sem-cotação), fluxo de caixa, escopo de agência e
gate de permissão."""
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from agencies.models import Agency
from users_api.models import UserPermissions
from contracts.models import Contract, ContractInstallment
from itineraries.models import Itinerary, ItineraryCostItem
from config_api.models import ConfigExchangeRate
from financeiro import services as S
from financeiro.services import receivables_report


def make_user(username, superuser=False, agency=None, **perms):
    u = User.objects.create_user(username=username, email=f'{username}@x.com', password='pw12345678')
    if superuser:
        u.is_superuser = True; u.is_staff = True; u.save()
    p, _ = UserPermissions.objects.get_or_create(user=u)
    for k, v in perms.items():
        setattr(p, k, v)
    p.save()
    if agency is not None:
        from agencies.models import AgencyMember
        AgencyMember.objects.create(agency=agency, user=u)
    return u


class ReceivablesTest(APITestCase):
    def setUp(self):
        S.clear_rate_cache()
        self.today = S.today()
        self.ag = Agency.objects.create(name='AgRec')
        self.c = Contract.objects.create(base_currency='USD', agency=self.ag, exchange_rate=Decimal('5'),
                                         stage='assinado', status='ativo', payment_type='parcelado')
        ContractInstallment.objects.create(contract=self.c, kind='entrada', due_date=self.today,
                                            value_brl=Decimal('1000'), payment_method='Pix')
        ContractInstallment.objects.create(contract=self.c, kind='parcela', installment_number=1,
                                            due_date=self.today - timedelta(days=5),
                                            value_brl=Decimal('500'), payment_method='Cartão')

    def test_cards_and_methods(self):
        u = make_user('recu', superuser=True)
        rep = S.receivables_report(u, {})
        self.assertEqual(rep['count'], 2)
        self.assertEqual(Decimal(rep['cards']['hoje']), Decimal('1000.00'))
        self.assertEqual(Decimal(rep['cards']['vencido']), Decimal('500.00'))
        self.assertEqual(Decimal(rep['cards']['pendente']), Decimal('1500.00'))
        methods = {m['method']: m for m in rep['methods']}
        self.assertEqual(Decimal(methods['Pix']['brl']), Decimal('1000.00'))

    def test_faturado_counts_as_received(self):
        self.c.stage = 'faturado'; self.c.save()
        u = make_user('recu2', superuser=True)
        rep = S.receivables_report(u, {})
        self.assertEqual(Decimal(rep['cards']['pendente']), Decimal('0.00'))
        self.assertTrue(Decimal(rep['cards']['recebido_mes']) >= Decimal('1000.00'))

    def test_cancelled_contract_excluded(self):
        self.c.status = 'cancelado'; self.c.save()
        u = make_user('recu3', superuser=True)
        self.assertEqual(S.receivables_report(u, {})['count'], 0)

    def test_agency_scope(self):
        other = Agency.objects.create(name='Outra')
        member = make_user('agu', agency=other, financeiro_view=True, financeiro_receivables=True)
        # usuário da 'Outra' não enxerga recebíveis da 'AgRec'
        self.assertEqual(S.receivables_report(member, {})['count'], 0)


class PayablesTest(APITestCase):
    def setUp(self):
        S.clear_rate_cache()
        self.today = S.today()
        ConfigExchangeRate.objects.create(from_currency='EUR', to_currency='BRL', rate=Decimal('6'))
        self.it = Itinerary.objects.create(name='RotP', base_currency='EUR', start_date=self.today + timedelta(days=30))
        # custo 1000 EUR, 20% até hoje, 80% em 10 dias
        self.item = ItineraryCostItem.objects.create(
            itinerary=self.it, description='Hotel', category='Hospedagem', supplier='ACME',
            currency='EUR', unit_value=Decimal('1000'), quantity=Decimal('1'),
            tax_kind='percent', tax_value=Decimal('0'), is_active=True,
            payment_schedule=[{'due_date': str(self.today), 'percent': '20', 'note': ''},
                              {'due_date': str(self.today + timedelta(days=10)), 'percent': '80', 'note': ''}])

    def test_conversion_and_cards(self):
        u = make_user('payu', superuser=True)
        rep = S.payables_report(u, {})
        self.assertEqual(rep['count'], 2)
        # 20% de 1000 EUR = 200 EUR × 6 = 1200 BRL hoje
        self.assertEqual(Decimal(rep['cards']['hoje']), Decimal('1200.00'))
        cur = {c['currency']: c for c in rep['by_currency']}
        self.assertEqual(Decimal(cur['EUR']['orig']), Decimal('1000.00'))
        self.assertEqual(Decimal(cur['EUR']['brl']), Decimal('6000.00'))

    def test_missing_rate_flagged(self):
        self.item.currency = 'JPY'; self.item.save()
        u = make_user('payu2', superuser=True)
        rep = S.payables_report(u, {})
        self.assertEqual(Decimal(rep['cards']['sem_cotacao']), Decimal('2'))
        for row in rep['detail']:
            self.assertIsNone(row['amount_brl'])

    def test_agency_user_sees_no_payables(self):
        ag = Agency.objects.create(name='AgX')
        member = make_user('payu3', agency=ag, financeiro_view=True, financeiro_payables=True)
        self.assertEqual(S.payables_report(member, {})['count'], 0)

    def test_rate_change_reflects_without_manual_clear(self):
        """Simula duas requisições no MESMO processo: muda a cotação do euro entre
        elas e o BRL tem que acompanhar (o cache de taxa nunca pode ficar stale)."""
        u = make_user('payu4', superuser=True)
        rep1 = S.payables_report(u, {})
        self.assertEqual(Decimal(rep1['cards']['hoje']), Decimal('1200.00'))   # 200 EUR × 6
        rate = ConfigExchangeRate.objects.get(from_currency='EUR')
        rate.base_rate = Decimal('7'); rate.save()   # taxa efetiva recalcula p/ 7 (markup 0)
        rep2 = S.payables_report(u, {})                                        # sem clear_rate_cache manual
        self.assertEqual(Decimal(rep2['cards']['hoje']), Decimal('1400.00'))   # 200 EUR × 7 (novo)


class CashflowTest(APITestCase):
    def setUp(self):
        S.clear_rate_cache()
        self.today = S.today()
        self.ag = Agency.objects.create(name='AgCf')
        c = Contract.objects.create(base_currency='USD', agency=self.ag, exchange_rate=Decimal('5'),
                                    stage='assinado', status='ativo', payment_type='parcelado')
        ContractInstallment.objects.create(contract=c, kind='entrada', due_date=self.today,
                                            value_brl=Decimal('2000'), payment_method='Pix')
        ConfigExchangeRate.objects.create(from_currency='EUR', to_currency='BRL', rate=Decimal('6'))
        it = Itinerary.objects.create(name='RotC', base_currency='EUR')
        ItineraryCostItem.objects.create(itinerary=it, description='X', currency='EUR',
                                          unit_value=Decimal('100'), quantity=Decimal('1'), is_active=True,
                                          tax_kind='percent', tax_value=Decimal('0'),
                                          payment_schedule=[{'due_date': str(self.today), 'percent': '100'}])

    def test_net_result(self):
        u = make_user('cfu', superuser=True)
        rep = S.cashflow_report(u, {}, opening=Decimal('100'))
        self.assertEqual(Decimal(rep['cards']['entradas']), Decimal('2000.00'))
        self.assertEqual(Decimal(rep['cards']['saidas']), Decimal('600.00'))    # 100 EUR × 6
        self.assertEqual(Decimal(rep['cards']['resultado']), Decimal('1400.00'))
        # saldo acumulado começa em 100 e sobe com 1400
        self.assertEqual(Decimal(rep['series'][-1]['accumulated']), Decimal('1500.00'))


class PermissionGateTest(APITestCase):
    def test_no_permission_denied(self):
        u = make_user('noperm')
        self.client.force_authenticate(u)
        for path in ('/api/financeiro/receivables/', '/api/financeiro/payables/',
                     '/api/financeiro/cashflow/', '/api/financeiro/meta/'):
            self.assertEqual(self.client.get(path).status_code, 403, path)

    def test_view_alone_cannot_see_tabs(self):
        # financeiro_view abre o módulo (meta ok) mas NÃO libera aba nenhuma (E, não OU).
        u = make_user('viewonly', financeiro_view=True)
        self.client.force_authenticate(u)
        self.assertEqual(self.client.get('/api/financeiro/meta/').status_code, 200)
        self.assertEqual(self.client.get('/api/financeiro/receivables/').status_code, 403)
        self.assertEqual(self.client.get('/api/financeiro/payables/').status_code, 403)
        self.assertEqual(self.client.get('/api/financeiro/cashflow/').status_code, 403)

    def test_tab_perm_without_view_denied(self):
        # Ter a permissão da aba sem acessar o módulo não basta.
        u = make_user('tabonly', financeiro_receivables=True)
        self.client.force_authenticate(u)
        self.assertEqual(self.client.get('/api/financeiro/receivables/').status_code, 403)

    def test_view_plus_tab_allows_only_that_tab(self):
        u = make_user('recv', financeiro_view=True, financeiro_receivables=True)
        self.client.force_authenticate(u)
        self.assertEqual(self.client.get('/api/financeiro/receivables/').status_code, 200)
        self.assertEqual(self.client.get('/api/financeiro/payables/').status_code, 403)
        self.assertEqual(self.client.get('/api/financeiro/cashflow/').status_code, 403)

    def test_meta_reports_capabilities(self):
        u = make_user('caps', financeiro_view=True, financeiro_cashflow=True, financeiro_past=True)
        self.client.force_authenticate(u)
        can = self.client.get('/api/financeiro/meta/').json()['can']
        self.assertFalse(can['receivables'])
        self.assertFalse(can['payables'])
        self.assertTrue(can['cashflow'])
        self.assertTrue(can['past'])


class PastPermissionTest(APITestCase):
    def setUp(self):
        S.clear_rate_cache()
        self.today = S.today()
        self.ag = Agency.objects.create(name='AgPast')
        c = Contract.objects.create(base_currency='USD', agency=self.ag, exchange_rate=Decimal('5'),
                                    stage='assinado', status='ativo', payment_type='parcelado')
        # uma parcela VENCIDA (passado) e uma FUTURA
        ContractInstallment.objects.create(contract=c, kind='parcela', installment_number=1,
                                            due_date=self.today - timedelta(days=30),
                                            value_brl=Decimal('300'), payment_method='Pix')
        ContractInstallment.objects.create(contract=c, kind='parcela', installment_number=2,
                                            due_date=self.today + timedelta(days=30),
                                            value_brl=Decimal('700'), payment_method='Pix')

    def test_without_past_hides_overdue(self):
        u = make_user('nopast', superuser=True)
        # can_past=False → só a parcela futura (700); a vencida (300) fica de fora
        rep = S.receivables_report(u, {}, can_past=False)
        self.assertEqual(rep['count'], 1)
        self.assertEqual(Decimal(rep['cards']['vencido']), Decimal('0.00'))

    def test_with_past_shows_everything(self):
        u = make_user('withpast', superuser=True)
        rep = S.receivables_report(u, {}, can_past=True)
        self.assertEqual(rep['count'], 2)
        self.assertEqual(Decimal(rep['cards']['vencido']), Decimal('300.00'))


class TaxaDoCartaoNosRecebiveisTest(TestCase):
    """O que entra em caixa não é o que o cliente paga: a adquirente fica com a
    taxa. Quem faz o fluxo de caixa precisa ver o líquido."""

    def setUp(self):
        from config_api.models import CardBrand, ConfigPaymentMethod, GatewayFee, PaymentGateway
        from contracts.models import Contract, ContractInstallment
        self.user = User.objects.create_superuser('fin_tx', 'f@f.com', 'pw12345678')
        ConfigPaymentMethod.objects.create(name='Cartão de crédito', kind='cartao_credito')
        ConfigPaymentMethod.objects.create(name='Boleto', kind='boleto')
        visa = CardBrand.objects.create(name='Visa')
        elo  = CardBrand.objects.create(name='Elo')
        self.gw = PaymentGateway.objects.create(name='Stone')
        # Em 2x: Visa 3%, Elo 5% — a mais cara é a que vale no caixa.
        GatewayFee.objects.create(gateway=self.gw, brand=visa, installments=2, percent=Decimal('3'))
        GatewayFee.objects.create(gateway=self.gw, brand=elo,  installments=2, percent=Decimal('5'))
        self.ct = Contract.objects.create(status='ativo', stage='assinado', payment_gateway=self.gw)
        hoje = timezone.localdate()
        for n in (1, 2):
            ContractInstallment.objects.create(contract=self.ct, kind='parcela', installment_number=n,
                                               due_date=hoje, value_brl=Decimal('1000'),
                                               payment_method='Cartão de crédito', order=n)

    def relatorio(self):
        return receivables_report(self.user, {}, limit=50)

    def test_cada_parcela_mostra_gateway_taxa_e_liquido(self):
        linhas = self.relatorio()['detail']
        self.assertEqual(len(linhas), 2)
        for l in linhas:
            self.assertEqual(l['gateway'], 'Stone')
            self.assertEqual(Decimal(l['fee_pct']), Decimal('5'))   # a bandeira mais cara
            self.assertEqual(Decimal(l['fee_brl']), Decimal('50'))
            self.assertEqual(Decimal(l['gross_brl']), Decimal('1000'))
            # `value_brl` é o LÍQUIDO: é o número que o financeiro usa em tudo.
            self.assertEqual(Decimal(l['value_brl']), Decimal('950'))

    def test_os_totais_sao_liquidos(self):
        cards = self.relatorio()['cards']
        self.assertEqual(Decimal(cards['bruto']), Decimal('2000'))
        self.assertEqual(Decimal(cards['taxas']), Decimal('100'))
        self.assertEqual(Decimal(cards['pendente']), Decimal('1900'))   # bruto − taxas

    def test_o_grafico_por_mes_tambem_e_liquido(self):
        mes = self.relatorio()['timeline'][0]
        self.assertEqual(Decimal(mes['previsto']) + Decimal(mes['vencido']), Decimal('1900'))

    def test_a_distribuicao_por_forma_tambem_e_liquida(self):
        forma = self.relatorio()['methods'][0]
        self.assertEqual(forma['method'], 'Cartão de crédito')
        self.assertEqual(Decimal(forma['brl']), Decimal('1900'))

    def test_boleto_nao_tem_taxa_nem_gateway(self):
        from contracts.models import ContractInstallment
        ContractInstallment.objects.filter(contract=self.ct).update(payment_method='Boleto')
        l = self.relatorio()['detail'][0]
        self.assertIsNone(l['gateway'])
        self.assertIsNone(l['fee_pct'])
        self.assertEqual(Decimal(l['value_brl']), Decimal('1000'))    # líquido = bruto

    def test_sem_gateway_escolhido_nao_se_inventa_taxa(self):
        self.ct.payment_gateway = None
        self.ct.save(update_fields=['payment_gateway'])
        l = self.relatorio()['detail'][0]
        self.assertIsNone(l['fee_pct'])
        self.assertEqual(Decimal(l['value_brl']), Decimal('1000'))

    def test_plano_sem_taxa_cadastrada_nao_inventa(self):
        """Contrato em 2x num gateway que só tem tabela de 1x."""
        self.gw.fees.all().delete()
        l = self.relatorio()['detail'][0]
        self.assertEqual(l['gateway'], 'Stone')     # o gateway continua sendo dito
        self.assertIsNone(l['fee_pct'])

    def test_o_fluxo_de_caixa_recebe_o_liquido(self):
        from financeiro.services import cashflow_report
        entradas = sum(Decimal(m['in']) for m in cashflow_report(self.user, {})['series'])
        self.assertEqual(entradas, Decimal('1900'))


class EtapaDoContratoNosRecebiveisTest(TestCase):
    """Antes da assinatura a parcela é intenção, não dinheiro a receber — mas
    quem planeja caixa quer poder ver o que está por vir."""

    def setUp(self):
        self.user = User.objects.create_superuser('fin_st', 'f@f.com', 'pw12345678')
        hoje = timezone.localdate()
        self.por_etapa = {}
        for etapa, valor in (('assinado', 1000), ('faturado', 500), ('enviado', 300), ('a_faturar', 200),
                             ('em_edicao', 90)):
            ct = Contract.objects.create(status='ativo', stage=etapa)
            ContractInstallment.objects.create(contract=ct, kind='parcela', installment_number=1,
                                               due_date=hoje, value_brl=Decimal(valor), order=1)
            self.por_etapa[etapa] = ct

    def total(self, f):
        return sum(Decimal(l['value_brl']) for l in receivables_report(self.user, f, limit=50)['detail'])

    def test_o_padrao_e_so_o_que_foi_assinado(self):
        self.assertEqual(self.total({}), Decimal('1500'))     # assinado + faturado

    def test_a_chave_traz_o_que_esta_por_vir(self):
        self.assertEqual(self.total({'a_caminho': True}), Decimal('2090'))   # tudo

    def test_filtro_de_etapas_soma_as_escolhidas(self):
        """"Quero ver a verificação do financeiro MAIS os que estão para assinar." """
        self.assertEqual(self.total({'stages': ['a_faturar', 'enviado']}), Decimal('500'))

    def test_o_filtro_de_etapas_manda_mais_que_a_chave(self):
        self.assertEqual(self.total({'stages': ['em_edicao'], 'a_caminho': False}), Decimal('90'))

    def test_o_resumo_por_etapa_ignora_o_filtro_de_etapa(self):
        r = receivables_report(self.user, {}, limit=50)
        etapas = {e['stage']: e for e in r['stage_totals']}
        self.assertEqual(set(etapas), {'assinado', 'faturado', 'enviado', 'a_faturar', 'em_edicao'})
        self.assertEqual(Decimal(etapas['enviado']['brl']), Decimal('300'))
        self.assertTrue(etapas['assinado']['firmado'])
        self.assertFalse(etapas['enviado']['firmado'])

    def test_desta_etapa_em_diante(self):
        """Quem planeja caixa corta o funil: "do para-assinar em diante"."""
        self.assertEqual(self.total({'from_stage': 'enviado'}), Decimal('1800'))   # enviado+assinado+faturado
        self.assertEqual(self.total({'from_stage': 'a_faturar'}), Decimal('2000'))
        self.assertEqual(self.total({'from_stage': 'em_edicao'}), Decimal('2090'))  # tudo
        self.assertEqual(self.total({'from_stage': 'assinado'}), Decimal('1500'))

    def test_etapa_desconhecida_nao_esconde_nada(self):
        self.assertEqual(self.total({'from_stage': 'inventada'}), Decimal('2090'))

    def test_etapas_soltas_ainda_mandam_mais_que_o_corte(self):
        self.assertEqual(self.total({'stages': ['em_edicao'], 'from_stage': 'assinado'}), Decimal('90'))


class InstallmentPaymentsTest(APITestCase):
    """Recebimento da parcela: quita inteira, quita metade (fica saldo) e nunca
    aceita mais do que a parcela vale."""

    def setUp(self):
        S.clear_rate_cache()
        self.today = S.today()
        self.ag = Agency.objects.create(name='AgBaixa')
        self.c = Contract.objects.create(base_currency='USD', agency=self.ag, exchange_rate=Decimal('5'),
                                         stage='assinado', status='ativo', payment_type='parcelado',
                                         reservation_number='000900')
        self.inst = ContractInstallment.objects.create(
            contract=self.c, kind='entrada', due_date=self.today,
            value_brl=Decimal('1000'), payment_method='Pix')
        self.url = f'/api/financeiro/receivables/{self.inst.id}/payments/'

    def _user(self, name, **perms):
        return make_user(name, financeiro_view=True, financeiro_receivables=True, **perms)

    def _rep(self, nome):
        return S.receivables_report(make_user(nome, superuser=True), {})

    def test_requires_permission(self):
        self.client.force_authenticate(self._user('semsettle'))   # vê, mas não baixa
        r = self.client.post(self.url, {}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.inst.payments.count(), 0)

    def test_full_payment_settles_the_installment(self):
        u = self._user('baixador', financeiro_settle=True)
        self.client.force_authenticate(u)
        r = self.client.post(self.url, {'note': 'Pix caiu'}, format='json')   # sem valor = saldo inteiro
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['status'], 'recebido')
        self.assertEqual(Decimal(r.data['received_brl']), Decimal('1000.00'))
        self.assertEqual(Decimal(r.data['balance_brl']), Decimal('0.00'))
        pg = self.inst.payments.get()
        self.assertEqual(pg.paid_at, self.today)
        self.assertEqual(pg.created_by_id, u.id)
        rep = self._rep('leitor')
        self.assertEqual(Decimal(rep['cards']['pendente']), Decimal('0.00'))
        self.assertEqual(Decimal(rep['cards']['recebido_mes']), Decimal('1000.00'))

    def test_half_payment_keeps_the_rest_as_receivable(self):
        """O caso do Fred: o cliente pagou metade. O resto continua a receber."""
        self.client.force_authenticate(self._user('baixador2', financeiro_settle=True))
        r = self.client.post(self.url, {'value': '400'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['status'], 'parcial')
        self.assertEqual(Decimal(r.data['balance_brl']), Decimal('600.00'))
        rep = self._rep('leitor2')
        linha = rep['detail'][0]
        self.assertEqual(linha['status'], 'parcial')
        self.assertEqual(Decimal(linha['balance_brl']), Decimal('600.00'))
        # nos cards, só o SALDO continua pendente; o que entrou vira recebido
        self.assertEqual(Decimal(rep['cards']['pendente']), Decimal('600.00'))
        self.assertEqual(Decimal(rep['cards']['recebido_mes']), Decimal('400.00'))
        # e o segundo pagamento fecha a conta
        r = self.client.post(self.url, {'value': '600'}, format='json')
        self.assertEqual(r.data['status'], 'recebido')
        self.assertEqual(self.inst.payments.count(), 2)
        self.assertEqual(Decimal(self._rep('leitor3')['cards']['pendente']), Decimal('0.00'))

    def test_never_more_than_the_installment(self):
        self.client.force_authenticate(self._user('baixador3', financeiro_settle=True))
        r = self.client.post(self.url, {'value': '1000.01'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('não pode passar', r.data['error'])
        self.client.post(self.url, {'value': '900'}, format='json')
        # sobrando 100, um lançamento de 200 também é recusado
        r = self.client.post(self.url, {'value': '200'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.inst.payments.count(), 1)

    def test_rejects_bad_input(self):
        self.client.force_authenticate(self._user('baixador4', financeiro_settle=True))
        self.assertEqual(self.client.post(self.url, {'date': '31/02/2026'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(self.url, {'value': 'abc'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(self.url, {'value': '0'}, format='json').status_code, 400)
        self.assertEqual(self.inst.payments.count(), 0)

    def test_delete_payment_returns_the_balance(self):
        self.client.force_authenticate(self._user('baixador5', financeiro_settle=True))
        r = self.client.post(self.url, {'value': '400'}, format='json')
        pid = r.data['payments'][0]['id']
        r = self.client.delete(f'{self.url}{pid}/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['status'], 'previsto')
        self.assertEqual(Decimal(r.data['balance_brl']), Decimal('1000.00'))
        self.assertEqual(self.inst.payments.count(), 0)

    def test_agency_user_cannot_touch_other_agency(self):
        outra = Agency.objects.create(name='OutraBaixa')
        u = make_user('agdeoutra', agency=outra, financeiro_view=True,
                      financeiro_receivables=True, financeiro_settle=True)
        self.client.force_authenticate(u)
        r = self.client.post(self.url, {}, format='json')
        self.assertEqual(r.status_code, 404)
        self.assertEqual(self.inst.payments.count(), 0)

    def test_payment_is_audited(self):
        from audit.models import AuditLog
        self.client.force_authenticate(self._user('baixador6', financeiro_settle=True))
        self.client.post(self.url, {}, format='json')
        self.assertTrue(AuditLog.objects.filter(model_name='ContractInstallmentPayment').exists())

    def test_editing_contract_keeps_the_money(self):
        """Salvar o contrato reescrevia as parcelas — e levaria a baixa junto."""
        from contracts.serializers import ContractSerializer
        self.client.force_authenticate(self._user('baixador7', financeiro_settle=True))
        self.client.post(self.url, {'value': '400'}, format='json')
        ser = ContractSerializer(self.c, data={'installments': [
            {'kind': 'entrada', 'due_date': str(self.today), 'value_brl': '1000', 'payment_method': 'Pix'},
            {'kind': 'parcela', 'installment_number': 1, 'due_date': str(self.today), 'value_brl': '500'},
        ]}, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        self.inst.refresh_from_db()
        self.assertEqual(self.inst.payments.count(), 1)   # o recebimento sobreviveu

    def test_cannot_drop_an_installment_that_already_received(self):
        from rest_framework.exceptions import ValidationError
        from contracts.serializers import ContractSerializer
        ContractInstallment.objects.create(contract=self.c, kind='parcela', installment_number=1,
                                           due_date=self.today, value_brl=Decimal('500'))
        self.client.force_authenticate(self._user('baixador8', financeiro_settle=True))
        alvo = self.c.installments.order_by('order', 'id').last()
        self.client.post(f'/api/financeiro/receivables/{alvo.id}/payments/', {'value': '100'}, format='json')
        ser = ContractSerializer(self.c, data={'installments': [
            {'kind': 'entrada', 'due_date': str(self.today), 'value_brl': '1000', 'payment_method': 'Pix'},
        ]}, partial=True)
        ser.is_valid(raise_exception=True)
        with self.assertRaises(ValidationError):
            ser.save()
