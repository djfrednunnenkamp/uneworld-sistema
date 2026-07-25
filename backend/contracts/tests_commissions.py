"""Comissões dos Vendedores: fórmula, política de status, escopo/IDOR, consistência
(soma dos vendedores == consolidado), export auditado."""
from decimal import Decimal
from datetime import date

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from users_api.models import UserPermissions
from agencies.models import Agency
from contracts.models import Contract, ContractAccommodationLine
from contracts import commissions as C
from audit.models import AuditLog


def make_user(username, superuser=False, **perms):
    u = User.objects.create_user(username=username, email=f'{username}@x.com', password='pw12345678',
                                 first_name=username.capitalize())
    if superuser:
        u.is_superuser = True; u.is_staff = True; u.save()
    p, _ = UserPermissions.objects.get_or_create(user=u)
    for k, v in perms.items():
        setattr(p, k, v)
    p.save()
    return u


def make_contract(*, seller=None, created_by=None, agency=None, total_usd='1000', total_brl='5000',
                  rate='5', stage='faturado', status='ativo', per_person='1000', qty=1,
                  contract_date=None):
    c = Contract.objects.create(
        base_currency='USD', seller=seller, created_by=created_by, agency=agency,
        total_usd=Decimal(total_usd), total_brl=Decimal(total_brl), exchange_rate=Decimal(rate),
        stage=stage, status=status, contract_date=contract_date or date(2026, 3, 10))
    ContractAccommodationLine.objects.create(contract=c, value_per_person_usd=Decimal(per_person),
                                             taxes_usd=Decimal('0'), quantity=qty)
    return c


class FinancialsTest(APITestCase):
    def setUp(self):
        self.ag = Agency.objects.create(name='Ag10', commission_rate=Decimal('10'))
        self.seller = make_user('vend')

    def test_net_sold_commission_formula(self):
        # subtotal=1000 → comissão 10% = 100 USD × câmbio 5 = 500 BRL; vendido 5000 → NET 4500.
        c = make_contract(seller=self.seller, agency=self.ag)
        fin = C.contract_financials(c)
        self.assertEqual(fin['sold_brl'], Decimal('5000'))
        self.assertEqual(fin['agency_commission_brl'], Decimal('500.00'))
        self.assertEqual(fin['net_brl'], Decimal('4500.00'))
        self.assertEqual(fin['seller_id'], self.seller.id)

    def test_no_agency_no_commission(self):
        c = make_contract(seller=self.seller, agency=None)
        fin = C.contract_financials(c)
        self.assertEqual(fin['agency_commission_brl'], Decimal('0'))
        self.assertEqual(fin['net_brl'], fin['sold_brl'])   # NET == vendido

    def test_no_seller_bucket(self):
        c = make_contract(seller=None, created_by=None, agency=self.ag)
        self.assertIsNone(C.contract_financials(c)['seller_id'])

    def test_seller_falls_back_to_creator(self):
        c = make_contract(seller=None, created_by=self.seller, agency=self.ag)
        self.assertEqual(C.contract_financials(c)['seller_id'], self.seller.id)


class PolicyAndConsistencyTest(APITestCase):
    def setUp(self):
        self.ag = Agency.objects.create(name='Ag10', commission_rate=Decimal('10'))
        self.root = make_user('root', superuser=True)
        self.a = make_user('alice'); self.b = make_user('bob')

    def test_cancelled_and_draft_excluded_by_default(self):
        make_contract(seller=self.a, agency=self.ag, stage='faturado', status='ativo')       # conta
        make_contract(seller=self.a, agency=self.ag, stage='faturado', status='cancelado')   # NÃO
        make_contract(seller=self.a, agency=self.ag, stage='em_edicao', status='ativo')      # NÃO (rascunho)
        qs = C.apply_filters(C.base_queryset(self.root))
        self.assertEqual(C.summarize(qs)['contracts'], 1)

    def test_sum_of_sellers_equals_consolidated(self):
        make_contract(seller=self.a, agency=self.ag, total_brl='5000')
        make_contract(seller=self.b, agency=self.ag, total_brl='3000')
        make_contract(seller=None, created_by=None, agency=self.ag, total_brl='2000')
        qs = C.apply_filters(C.base_queryset(self.root))
        summ = C.summarize(qs)
        sellers = C.by_seller(qs)
        self.assertEqual(summ['contracts'], 3)
        self.assertEqual(Decimal(summ['sold_brl']), Decimal('10000.00'))
        # soma dos vendedores == consolidado (inclui o bucket "sem vendedor")
        self.assertEqual(sum(Decimal(r['sold_brl']) for r in sellers), Decimal(summ['sold_brl']))
        self.assertEqual(sum(r['contracts'] for r in sellers), summ['contracts'])

    def test_year_filter(self):
        make_contract(seller=self.a, agency=self.ag, contract_date=date(2025, 6, 1))
        make_contract(seller=self.a, agency=self.ag, contract_date=date(2026, 6, 1))
        qs = C.apply_filters(C.base_queryset(self.root), year=2026)
        self.assertEqual(C.summarize(qs)['contracts'], 1)


class ApiSecurityTest(APITestCase):
    def setUp(self):
        self.ag = Agency.objects.create(name='Ag10', commission_rate=Decimal('10'))
        self.alice = make_user('alice', commissions_view=True)                     # só as próprias
        self.boss  = make_user('boss', commissions_view=True, commissions_view_all=True)
        self.nobody = make_user('nobody')                                          # sem acesso
        make_contract(seller=self.alice, agency=self.ag, total_brl='5000')
        make_contract(seller=self.boss,  agency=self.ag, total_brl='3000')

    def test_no_permission_403(self):
        self.client.force_authenticate(self.nobody)
        self.assertEqual(self.client.get('/api/contracts/commissions/summary/').status_code, 403)

    def test_seller_sees_only_own(self):
        self.client.force_authenticate(self.alice)
        r = self.client.get('/api/contracts/commissions/summary/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Decimal(r.json()['summary']['sold_brl']), Decimal('5000.00'))  # não vê os 3000 do boss
        self.assertFalse(r.json()['can_view_all'])

    def test_view_all_sees_everyone(self):
        self.client.force_authenticate(self.boss)
        r = self.client.get('/api/contracts/commissions/summary/')
        self.assertEqual(Decimal(r.json()['summary']['sold_brl']), Decimal('8000.00'))

    def test_idor_seller_cannot_read_other_seller_contracts(self):
        self.client.force_authenticate(self.alice)
        r = self.client.get(f'/api/contracts/commissions/seller/{self.boss.id}/contracts/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['contracts'], [])   # base_queryset já limita às próprias → vazio

    def test_export_requires_permission_and_is_audited(self):
        self.client.force_authenticate(self.alice)   # tem view, não tem export
        self.assertEqual(self.client.get('/api/contracts/commissions/export/').status_code, 403)
        exporter = make_user('exp', commissions_view=True, commissions_view_all=True, commissions_export=True)
        self.client.force_authenticate(exporter)
        before = AuditLog.objects.filter(action='download').count()
        r = self.client.get('/api/contracts/commissions/export/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r['Content-Type'].split(';')[0], 'text/csv')
        self.assertIn('comissoes-vendedores', r['Content-Disposition'])
        self.assertEqual(AuditLog.objects.filter(action='download').count(), before + 1)

    def test_meta_years_not_hardcoded(self):
        self.client.force_authenticate(self.boss)
        r = self.client.get('/api/contracts/commissions/meta/')
        self.assertEqual(r.status_code, 200)
        self.assertIn(2026, r.json()['years'])
