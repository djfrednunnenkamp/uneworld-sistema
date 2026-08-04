"""Mapa NATIVO do roteiro (ItineraryMapPoint) — o que substituiu o embed do
Google My Maps. Os pontos são geridos por ações imediatas (criar/editar/excluir/
reordenar/foto), como as imagens, então cada uma precisa: exigir `roteiros_edit`,
validar as coordenadas, marcar o roteiro como "pendente" (publicado × trabalho) e
devolver o ponto serializado pro front atualizar a lista na hora.
"""
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from users_api.models import UserPermissions
from itineraries.models import Itinerary, ItineraryMapPoint


def make_user(username, **perms):
    u = User.objects.create_user(username=username, email=f'{username}@x.com', password='pw12345678')
    p, _ = UserPermissions.objects.get_or_create(user=u)
    for k, v in perms.items():
        setattr(p, k, v)
    p.save()
    return u


# PNG 1x1 válido (o upload passa pelo validate_document_file).
PNG_1PX = (
    b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00'
    b'\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00'
    b'\x00\x00IEND\xaeB`\x82'
)


class MapPointsTest(APITestCase):
    def setUp(self):
        self.editor = make_user('map_editor', roteiros_edit=True)
        self.client.force_authenticate(self.editor)
        self.it = Itinerary.objects.create(name='Cancún', base_currency='USD', is_published=True)

    def url(self, suffix=''):
        return f'/api/itineraries/{self.it.id}/map-points/{suffix}'

    # ── Criar ────────────────────────────────────────────────────────────────
    def test_creates_point_and_marks_pending(self):
        r = self.client.post(self.url(), {'latitude': 21.1619, 'longitude': -86.8515,
                                          'title': 'Cancún', 'description': 'Chegada'}, format='json')
        self.assertEqual(r.status_code, 201)
        body = r.json()
        self.assertEqual(body['title'], 'Cancún')
        self.assertAlmostEqual(body['latitude'], 21.1619)
        self.assertIn('id', body)
        self.it.refresh_from_db()
        self.assertTrue(self.it.has_unpublished_changes)

    def test_rejects_invalid_coordinates(self):
        for payload in ({'latitude': 200, 'longitude': 0}, {'latitude': 'abc', 'longitude': 0}, {}):
            r = self.client.post(self.url(), payload, format='json')
            self.assertEqual(r.status_code, 400, payload)
        self.assertEqual(ItineraryMapPoint.objects.count(), 0)

    def test_order_increments(self):
        for i in range(3):
            self.client.post(self.url(), {'latitude': i, 'longitude': i}, format='json')
        orders = list(self.it.map_points.values_list('order', flat=True))
        self.assertEqual(orders, sorted(orders))
        self.assertEqual(len(orders), 3)

    # ── Editar / excluir ─────────────────────────────────────────────────────
    def test_updates_fields(self):
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0)
        r = self.client.patch(self.url(f'{pt.id}/'),
                              {'title': 'Tulum', 'description': 'Ruínas', 'color': '#16a34a',
                               'latitude': 20.2, 'longitude': -87.4}, format='json')
        self.assertEqual(r.status_code, 200)
        pt.refresh_from_db()
        self.assertEqual(pt.title, 'Tulum')
        self.assertEqual(pt.color, '#16a34a')
        self.assertAlmostEqual(pt.latitude, 20.2)

    def test_icon_is_stored_and_returned(self):
        # O pino mostra o NÚMERO da ordem por padrão; com `icon`, mostra o ícone
        # escolhido (chave do catálogo de ícones do front).
        r = self.client.post(self.url(), {'latitude': 1, 'longitude': 1, 'icon': 'anchor'}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()['icon'], 'anchor')
        pt_id = r.json()['id']

        r = self.client.patch(self.url(f'{pt_id}/'), {'icon': 'plane'}, format='json')
        self.assertEqual(r.json()['icon'], 'plane')

        # Voltar pro número = ícone vazio.
        r = self.client.patch(self.url(f'{pt_id}/'), {'icon': ''}, format='json')
        self.assertEqual(r.json()['icon'], '')

    def test_update_rejects_invalid_coordinates(self):
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0)
        r = self.client.patch(self.url(f'{pt.id}/'), {'latitude': 999, 'longitude': 0}, format='json')
        self.assertEqual(r.status_code, 400)
        pt.refresh_from_db()
        self.assertEqual(pt.latitude, 0)

    def test_deletes_point(self):
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0, title='X')
        r = self.client.delete(self.url(f'{pt.id}/'))
        self.assertEqual(r.status_code, 204)
        self.assertFalse(ItineraryMapPoint.objects.filter(pk=pt.id).exists())

    def test_point_of_other_itinerary_is_404(self):
        other = Itinerary.objects.create(name='Outro', base_currency='USD')
        pt = ItineraryMapPoint.objects.create(itinerary=other, latitude=0, longitude=0)
        r = self.client.patch(self.url(f'{pt.id}/'), {'title': 'invadido'}, format='json')
        self.assertEqual(r.status_code, 404)

    # ── Ordem ────────────────────────────────────────────────────────────────
    def test_reorder(self):
        a = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=1, longitude=1, order=0)
        b = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=2, longitude=2, order=1)
        r = self.client.post(self.url('reorder/'), {'order': [b.id, a.id]}, format='json')
        self.assertEqual(r.status_code, 204)
        self.assertEqual(list(self.it.map_points.values_list('id', flat=True)), [b.id, a.id])

    # ── Foto ─────────────────────────────────────────────────────────────────
    def test_uploads_and_removes_photo(self):
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0)
        up = SimpleUploadedFile('lugar.png', PNG_1PX, content_type='image/png')
        r = self.client.post(self.url(f'{pt.id}/image/'), {'image': up}, format='multipart')
        self.assertEqual(r.status_code, 201)
        self.assertTrue(r.json()['image'])
        pt.refresh_from_db()
        self.assertTrue(pt.image)

        r = self.client.delete(self.url(f'{pt.id}/image/'))
        self.assertEqual(r.status_code, 200)
        pt.refresh_from_db()
        self.assertFalse(pt.image)

    def test_photo_requires_file(self):
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0)
        r = self.client.post(self.url(f'{pt.id}/image/'), {}, format='multipart')
        self.assertEqual(r.status_code, 400)

    # ── Leitura / permissão ──────────────────────────────────────────────────
    def test_points_come_nested_in_the_itinerary(self):
        ItineraryMapPoint.objects.create(itinerary=self.it, latitude=1, longitude=2, title='Isla Mujeres')
        r = self.client.get(f'/api/itineraries/{self.it.id}/')
        self.assertEqual(r.status_code, 200)
        pts = r.json()['map_points']
        self.assertEqual(len(pts), 1)
        self.assertEqual(pts[0]['title'], 'Isla Mujeres')

    def test_requires_edit_permission(self):
        viewer = make_user('map_viewer', roteiros_view=True)
        self.client.force_authenticate(viewer)
        r = self.client.post(self.url(), {'latitude': 1, 'longitude': 1}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(ItineraryMapPoint.objects.count(), 0)
