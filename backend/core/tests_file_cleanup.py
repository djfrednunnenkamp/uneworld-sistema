"""Limpeza dos arquivos físicos (core/file_cleanup.py).

Apagar o registro tem de apagar o arquivo — senão o disco vira depósito de
órfãos. Mas há uma exceção que não perdoa: se OUTRO registro ainda aponta para
o mesmo caminho, apagar o arquivo cega os dois. Órfão a gente varre depois;
arquivo perdido não volta.
"""
import os

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from itineraries.models import Itinerary, ItineraryImage

PNG_1PX = (
    b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00'
    b'\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00'
    b'\x00\x00IEND\xaeB`\x82'
)


class FileCleanupTest(TestCase):
    def setUp(self):
        self.it = Itinerary.objects.create(name='Cancún', base_currency='USD')

    def nova(self, nome='a.png'):
        return ItineraryImage.objects.create(
            itinerary=self.it, kind='gallery',
            image=SimpleUploadedFile(nome, PNG_1PX, content_type='image/png'))

    def test_apagar_registro_apaga_o_arquivo(self):
        im = self.nova()
        caminho = im.image.path
        self.assertTrue(os.path.exists(caminho))
        im.delete()
        self.assertFalse(os.path.exists(caminho))

    def test_arquivo_compartilhado_sobrevive_a_exclusao_do_irmao(self):
        """O caso que faz estrago: dois registros, um arquivo só."""
        original = self.nova()
        caminho = original.image.path
        gemea = ItineraryImage.objects.create(itinerary=self.it, kind='cover',
                                              image=original.image.name)
        gemea.delete()
        self.assertTrue(os.path.exists(caminho), 'o arquivo do registro que ficou foi apagado junto')
        original.refresh_from_db()
        self.assertTrue(original.image.storage.exists(original.image.name))
        # E quando o último sai, aí sim o arquivo vai embora.
        original.delete()
        self.assertFalse(os.path.exists(caminho))

    def test_trocar_o_arquivo_apaga_o_antigo(self):
        im = self.nova('velha.png')
        antigo = im.image.path
        im.image = SimpleUploadedFile('nova.png', PNG_1PX, content_type='image/png')
        im.save()
        self.assertFalse(os.path.exists(antigo))
        self.assertTrue(os.path.exists(im.image.path))

    def test_trocar_o_arquivo_nao_apaga_o_que_outro_registro_usa(self):
        im = self.nova('compartilhada.png')
        antigo_nome, antigo_caminho = im.image.name, im.image.path
        ItineraryImage.objects.create(itinerary=self.it, kind='cover', image=antigo_nome)
        im.image = SimpleUploadedFile('outra.png', PNG_1PX, content_type='image/png')
        im.save()
        self.assertTrue(os.path.exists(antigo_caminho))

    def tearDown(self):
        for im in ItineraryImage.objects.all():
            try:
                if im.image and os.path.exists(im.image.path):
                    os.remove(im.image.path)
            except Exception:
                pass
