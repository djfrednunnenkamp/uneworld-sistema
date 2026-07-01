"""Testes de RBAC dos ViewSets do app trips (auditoria IDS — A-01).

Antes da correção esses ViewSets caíam no default global IsAuthenticated, então
QUALQUER usuário logado podia criar/editar/excluir catálogos e viagens. Aqui
garantimos que sem a permissão certa a ação é bloqueada (403) e que com a
permissão certa ela é liberada."""
from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from users_api.models import UserPermissions
from .models import Supplier, CrewRole


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


class TripsRBACTest(APITestCase):
    def setUp(self):
        self.nobody   = make_user('nobody')                                  # logado, sem permissão
        self.viewer   = make_user('viewer',  lists_view=True)
        self.editor   = make_user('editor',  lists_edit=True, lists_view=True)
        self.crewadm  = make_user('crewadm', settings_crew_roles_edit=True,
                                  settings_crew_roles_delete=True, settings_crew_roles_view=True)
        self.super    = make_user('root', superuser=True)

    # ── Escrita bloqueada sem permissão ──────────────────────────────────────
    def test_authenticated_without_permission_cannot_create(self):
        self.client.force_authenticate(self.nobody)
        for url in ('/api/trips/suppliers/', '/api/trips/crew-roles/',
                    '/api/trips/roteiros/', '/api/trips/list-additionals/'):
            r = self.client.post(url, {'name': 'X'}, format='json')
            self.assertEqual(r.status_code, 403, f'POST {url} deveria ser 403, foi {r.status_code}')

    def test_authenticated_without_permission_cannot_delete(self):
        s = Supplier.objects.create(name='Fornecedor')
        c = CrewRole.objects.create(name='Guia')
        self.client.force_authenticate(self.nobody)
        self.assertEqual(self.client.delete(f'/api/trips/suppliers/{s.id}/').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/trips/crew-roles/{c.id}/').status_code, 403)

    def test_authenticated_without_permission_cannot_list(self):
        self.client.force_authenticate(self.nobody)
        self.assertEqual(self.client.get('/api/trips/suppliers/').status_code, 403)
        self.assertEqual(self.client.get('/api/trips/crew-roles/').status_code, 403)

    # ── Escrita liberada com a permissão certa ───────────────────────────────
    def test_list_editor_can_manage_list_catalogs(self):
        """O popup de edição de lista cria fornecedores/roteiros — quem tem
        lists_edit precisa conseguir (fluxo do ListModal)."""
        self.client.force_authenticate(self.editor)
        self.assertEqual(self.client.post('/api/trips/suppliers/', {'name': 'Forn'}, format='json').status_code, 201)
        self.assertEqual(self.client.post('/api/trips/roteiros/', {'name': 'Rot'}, format='json').status_code, 201)

    def test_settings_perm_can_crud_crew_role(self):
        self.client.force_authenticate(self.crewadm)
        r = self.client.post('/api/trips/crew-roles/', {'name': 'Coordenador'}, format='json')
        self.assertEqual(r.status_code, 201)
        cid = r.data['id']
        self.assertEqual(self.client.delete(f'/api/trips/crew-roles/{cid}/').status_code, 204)

    def test_viewer_can_list_but_not_write(self):
        Supplier.objects.create(name='Forn')
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.client.get('/api/trips/suppliers/').status_code, 200)
        self.assertEqual(self.client.post('/api/trips/suppliers/', {'name': 'Y'}, format='json').status_code, 403)

    def test_superuser_can_do_everything(self):
        self.client.force_authenticate(self.super)
        r = self.client.post('/api/trips/list-additionals/', {'name': 'Extra'}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.client.delete(f'/api/trips/list-additionals/{r.data["id"]}/').status_code, 204)
