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


from django.contrib.auth.models import User


class LaminaFavoritePrefsTest(APITestCase):
    """Favoritos/recentes das lâminas nas preferências: por usuário, validados,
    com semântica de 'nunca inicializado' (null) vs escolha do usuário (lista)."""
    URL = '/api/agenda/preferences/'

    def setUp(self):
        self.a = User.objects.create_user('u-a', password='x')
        self.b = User.objects.create_user('u-b', password='x')

    def test_defaults_null_until_set(self):
        self.client.force_authenticate(self.a)
        r = self.client.get(self.URL)
        # nunca inicializado → null (o front semeia os padrões)
        self.assertIsNone(r.data['lamina_favorite_patterns'])
        self.assertIsNone(r.data['lamina_favorite_recommended'])
        self.assertEqual(r.data['lamina_recent_patterns'], [])

    def test_roundtrip_and_dedup(self):
        self.client.force_authenticate(self.a)
        r = self.client.patch(self.URL, {'lamina_favorite_patterns': ['none', 'dots', 'dots', 'planes']}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['lamina_favorite_patterns'], ['none', 'dots', 'planes'])  # sem duplicatas

    def test_recent_patterns_capped(self):
        self.client.force_authenticate(self.a)
        many = [f'p{i}' for i in range(30)]
        r = self.client.patch(self.URL, {'lamina_recent_patterns': many}, format='json')
        self.assertEqual(len(r.data['lamina_recent_patterns']), 16)

    def test_isolation_between_users(self):
        self.client.force_authenticate(self.a)
        self.client.patch(self.URL, {'lamina_favorite_patterns': ['dots']}, format='json')
        # b não enxerga os favoritos de a
        self.client.force_authenticate(self.b)
        self.assertIsNone(self.client.get(self.URL).data['lamina_favorite_patterns'])
