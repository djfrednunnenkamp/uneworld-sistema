"""Testes do webhook da Autentique (auditoria IDS — A-07).

O webhook não confia no corpo: valida um segredo compartilhado (header
X-Webhook-Secret, com fallback ?secret= por compatibilidade) e reconsulta a API.
Fail-closed em produção quando o segredo não está configurado."""
from django.test import override_settings
from rest_framework.test import APITestCase

LOCMEM_CACHE = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
URL = '/api/contracts/autentique-webhook/'


@override_settings(CACHES=LOCMEM_CACHE, AUTENTIQUE_WEBHOOK_SECRET='topsecret')
class AutentiqueWebhookSecretTest(APITestCase):
    def test_correct_secret_via_header_accepted(self):
        r = self.client.post(URL, {}, format='json', HTTP_X_WEBHOOK_SECRET='topsecret')
        self.assertEqual(r.status_code, 200)

    def test_correct_secret_via_querystring_accepted(self):
        r = self.client.post(URL + '?secret=topsecret', {}, format='json')
        self.assertEqual(r.status_code, 200)

    def test_wrong_secret_rejected(self):
        r = self.client.post(URL + '?secret=errado', {}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_missing_secret_rejected(self):
        r = self.client.post(URL, {}, format='json')
        self.assertEqual(r.status_code, 403)


@override_settings(CACHES=LOCMEM_CACHE, AUTENTIQUE_WEBHOOK_SECRET='', DEBUG=False)
class AutentiqueWebhookNoSecretProdTest(APITestCase):
    def test_no_secret_in_production_is_rejected(self):
        r = self.client.post(URL, {}, format='json')
        self.assertEqual(r.status_code, 403)


@override_settings(CACHES=LOCMEM_CACHE, AUTENTIQUE_WEBHOOK_SECRET='', DEBUG=True)
class AutentiqueWebhookNoSecretDevTest(APITestCase):
    def test_no_secret_in_dev_is_allowed(self):
        r = self.client.post(URL, {}, format='json')
        self.assertEqual(r.status_code, 200)


# ── A-14 — validação de host no download da Autentique ────────────────────────
from unittest import mock
from django.test import SimpleTestCase
from contracts import autentique


class AutentiqueDownloadHostTest(SimpleTestCase):
    def test_host_matcher_rejects_lookalike(self):
        self.assertFalse(autentique._is_autentique_host('https://autentique.com.br.evil.com/f.pdf'))
        self.assertFalse(autentique._is_autentique_host('https://evilautentique.com.br/f.pdf'))
        self.assertTrue(autentique._is_autentique_host('https://autentique.com.br/f.pdf'))
        self.assertTrue(autentique._is_autentique_host('https://api.autentique.com.br/f.pdf'))

    @mock.patch.object(autentique, 'requests')
    def test_no_bearer_sent_to_lookalike_host(self, mreq):
        resp = mock.Mock(status_code=200, content=b'PDF', is_redirect=False,
                         is_permanent_redirect=False)
        resp.raise_for_status.return_value = None
        mreq.get.return_value = resp
        mreq.RequestException = Exception
        autentique.download('https://autentique.com.br.evil.com/f.pdf')
        # Não pode ter mandado Authorization para o host falso.
        headers = mreq.get.call_args.kwargs.get('headers') or {}
        self.assertNotIn('Authorization', headers)

    @override_settings(AUTENTIQUE_API_TOKEN='tok-secreto')
    @mock.patch.object(autentique, 'requests')
    def test_bearer_sent_to_official_host_without_following_redirect(self, mreq):
        resp = mock.Mock(status_code=200, content=b'PDF', is_redirect=False,
                         is_permanent_redirect=False)
        resp.raise_for_status.return_value = None
        mreq.get.return_value = resp
        mreq.RequestException = Exception
        autentique.download('https://api.autentique.com.br/documents/1/signed.pdf')
        kwargs = mreq.get.call_args.kwargs
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer tok-secreto')
        self.assertIs(kwargs['allow_redirects'], False)  # não segue redirect com token


# ── Feature: sugestão de pagamento — flag de alteração na revisão ─────────────
from decimal import Decimal
from django.test import TestCase as DjTestCase
from contracts.models import Contract, ContractInstallment
from contracts.review import build_review_data


class PaymentPlanReviewFlagTest(DjTestCase):
    """A revisão sinaliza quando a sugestão de pagamento aplicada foi alterada."""
    def _contract(self):
        return Contract.objects.create(
            total_brl=Decimal('50000.00'), payment_type='parcelado',
            payment_plan_applied={'has_down_payment': True, 'down_payment_mode': 'percent',
                                  'down_payment_value': 20, 'installments_count': 10,
                                  'payment_method': 'Boleto'})

    def _flags(self, c):
        return {f['code']: f['level'] for f in build_review_data(c)['flags']}

    def test_unfavorable_changes_are_warnings(self):
        c = self._contract()
        # Sugerido: entrada 20% (=10.000) + 10x. Usuário baixou p/ 5.000 + 24x
        # (entrada MENOR e MAIS parcelas = desfavorável → alerta laranja).
        ContractInstallment.objects.create(contract=c, kind='entrada', value_brl=Decimal('5000'), order=0)
        for i in range(24):
            ContractInstallment.objects.create(contract=c, kind='parcela', installment_number=i + 1,
                                               value_brl=Decimal('1875'), order=i + 1)
        f = self._flags(c)
        self.assertEqual(f.get('payment_entrada_down'), 'warn')
        self.assertEqual(f.get('payment_installments_up'), 'warn')

    def test_favorable_changes_are_green(self):
        # Entrada MAIOR (15.000 vs 10.000) e MENOS parcelas (8 vs 10) → verde ('good').
        c = Contract.objects.create(
            total_brl=Decimal('50000.00'), payment_type='parcelado',
            payment_plan_applied={'has_down_payment': True, 'down_payment_mode': 'percent',
                                  'down_payment_value': 20, 'installments_count': 10})
        ContractInstallment.objects.create(contract=c, kind='entrada', value_brl=Decimal('15000'), order=0)
        for i in range(8):
            ContractInstallment.objects.create(contract=c, kind='parcela', installment_number=i + 1,
                                               value_brl=Decimal('4375'), order=i + 1)
        f = self._flags(c)
        self.assertEqual(f.get('payment_entrada_up'), 'good')
        self.assertEqual(f.get('payment_installments_down'), 'good')

    def test_no_flag_when_matches_suggestion(self):
        c = self._contract()
        # Entrada 20% (=10.000) + 10x de 4.000 = 50.000, forma Boleto: bate com a sugestão.
        ContractInstallment.objects.create(contract=c, kind='entrada', value_brl=Decimal('10000'),
                                           payment_method='Boleto', order=0)
        for i in range(10):
            ContractInstallment.objects.create(contract=c, kind='parcela', installment_number=i + 1,
                                               value_brl=Decimal('4000'), payment_method='Boleto', order=i + 1)
        codes = list(self._flags(c).keys())
        self.assertFalse(any(code.startswith('payment_entrada') or code.startswith('payment_installments')
                             for code in codes))

    def test_valor_entrada_mode_lower_is_warning(self):
        # Entrada como VALOR fixo (R$ 10.000). Usuário baixou p/ R$ 3.000 → alerta.
        c = Contract.objects.create(
            total_brl=Decimal('50000.00'), payment_type='parcelado',
            payment_plan_applied={'has_down_payment': True, 'down_payment_mode': 'valor',
                                  'down_payment_value': 10000, 'installments_count': 10})
        ContractInstallment.objects.create(contract=c, kind='entrada', value_brl=Decimal('3000'), order=0)
        for i in range(10):
            ContractInstallment.objects.create(contract=c, kind='parcela', installment_number=i + 1,
                                               value_brl=Decimal('4700'), order=i + 1)
        self.assertEqual(self._flags(c).get('payment_entrada_down'), 'warn')
