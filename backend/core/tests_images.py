"""Testes do pipeline CENTRAL de imagem (core/images.py).

Cobrem as três promessas do serviço:
  1. entra JPEG/PNG/WebP/AVIF/HEIC/GIF → sai WebP que abre de verdade;
  2. lixo disfarçado de imagem é rejeitado (extensão falsa, MIME falso,
     corrompido, vazio, não-imagem, bomba de descompressão);
  3. nada do arquivo original sobrevive (EXIF, GPS, orientação já aplicada).

Também exercitam a integração: substituição de imagem, ordem segura de
exclusão e falha do storage no meio do caminho.
"""
import io
import os
import struct
from unittest import mock

from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from PIL import Image

from core import images as imgsvc


# ── Helpers ──────────────────────────────────────────────────────────────────

def _img(size=(80, 60), mode='RGB', color=(20, 130, 210)):
    if mode == 'RGBA':
        color = (*color[:3], 128)
    return Image.new(mode, size, color)


def _bytes(fmt, size=(80, 60), mode='RGB', **kw):
    buf = io.BytesIO()
    _img(size, mode).save(buf, format=fmt, **kw)
    return buf.getvalue()


def _upload(name, data, content_type='application/octet-stream'):
    return SimpleUploadedFile(name, data, content_type=content_type)


def _reabre(processed):
    """Abre a saída do pipeline — se não abrir, a conversão não serviu de nada."""
    data = processed.content.read()
    processed.content.seek(0)
    return Image.open(io.BytesIO(data)), data


# ── 1. Formatos de entrada → WebP ────────────────────────────────────────────

class ConversaoParaWebPTests(SimpleTestCase):
    """Todo formato aceito precisa sair WebP, abrindo e com o tipo certo."""

    def _checa(self, nome, fmt, mode='RGB', **kw):
        p = imgsvc.process_image(_upload(nome, _bytes(fmt, mode=mode, **kw)))
        out, data = _reabre(p)
        self.assertEqual(out.format, 'WEBP', f'{nome} não virou WebP')
        self.assertEqual(p.content_type, 'image/webp')
        self.assertEqual(p.size, len(data))
        self.assertEqual((p.width, p.height), out.size)
        self.assertTrue(p.name.endswith('.webp'))
        return p, out

    def test_jpeg_valido(self):
        _, out = self._checa('foto.jpg', 'JPEG')
        self.assertEqual(out.size, (80, 60))

    def test_png_valido(self):
        self._checa('imagem.png', 'PNG')

    def test_png_com_transparencia_preserva_alfa(self):
        _, out = self._checa('logo.png', 'PNG', mode='RGBA')
        self.assertIn(out.mode, ('RGBA', 'LA'), 'a transparência se perdeu')

    def test_webp_valido_e_reprocessado(self):
        """WebP também passa pelo pipeline (não é aceito 'como veio')."""
        original = _bytes('WEBP')
        p = imgsvc.process_image(_upload('ja.webp', original))
        _, saida = _reabre(p)
        self.assertNotEqual(saida, original, 'o WebP foi devolvido sem reprocessar')

    def test_avif_valido(self):
        if not imgsvc.AVIF_SUPPORTED:
            self.skipTest('Pillow sem suporte a AVIF neste ambiente')
        self._checa('foto.avif', 'AVIF')

    def test_heic_heif_valido(self):
        if not imgsvc.HEIF_SUPPORTED:
            self.skipTest('pillow-heif ausente neste ambiente')
        self._checa('IMG_0042.HEIC', 'HEIF')

    def test_gif_valido(self):
        self._checa('anim.gif', 'GIF')

    def test_gif_animado_usa_o_primeiro_quadro(self):
        buf = io.BytesIO()
        q1, q2 = _img(color=(255, 0, 0)), _img(color=(0, 0, 255))
        q1.save(buf, format='GIF', save_all=True, append_images=[q2], duration=100, loop=0)
        p = imgsvc.process_image(_upload('anim.gif', buf.getvalue()))
        out, _ = _reabre(p)
        self.assertEqual(out.format, 'WEBP')
        self.assertEqual(getattr(out, 'n_frames', 1), 1, 'a saída deveria ser estática')

    def test_saida_e_sempre_diferente_dos_bytes_enviados(self):
        """Nunca devolvemos ao navegador os bytes que o usuário mandou."""
        entrada = _bytes('JPEG')
        p = imgsvc.process_image(_upload('x.jpg', entrada))
        _, saida = _reabre(p)
        self.assertNotEqual(saida, entrada)


# ── 2. Segurança ─────────────────────────────────────────────────────────────

class SegurancaTests(SimpleTestCase):

    def test_extensao_falsa_e_rejeitada(self):
        """Script renomeado para foto.jpg — o caso clássico."""
        with self.assertRaises(ValidationError) as ctx:
            imgsvc.process_image(_upload('foto.jpg', b'#!/bin/sh\nrm -rf /\n'))
        self.assertIn('não é uma imagem', ctx.exception.messages[0])

    def test_mime_falso_e_rejeitado(self):
        """Content-Type mentindo não abre porta nenhuma."""
        with self.assertRaises(ValidationError):
            imgsvc.process_image(_upload('x.png', b'<svg onload=alert(1)></svg>',
                                         content_type='image/png'))

    def test_html_disfarcado_de_imagem(self):
        with self.assertRaises(ValidationError):
            imgsvc.process_image(_upload('a.png', b'<html><script>alert(1)</script></html>',
                                         content_type='image/png'))

    def test_svg_nao_entra_no_pipeline_raster(self):
        svg = b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'
        with self.assertRaises(ValidationError):
            imgsvc.process_image(_upload('logo.svg', svg, content_type='image/svg+xml'))

    def test_arquivo_vazio(self):
        with self.assertRaises(ValidationError) as ctx:
            imgsvc.process_image(_upload('vazio.png', b''))
        self.assertIn('vazio', ctx.exception.messages[0].lower())

    def test_arquivo_corrompido_ou_truncado(self):
        """Cabeçalho JPEG legítimo + corpo cortado: só estoura ao decodificar."""
        completo = _bytes('JPEG', size=(400, 300))
        with self.assertRaises(ValidationError) as ctx:
            imgsvc.process_image(_upload('meia.jpg', completo[: len(completo) // 3]))
        self.assertIn('corrompida', ctx.exception.messages[0])

    def test_nao_imagem_com_extensao_de_imagem(self):
        pdf = b'%PDF-1.7\n% fake\n'
        with self.assertRaises(ValidationError):
            imgsvc.process_image(_upload('doc.png', pdf))

    @override_settings(IMAGE_UPLOAD_MAX_BYTES=1024)
    def test_limite_de_tamanho_do_upload(self):
        with self.assertRaises(ValidationError) as ctx:
            imgsvc.process_image(_upload('g.png', _bytes('PNG', size=(600, 600))),
                                 max_bytes=1024)
        self.assertIn('muito grande', ctx.exception.messages[0])

    def test_limite_de_lado_e_de_megapixels(self):
        """Cabeçalho PNG anunciando dimensões absurdas — sem alocar nada."""
        largura = altura = 60_000
        ihdr = struct.pack('>II', largura, altura) + b'\x08\x02\x00\x00\x00'
        png = (b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR' + ihdr
               + struct.pack('>I', 0) + b'\x00' * 4)
        with self.assertRaises(ValidationError):
            imgsvc.process_image(_upload('bomba.png', png))

    def test_decompression_bomb(self):
        """PNG minúsculo que se expande em uma imagem enorme."""
        buf = io.BytesIO()
        Image.new('L', (12_000, 12_000), 0).save(buf, format='PNG', optimize=True)
        dados = buf.getvalue()
        with override_settings(IMAGE_MAX_PIXELS=1_000_000):
            with mock.patch.object(imgsvc, 'MAX_PIXELS', 1_000_000):
                with self.assertRaises(ValidationError) as ctx:
                    imgsvc.process_image(_upload('bomba.png', dados))
        self.assertIn('bomb', ctx.exception.messages[0].lower())

    def test_nome_do_arquivo_e_saneado(self):
        """Nada de path traversal a partir do nome enviado."""
        p = imgsvc.process_image(_upload('../../../etc/passwd.png', _bytes('PNG')))
        self.assertNotIn('/', p.name)
        self.assertNotIn('..', p.name)
        self.assertTrue(p.name.endswith('.webp'))

    def test_sniff_reconhece_os_formatos_e_recusa_o_resto(self):
        self.assertEqual(imgsvc.sniff_image_kind(_bytes('JPEG')[:32]), 'jpeg')
        self.assertEqual(imgsvc.sniff_image_kind(_bytes('PNG')[:32]), 'png')
        self.assertEqual(imgsvc.sniff_image_kind(_bytes('GIF')[:32]), 'gif')
        self.assertEqual(imgsvc.sniff_image_kind(_bytes('WEBP')[:32]), 'webp')
        self.assertIsNone(imgsvc.sniff_image_kind(b'%PDF-1.7' + b'\x00' * 24))
        self.assertIsNone(imgsvc.sniff_image_kind(b'MZ' + b'\x00' * 30))
        self.assertIsNone(imgsvc.sniff_image_kind(b'curto'))


# ── 3. Metadados e orientação ────────────────────────────────────────────────

class MetadadosTests(SimpleTestCase):

    def _com_exif(self, orientacao=6, gps=True):
        """JPEG com EXIF de orientação (6 = girado 90°) e coordenada de GPS."""
        img = Image.new('RGB', (100, 50), (200, 30, 30))
        exif = Image.Exif()
        exif[0x0112] = orientacao                     # Orientation
        exif[0x010E] = 'comentario secreto'           # ImageDescription
        if gps:
            ifd = exif.get_ifd(0x8825)                # GPSInfo
            ifd[1] = 'S'
            ifd[2] = (29.0, 41.0, 0.0)                # latitude
            ifd[3] = 'W'
            ifd[4] = (52.0, 40.0, 0.0)                # longitude
        buf = io.BytesIO()
        img.save(buf, format='JPEG', exif=exif)
        return buf.getvalue()

    def test_orientacao_exif_e_aplicada_antes_de_o_exif_sumir(self):
        p = imgsvc.process_image(_upload('celular.jpg', self._com_exif(orientacao=6)))
        out, _ = _reabre(p)
        # 100×50 com orientação 6 (girar 90°) vira 50×100.
        self.assertEqual(out.size, (50, 100), 'a foto do celular saiu deitada')

    def test_exif_gps_e_comentarios_nao_sobrevivem(self):
        p = imgsvc.process_image(_upload('celular.jpg', self._com_exif()))
        out, data = _reabre(p)
        self.assertFalse(dict(out.getexif()), 'sobrou EXIF na saída')
        self.assertNotIn(b'secreto', data)
        self.assertFalse(out.getexif().get_ifd(0x8825), 'sobrou GPS na saída')
        self.assertIsNone(out.info.get('icc_profile'))

    def test_sem_exif_tambem_funciona(self):
        p = imgsvc.process_image(_upload('limpa.png', _bytes('PNG')))
        out, _ = _reabre(p)
        self.assertFalse(dict(out.getexif()))


# ── 4. Normalização ──────────────────────────────────────────────────────────

class NormalizacaoTests(SimpleTestCase):

    def test_reduz_mantendo_a_proporcao(self):
        p = imgsvc.process_image(_upload('g.png', _bytes('PNG', size=(2000, 1000))), max_dim=500)
        out, _ = _reabre(p)
        self.assertEqual(out.size, (500, 250), 'a proporção mudou')

    def test_nao_amplia_imagem_pequena(self):
        p = imgsvc.process_image(_upload('p.png', _bytes('PNG', size=(40, 30))), max_dim=4000)
        out, _ = _reabre(p)
        self.assertEqual(out.size, (40, 30), 'a imagem foi esticada')

    def test_flatten_bg_remove_o_alfa(self):
        p = imgsvc.process_image(_upload('t.png', _bytes('PNG', mode='RGBA')),
                                 flatten_bg=(255, 255, 255))
        out, _ = _reabre(p)
        self.assertEqual(out.mode, 'RGB')

    def test_presets_existem(self):
        for nome in ('photo', 'logo', 'avatar', 'thumb'):
            self.assertIn(nome, imgsvc.PRESETS)

    def test_qualidade_configuravel(self):
        # Cor chapada comprime igual em qualquer qualidade — precisa de detalhe
        # (ruído determinístico) para a diferença aparecer.
        import random
        rnd = random.Random(42)
        ruido = Image.new('RGB', (300, 300))
        ruido.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256))
                       for _ in range(300 * 300)])
        buf = io.BytesIO(); ruido.save(buf, format='PNG')
        alta = imgsvc.process_image(_upload('f.png', buf.getvalue()), quality=95)
        baixa = imgsvc.process_image(_upload('f.png', buf.getvalue()), quality=30)
        self.assertGreater(alta.size, baixa.size, 'a qualidade não mudou o resultado')


# ── 5. Storage: substituição, ordem segura e falha do S3 ─────────────────────

class StorageTests(TestCase):
    """Usa o campo de foto do passageiro como representante dos ImageField."""

    def _passageiro(self):
        from passengers.models import Passenger
        return Passenger.objects.create(first_name='Ana', last_name='Souza')

    def test_upload_grava_webp_no_storage(self):
        p = self._passageiro()
        processed = imgsvc.process_image(_upload('foto.jpg', _bytes('JPEG')))
        imgsvc.upload_processed_image(p.photo, processed, save=True)
        p.refresh_from_db()
        self.assertTrue(p.photo.name.endswith('.webp'))
        with p.photo.open('rb') as fh:
            self.assertEqual(Image.open(io.BytesIO(fh.read())).format, 'WEBP')
        p.photo.delete(save=True)

    def test_substituicao_troca_o_arquivo_e_remove_o_antigo(self):
        p = self._passageiro()
        imgsvc.upload_processed_image(p.photo, imgsvc.process_image(_upload('a.jpg', _bytes('JPEG'))))
        primeiro = p.photo.name
        storage = p.photo.storage
        self.assertTrue(storage.exists(primeiro))

        imgsvc.upload_processed_image(p.photo, imgsvc.process_image(_upload('b.png', _bytes('PNG'))))
        segundo = p.photo.name
        self.assertNotEqual(primeiro, segundo)
        self.assertTrue(storage.exists(segundo), 'a nova imagem não ficou no storage')
        self.assertFalse(storage.exists(primeiro), 'a antiga não foi removida')
        p.photo.delete(save=True)

    def test_falha_do_storage_nao_apaga_a_imagem_anterior(self):
        """Se o S3 cair no meio do upload, o registro continua com a foto antiga."""
        p = self._passageiro()
        imgsvc.upload_processed_image(p.photo, imgsvc.process_image(_upload('a.jpg', _bytes('JPEG'))))
        antiga = p.photo.name
        storage = p.photo.storage

        nova = imgsvc.process_image(_upload('b.png', _bytes('PNG')))
        with mock.patch.object(type(p.photo), 'save', side_effect=OSError('S3 fora do ar')):
            with self.assertRaises(OSError):
                imgsvc.upload_processed_image(p.photo, nova)
        self.assertEqual(p.photo.name, antiga)
        self.assertTrue(storage.exists(antiga), 'a imagem antiga foi perdida na falha')
        p.photo.delete(save=True)

    def test_falha_ao_apagar_a_antiga_nao_derruba_o_upload(self):
        """Órfão no S3 é aceitável; perder a imagem nova não é."""
        p = self._passageiro()
        imgsvc.upload_processed_image(p.photo, imgsvc.process_image(_upload('a.jpg', _bytes('JPEG'))))
        nova = imgsvc.process_image(_upload('b.png', _bytes('PNG')))
        with mock.patch.object(p.photo.storage.__class__, 'delete',
                               side_effect=OSError('sem permissão')):
            imgsvc.upload_processed_image(p.photo, nova)
        self.assertTrue(p.photo.name.endswith('.webp'))
        self.assertTrue(p.photo.storage.exists(p.photo.name))
        p.photo.delete(save=True)

    def test_arquivo_antigo_em_jpeg_continua_valendo(self):
        """Acervo legado não pode quebrar: nada é reconvertido automaticamente."""
        p = self._passageiro()
        p.photo.save('legado.jpg', ContentFile(_bytes('JPEG')), save=True)
        p.refresh_from_db()
        self.assertTrue(p.photo.name.endswith('.jpg'))
        with p.photo.open('rb') as fh:
            self.assertEqual(Image.open(io.BytesIO(fh.read())).format, 'JPEG')
        p.photo.delete(save=True)


# ── 6. Os funis usados pelas views/serializers ───────────────────────────────

class FunisTests(SimpleTestCase):
    """`passengers.validators` é a porta que as views já chamavam; ela precisa
    devolver WebP sem que cada view saiba do pipeline."""

    def test_validate_document_file_converte_imagem(self):
        from passengers.validators import validate_document_file
        f = validate_document_file(_upload('foto.jpg', _bytes('JPEG')))
        self.assertEqual(f.content_type, 'image/webp')
        self.assertTrue(f.name.endswith('.webp'))
        self.assertEqual(Image.open(io.BytesIO(f.read())).format, 'WEBP')

    def test_validate_document_file_aceita_heic(self):
        if not imgsvc.HEIF_SUPPORTED:
            self.skipTest('pillow-heif ausente neste ambiente')
        from passengers.validators import validate_document_file
        f = validate_document_file(_upload('IMG.HEIC', _bytes('HEIF')))
        self.assertEqual(f.content_type, 'image/webp')

    def test_validate_document_file_nao_toca_no_pdf(self):
        from passengers.validators import validate_document_file
        pdf = b'%PDF-1.7\n' + b'x' * 200
        f = validate_document_file(_upload('doc.pdf', pdf), allowed_exts={'.pdf'}, allow_images=False)
        f.seek(0)
        self.assertEqual(f.read(), pdf, 'o PDF foi alterado pelo pipeline de imagem')

    def test_pdf_disfarcado_de_imagem_e_barrado(self):
        from passengers.validators import validate_document_file
        with self.assertRaises(ValidationError):
            validate_document_file(_upload('x.jpg', b'%PDF-1.7\n' + b'x' * 200))

    def test_imagem_barrada_onde_so_pdf_e_aceito(self):
        from passengers.validators import validate_document_file
        with self.assertRaises(ValidationError):
            validate_document_file(_upload('a.jpg', _bytes('JPEG')),
                                   allowed_exts={'.pdf'}, allow_images=False)

    def test_sanitize_image_devolve_webp(self):
        from passengers.validators import sanitize_image
        cf = sanitize_image(_upload('logo.png', _bytes('PNG', mode='RGBA')))
        self.assertEqual(Image.open(io.BytesIO(cf.read())).format, 'WEBP')

    def test_validate_media_file_separa_imagem_de_video(self):
        from passengers.validators import validate_media_file
        kind, arquivo = validate_media_file(_upload('foto.png', _bytes('PNG')))
        self.assertEqual(kind, 'image')
        self.assertEqual(arquivo.content_type, 'image/webp')

    def test_video_nao_passa_pelo_pipeline_de_imagem(self):
        """Vídeo mantém o fluxo próprio — nada de converter MP4 para WebP."""
        from passengers.validators import validate_media_file
        mp4 = b'\x00\x00\x00\x18ftypmp42' + b'\x00' * 64
        kind, arquivo = validate_media_file(_upload('clipe.mp4', mp4))
        self.assertEqual(kind, 'video')
        arquivo.seek(0)
        self.assertEqual(arquivo.read(), mp4)


# ── 7. Ambiente ──────────────────────────────────────────────────────────────

class AmbienteTests(SimpleTestCase):
    """Guarda contra o clássico "funciona na minha máquina": se o servidor não
    tiver HEIC/AVIF, é melhor o teste gritar aqui do que o usuário descobrir."""

    def test_heic_disponivel(self):
        self.assertTrue(
            imgsvc.HEIF_SUPPORTED,
            'pillow-heif não está instalado — fotos de iPhone serão recusadas. '
            'Confira requirements.txt e a imagem Docker.',
        )

    def test_avif_disponivel(self):
        self.assertTrue(
            imgsvc.AVIF_SUPPORTED,
            'Pillow sem suporte a AVIF — confira a versão em requirements.txt.',
        )

    def test_extensoes_de_entrada_batem_com_o_front(self):
        esperado = {'.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic', '.heif', '.gif'}
        self.assertEqual(imgsvc.INPUT_EXTENSIONS, esperado)

    def test_formato_de_saida(self):
        self.assertEqual(imgsvc.CONTENT_TYPE, 'image/webp')
        self.assertEqual(imgsvc.OUTPUT_EXT, '.webp')


assert os.path.basename(__file__).startswith('tests_')   # descoberto pelo runner
