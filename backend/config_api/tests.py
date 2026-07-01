"""Testes de restrição de execução de scripts de câmbio (auditoria IDS — A-03).

Script customizado = execução de código no servidor. Escrever já era exclusivo de
superusuário; agora DISPARAR manualmente (run_now/update_one) um câmbio com script
também é. O sandbox roda `result = <número>` sem rede, então dá pra testar offline."""
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from users_api.models import UserPermissions
from .models import ConfigExchangeRate


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
