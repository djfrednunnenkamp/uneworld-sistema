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

    # ── user_update (takeover por troca de e-mail — A-02) ────────────────────
    def test_non_superuser_cannot_change_superuser_email(self):
        """Um não-superusuário com users_edit NÃO pode trocar o e-mail de um
        superusuário (senão dispararia forgot-password no e-mail novo e assumiria
        a conta). Espera 403 e e-mail inalterado."""
        original = self.target_su.email
        self.client.force_authenticate(self.actor)
        r = self.client.patch(f'/api/users/{self.target_su.id}/',
                              {'email': 'atacante@evil.com'}, format='json')
        self.assertEqual(r.status_code, 403)
        self.target_su.refresh_from_db()
        self.assertEqual(self.target_su.email, original)
        self.assertNotEqual(self.target_su.email, 'atacante@evil.com')

    def test_superuser_can_change_superuser_email(self):
        """Superusuário continua podendo editar o e-mail de outra conta
        superusuária (comportamento esperado do sistema)."""
        self.client.force_authenticate(self.super_root)
        r = self.client.patch(f'/api/users/{self.target_su.id}/',
                              {'email': 'novo_admin@x.com'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.target_su.refresh_from_db()
        self.assertEqual(self.target_su.email, 'novo_admin@x.com')
        # username fica sincronizado com o e-mail (usado no login).
        self.assertEqual(self.target_su.username, 'novo_admin@x.com')

    def test_non_superuser_can_still_edit_regular_user_email(self):
        """Regressão: a nova checagem NÃO pode quebrar a edição legítima de uma
        conta comum por quem tem users_edit."""
        self.client.force_authenticate(self.actor)
        r = self.client.patch(f'/api/users/{self.target_reg.id}/',
                              {'email': 'regular_novo@x.com'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.target_reg.refresh_from_db()
        self.assertEqual(self.target_reg.email, 'regular_novo@x.com')

    # ── outros caminhos da mesma classe (endereçados na mesma auditoria) ─────
    def test_non_superuser_cannot_delete_superuser(self):
        """Não-superusuário com users_delete não pode desativar (soft-delete) um
        superusuário."""
        deleter = make_user('deleter', password=ADMIN_PW, users_delete=True)
        self.client.force_authenticate(deleter)
        r = self.client.delete(f'/api/users/{self.target_su.id}/delete/')
        self.assertEqual(r.status_code, 403)
        self.target_su.refresh_from_db()
        self.assertTrue(self.target_su.is_active)

    def test_non_superuser_cannot_invite_superuser(self):
        """Não-superusuário com users_edit não pode disparar convite de ativação
        para uma conta superusuária."""
        self.client.force_authenticate(self.actor)
        r = self.client.post(f'/api/users/{self.target_su.id}/invite/', {}, format='json')
        self.assertEqual(r.status_code, 403)


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


@override_settings(CACHES=LOCMEM_CACHE)
class ProfileLiveLinkTest(APITestCase):
    """Link VIVO entre Perfil de Permissão e usuário: editar o perfil nas
    Configurações re-aplica as permissões a todos os usuários vinculados."""
    def setUp(self):
        cache.clear()
        from config_api.models import PermissionProfile
        self.root = make_user('root', superuser=True, password=ADMIN_PW)
        self.prof = PermissionProfile.objects.create(
            name='Agência', is_agency_default=True,
            permissions={'passengers_view_basic': True, 'contracts_view': False},
        )

    def test_agency_user_created_is_linked_and_follows_profile(self):
        from config_api.models import PermissionProfile
        self.client.force_authenticate(self.root)
        # Cria usuário de agência → vincula ao perfil padrão e copia as permissões.
        r = self.client.post('/api/users/create/',
                             {'email': 'ag@x.com', 'first_name': 'Ag', 'agency_user': True}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        uid = r.data['id']
        self.assertEqual(r.data['profile_id'], self.prof.id)
        perms = UserPermissions.objects.get(user_id=uid)
        self.assertTrue(perms.passengers_view_basic)
        self.assertFalse(perms.contracts_view)

        # Edita o perfil → deve propagar para o usuário vinculado (link vivo).
        self.client.patch(f'/api/config/permission-profiles/{self.prof.id}/',
                          {'permissions': {'passengers_view_basic': True, 'contracts_view': True}}, format='json')
        perms.refresh_from_db()
        self.assertTrue(perms.contracts_view)

    def test_manual_permission_edit_unlinks(self):
        self.client.force_authenticate(self.root)
        r = self.client.post('/api/users/create/',
                             {'email': 'ag2@x.com', 'first_name': 'Ag2', 'agency_user': True}, format='json')
        uid = r.data['id']
        # Ajuste manual (profile_id=null) desvincula: perfil não sobrescreve mais.
        self.client.patch(f'/api/users/{uid}/',
                          {'permissions': {'passengers_view_basic': False}, 'profile_id': None}, format='json')
        perms = UserPermissions.objects.get(user_id=uid)
        self.assertIsNone(perms.profile_id)
        # Editar o perfil agora NÃO deve tocar o usuário desvinculado.
        self.client.patch(f'/api/config/permission-profiles/{self.prof.id}/',
                          {'permissions': {'passengers_view_basic': True}}, format='json')
        perms.refresh_from_db()
        self.assertFalse(perms.passengers_view_basic)


@override_settings(CACHES=LOCMEM_CACHE)
class AgencyAdminManagementTest(APITestCase):
    """Admin de agência (AgencyMember.role='admin') gerencia SÓ os usuários da
    agência dele: criar, listar, permissões (limitadas às dele), senha e excluir.
    Nunca toca contas internas nem usuários de outra agência."""
    def setUp(self):
        cache.clear()
        from agencies.models import Agency, AgencyMember
        from config_api.models import PermissionProfile
        self.agA = Agency.objects.create(name='A', person_type='juridica')
        self.agB = Agency.objects.create(name='B', person_type='juridica')
        # lists_view no baseline é uma permissão que o admin NÃO tem — serve para
        # testar que o baseline dela é preservado (o admin não pode mexer nela).
        PermissionProfile.objects.create(name='Agência', is_agency_default=True,
                                         permissions={'passengers_view_basic': True, 'contracts_view': True, 'lists_view': True})
        # admin da agência A: tem passengers_view_basic/contracts_view, mas NÃO lists_view nem contracts_edit
        self.admin = make_user('admin_ag', passengers_view_basic=True, contracts_view=True)
        AgencyMember.objects.create(agency=self.agA, user=self.admin, role='admin')
        # membro comum da agência A
        self.memberA = make_user('memberA', passengers_view_basic=True)
        AgencyMember.objects.create(agency=self.agA, user=self.memberA, role='operator')
        # usuário da agência B (fora do alcance do admin de A)
        self.memberB = make_user('memberB')
        AgencyMember.objects.create(agency=self.agB, user=self.memberB, role='operator')
        # conta interna (nunca gerenciável por admin de agência)
        self.staff = make_user('staff', password=ADMIN_PW, manage_users=True)

    def test_list_only_own_agency_users(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get('/api/users/')
        ids = [u['id'] for u in r.data]
        self.assertIn(self.memberA.id, ids)
        self.assertIn(self.admin.id, ids)
        self.assertNotIn(self.memberB.id, ids)
        self.assertNotIn(self.staff.id, ids)

    def test_create_user_links_to_agency_and_applies_default_profile(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post('/api/users/create/', {'email': 'novo@x.com', 'first_name': 'Novo'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        from django.contrib.auth.models import User
        from agencies.models import AgencyMember
        u = User.objects.get(email='novo@x.com')
        self.assertTrue(AgencyMember.objects.filter(agency=self.agA, user=u).exists())
        self.assertTrue(u.permissions.passengers_view_basic)   # veio do perfil padrão
        self.assertTrue(u.permissions.lists_view)              # baseline (admin não tem essa) preservado

    def test_create_with_custom_permissions_at_creation(self):
        """Admin pode ajustar permissões JÁ na criação: revoga o que ele tem,
        não concede o que não tem, e o baseline das que ele não tem é preservado."""
        self.client.force_authenticate(self.admin)
        r = self.client.post('/api/users/create/', {
            'email': 'custom@x.com', 'first_name': 'Custom',
            # tira passengers_view_basic (o admin tem → pode revogar); tenta tirar
            # lists_view (o admin NÃO tem → ignorado, baseline fica True)
            'permissions': {'passengers_view_basic': False, 'contracts_view': True, 'lists_view': False},
        }, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        from django.contrib.auth.models import User
        u = User.objects.get(email='custom@x.com')
        self.assertFalse(u.permissions.passengers_view_basic)  # revogado na criação
        self.assertTrue(u.permissions.contracts_view)          # mantido
        self.assertTrue(u.permissions.lists_view)              # admin não pode mexer → baseline preservado
        self.assertIsNone(u.permissions.profile_id)            # customizou → desvinculado

    def test_edit_permission_bounded_to_admin_own(self):
        self.client.force_authenticate(self.admin)
        # admin NÃO tem contracts_edit → não consegue conceder (fica False)
        r = self.client.patch(f'/api/users/{self.memberA.id}/',
                              {'permissions': {'contracts_edit': True, 'passengers_view_basic': False},
                               'profile_id': None}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.memberA.refresh_from_db()
        p = self.memberA.permissions
        self.assertFalse(p.contracts_edit)         # não pôde conceder o que não tem
        self.assertFalse(p.passengers_view_basic)  # pôde REVOGAR o que ele tem

    def test_cannot_touch_other_agency_user(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.patch(f'/api/users/{self.memberB.id}/', {'first_name': 'X'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/users/{self.memberB.id}/delete/').status_code, 403)

    def test_cannot_touch_internal_account(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.patch(f'/api/users/{self.staff.id}/', {'first_name': 'X'}, format='json').status_code, 403)

    def test_can_reset_password_of_own_user(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(f'/api/users/{self.memberA.id}/set-password/',
                             {'admin_password': 'pw12345678', 'password': 'NovaSenha#42'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.memberA.refresh_from_db()
        self.assertTrue(self.memberA.check_password('NovaSenha#42'))

    def test_can_delete_own_user(self):
        self.client.force_authenticate(self.admin)
        r = self.client.delete(f'/api/users/{self.memberA.id}/delete/')
        self.assertEqual(r.status_code, 204)
        self.memberA.refresh_from_db()
        self.assertTrue(self.memberA.permissions.is_deleted)

    def test_non_admin_member_cannot_manage(self):
        self.client.force_authenticate(self.memberA)   # operador comum, não admin
        self.assertEqual(self.client.get('/api/users/').status_code, 403)
        self.assertEqual(self.client.post('/api/users/create/', {'email': 'z@x.com'}, format='json').status_code, 403)


@override_settings(CACHES=LOCMEM_CACHE)
class ApplyProfileFullReplaceTest(APITestCase):
    """apply_profile define o conjunto COMPLETO: permissões antigas que NÃO estão
    no perfil são zeradas (senão um superadmin rebaixado seguia como staff)."""
    def test_old_perms_cleared_and_staff_recalculated(self):
        from config_api.models import PermissionProfile
        from users_api.permissions import apply_profile
        u = make_user('leftover', manage_users=True, settings_professions=True, passengers_view_basic=False)
        u.is_staff = True; u.save()
        prof = PermissionProfile.objects.create(name='Ag', is_agency_default=True,
                                                permissions={'passengers_view_basic': True})  # sem chaves de staff
        apply_profile(u, prof)
        u.refresh_from_db(); u.permissions.refresh_from_db()
        self.assertFalse(u.permissions.manage_users)        # perm antiga zerada
        self.assertFalse(u.permissions.settings_professions)
        self.assertTrue(u.permissions.passengers_view_basic)  # veio do perfil
        self.assertFalse(u.is_staff)                         # sync recalculou → não é mais staff


@override_settings(CACHES=LOCMEM_CACHE)
class InternalDropsAgencyMembershipTest(APITestCase):
    """Ao virar conta interna (superusuário/staff), o usuário perde os vínculos de
    agência (não aparece mais como membro)."""
    def setUp(self):
        from agencies.models import Agency, AgencyMember
        self.root = make_user('root_x', superuser=True, password=ADMIN_PW)
        self.ag = Agency.objects.create(name='A', person_type='juridica')
        self.u = make_user('aguser_x', passengers_view_basic=True)
        AgencyMember.objects.create(agency=self.ag, user=self.u, role='operator')

    def test_promote_to_superuser_removes_membership(self):
        from agencies.models import AgencyMember
        self.assertTrue(AgencyMember.objects.filter(user=self.u).exists())
        self.client.force_authenticate(self.root)
        r = self.client.patch(f'/api/users/{self.u.id}/', {'is_superuser': True}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertFalse(AgencyMember.objects.filter(user=self.u).exists())  # vínculo removido


class JobRoleAssignmentTest(APITestCase):
    """Cargo (ConfigJobRole) escolhido no perfil do usuário: persiste em
    UserPermissions.job_role e volta serializado; id inválido vira None."""
    def setUp(self):
        from config_api.models import ConfigJobRole
        self.admin = make_user('roleadmin', superuser=True)
        self.target = make_user('roletarget')
        self.ceo = ConfigJobRole.objects.create(name='CEO')
        self.client.force_authenticate(self.admin)

    def test_set_and_clear_job_role(self):
        r = self.client.patch(f'/api/users/{self.target.id}/', {'job_role': self.ceo.id}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['job_role'], self.ceo.id)
        self.assertEqual(r.json()['job_role_name'], 'CEO')
        # limpar
        r = self.client.patch(f'/api/users/{self.target.id}/', {'job_role': None}, format='json')
        self.assertIsNone(r.json()['job_role'])

    def test_invalid_job_role_becomes_none(self):
        r = self.client.patch(f'/api/users/{self.target.id}/', {'job_role': 999999}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.json()['job_role'])


class ShowOnSiteFlagTest(APITestCase):
    """Flag 'Mostrar no site' persiste em UserPermissions.show_on_site."""
    def setUp(self):
        self.admin = make_user('siteadmin', superuser=True)
        self.target = make_user('sitetarget')
        self.client.force_authenticate(self.admin)

    def test_toggle_show_on_site(self):
        r = self.client.patch(f'/api/users/{self.target.id}/', {'show_on_site': True}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['show_on_site'])
        r = self.client.patch(f'/api/users/{self.target.id}/', {'show_on_site': False}, format='json')
        self.assertFalse(r.json()['show_on_site'])
