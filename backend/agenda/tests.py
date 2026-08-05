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


class LaminaPromptPrefsTest(APITestCase):
    """Escolhas do pop-up "Prompt da lâmina com IA": ficam na conta do USUÁRIO
    (valem em qualquer roteiro), com lista fechada de chaves/valores."""
    URL = '/api/agenda/preferences/'

    def setUp(self):
        self.a = User.objects.create_user('lp-a', password='x')
        self.b = User.objects.create_user('lp-b', password='x')

    def test_default_is_empty(self):
        self.client.force_authenticate(self.a)
        self.assertEqual(self.client.get(self.URL).data['lamina_prompt'], {})

    def test_roundtrip(self):
        self.client.force_authenticate(self.a)
        cfg = {'formato': 'a4', 'direcao': 'colagem', 'composicao': 'mosaico',
               'densidade': 'detalhada', 'chamada': 'preco', 'paleta': 'personalizada',
               'cor1': '1a2d4f', 'cor2': '#2E6DB4', 'incModo': 'todas',
               'precoModo': 'brl', 'taxaTipo': 'parcelado',
               'conteudo': {'datas': False, 'saidas': True}}
        r = self.client.patch(self.URL, {'lamina_prompt': cfg}, format='json')
        self.assertEqual(r.status_code, 200)
        salvo = r.data['lamina_prompt']
        self.assertEqual(salvo['formato'], 'a4')
        self.assertEqual(salvo['direcao'], 'colagem')
        self.assertEqual(salvo['precoModo'], 'brl')
        self.assertEqual(salvo['cor1'], '#1A2D4F')      # normaliza o hex
        self.assertEqual(salvo['cor2'], '#2E6DB4')
        self.assertEqual(salvo['conteudo'], {'datas': False, 'saidas': True})
        # persistiu de verdade (novo GET)
        self.assertEqual(self.client.get(self.URL).data['lamina_prompt']['direcao'], 'colagem')

    def test_rejects_unknown_keys_and_values(self):
        self.client.force_authenticate(self.a)
        r = self.client.patch(self.URL, {'lamina_prompt': {
            'formato': 'poster-gigante',           # valor fora da lista
            'direcao': 'editorial',                # válido
            'hackzinho': {'x': 1},                 # chave desconhecida
            'cor1': 'não é hex',
            'conteudo': {'nome': True, 'custo_net': True},   # campo não publicável
        }}, format='json')
        salvo = r.data['lamina_prompt']
        self.assertNotIn('formato', salvo)
        self.assertNotIn('hackzinho', salvo)
        self.assertNotIn('cor1', salvo)
        self.assertEqual(salvo['direcao'], 'editorial')
        self.assertEqual(salvo['conteudo'], {'nome': True})

    def test_isolation_between_users(self):
        self.client.force_authenticate(self.a)
        self.client.patch(self.URL, {'lamina_prompt': {'formato': 'story'}}, format='json')
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.get(self.URL).data['lamina_prompt'], {})

    def test_custom_size_roundtrip(self):
        self.client.force_authenticate(self.a)
        r = self.client.patch(self.URL, {'lamina_prompt': {
            'formato': 'personalizado',
            'tamanho': {'unidade': 'cm', 'larg': 21, 'alt': 29.7, 'w': 2480, 'h': 3508, 'dpi': 300},
        }}, format='json')
        salvo = r.data['lamina_prompt']
        self.assertEqual(salvo['formato'], 'personalizado')
        self.assertEqual(salvo['tamanho'], {'unidade': 'cm', 'larg': 21.0, 'alt': 29.7,
                                            'w': 2480, 'h': 3508, 'dpi': 300})

    def test_custom_size_rejects_garbage(self):
        self.client.force_authenticate(self.a)
        for tam in ({'unidade': 'braça', 'larg': 10, 'alt': 10, 'w': 10, 'h': 10},   # unidade inexistente
                    {'unidade': 'cm', 'larg': 'dez', 'alt': 10, 'w': 10, 'h': 10},   # não numérico
                    {'unidade': 'px', 'larg': 0, 'alt': 0, 'w': 0, 'h': 0},          # sem medida
                    {'unidade': 'px', 'larg': 1, 'alt': 1, 'w': 999999, 'h': 10}):   # fora de faixa
            r = self.client.patch(self.URL, {'lamina_prompt': {'tamanho': tam}}, format='json')
            self.assertNotIn('tamanho', r.data['lamina_prompt'], tam)

    def test_new_instagram_format_accepted(self):
        self.client.force_authenticate(self.a)
        r = self.client.patch(self.URL, {'lamina_prompt': {'formato': 'feed34'}}, format='json')
        self.assertEqual(r.data['lamina_prompt']['formato'], 'feed34')
