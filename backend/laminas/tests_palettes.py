"""Testes das paletas de cores pessoais (aba Lâminas).

Foco: isolamento por usuário (não ver/editar/excluir paleta de outro), validação
(nome, cores, limites) e as ações duplicate/favorite.
"""
from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from users_api.models import UserPermissions
from .models import UserColorPalette


def _grant_laminas(user):
    # Dá a permissão de lâminas ao usuário (o gate reusa laminas_view/laminas_agency).
    perms, _ = UserPermissions.objects.get_or_create(user=user)
    perms.laminas_view = True
    perms.save()


class ColorPaletteTest(APITestCase):
    def setUp(self):
        self.a = User.objects.create_user('alice', password='x')
        self.b = User.objects.create_user('bob', password='x')
        _grant_laminas(self.a)
        _grant_laminas(self.b)

    def test_create_and_list_own(self):
        self.client.force_authenticate(self.a)
        r = self.client.post('/api/laminas/color-palettes/',
                             {'name': 'México 2026', 'colors': ['#c94b32', '#E9A23B', '#146b5a']}, format='json')
        self.assertEqual(r.status_code, 201)
        # normaliza para #RRGGBB maiúsculo
        self.assertEqual(r.data['colors'], ['#C94B32', '#E9A23B', '#146B5A'])
        lst = self.client.get('/api/laminas/color-palettes/')
        self.assertEqual(len(lst.data['results'] if isinstance(lst.data, dict) else lst.data), 1)

    def test_isolation_between_users(self):
        self.client.force_authenticate(self.a)
        pid = self.client.post('/api/laminas/color-palettes/',
                               {'name': 'A', 'colors': ['#111111']}, format='json').data['id']
        # Bob não vê a paleta da Alice
        self.client.force_authenticate(self.b)
        self.assertEqual(len(self.client.get('/api/laminas/color-palettes/').data['results']
                             if isinstance(self.client.get('/api/laminas/color-palettes/').data, dict)
                             else self.client.get('/api/laminas/color-palettes/').data), 0)
        # Bob não consegue GET/PATCH/DELETE a paleta da Alice → 404 (fora do queryset)
        self.assertEqual(self.client.get(f'/api/laminas/color-palettes/{pid}/').status_code, 404)
        self.assertEqual(self.client.patch(f'/api/laminas/color-palettes/{pid}/',
                                           {'name': 'hack'}, format='json').status_code, 404)
        self.assertEqual(self.client.delete(f'/api/laminas/color-palettes/{pid}/').status_code, 404)
        # A paleta continua da Alice, intacta
        self.assertTrue(UserColorPalette.objects.filter(id=pid, user=self.a, name='A').exists())

    def test_owner_from_request_not_payload(self):
        # Enviar 'user' no corpo não muda o dono.
        self.client.force_authenticate(self.a)
        r = self.client.post('/api/laminas/color-palettes/',
                             {'name': 'X', 'colors': ['#222222'], 'user': self.b.id}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(UserColorPalette.objects.get(id=r.data['id']).user, self.a)

    def test_validation_name_and_colors(self):
        self.client.force_authenticate(self.a)
        self.assertEqual(self.client.post('/api/laminas/color-palettes/',
                         {'name': '', 'colors': ['#123456']}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/laminas/color-palettes/',
                         {'name': 'Sem cor', 'colors': []}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/laminas/color-palettes/',
                         {'name': 'Inválida', 'colors': ['nope']}, format='json').status_code, 400)
        # mais de 20 cores
        many = [f'#{i:02x}00ff' for i in range(25)]
        self.assertEqual(self.client.post('/api/laminas/color-palettes/',
                         {'name': 'Muitas', 'colors': many}, format='json').status_code, 400)

    def test_dedup_colors(self):
        self.client.force_authenticate(self.a)
        r = self.client.post('/api/laminas/color-palettes/',
                             {'name': 'Dup', 'colors': ['#abcabc', '#ABCABC', '#000000']}, format='json')
        self.assertEqual(r.data['colors'], ['#ABCABC', '#000000'])

    def test_max_palettes_per_user(self):
        for i in range(UserColorPalette.MAX_PER_USER):
            UserColorPalette.objects.create(user=self.a, name=f'p{i}', colors=['#000000'])
        self.client.force_authenticate(self.a)
        r = self.client.post('/api/laminas/color-palettes/',
                             {'name': 'over', 'colors': ['#111111']}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_duplicate_and_favorite_actions(self):
        self.client.force_authenticate(self.a)
        pid = self.client.post('/api/laminas/color-palettes/',
                               {'name': 'Base', 'colors': ['#010101', '#020202']}, format='json').data['id']
        dup = self.client.post(f'/api/laminas/color-palettes/{pid}/duplicate/')
        self.assertEqual(dup.status_code, 201)
        self.assertEqual(dup.data['name'], 'Base (cópia)')
        self.assertEqual(dup.data['colors'], ['#010101', '#020202'])
        fav = self.client.post(f'/api/laminas/color-palettes/{pid}/favorite/')
        self.assertEqual(fav.status_code, 200)
        self.assertTrue(fav.data['is_favorite'])

    def test_requires_auth(self):
        self.assertEqual(self.client.get('/api/laminas/color-palettes/').status_code, 403)
