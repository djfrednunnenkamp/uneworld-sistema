"""Testes do pipeline de vídeo da Galeria: validação, normalização, thumbnail,
máquina de estados, streaming com Range, download e reprocessamento.

As fixtures são geradas com o próprio FFmpeg em tempo de teste (pequenas, não vão
para o repositório). Todo o módulo é pulado quando ffmpeg/ffprobe não estão
disponíveis no ambiente — assim o CI sem FFmpeg não quebra, mas onde há FFmpeg a
cobertura é real.
"""
import os
import shutil
import subprocess
import tempfile
import hashlib

from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase, APITestCase as _Base
import unittest

from users_api.models import UserPermissions
from itineraries.models import ItineraryImage
from itineraries.services import video as vsvc
from itineraries import video_processing as vp

FFMPEG = shutil.which(os.environ.get('FFMPEG_BIN', 'ffmpeg')) or shutil.which('ffmpeg')
FFPROBE = shutil.which(os.environ.get('FFPROBE_BIN', 'ffprobe')) or shutil.which('ffprobe')
HAVE_FFMPEG = bool(FFMPEG and FFPROBE)

requires_ffmpeg = unittest.skipUnless(HAVE_FFMPEG, 'ffmpeg/ffprobe indisponíveis')

# MEDIA_ROOT isolado: os testos gravam vídeos normalizados/thumbnails; mandamos
# para um diretório temporário para NÃO poluir o media real (limpo no fim).
_TEST_MEDIA = tempfile.mkdtemp(prefix='vidtest_media_')
media_isolated = override_settings(MEDIA_ROOT=_TEST_MEDIA)


def tearDownModule():
    shutil.rmtree(_TEST_MEDIA, ignore_errors=True)


# ── geradores de fixtures ────────────────────────────────────────────────────

def _gen(args_out, seconds=2, size='320x240', fps=25, audio=False, extra_in=None):
    """Gera um arquivo de vídeo com o ffmpeg. `args_out` = (formato/args de saída,
    caminho). Retorna o caminho."""
    fd, path = tempfile.mkstemp(suffix=args_out)
    os.close(fd)
    cmd = [FFMPEG, '-y', '-loglevel', 'error',
           '-f', 'lavfi', '-i', f'testsrc=size={size}:rate={fps}:duration={seconds}']
    if audio:
        cmd += ['-f', 'lavfi', '-i', f'sine=frequency=440:duration={seconds}']
    if extra_in:
        cmd += extra_in
    cmd += [path]
    subprocess.run(cmd, check=True, capture_output=True)
    return path


def make_user(username, superuser=False, **perms):
    u = User.objects.create_user(username=username, email=f'{username}@x.com', password='pw12345678')
    if superuser:
        u.is_superuser = True; u.is_staff = True; u.save()
    p, _ = UserPermissions.objects.get_or_create(user=u)
    for k, v in perms.items():
        setattr(p, k, v)
    p.save()
    return u


# ── validação de upload (rápida, sem ffmpeg) ─────────────────────────────────

class VideoUploadValidationTest(APITestCase):
    """A 1ª barreira (extensão/tamanho/sniff) — não precisa de ffmpeg."""

    def test_fake_mp4_is_rejected(self):
        from passengers.validators import validate_video_file
        fake = SimpleUploadedFile('x.mp4', b'<html>not a video</html>', content_type='video/mp4')
        with self.assertRaises(ValidationError):
            validate_video_file(fake)

    def test_oversize_is_rejected(self):
        from passengers.validators import validate_video_file, MAX_VIDEO_SIZE

        class Big:
            name = 'big.mp4'
            size = MAX_VIDEO_SIZE + 1
        with self.assertRaises(ValidationError):
            validate_video_file(Big())

    def test_real_mp4_header_passes(self):
        from passengers.validators import validate_video_file
        # ftyp box mínimo (bytes 4-8 = 'ftyp')
        data = b'\x00\x00\x00\x18ftypmp42' + b'\x00' * 32
        f = SimpleUploadedFile('ok.mp4', data, content_type='video/mp4')
        self.assertIs(validate_video_file(f), f)


@requires_ffmpeg
class VideoServiceTest(_Base):
    """O serviço ffmpeg em si: probe, normalize, thumbnail, validate_output."""

    def _cleanup(self, *paths):
        for p in paths:
            try:
                os.remove(p)
            except OSError:
                pass

    def test_probe_reads_streams(self):
        src = _gen('.mp4', audio=True)
        info = vsvc.probe(src)
        self.assertTrue(info.has_video)
        self.assertTrue(info.has_audio)
        self.assertGreater(info.duration, 1.0)
        self._cleanup(src)

    def test_normalize_produces_browser_mp4(self):
        # Entrada WebM/VP8 → saída deve ser MP4/H.264/yuv420p tocável.
        src = _gen('.webm', extra_in=['-c:v', 'libvpx', '-b:v', '300k'])
        out = tempfile.mktemp(suffix='.mp4')
        vsvc.normalize(src, out)
        info = vsvc.validate_output(out)          # não levanta = válido
        self.assertEqual(info.codec, 'h264')
        self.assertIn(info.pix_fmt, ('yuv420p', 'yuvj420p'))
        self._cleanup(src, out)

    def test_odd_dimensions_become_even(self):
        src = _gen('.mp4', size='641x361')        # ímpares de propósito
        out = tempfile.mktemp(suffix='.mp4')
        vsvc.normalize(src, out)
        info = vsvc.validate_output(out)
        self.assertEqual(info.width % 2, 0)
        self.assertEqual(info.height % 2, 0)
        self._cleanup(src, out)

    def test_no_audio_is_fine(self):
        src = _gen('.mp4', audio=False)
        out = tempfile.mktemp(suffix='.mp4')
        vsvc.normalize(src, out)
        vsvc.validate_output(out)                 # sem áudio deve validar normalmente
        self._cleanup(src, out)

    def test_thumbnail_generated(self):
        src = _gen('.mp4', seconds=3)
        out = tempfile.mktemp(suffix='.mp4'); thumb = tempfile.mktemp(suffix='.jpg')
        vsvc.normalize(src, out)
        vsvc.make_thumbnail(out, thumb, duration=3.0)
        self.assertTrue(os.path.getsize(thumb) > 0)
        self._cleanup(src, out, thumb)

    def test_truncated_file_fails(self):
        src = _gen('.mp4', seconds=3)
        trunc = tempfile.mktemp(suffix='.mp4')
        with open(src, 'rb') as f:
            head = f.read()
        with open(trunc, 'wb') as f:
            f.write(head[: len(head) // 3])       # corta no meio
        out = tempfile.mktemp(suffix='.mp4')
        with self.assertRaises(vsvc.VideoError):
            vsvc.normalize(trunc, out)
            vsvc.validate_output(out)
        self._cleanup(src, trunc, out)


@requires_ffmpeg
@media_isolated
@override_settings(VIDEO_PROCESS_INLINE=False)   # controla o processamento no teste
class VideoStateMachineTest(_Base):
    """Máquina de estados + gravação atômica via orquestrador."""

    def _make_img(self, ext='.mp4', **kw):
        src = _gen(ext, **kw)
        with open(src, 'rb') as f:
            data = f.read()
        os.remove(src)
        img = ItineraryImage(kind='gallery')
        img.image.save('v' + ext, SimpleUploadedFile('v' + ext, data), save=False)
        img.orig_size = len(data)
        img.status = 'pending'
        img.save()
        return img

    def test_pending_to_ready(self):
        img = self._make_img(audio=True)
        self.assertEqual(img.status, 'pending')
        result = vp.process_video(img.id)
        img.refresh_from_db()
        self.assertEqual(result, 'ready')
        self.assertEqual(img.status, 'ready')
        self.assertTrue(img.video_normalized)
        self.assertTrue(img.thumbnail)
        self.assertGreater(img.duration or 0, 0)
        self.assertTrue(img.width and img.height)

    def test_failed_sets_status_and_message(self):
        # Grava um "vídeo" falso (não decodifica) → deve falhar com mensagem.
        img = ItineraryImage(kind='gallery')
        img.image.save('bad.mp4', SimpleUploadedFile('bad.mp4', b'\x00\x00\x00\x18ftypmp42' + b'\x00' * 64), save=False)
        img.status = 'pending'; img.save()
        result = vp.process_video(img.id)
        img.refresh_from_db()
        self.assertEqual(result, 'failed')
        self.assertEqual(img.status, 'failed')
        self.assertTrue(img.error_message)

    def test_reprocess_is_idempotent(self):
        img = self._make_img()
        vp.process_video(img.id)
        img.refresh_from_db()
        first = img.video_normalized.name
        # Reprocessa forçado: gera novo arquivo, continua 'ready', sem duplicar registro.
        result = vp.process_video(img.id, force=True)
        img.refresh_from_db()
        self.assertEqual(result, 'ready')
        self.assertEqual(img.status, 'ready')
        self.assertEqual(ItineraryImage.objects.filter(pk=img.pk).count(), 1)

    def test_claim_prevents_double_processing(self):
        img = self._make_img()
        self.assertTrue(vp.claim(img.id))          # 1º pega
        self.assertFalse(vp.claim(img.id))         # 2º não pega (já 'processing')
        # process_video com claim de outro em andamento → skip
        self.assertEqual(vp.process_video(img.id), 'skipped')


@requires_ffmpeg
@media_isolated
@override_settings(VIDEO_PROCESS_INLINE=False, DEBUG=True)
class VideoApiTest(APITestCase):
    """Upload, streaming com Range, download com hash idêntico e permissões."""

    def setUp(self):
        self.uploader = make_user('vup', gallery_upload_videos=True, gallery_view=True)
        self.viewer = make_user('vview', gallery_view_images=True)   # NÃO pode vídeo

    def _upload_and_process(self):
        self.client.force_authenticate(self.uploader)
        src = _gen('.mp4', audio=True)
        with open(src, 'rb') as f:
            data = f.read()
        os.remove(src)
        resp = self.client.post('/api/itineraries/gallery/',
                                {'image': SimpleUploadedFile('clip.mp4', data, content_type='video/mp4')},
                                format='multipart')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['status'], 'pending')
        img_id = resp.data['id']
        vp.process_video(img_id)                   # processa síncrono (inline desligado)
        return img_id, data

    def test_upload_status_and_serializer_fields(self):
        img_id, _ = self._upload_and_process()
        r = self.client.get(f'/api/itineraries/gallery/{img_id}/')
        self.assertEqual(r.data['status'], 'ready')
        self.assertTrue(r.data['is_video'])
        self.assertTrue(r.data['video_url'])
        self.assertTrue(r.data['thumb_url'])
        self.assertGreater(r.data['duration'], 0)

    def test_range_request_returns_206(self):
        # A rota /media/ com Range só existe quando DEBUG=True no import do urls.py
        # (em prod é o nginx). Aqui exercitamos a view diretamente (RequestFactory),
        # que é o código que serve o vídeo com Range no dev.
        from django.test import RequestFactory
        from core.urls import _serve_media_range
        img_id, _ = self._upload_and_process()
        img = ItineraryImage.objects.get(pk=img_id)
        path = img.video_normalized.name
        rf = RequestFactory()

        full = _serve_media_range(rf.get('/media/' + path), path)
        self.assertEqual(full.status_code, 200)
        self.assertEqual(full['Accept-Ranges'], 'bytes')
        self.assertEqual(full['Content-Type'], 'video/mp4')

        partial = _serve_media_range(rf.get('/media/' + path, HTTP_RANGE='bytes=0-99'), path)
        self.assertEqual(partial.status_code, 206)
        self.assertEqual(partial['Content-Range'].split('/')[0], 'bytes 0-99')
        self.assertEqual(partial['Content-Length'], '100')

        bad = _serve_media_range(rf.get('/media/' + path, HTTP_RANGE='bytes=99999999-100000000'), path)
        self.assertEqual(bad.status_code, 416)

    def test_download_hash_matches_stored(self):
        img_id, _ = self._upload_and_process()
        img = ItineraryImage.objects.get(pk=img_id)
        with img.video_normalized.open('rb') as f:
            stored_sha = hashlib.sha256(f.read()).hexdigest()
        r = self.client.get(f'/api/itineraries/gallery/{img_id}/download/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r['Content-Type'], 'video/mp4')
        body = b''.join(r.streaming_content)
        self.assertEqual(hashlib.sha256(body).hexdigest(), stored_sha)

    def test_viewer_without_video_permission_cannot_see(self):
        img_id, _ = self._upload_and_process()
        self.client.force_authenticate(self.viewer)
        r = self.client.get('/api/itineraries/gallery/', {'media': 'video'})
        rows = r.data['results'] if isinstance(r.data, dict) and 'results' in r.data else r.data
        ids = [x['id'] for x in rows]
        self.assertNotIn(img_id, ids)

    def test_reprocess_endpoint_requires_permission(self):
        img_id, _ = self._upload_and_process()
        self.client.force_authenticate(self.viewer)
        r = self.client.post(f'/api/itineraries/gallery/{img_id}/reprocess/')
        self.assertIn(r.status_code, (403, 404))
