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
