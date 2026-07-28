"""Testes do módulo Financeiro (agregação PREVISTA). Cobrem: recebíveis dos
contratos, contas a pagar do payment_schedule (com conversão de moeda por
cotação estimada e flag de sem-cotação), fluxo de caixa, escopo de agência e
gate de permissão."""
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from agencies.models import Agency
from users_api.models import UserPermissions
from contracts.models import Contract, ContractInstallment
from itineraries.models import Itinerary, ItineraryCostItem
from config_api.models import ConfigExchangeRate
from financeiro import services as S


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
                                         stage='em_edicao', status='ativo', payment_type='parcelado')
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
                                    stage='em_edicao', status='ativo', payment_type='parcelado')
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
    def test_endpoints_require_permission(self):
        u = make_user('noperm')
        self.client.force_authenticate(u)
        for path in ('/api/financeiro/receivables/', '/api/financeiro/payables/',
                     '/api/financeiro/cashflow/', '/api/financeiro/meta/'):
            self.assertEqual(self.client.get(path).status_code, 403, path)

    def test_view_perm_allows(self):
        u = make_user('okperm', financeiro_view=True)
        self.client.force_authenticate(u)
        self.assertEqual(self.client.get('/api/financeiro/receivables/').status_code, 200)
