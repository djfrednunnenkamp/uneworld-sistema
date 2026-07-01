"""Testes de fronteira de privilégio no reset de senha (auditoria IDS — A-02).

Um não-superusuário com users_set_password/manage_users não pode redefinir a
senha (nem enviar reset) de uma conta superusuário — senão bastaria essa flag
para assumir uma conta admin (escalada de privilégio)."""
from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from .models import UserPermissions

ADMIN_PW = 'actorpw12345'


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
