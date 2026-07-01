"""Testes do webhook da Resend (auditoria IDS — A-07).

Fail-closed em produção: sem RESEND_WEBHOOK_SECRET configurado a assinatura não
pode ser verificada, então em DEBUG=False a requisição é rejeitada (401). Em dev
(DEBUG=True) é aceita para facilitar o desenvolvimento local."""
from django.test import override_settings
from rest_framework.test import APITestCase

LOCMEM_CACHE = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
URL = '/api/agenda/resend-webhook/'
PAYLOAD = {'type': 'email.delivered', 'data': {}}


@override_settings(CACHES=LOCMEM_CACHE, RESEND_WEBHOOK_SECRET='', DEBUG=False)
class ResendWebhookNoSecretProdTest(APITestCase):
    def test_no_secret_in_production_is_rejected(self):
        r = self.client.post(URL, PAYLOAD, format='json')
        self.assertEqual(r.status_code, 401)


@override_settings(CACHES=LOCMEM_CACHE, RESEND_WEBHOOK_SECRET='', DEBUG=True)
class ResendWebhookNoSecretDevTest(APITestCase):
    def test_no_secret_in_dev_is_allowed(self):
        r = self.client.post(URL, PAYLOAD, format='json')
        self.assertEqual(r.status_code, 200)
