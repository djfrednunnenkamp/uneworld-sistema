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
@override_settings(VIDEO_PROCESS_INLINE=False, VIDEO_MAKE_WEBM=False)  # MP4 só; WebM tem classe própria
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

    def test_progress_reaches_100_when_ready(self):
        # Processa síncrono (na thread do teste, mesma conexão) → estado final coerente.
        img = self._make_img(seconds=2)
        vp.process_video(img.id)
        img.refresh_from_db()
        self.assertEqual(img.status, 'ready')
        self.assertEqual(img.processing_progress, 100.0)
        self.assertEqual(img.processing_stage, 'completed')
        self.assertEqual(img.estimated_remaining_seconds, 0)
        self.assertIsNotNone(img.processing_heartbeat_at)
        self.assertIsNotNone(img.processing_finished_at)

    def test_progress_never_regresses(self):
        # O reporter clampa monotonicamente: nunca grava um % menor que o já salvo.
        from itineraries.video_processing import _Reporter
        img = self._make_img(seconds=1)
        rep = _Reporter(img.id, duration=10)
        rep._persist({}, force=True, progress=50)
        img.refresh_from_db(); self.assertEqual(img.processing_progress, 50.0)
        rep._persist({}, force=True, progress=30)          # regressão ignorada
        img.refresh_from_db(); self.assertEqual(img.processing_progress, 50.0)
        rep._persist({}, force=True, progress=80)
        img.refresh_from_db(); self.assertEqual(img.processing_progress, 80.0)

    def test_ffmpeg_missing_fails_fast(self):
        from unittest import mock
        img = self._make_img()
        with mock.patch.object(vsvc, 'ffmpeg_available', return_value=False):
            result = vp.process_video(img.id)
        img.refresh_from_db()
        self.assertEqual(result, 'failed')
        self.assertEqual(img.status, 'failed')            # NUNCA fica preso em processing
        self.assertIn('indisponível', img.error_message)

    def test_exception_after_thumbnail_becomes_failed(self):
        from unittest import mock
        img = self._make_img()
        # Falha DEPOIS da thumbnail (na gravação atômica) → precisa virar failed, não
        # ficar eternamente em processing, e não publicar normalizado.
        with mock.patch.object(vsvc, 'make_thumbnail', side_effect=vsvc.VideoError('boom thumb')):
            result = vp.process_video(img.id)
        img.refresh_from_db()
        self.assertEqual(result, 'failed')
        self.assertEqual(img.status, 'failed')
        self.assertFalse(img.video_normalized)


class VideoStuckRecoveryTest(_Base):
    """Detecção/recuperação de processamento abandonado (heartbeat) — sem ffmpeg."""

    def _proc(self, attempts=1, hb_minutes_ago=10):
        from datetime import timedelta
        from django.utils import timezone
        img = ItineraryImage(kind='gallery')
        img.image.save('v.mp4', SimpleUploadedFile('v.mp4', b'\x00\x00\x00\x18ftypmp42' + b'\x00' * 40), save=False)
        img.status = 'processing'; img.processing_attempts = attempts
        img.processing_started_at = timezone.now() - timedelta(minutes=hb_minutes_ago)
        img.processing_heartbeat_at = timezone.now() - timedelta(minutes=hb_minutes_ago)
        img.save()
        return img

    def test_fresh_heartbeat_not_stuck(self):
        from django.utils import timezone
        img = self._proc()
        img.processing_heartbeat_at = timezone.now(); img.save()
        self.assertFalse(vp.is_stuck(img))

    def test_stale_heartbeat_is_stuck(self):
        self.assertTrue(vp.is_stuck(self._proc()))

    def test_recover_requeues_when_attempts_left(self):
        img = self._proc(attempts=1)
        r = vp.recover_stuck()
        img.refresh_from_db()
        self.assertEqual(img.status, 'pending')
        self.assertEqual(r['requeued'], 1)

    def test_recover_fails_when_attempts_exhausted(self):
        img = self._proc(attempts=3)
        r = vp.recover_stuck()
        img.refresh_from_db()
        self.assertEqual(img.status, 'failed')
        self.assertEqual(r['failed'], 1)
        self.assertTrue(img.error_message)


@requires_ffmpeg
@media_isolated
@override_settings(VIDEO_PROCESS_INLINE=False, DEBUG=True, VIDEO_MAKE_WEBM=False)
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

    def test_status_endpoint_returns_progress_fields(self):
        img_id, _ = self._upload_and_process()
        r = self.client.get(f'/api/itineraries/gallery/{img_id}/status/')
        self.assertEqual(r.status_code, 200)
        for key in ('id', 'status', 'processing_stage', 'processing_progress',
                    'estimated_remaining_seconds', 'processing_elapsed_seconds',
                    'processing_heartbeat_at', 'video_url', 'thumb_url', 'duration'):
            self.assertIn(key, r.data)
        self.assertEqual(r.data['status'], 'ready')
        self.assertEqual(r.data['processing_progress'], 100.0)
        self.assertTrue(r.data['video_url'])

    def test_status_endpoint_recovers_stuck(self):
        # Um vídeo preso em processing (heartbeat velho) deve se recuperar ao ser
        # consultado pelo /status/ (self-heal), sem ficar carregando pra sempre.
        from datetime import timedelta
        from django.utils import timezone
        img_id, _ = self._upload_and_process()
        ItineraryImage.objects.filter(pk=img_id).update(
            status='processing', processing_attempts=1,
            processing_heartbeat_at=timezone.now() - timedelta(minutes=10),
            processing_started_at=timezone.now() - timedelta(minutes=10))
        r = self.client.get(f'/api/itineraries/gallery/{img_id}/status/')
        self.assertEqual(r.status_code, 200)
        self.assertIn(r.data['status'], ('pending', 'failed'))   # não segue 'processing'

    def test_status_endpoint_permission(self):
        img_id, _ = self._upload_and_process()
        self.client.force_authenticate(self.viewer)          # não vê vídeos
        r = self.client.get(f'/api/itineraries/gallery/{img_id}/status/')
        self.assertIn(r.status_code, (403, 404))

    def test_serializer_media_contract(self):
        # Contrato claro de mídia: playback (video_url), download_url, thumb, mime.
        img_id, _ = self._upload_and_process()
        r = self.client.get(f'/api/itineraries/gallery/{img_id}/')
        self.assertTrue(r.data['video_url'])
        self.assertTrue(r.data['thumb_url'])
        self.assertEqual(r.data['mime_type'], 'video/mp4')
        self.assertIn(f'/api/itineraries/gallery/{img_id}/download/', r.data['download_url'])

    def test_download_endpoint_headers(self):
        img_id, _ = self._upload_and_process()
        r = self.client.get(f'/api/itineraries/gallery/{img_id}/download/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r['Content-Type'], 'video/mp4')
        self.assertIn('attachment', r['Content-Disposition'])
        self.assertTrue(r['Content-Disposition'].endswith('.mp4"') or '.mp4' in r['Content-Disposition'])

    def test_mp4_is_main_profile(self):
        img_id, _ = self._upload_and_process()
        img = ItineraryImage.objects.get(pk=img_id)
        out = subprocess.run([FFPROBE, '-v', 'error', '-select_streams', 'v:0',
                              '-show_entries', 'stream=profile,codec_tag_string,pix_fmt',
                              '-of', 'default=noprint_wrappers=1', img.video_normalized.path],
                             capture_output=True, text=True).stdout
        self.assertIn('profile=Main', out)
        self.assertIn('codec_tag_string=avc1', out)
        self.assertIn('pix_fmt=yuv420p', out)

    def test_downloads_contract(self):
        img_id, _ = self._upload_and_process()
        r = self.client.get(f'/api/itineraries/gallery/{img_id}/')
        dl = r.data['downloads']
        self.assertTrue(dl['mp4']['available'])
        self.assertTrue(dl['mp4']['url'])
        self.assertTrue(dl['mp4']['filename'].endswith('.mp4'))
        self.assertIn(str(img_id), dl['mp4']['filename'])          # id no nome
        # sem WebM neste teste (VIDEO_MAKE_WEBM=False) → webm available False
        self.assertFalse(dl['webm']['available'])

    def test_download_uses_pretty_name_not_uuid(self):
        img_id, _ = self._upload_and_process()
        img = ItineraryImage.objects.get(pk=img_id)
        uuid_name = img.video_normalized.name.split('/')[-1]
        r = self.client.get(f'/api/itineraries/gallery/{img_id}/download/?fmt=mp4')
        cd = r['Content-Disposition']
        self.assertIn("filename*=UTF-8''", cd)                     # RFC 5987
        self.assertIn(f'- {img_id}.mp4', cd)                       # nome bonito, id por último
        self.assertNotIn(uuid_name, cd)                            # NÃO expõe o nome físico

    def test_processing_video_has_no_playback_url(self):
        # Enquanto processa, NÃO expõe video_url (o front não abre player quebrado).
        self.client.force_authenticate(self.uploader)
        src = _gen('.mp4')
        with open(src, 'rb') as f:
            data = f.read()
        os.remove(src)
        resp = self.client.post('/api/itineraries/gallery/',
                                {'image': SimpleUploadedFile('c.mp4', data, content_type='video/mp4')},
                                format='multipart')
        img_id = resp.data['id']   # status 'pending', ainda não processado
        r = self.client.get(f'/api/itineraries/gallery/{img_id}/status/')
        self.assertIn(r.data['status'], ('pending', 'processing'))
        self.assertIsNone(r.data['video_url'])


HAVE_VP9 = HAVE_FFMPEG and ('libvpx-vp9' in (
    subprocess.run([FFMPEG, '-hide_banner', '-encoders'], capture_output=True, text=True).stdout if FFMPEG else ''))
requires_vp9 = unittest.skipUnless(HAVE_VP9, 'libvpx-vp9 indisponível')


@requires_vp9
@media_isolated
@override_settings(VIDEO_PROCESS_INLINE=False, VIDEO_MAKE_WEBM=True,
                   VIDEO_VP9_CPU_USED=8, VIDEO_VP9_DEADLINE='realtime', VIDEO_VP9_CRF=40)
class VideoDualFormatTest(APITestCase):
    """Gera MP4 (H.264) + WebM (VP9) e valida o contrato/download das duas versões.
    Usa VP9 rápido (cpu-used 8/realtime) para não travar o teste."""

    def setUp(self):
        self.user = make_user('dual', gallery_upload_videos=True, gallery_view=True)

    def _make(self, **kw):
        src = _gen('.mp4', seconds=2, **kw)
        with open(src, 'rb') as f:
            data = f.read()
        os.remove(src)
        img = ItineraryImage(kind='gallery')
        img.image.save('d.mp4', SimpleUploadedFile('d.mp4', data), save=False)
        img.status = 'pending'; img.save()
        return img

    def test_generates_both_formats(self):
        img = self._make(audio=True)
        self.assertEqual(vp.process_video(img.id), 'ready')
        img.refresh_from_db()
        self.assertTrue(img.video_normalized, 'MP4 ausente')
        self.assertTrue(img.video_normalized_webm, 'WebM ausente')
        mp4 = vsvc.probe(img.video_normalized.path)
        webm = vsvc.probe(img.video_normalized_webm.path)
        self.assertEqual(mp4.codec, 'h264')
        self.assertEqual(webm.codec, 'vp9')
        self.assertIn(webm.pix_fmt, ('yuv420p', 'yuvj420p'))
        self.assertTrue(vsvc.decode_ok(img.video_normalized_webm.path))

    def test_no_audio_both_formats(self):
        img = self._make(audio=False)
        self.assertEqual(vp.process_video(img.id), 'ready')
        img.refresh_from_db()
        self.assertTrue(img.video_normalized and img.video_normalized_webm)

    def test_webm_failure_keeps_mp4_ready(self):
        # WebM falha (mock) mas o MP4 é válido → vídeo ainda fica 'ready' (best-effort).
        from unittest import mock
        img = self._make()
        with mock.patch.object(vsvc, 'normalize_webm', side_effect=vsvc.VideoError('vp9 boom')):
            self.assertEqual(vp.process_video(img.id), 'ready')
        img.refresh_from_db()
        self.assertEqual(img.status, 'ready')
        self.assertTrue(img.video_normalized)          # MP4 presente
        self.assertFalse(img.video_normalized_webm)    # WebM ausente (falhou), mas não bloqueou

    def test_webm_only_reprocess_keeps_mp4(self):
        img = self._make()
        vp.process_video(img.id)                       # gera MP4+WebM
        img.refresh_from_db()
        mp4_name = img.video_normalized.name
        # apaga só o WebM e regenera com webm_only
        img.video_normalized_webm.delete(save=False); img.video_normalized_webm = ''; img.save()
        self.assertEqual(vp.process_video(img.id, force=True, webm_only=True), 'ready')
        img.refresh_from_db()
        self.assertEqual(img.video_normalized.name, mp4_name)   # MP4 preservado (mesmo arquivo)
        self.assertTrue(img.video_normalized_webm)              # WebM regenerado

    def test_serializer_playback_sources_and_download_urls(self):
        img = self._make()
        vp.process_video(img.id)
        self.client.force_authenticate(self.user)
        r = self.client.get(f'/api/itineraries/gallery/{img.id}/')
        sources = r.data['playback_sources']
        self.assertEqual(len(sources), 2)
        self.assertEqual(sources[0]['codec'], 'avc1')
        self.assertEqual(sources[1]['codec'], 'vp9')
        self.assertIn('mp4', r.data['download_urls'])
        self.assertIn('webm', r.data['download_urls'])
        self.assertIn('fmt=webm', r.data['download_urls']['webm'])   # não usa ?format= (reservado DRF)
        self.assertTrue(r.data['webm_url'])

    def test_download_webm_hash_and_headers(self):
        import hashlib
        img = self._make()
        vp.process_video(img.id)
        img.refresh_from_db()
        with img.video_normalized_webm.open('rb') as f:
            stored = hashlib.sha256(f.read()).hexdigest()
        self.client.force_authenticate(self.user)
        r = self.client.get(f'/api/itineraries/gallery/{img.id}/download/?fmt=webm')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r['Content-Type'], 'video/webm')
        self.assertIn('attachment', r['Content-Disposition'])
        self.assertTrue(r['Content-Disposition'].endswith('.webm"') or '.webm' in r['Content-Disposition'])
        body = b''.join(r.streaming_content)
        self.assertEqual(hashlib.sha256(body).hexdigest(), stored)

    def test_deleting_video_removes_both_files(self):
        img = self._make()
        vp.process_video(img.id)
        img.refresh_from_db()
        mp4p, webmp = img.video_normalized.path, img.video_normalized_webm.path
        self.assertTrue(os.path.exists(mp4p) and os.path.exists(webmp))
        img.delete()
        self.assertFalse(os.path.exists(mp4p))
        self.assertFalse(os.path.exists(webmp))


class _FakeImg:
    """Objeto leve com os atributos que gallery_naming lê (evita fixtures de FK geo)."""
    SUBJECT_CHOICES = ItineraryImage.SUBJECT_CHOICES
    is_video = True
    def __init__(self, **kw):
        self.id = kw.get('id', 1); self.kind = kw.get('kind', 'gallery')
        self.subject_type = kw.get('subject_type', 'landscape'); self.caption = kw.get('caption', '')
        self.continent = None; self.continent_id = None
        self.country = None; self.country_id = None
        self.city = None; self.city_id = None
        cont = kw.get('continent')
        if cont: self.continent = type('X', (), {'name': cont})(); self.continent_id = 1
        country = kw.get('country'); city = kw.get('city')
        if country:
            self.country = type('X', (), {'name': country})(); self.country_id = 1
        if city:
            st = None
            if kw.get('country_from_city'):
                st = type('S', (), {'country': type('C', (), {'name': kw['country_from_city']})(), 'country_id': 1})()
            self.city = type('Ci', (), {'name': city, 'state': st, 'state_id': (1 if st else None)})()
            self.city_id = 1


class GalleryNamingTest(_Base):
    """Nome de download a partir dos metadados — casos e sanitização (sem ffmpeg)."""

    def setUp(self):
        from itineraries import gallery_naming as gn
        self.gn = gn

    def test_full_name(self):
        img = _FakeImg(id=461, subject_type='landscape', city='Paris', country='França', caption='Torre Eiffel ao entardecer')
        self.assertEqual(self.gn.download_filename(img, '.mp4'),
                         'Paisagem - Paris - França - Torre Eiffel ao entardecer - 461.mp4')

    def test_no_description(self):
        img = _FakeImg(id=461, city='Paris', country='França')
        self.assertEqual(self.gn.download_filename(img, '.mp4'), 'Paisagem - Paris - França - 461.mp4')

    def test_city_only(self):
        img = _FakeImg(id=461, city='Paris')
        self.assertEqual(self.gn.download_filename(img, '.mp4'), 'Paisagem - Paris - 461.mp4')

    def test_country_derived_from_city(self):
        img = _FakeImg(id=7, city='Paris', country_from_city='França')
        self.assertEqual(self.gn.download_filename(img, '.mp4'), 'Paisagem - Paris - França - 7.mp4')

    def test_no_metadata(self):
        img = _FakeImg(id=461, subject_type='')
        self.assertEqual(self.gn.download_filename(img, '.mp4'), 'Vídeo - 461.mp4')

    def test_object_type_label(self):
        img = _FakeImg(id=9, subject_type='object', city='Roma', country='Itália', caption='Escultura')
        self.assertEqual(self.gn.download_filename(img, '.mp4'), 'Objeto - Roma - Itália - Escultura - 9.mp4')

    def test_forbidden_chars_removed(self):
        img = _FakeImg(id=5, subject_type='object', caption='a/b\\c:d*e?f"g<h>i|j')
        out = self.gn.download_filename(img, '.mp4')
        for ch in '/\\:*?"<>|':
            self.assertNotIn(ch, out.replace('.mp4', ''))
        self.assertTrue(out.endswith('- 5.mp4'))

    def test_control_and_crlf_removed(self):
        img = _FakeImg(id=5, caption='linha1\r\nlinha2\ttab\x00nul')
        out = self.gn.download_filename(img, '.mp4')
        for ch in ['\r', '\n', '\t', '\x00']:
            self.assertNotIn(ch, out)

    def test_path_traversal_neutralized(self):
        img = _FakeImg(id=5, caption='../../etc/passwd')
        out = self.gn.download_filename(img, '.mp4')
        self.assertNotIn('..', out)
        self.assertNotIn('/', out.replace('.mp4', ''))

    def test_length_limited(self):
        img = _FakeImg(id=5, caption='x' * 500)
        out = self.gn.download_filename(img, '.mp4')
        self.assertLessEqual(len(out), 210)
        self.assertTrue(out.endswith('- 5.mp4'))

    def test_id_is_last(self):
        img = _FakeImg(id=999, city='Paris', caption='Desc')
        self.assertTrue(self.gn.download_filename(img, '.mp4').endswith(' - 999.mp4'))

    def test_no_duplicate_separators(self):
        # caption vazia entre partes não deve deixar " -  - "
        img = _FakeImg(id=3, subject_type='landscape', city='', country='França')
        self.assertEqual(self.gn.download_filename(img, '.mp4'), 'Paisagem - França - 3.mp4')

    def test_extension_normalized(self):
        img = _FakeImg(id=1)
        self.assertTrue(self.gn.download_filename(img, 'MP4').endswith('.mp4'))
        self.assertTrue(self.gn.download_filename(img, '.WEBM').endswith('.webm'))

    def test_content_disposition_has_both_and_ascii_fallback(self):
        img = _FakeImg(id=461, city='Paris', country='França', caption='Torre')
        cd = self.gn.content_disposition(self.gn.download_filename(img, '.mp4'))
        self.assertIn('attachment;', cd)
        self.assertIn('filename="', cd)
        self.assertIn("filename*=UTF-8''", cd)
        # fallback ASCII sem acento (França → Franca)
        self.assertIn('Franca', cd.split("filename*=")[0])
        # sem CR/LF no header (anti-injeção)
        self.assertNotIn('\r', cd); self.assertNotIn('\n', cd)

    def test_content_disposition_no_crlf_injection(self):
        # O vetor real de injeção é o CR/LF (quebra o header); o resto vira texto do
        # nome, entre aspas / percent-encoded — não injeta cabeçalho novo.
        img = _FakeImg(id=5, caption='a";\r\nSet-Cookie: x=1')
        cd = self.gn.content_disposition(self.gn.download_filename(img, '.mp4'))
        self.assertNotIn('\r', cd); self.assertNotIn('\n', cd)     # sem quebra de linha
        self.assertNotIn('"', cd.split('filename="')[1].split('";')[0])  # aspas não escaparam do valor

    def test_name_reflects_edited_metadata(self):
        # Editar metadado muda o PRÓXIMO nome de download (calculado dinamicamente).
        img = _FakeImg(id=1, subject_type='landscape', city='Paris')
        self.assertEqual(self.gn.download_basename(img), 'Paisagem - Paris - 1')
        img.caption = 'Nova descrição'
        self.assertEqual(self.gn.download_basename(img), 'Paisagem - Paris - Nova descrição - 1')
        img.subject_type = 'object'
        self.assertEqual(self.gn.download_basename(img), 'Objeto - Paris - Nova descrição - 1')
