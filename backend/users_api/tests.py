"""Testes de fronteira de privilégio no reset de senha (auditoria IDS — A-02).

Um não-superusuário com users_set_password/manage_users não pode redefinir a
senha (nem enviar reset) de uma conta superusuário — senão bastaria essa flag
para assumir uma conta admin (escalada de privilégio)."""
import json
import os
import subprocess
import sys

from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase

from .models import UserPermissions

ADMIN_PW = 'actorpw12345'

# Cache local isolado para os testes de rate limit (independe de Redis/.env).
LOCMEM_CACHE = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}


def make_user(username, superuser=False, password='pw12345678', **perms):
    u = User.objects.create_user(username=username, email=f'{username}@x.com', password=password)
    if superuser:
        u.is_superuser = True
        u.is_staff = True
        u.save()
    p, _ = UserPermissions.objects.get_or_create(user=u)
    for k, v in perms.items():
        setattr(p, k, v)
    p.save()
    return u


class PasswordResetBoundaryTest(APITestCase):
    def setUp(self):
        # Ator não-superusuário com a permissão sensível
        self.actor      = make_user('actor', password=ADMIN_PW, users_set_password=True, users_edit=True)
        self.super_root = make_user('root', superuser=True, password=ADMIN_PW)
        self.target_su  = make_user('target_su', superuser=True)
        self.target_reg = make_user('target_reg')

    # ── admin_set_password ───────────────────────────────────────────────────
    def test_non_superuser_cannot_set_superuser_password(self):
        self.client.force_authenticate(self.actor)
        r = self.client.post(f'/api/users/{self.target_su.id}/set-password/',
                             {'admin_password': ADMIN_PW, 'password': 'novaSenha123'}, format='json')
        self.assertEqual(r.status_code, 403)
        self.target_su.refresh_from_db()
        self.assertFalse(self.target_su.check_password('novaSenha123'))

    def test_non_superuser_can_set_regular_user_password(self):
        self.client.force_authenticate(self.actor)
        r = self.client.post(f'/api/users/{self.target_reg.id}/set-password/',
                             {'admin_password': ADMIN_PW, 'password': 'novaSenha123'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.target_reg.refresh_from_db()
        self.assertTrue(self.target_reg.check_password('novaSenha123'))

    def test_superuser_can_set_superuser_password(self):
        self.client.force_authenticate(self.super_root)
        r = self.client.post(f'/api/users/{self.target_su.id}/set-password/',
                             {'admin_password': ADMIN_PW, 'password': 'novaSenha123'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.target_su.refresh_from_db()
        self.assertTrue(self.target_su.check_password('novaSenha123'))

    # ── admin_send_reset ─────────────────────────────────────────────────────
    def test_non_superuser_cannot_send_reset_to_superuser(self):
        self.client.force_authenticate(self.actor)
        r = self.client.post(f'/api/users/{self.target_su.id}/send-reset/', {}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_superuser_can_send_reset_to_superuser(self):
        self.client.force_authenticate(self.super_root)
        r = self.client.post(f'/api/users/{self.target_su.id}/send-reset/', {}, format='json')
        self.assertEqual(r.status_code, 200)


@override_settings(CACHES=LOCMEM_CACHE)
class RateLimitTest(APITestCase):
    """Rate limiting dos endpoints públicos sensíveis (A-04)."""
    def setUp(self):
        cache.clear()  # zera o histórico de throttle entre os testes

    def test_login_throttled_after_5_per_minute(self):
        # login: 5/min → a 6ª tentativa (mesmo IP) deve ser 429.
        codes = []
        for _ in range(6):
            r = self.client.post('/api/users/login/',
                                 {'email': 'x@x.com', 'password': 'errada'}, format='json')
            codes.append(r.status_code)
        self.assertNotIn(429, codes[:5], f'primeiras 5 não deviam ser bloqueadas: {codes}')
        self.assertEqual(codes[5], 429, f'a 6ª deveria ser 429: {codes}')

    def test_password_reset_throttled_after_5_per_hour(self):
        # forgot-password: 5/hour → 6ª → 429.
        codes = []
        for _ in range(6):
            r = self.client.post('/api/users/forgot-password/',
                                 {'email': 'ninguem@x.com'}, format='json')
            codes.append(r.status_code)
        self.assertNotIn(429, codes[:5], f'primeiras 5 não deviam ser bloqueadas: {codes}')
        self.assertEqual(codes[5], 429, f'a 6ª deveria ser 429: {codes}')


class SecurityHardeningTest(APITestCase):
    """Hardening HTTP (A-06)."""
    def test_always_on_flags(self):
        # Valem em qualquer ambiente (não dependem de HTTPS).
        self.assertIs(settings.SECURE_CONTENT_TYPE_NOSNIFF, True)
        self.assertIs(settings.SESSION_COOKIE_HTTPONLY, True)
        self.assertEqual(settings.SESSION_COOKIE_SAMESITE, 'Lax')
        self.assertEqual(settings.CSRF_COOKIE_SAMESITE, 'Lax')
        # Proxy SSL header preservado para Cloudflare/nginx.
        self.assertEqual(settings.SECURE_PROXY_SSL_HEADER, ('HTTP_X_FORWARDED_PROTO', 'https'))
        # Não adicionar SECURE_BROWSER_XSS_FILTER (pedido explícito da auditoria).
        self.assertFalse(getattr(settings, 'SECURE_BROWSER_XSS_FILTER', False))

    def test_prod_flags_active_when_debug_false(self):
        """Reimporta as settings com DEBUG=False (subprocesso) e confirma HSTS +
        SSL redirect. Feito fora do processo porque a suíte roda com DEBUG=True."""
        code = (
            "import django; django.setup();"
            "from django.conf import settings as s; import json;"
            "print('RESULT:' + json.dumps({"
            "'ssl': s.SECURE_SSL_REDIRECT,"
            "'hsts': s.SECURE_HSTS_SECONDS,"
            "'subs': s.SECURE_HSTS_INCLUDE_SUBDOMAINS,"
            "'preload': s.SECURE_HSTS_PRELOAD}))"
        )
        env = {**os.environ, 'DEBUG': 'False', 'DJANGO_SETTINGS_MODULE': 'core.settings'}
        out = subprocess.check_output(
            [sys.executable, '-c', code], env=env, cwd=str(settings.BASE_DIR), text=True)
        data = json.loads([l for l in out.splitlines() if l.startswith('RESULT:')][0][7:])
        self.assertIs(data['ssl'], True)
        self.assertEqual(data['hsts'], 31536000)
        self.assertIs(data['subs'], True)
        self.assertIs(data['preload'], True)


@override_settings(CACHES=LOCMEM_CACHE)
class PasswordPolicyTest(APITestCase):
    """F-03 — validate_password oficial em todos os fluxos de definição de senha."""
    def setUp(self):
        cache.clear()
        self.user = make_user('joao', password='Forte#Senha42')

    def test_change_password_rejects_numeric_common(self):
        self.client.force_authenticate(self.user)
        r = self.client.post('/api/users/me/change-password/',
                             {'current_password': 'Forte#Senha42', 'new_password': '12345678'},
                             format='json')
        self.assertEqual(r.status_code, 400)
        self.user.refresh_from_db()
        self.assertFalse(self.user.check_password('12345678'))

    def test_change_password_rejects_common_word(self):
        self.client.force_authenticate(self.user)
        r = self.client.post('/api/users/me/change-password/',
                             {'current_password': 'Forte#Senha42', 'new_password': 'password'},
                             format='json')
        self.assertEqual(r.status_code, 400)

    def test_change_password_accepts_strong(self):
        self.client.force_authenticate(self.user)
        r = self.client.post('/api/users/me/change-password/',
                             {'current_password': 'Forte#Senha42', 'new_password': 'Zx9!kLmn42Q'},
                             format='json')
        self.assertEqual(r.status_code, 200)

    def test_reset_password_rejects_weak(self):
        from .models import PasswordResetToken
        tok = PasswordResetToken.objects.create(user=self.user)
        r = self.client.post('/api/users/reset-password/',
                             {'token': str(tok.token), 'password': '12345678'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_admin_set_password_rejects_weak(self):
        from .models import PasswordResetToken  # noqa: F401
        root = make_user('root', superuser=True, password='Forte#Senha42')
        self.client.force_authenticate(root)
        r = self.client.post(f'/api/users/{self.user.id}/set-password/',
                             {'admin_password': 'Forte#Senha42', 'password': '12345678'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_accept_invite_rejects_weak(self):
        from .models import InviteToken
        inv = InviteToken.objects.create(email='novo@x.com', first_name='Novo')
        r = self.client.post('/api/users/invite/accept/',
                             {'token': str(inv.token), 'password': '12345678'}, format='json')
        self.assertEqual(r.status_code, 400)


@override_settings(CACHES=LOCMEM_CACHE)
class ValidateTokenEndpointsTest(APITestCase):
    """F-01 (invite via POST) e F-07 (validar reset token no load)."""
    def setUp(self):
        cache.clear()
        self.user = make_user('maria', password='Forte#Senha42')

    def test_validate_invite_accepts_post_body(self):
        from .models import InviteToken
        inv = InviteToken.objects.create(email='m@x.com', first_name='M')
        r = self.client.post('/api/users/invite/validate/', {'token': str(inv.token)}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['email'], 'm@x.com')

    def test_validate_reset_token_valid(self):
        from .models import PasswordResetToken
        tok = PasswordResetToken.objects.create(user=self.user)
        r = self.client.post('/api/users/reset-password/validate/', {'token': str(tok.token)}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['valid'])

    def test_validate_reset_token_invalid(self):
        r = self.client.post('/api/users/reset-password/validate/',
                             {'token': '00000000-0000-0000-0000-000000000000'}, format='json')
        self.assertEqual(r.status_code, 400)
