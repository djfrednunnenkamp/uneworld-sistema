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
