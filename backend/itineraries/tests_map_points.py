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
from itineraries.models import Itinerary, ItineraryImage, ItineraryMapPoint


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
        # Pegar imagem da galeria (adotar) tem permissão própria — a foto do ponto
        # usa o mesmo seletor das outras imagens, então segue a mesma regra.
        self.editor = make_user('map_editor', roteiros_edit=True, roteiros_images_from_gallery=True)
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

    # ── Trecho até o próximo ponto (a linha do percurso) ─────────────────────
    def test_leg_fields_are_stored(self):
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0)
        r = self.client.patch(self.url(f'{pt.id}/'), {
            'leg_style': 'solid', 'leg_color': '#16a34a',
            'leg_icon': 'Ship', 'leg_label': 'Deslocamento de barco',
        }, format='json')
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body['leg_style'], 'solid')
        self.assertEqual(body['leg_icon'], 'Ship')
        self.assertEqual(body['leg_label'], 'Deslocamento de barco')
        pt.refresh_from_db()
        self.assertEqual(pt.leg_color, '#16a34a')

    def test_leg_style_invalid_falls_back_to_default(self):
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0, leg_style='solid')
        r = self.client.patch(self.url(f'{pt.id}/'), {'leg_style': 'zigzag'}, format='json')
        self.assertEqual(r.status_code, 200)
        # Estilo desconhecido vira vazio = tracejada (padrão), nunca quebra o mapa.
        self.assertEqual(r.json()['leg_style'], '')

    def test_leg_sem_linha(self):
        # "Sem linha": o trecho existe (pode ter ícone), mas nada é desenhado.
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0)
        r = self.client.patch(self.url(f'{pt.id}/'), {'leg_style': 'none'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['leg_style'], 'none')

    def test_leg_can_be_cleared_to_line_only(self):
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0,
                                              leg_icon='Plane', leg_label='Voo')
        r = self.client.patch(self.url(f'{pt.id}/'), {'leg_icon': '', 'leg_label': ''}, format='json')
        self.assertEqual(r.json()['leg_icon'], '')
        self.assertEqual(r.json()['leg_label'], '')

    # ── Foto pelo fluxo PADRÃO de imagem (ItineraryImage ligada ao ponto) ────
    def test_photo_via_standard_image_upload(self):
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0)
        up = SimpleUploadedFile('lugar.png', PNG_1PX, content_type='image/png')
        r = self.client.post(f'/api/itineraries/{self.it.id}/images/',
                             {'image': up, 'map_point': pt.id}, format='multipart')
        self.assertEqual(r.status_code, 201)
        img_id = r.json()['id']
        self.assertEqual(pt.photos.count(), 1)

        # A foto do ponto NÃO aparece nas seções de imagem do roteiro…
        det = self.client.get(f'/api/itineraries/{self.it.id}/').json()
        self.assertNotIn(img_id, [im['id'] for im in det['images']])
        # …e vem no próprio ponto (com a imagem inteira em `photo`).
        ponto = det['map_points'][0]
        self.assertEqual(ponto['photo']['id'], img_id)
        self.assertTrue(ponto['image'])

    def test_second_photo_replaces_the_first(self):
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0)
        for _ in range(2):
            up = SimpleUploadedFile('lugar.png', PNG_1PX, content_type='image/png')
            r = self.client.post(f'/api/itineraries/{self.it.id}/images/',
                                 {'image': up, 'map_point': pt.id}, format='multipart')
            self.assertEqual(r.status_code, 201)
        self.assertEqual(pt.photos.count(), 1)   # uma foto por ponto

    def test_photo_adopted_from_gallery(self):
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0)
        # Imagem "do banco" (sem roteiro), como as da aba Galeria.
        up = SimpleUploadedFile('banco.png', PNG_1PX, content_type='image/png')
        src = ItineraryImage.objects.create(image=up, caption='Praia', subject_type='landscape')
        r = self.client.post(f'/api/itineraries/{self.it.id}/images/adopt/',
                             {'source_id': src.id, 'kind': 'map_point', 'map_point': pt.id}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(pt.photos.count(), 1)
        copia = pt.photos.first()
        self.assertEqual(copia.caption, 'Praia')          # metadados preservados
        self.assertNotEqual(copia.pk, src.pk)             # é uma CÓPIA (o original fica)
        self.assertTrue(ItineraryImage.objects.filter(pk=src.pk).exists())

    def test_adopt_rejects_point_of_other_itinerary(self):
        other = Itinerary.objects.create(name='Outro', base_currency='USD')
        pt = ItineraryMapPoint.objects.create(itinerary=other, latitude=0, longitude=0)
        up = SimpleUploadedFile('banco.png', PNG_1PX, content_type='image/png')
        src = ItineraryImage.objects.create(image=up)
        r = self.client.post(f'/api/itineraries/{self.it.id}/images/adopt/',
                             {'source_id': src.id, 'map_point': pt.id}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_deleting_point_removes_its_photo(self):
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0)
        up = SimpleUploadedFile('lugar.png', PNG_1PX, content_type='image/png')
        self.client.post(f'/api/itineraries/{self.it.id}/images/',
                         {'image': up, 'map_point': pt.id}, format='multipart')
        self.assertEqual(ItineraryImage.objects.filter(map_point=pt).count(), 1)
        r = self.client.delete(self.url(f'{pt.id}/'))
        self.assertEqual(r.status_code, 204)
        self.assertEqual(ItineraryImage.objects.filter(map_point_id=pt.id).count(), 0)

    # ── Foto automática (a regra de negócio da escolha) ──────────────────────
    def _img(self, **kw):
        up = SimpleUploadedFile('g.png', PNG_1PX, content_type='image/png')
        return ItineraryImage.objects.create(image=up, **kw)

    def _cidade(self, nome='Pequim', pais_nome='China'):
        from config_api.models import ConfigCity, ConfigState, ConfigCountry
        pais = ConfigCountry.objects.create(name=pais_nome, code='CN')
        estado = ConfigState.objects.create(country=pais, name='Hebei')
        return ConfigCity.objects.create(state=estado, name=nome), pais

    def test_auto_photo_escolhe_a_mais_usada_da_cidade(self):
        cidade, _ = self._cidade()
        pouco = self._img(city=cidade, caption='pouco usada')
        muito = self._img(city=cidade, caption='muito usada')
        # "usos" = cópias que vivem em roteiros.
        outro = Itinerary.objects.create(name='Outro', base_currency='USD')
        for _ in range(2):
            self._img(city=cidade, source=muito, itinerary=outro)

        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0, title='Pequim')
        r = self.client.post(self.url(f'{pt.id}/auto-photo/'), {'city': cidade.id}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(pt.photos.count(), 1)
        self.assertEqual(pt.photos.first().source_id, muito.id)
        self.assertNotEqual(pt.photos.first().source_id, pouco.id)

    def test_auto_photo_empate_fica_com_a_mais_recente(self):
        cidade, _ = self._cidade()
        antiga = self._img(city=cidade, caption='antiga')
        nova = self._img(city=cidade, caption='nova')     # criada depois
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0)
        r = self.client.post(self.url(f'{pt.id}/auto-photo/'), {'city': cidade.id}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(pt.photos.first().source_id, nova.id)
        self.assertNotEqual(pt.photos.first().source_id, antiga.id)

    def test_auto_photo_cai_para_foto_do_pais(self):
        cidade, pais = self._cidade()
        do_pais = self._img(country=pais, caption='paisagem do país')
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0)
        r = self.client.post(self.url(f'{pt.id}/auto-photo/'), {'city': cidade.id}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(pt.photos.first().source_id, do_pais.id)

    def test_auto_photo_sem_candidata_nao_faz_nada(self):
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0, title='Lugar Nenhum')
        r = self.client.post(self.url(f'{pt.id}/auto-photo/'), {}, format='json')
        self.assertEqual(r.status_code, 204)
        self.assertEqual(pt.photos.count(), 0)

    def test_auto_photo_nao_troca_foto_existente(self):
        cidade, _ = self._cidade()
        self._img(city=cidade)
        pt = ItineraryMapPoint.objects.create(itinerary=self.it, latitude=0, longitude=0)
        up = SimpleUploadedFile('minha.png', PNG_1PX, content_type='image/png')
        ItineraryImage.objects.create(image=up, itinerary=self.it, map_point=pt, caption='escolhida à mão')
        r = self.client.post(self.url(f'{pt.id}/auto-photo/'), {'city': cidade.id}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(pt.photos.count(), 1)
        self.assertEqual(pt.photos.first().caption, 'escolhida à mão')

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
