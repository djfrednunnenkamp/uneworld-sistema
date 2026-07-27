"""Testes de restrição de execução de scripts de câmbio (auditoria IDS — A-03).

Script customizado = execução de código no servidor. Escrever já era exclusivo de
superusuário; agora DISPARAR manualmente (run_now/update_one) um câmbio com script
também é. O sandbox roda `result = <número>` sem rede, então dá pra testar offline."""
from decimal import Decimal
from unittest import mock

from django.contrib.auth.models import User
from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from users_api.models import UserPermissions
from .models import ConfigExchangeRate
from . import exchange_runner
from .exchange_runner import safe_get
from .exchange_service import fetch_from_url


def make_user(username, superuser=False, **perms):
    u = User.objects.create_user(username=username, email=f'{username}@x.com', password='pw12345678')
    if superuser:
        u.is_superuser = True
        u.is_staff = True
        u.save()
    p, _ = UserPermissions.objects.get_or_create(user=u)
    for k, v in perms.items():
        setattr(p, k, v)
    p.save()
    return u


class ExchangeScriptExecutionTest(APITestCase):
    def setUp(self):
        # Não-superusuário COM a permissão de "atualizar agora" (o ponto: mesmo
        # com ela, não pode disparar scripts).
        self.op    = make_user('op', settings_exchange_rates_update_now=True,
                               settings_exchange_rates_advanced=True)
        self.super = make_user('root', superuser=True)
        # Moeda com script (auto_update ligado) — única due, sem link/API → offline.
        self.scripted = ConfigExchangeRate.objects.create(
            from_currency='USD', to_currency='BRL', base_rate=Decimal('1.0000'),
            rate=Decimal('1.0000'), auto_update=True, script='result = 5.55',
        )

    # ── update_one (por moeda) ───────────────────────────────────────────────
    def test_non_superuser_cannot_update_scripted_currency(self):
        self.client.force_authenticate(self.op)
        r = self.client.post(f'/api/config/exchange-rates/{self.scripted.id}/update-now/', {}, format='json')
        self.assertEqual(r.status_code, 403)
        self.scripted.refresh_from_db()
        self.assertEqual(self.scripted.base_rate, Decimal('1.0000'))  # script não rodou

    def test_superuser_can_update_scripted_currency(self):
        self.client.force_authenticate(self.super)
        r = self.client.post(f'/api/config/exchange-rates/{self.scripted.id}/update-now/', {}, format='json')
        self.assertEqual(r.status_code, 200)
        self.scripted.refresh_from_db()
        self.assertEqual(self.scripted.base_rate, Decimal('5.5500'))  # script executou

    # ── run_now (todas) ──────────────────────────────────────────────────────
    def test_non_superuser_run_now_skips_scripts(self):
        self.client.force_authenticate(self.op)
        r = self.client.post('/api/config/exchange-rates/run-now/', {}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['updated'], 0)          # a única moeda tinha script → pulada
        self.scripted.refresh_from_db()
        self.assertEqual(self.scripted.base_rate, Decimal('1.0000'))

    def test_superuser_run_now_executes_scripts(self):
        self.client.force_authenticate(self.super)
        r = self.client.post('/api/config/exchange-rates/run-now/', {}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['updated'], 1)
        self.scripted.refresh_from_db()
        self.assertEqual(self.scripted.base_rate, Decimal('5.5500'))

    # ── test_script continua exclusivo de superusuário ───────────────────────
    def test_test_script_superuser_only(self):
        self.client.force_authenticate(self.op)
        r = self.client.post('/api/config/exchange-rates/test-script/',
                             {'script': 'result = 5.55'}, format='json')
        self.assertEqual(r.status_code, 403)


class ExchangeSSRFTest(SimpleTestCase):
    """A-05 — a fonte de câmbio (link próprio + scripts) passa por safe_get, que
    bloqueia destinos internos e não segue redirects."""

    def test_blocks_loopback(self):
        with self.assertRaises(ValueError):
            safe_get('http://127.0.0.1/x')
        with self.assertRaises(ValueError):
            safe_get('http://localhost/x')

    def test_blocks_cloud_metadata(self):
        # 169.254.169.254 (metadata AWS/GCP) é link-local → bloqueado.
        with self.assertRaises(ValueError):
            safe_get('http://169.254.169.254/latest/meta-data/')

    def test_blocks_non_http_scheme(self):
        with self.assertRaises(ValueError):
            safe_get('file:///etc/passwd')

    def test_fetch_from_url_also_guarded(self):
        # fetch_from_url (link próprio da moeda) usa a mesma proteção.
        with self.assertRaises(ValueError):
            fetch_from_url('http://127.0.0.1:8000/rate.json')

    def test_redirects_are_disabled(self):
        # Para um host público (passa no _check_url), o GET NÃO segue redirects.
        with mock.patch.object(exchange_runner.requests, 'get') as m, \
                mock.patch.object(exchange_runner, '_check_url', return_value=None):
            safe_get('http://example.com/rate.json')
            self.assertEqual(m.call_args.kwargs.get('allow_redirects'), False)


class HtmlSanitizeTest(SimpleTestCase):
    """A-12 — sanitize_html remove script/handlers/iframe/javascript: e mantém
    formatação básica."""
    def test_strips_script_and_event_handlers(self):
        from core.sanitize import sanitize_html
        clean = sanitize_html('<p onclick="x()">oi<script>alert(1)</script>'
                              '<img src=x onerror=alert(2)></p>')
        self.assertNotIn('<script', clean.lower())
        self.assertNotIn('onerror', clean.lower())
        self.assertNotIn('onclick', clean.lower())
        self.assertIn('oi', clean)

    def test_blocks_javascript_url(self):
        from core.sanitize import sanitize_html
        self.assertNotIn('javascript:', sanitize_html('<a href="javascript:alert(1)">x</a>').lower())

    def test_blocks_iframe_object_embed(self):
        from core.sanitize import sanitize_html
        clean = sanitize_html('<iframe src="//evil"></iframe><object></object><embed>hi')
        self.assertNotIn('<iframe', clean.lower())
        self.assertNotIn('<object', clean.lower())
        self.assertNotIn('<embed', clean.lower())
        self.assertIn('hi', clean)

    def test_keeps_basic_formatting(self):
        from core.sanitize import sanitize_html
        clean = sanitize_html('<p><strong>Bold</strong></p><ul><li>a</li></ul>')
        self.assertIn('<strong>', clean)
        self.assertIn('<li>', clean)


class ContractClauseSanitizeApiTest(APITestCase):
    """A-12 — o HTML malicioso é sanitizado ao SALVAR pela API (não só na leitura)."""
    def test_malicious_clause_content_is_sanitized_on_save(self):
        self.client.force_authenticate(make_user('adm', superuser=True))
        r = self.client.post('/api/config/contract-clauses/',
                             {'name': 'C1', 'content': '<p>ok</p><script>alert(1)</script>'},
                             format='json')
        self.assertEqual(r.status_code, 201, r.data)
        from config_api.models import ContractClause
        saved = ContractClause.objects.get(id=r.data['id'])
        self.assertNotIn('<script', saved.content.lower())
        self.assertIn('ok', saved.content)


class OperatingCompanyContractAccessTest(APITestCase):
    """Quem cria contrato (mas não tem acesso a Configurações) precisa LER a
    operadora para montar o contrato — sem ver os campos sensíveis do CEO."""
    def test_contract_user_reads_without_ceo_fields(self):
        self.client.force_authenticate(make_user('vend', contracts_edit=True))
        r = self.client.get('/api/config/operating-company/')
        self.assertEqual(r.status_code, 200)
        self.assertNotIn('ceo_autentique_token', r.data)
        self.assertIn('default_signature_type', r.data)
        self.assertIn('pix_key', r.data)

    def test_settings_user_sees_ceo_fields(self):
        self.client.force_authenticate(make_user('cfg', settings_operating_company_view=True))
        r = self.client.get('/api/config/operating-company/')
        self.assertEqual(r.status_code, 200)
        self.assertIn('ceo_autentique_token', r.data)

    def test_user_without_any_access_gets_403(self):
        self.client.force_authenticate(make_user('nobody'))
        r = self.client.get('/api/config/operating-company/')
        self.assertEqual(r.status_code, 403)


class DocModelConfigTest(APITestCase):
    """Central 'Modelos de documentos': rascunho não afeta produção; publicar sobe
    versão + histórico; validação whitelist; permissões separadas (editar × publicar)."""
    def setUp(self):
        from .models import DocumentTemplateConfig
        self.M = DocumentTemplateConfig
        self.editor = make_user('editor', settings_doc_models_view=True, settings_doc_models_edit=True)
        self.publisher = make_user('pub', settings_doc_models_view=True, settings_doc_models_edit=True, settings_doc_models_publish=True)
        self.viewer = make_user('viewer', settings_doc_models_view=True)
        self.nobody = make_user('nobody')
        self.code = 'pimaco-a4356'

    def _draft(self, user, body):
        self.client.force_authenticate(user)
        return self.client.patch(f'/api/config/doc-models/{self.code}/draft/', body, format='json')

    def test_save_draft_validates_whitelist_and_range(self):
        r = self._draft(self.editor, {'horizontalGapMm': 1.0})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.M.objects.get(model_code=self.code).draft_json, {'horizontalGapMm': 1.0})
        # chave desconhecida → 400
        self.assertEqual(self._draft(self.editor, {'evil': 1}).status_code, 400)
        # fora do limite → 400
        self.assertEqual(self._draft(self.editor, {'horizontalGapMm': 999}).status_code, 400)
        # não numérico → 400
        self.assertEqual(self._draft(self.editor, {'marginLeftMm': 'x'}).status_code, 400)

    def test_draft_does_not_affect_published(self):
        self._draft(self.editor, {'horizontalGapMm': 2.5})
        # published (o que o gerador lê) continua vazio
        self.client.force_authenticate(self.viewer)
        r = self.client.get('/api/config/doc-models/published/')
        self.assertNotIn(self.code, r.json())

    def test_publish_requires_permission(self):
        self._draft(self.editor, {'horizontalGapMm': 1.0})
        self.client.force_authenticate(self.editor)   # tem edit, não tem publish
        self.assertEqual(self.client.post(f'/api/config/doc-models/{self.code}/publish/').status_code, 403)

    def test_publish_bumps_version_and_feeds_generator(self):
        self._draft(self.publisher, {'horizontalGapMm': 1.5})
        self.client.force_authenticate(self.publisher)
        r = self.client.post(f'/api/config/doc-models/{self.code}/publish/')
        self.assertEqual(r.status_code, 200)
        row = self.M.objects.get(model_code=self.code)
        self.assertEqual(row.version, 1)
        self.assertEqual(row.published_json, {'horizontalGapMm': 1.5})
        # agora o endpoint do gerador entrega a calibração publicada
        pub = self.client.get('/api/config/doc-models/published/').json()
        self.assertEqual(pub[self.code], {'horizontalGapMm': 1.5})

    def test_publish_history_and_rollback(self):
        self.client.force_authenticate(self.publisher)
        self._draft(self.publisher, {'horizontalGapMm': 1.0}); self.client.post(f'/api/config/doc-models/{self.code}/publish/')
        self._draft(self.publisher, {'horizontalGapMm': 2.0}); self.client.post(f'/api/config/doc-models/{self.code}/publish/')
        row = self.M.objects.get(model_code=self.code)
        self.assertEqual(row.version, 2)
        self.assertEqual(len(row.history), 1)                 # v1 guardada
        self.assertEqual(row.history[0]['config'], {'horizontalGapMm': 1.0})
        # rollback para v1 cria NOVA versão (não apaga histórico)
        r = self.client.post(f'/api/config/doc-models/{self.code}/rollback/', {'version': 1}, format='json')
        self.assertEqual(r.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.published_json, {'horizontalGapMm': 1.0})
        self.assertEqual(row.version, 3)
        self.assertGreaterEqual(len(row.history), 2)

    def test_restore_default_clears_published(self):
        self.client.force_authenticate(self.publisher)
        self._draft(self.publisher, {'horizontalGapMm': 3.0}); self.client.post(f'/api/config/doc-models/{self.code}/publish/')
        self.client.post(f'/api/config/doc-models/{self.code}/restore/')
        self.assertEqual(self.M.objects.get(model_code=self.code).published_json, {})

    def test_no_permission_cannot_read_admin_list(self):
        self.client.force_authenticate(self.nobody)
        self.assertEqual(self.client.get('/api/config/doc-models/').status_code, 403)
