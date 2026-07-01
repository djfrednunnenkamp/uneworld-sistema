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
