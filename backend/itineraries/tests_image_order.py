"""Ordem das imagens do roteiro (capas, galeria, vídeos, lâminas).

A ordem é o que a tela mostra e o que o PDF/site publica — a primeira capa é a
capa, a primeira lâmina é a padrão. Ela vive num campo `order` com default 0,
e é justamente o default que morde: enquanto ninguém reordena, tudo é zero e
vale a ordem de criação; depois da primeira reordenação as posições viram
0,1,2… e uma imagem nova, ainda com zero, empata com a PRIMEIRA e aparece no
começo — não onde acabou de ser colocada.

Vale para os dois jeitos de entrar uma imagem: enviar do computador e pegar da
galeria (adotar).
"""
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from users_api.models import UserPermissions
from itineraries.models import Itinerary, ItineraryImage

# PNG 1x1 válido (o upload passa pelo pipeline de imagem de verdade).
PNG_1PX = (
    b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00'
    b'\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00'
    b'\x00\x00IEND\xaeB`\x82'
)


class ImageOrderTest(APITestCase):
    def setUp(self):
        u = User.objects.create_user(username='img_editor', email='img@x.com', password='pw12345678')
        p, _ = UserPermissions.objects.get_or_create(user=u)
        p.roteiros_edit = True
        p.roteiros_images_from_gallery = True
        p.save()
        self.client.force_authenticate(u)
        self.it = Itinerary.objects.create(name='Cancún', base_currency='USD')

    def enviar(self, kind='cover', nome='f.png'):
        r = self.client.post(
            f'/api/itineraries/{self.it.id}/images/',
            {'image': SimpleUploadedFile(nome, PNG_1PX, content_type='image/png'), 'kind': kind},
            format='multipart')
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def ordem(self, kind='cover'):
        return list(self.it.images.filter(kind=kind, day__isnull=True, map_point__isnull=True)
                    .values_list('id', flat=True))

    # ── Entrada de imagem ────────────────────────────────────────────────────
    def test_upload_entra_no_fim(self):
        ids = [self.enviar()['id'] for _ in range(3)]
        self.assertEqual([ItineraryImage.objects.get(pk=i).order for i in ids], [0, 1, 2])
        self.assertEqual(self.ordem(), ids)

    def test_upload_depois_de_reordenar_nao_pula_pro_comeco(self):
        """O caso que quebrava: reordenar e ENTÃO enviar uma imagem nova."""
        a, b, c = [self.enviar()['id'] for _ in range(3)]
        r = self.client.post(f'/api/itineraries/{self.it.id}/images/reorder/',
                             {'order': [c, a, b]}, format='json')
        self.assertEqual(r.status_code, 204)
        nova = self.enviar()['id']
        self.assertEqual(self.ordem(), [c, a, b, nova])

    def test_cada_secao_tem_a_propria_contagem(self):
        capa = self.enviar('cover')['id']
        gal1 = self.enviar('gallery')['id']
        gal2 = self.enviar('gallery')['id']
        self.assertEqual(ItineraryImage.objects.get(pk=capa).order, 0)
        self.assertEqual([ItineraryImage.objects.get(pk=i).order for i in (gal1, gal2)], [0, 1])

    def test_adotar_da_galeria_entra_no_fim(self):
        a, b = [self.enviar('gallery')['id'] for _ in range(2)]
        self.client.post(f'/api/itineraries/{self.it.id}/images/reorder/', {'order': [b, a]}, format='json')
        fonte = ItineraryImage.objects.create(image=SimpleUploadedFile('g.png', PNG_1PX, content_type='image/png'))
        r = self.client.post(f'/api/itineraries/{self.it.id}/images/adopt/',
                             {'source_id': fonte.id, 'kind': 'gallery'}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(self.ordem('gallery'), [b, a, r.json()['id']])

    # ── Reordenar ────────────────────────────────────────────────────────────
    def test_reorder_grava_a_sequencia_pedida(self):
        a, b, c = [self.enviar()['id'] for _ in range(3)]
        self.client.post(f'/api/itineraries/{self.it.id}/images/reorder/', {'order': [c, b, a]}, format='json')
        self.assertEqual(self.ordem(), [c, b, a])
        self.assertEqual([ItineraryImage.objects.get(pk=i).order for i in (c, b, a)], [0, 1, 2])

    def test_reorder_de_uma_secao_nao_mexe_na_outra(self):
        capas = [self.enviar('cover')['id'] for _ in range(2)]
        galeria = [self.enviar('gallery')['id'] for _ in range(2)]
        self.client.post(f'/api/itineraries/{self.it.id}/images/reorder/',
                         {'order': list(reversed(capas))}, format='json')
        self.assertEqual(self.ordem('cover'), list(reversed(capas)))
        self.assertEqual(self.ordem('gallery'), galeria)

    def test_reorder_ignora_id_de_fora_do_roteiro(self):
        a, b = [self.enviar()['id'] for _ in range(2)]
        outra = ItineraryImage.objects.create(image=SimpleUploadedFile('x.png', PNG_1PX, content_type='image/png'))
        r = self.client.post(f'/api/itineraries/{self.it.id}/images/reorder/',
                             {'order': [outra.id, b, a]}, format='json')
        self.assertEqual(r.status_code, 204)
        outra.refresh_from_db()
        self.assertEqual(outra.order, 0)         # intocada
        self.assertEqual(self.ordem(), [b, a])   # e a ordem pedida valeu para as de casa
