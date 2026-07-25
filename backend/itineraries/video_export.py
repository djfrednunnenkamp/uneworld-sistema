"""Orquestração da EXPORTAÇÃO avançada (sob demanda + cache).

Fluxo: normaliza/valida as opções → hash → reusa export pronto/em processamento OU
cria um novo → processa em thread (claim atômico, heartbeat, progresso real,
validação) → grava o arquivo → 'ready' com expiração. Nunca roda duas conversões
idênticas ao mesmo tempo (dedup por `config_hash`). Não substitui original/padrão.

Segurança/limites: só constrói comando da allowlist (gallery_export_presets); limita
conversões simultâneas por usuário e no total; timeout por conversão.
"""
from __future__ import annotations

import logging
import os
import shutil
import tempfile
import threading
import time
from datetime import timedelta

from django.conf import settings
from django.core.files import File
from django.db import close_old_connections, connection, transaction
from django.utils import timezone

from . import gallery_export_presets as P
from .services import video as vsvc

logger = logging.getLogger(__name__)


class ExportBusy(Exception):
    """Limite de conversões simultâneas atingido."""


def _expiry():
    days = getattr(settings, 'VIDEO_EXPORT_EXPIRY_DAYS', 7)
    return timezone.now() + timedelta(days=days)


def source_path_for(video):
    """Arquivo de ORIGEM da exportação = o ORIGINAL (melhor qualidade). `+genpts`
    conserta timestamps na conversão."""
    return video.image


def create_or_reuse(video, config, user):
    """Retorna (export, created). Reusa export 'ready' (renova validade) ou
    'processing' (mesma config). Senão cria e agenda. Levanta ExportBusy se estourar
    o limite de conversões simultâneas."""
    from .models import VideoExport
    h = P.config_hash(video.pk, config)
    now = timezone.now()
    existing = (VideoExport.objects
                .filter(video=video, config_hash=h)
                .exclude(status='failed')
                .order_by('-created_at').first())
    if existing and existing.status == 'ready' and existing.file and existing.file.name:
        # renova a validade ao reusar
        VideoExport.objects.filter(pk=existing.pk).update(expires_at=_expiry(), last_downloaded_at=now)
        return existing, False
    if existing and existing.status in ('pending', 'processing'):
        return existing, False           # conecta ao processo existente

    # Limites de concorrência (anti-DoS).
    max_user = getattr(settings, 'VIDEO_EXPORT_MAX_PER_USER', 3)
    max_total = getattr(settings, 'VIDEO_EXPORT_MAX_TOTAL', 6)
    active = VideoExport.objects.filter(status__in=('pending', 'processing'))
    if active.count() >= max_total:
        raise ExportBusy('O servidor está ocupado com muitas conversões. Tente em instantes.')
    if user is not None and active.filter(requested_by=user).count() >= max_user:
        raise ExportBusy('Você já tem exportações em andamento. Aguarde concluir.')

    export = VideoExport.objects.create(
        video=video, requested_by=user, config_hash=h, status='pending', stage='queued',
        **config)
    schedule(export)
    return export, True


# ── progresso ────────────────────────────────────────────────────────────────

class _Reporter:
    def __init__(self, export_id, duration=0.0):
        self.export_id = export_id
        self.duration = duration or 0.0
        self.speed_ema = None
        self.last_write = 0.0
        self.last_progress = 0.0

    def _persist(self, fields, *, force=False, progress=None):
        from .models import VideoExport
        if progress is not None:
            progress = max(self.last_progress, min(100.0, progress))
            fields['progress'] = progress
        now = time.monotonic()
        advanced = progress is not None and (progress - self.last_progress) >= 3.0
        if not force and (now - self.last_write) < 1.0 and not advanced:
            return
        self.last_write = now
        if progress is not None:
            self.last_progress = progress
        fields['heartbeat_at'] = timezone.now()
        VideoExport.objects.filter(pk=self.export_id).update(**fields)

    def stage(self, name, *, eta=None, base=None):
        f = {'stage': name}
        if eta is not None:
            f['estimated_remaining_seconds'] = max(0.0, eta)
        self._persist(f, force=True, progress=base)

    def transcode(self, processed, speed):
        pct = 3.0
        if self.duration > 0:
            pct = 3.0 + min(1.0, max(0.0, processed / self.duration)) * 90.0   # 3..93
        if speed and speed > 0:
            self.speed_ema = speed if self.speed_ema is None else 0.3 * speed + 0.7 * self.speed_ema
        eta = None
        if self.duration > 0 and self.speed_ema and self.speed_ema > 0.01:
            eta = max(0.0, self.duration - processed) / self.speed_ema + 3.0
        f = {}
        if eta is not None:
            f['estimated_remaining_seconds'] = eta
        self._persist(f, progress=pct)


def claim(export_id):
    from .models import VideoExport
    from django.db.models import F
    n = (VideoExport.objects.filter(pk=export_id, status__in=['pending', 'failed'])
         .update(status='processing', started_at=timezone.now(), heartbeat_at=timezone.now(),
                 stage='queued', progress=0, error='', attempts=F('attempts') + 1))
    return bool(n)


def _fail(export_id, msg):
    from .models import VideoExport
    VideoExport.objects.filter(pk=export_id).update(
        status='failed', stage='failed', error=(msg or '')[:2000], finished_at=timezone.now(),
        heartbeat_at=timezone.now(), estimated_remaining_seconds=None)


def _audit(export, action, msg=''):
    try:
        from audit.tracking import log_event
        label = {'export_start': 'Exportação iniciada', 'export_done': 'Exportação concluída',
                 'export_fail': 'Falha na exportação', 'export_reuse': 'Exportação reutilizada (cache)',
                 'export_download': 'Download de exportação'}.get(action, action)
        log_event('update', model_name='VideoExport', model_label='Exportação de vídeo',
                  object_id=str(export.pk), object_repr=P.config_summary(export.config()),
                  changes={label: msg or P.config_summary(export.config())},
                  user=getattr(export, 'requested_by', None))
    except Exception:
        logger.debug('falha ao auditar export', exc_info=True)


def process_export(export_id, *, claimed=False):
    """Converte UMA exportação. Retorna 'ready'|'failed'|'skipped'. Nunca levanta."""
    from .models import VideoExport
    if not claimed and not claim(export_id):
        return 'skipped'
    try:
        export = VideoExport.objects.select_related('video').get(pk=export_id)
    except VideoExport.DoesNotExist:
        return 'skipped'

    if not vsvc.ffmpeg_available():
        _fail(export_id, 'Processamento de vídeo indisponível no servidor.')
        return 'failed'

    config = export.config()
    ffmpeg = vsvc._bin('FFMPEG_BIN', 'ffmpeg')
    rep = _Reporter(export_id)
    src_field = source_path_for(export.video)
    tmpdir = tempfile.mkdtemp(prefix='videxport_')
    local_src = None
    _audit(export, 'export_start', P.config_summary(config))
    t0 = time.monotonic()
    try:
        rep.stage('probing', base=1.0)
        src_path = getattr(src_field, 'path', None)
        if src_path and os.path.exists(src_path):
            work_src = src_path
        else:
            local_src = os.path.join(tmpdir, 'src' + (os.path.splitext(src_field.name or '')[1] or '.bin'))
            with src_field.open('rb') as fh, open(local_src, 'wb') as out:
                for chunk in fh.chunks():
                    out.write(chunk)
            work_src = local_src
        info = vsvc.probe(work_src)
        rep.duration = info.duration or 0.0

        rep.stage('transcoding', base=3.0)
        out_path = os.path.join(tmpdir, 'out' + P.container_ext(config))
        cmd = P.build_command(ffmpeg, work_src, out_path, config, target_fps=None)
        vsvc._run_with_progress(cmd, timeout=getattr(settings, 'VIDEO_EXPORT_TIMEOUT', 3600),
                                step='exportar o vídeo', on_progress=rep.transcode)

        rep.stage('validating', eta=3.0, base=94.0)
        out_info = P.validate_output(out_path, config)
        if info.duration and out_info.duration and abs(out_info.duration - info.duration) > max(2.0, info.duration * 0.2):
            raise vsvc.VideoError(
                f'Duração inconsistente ({out_info.duration:.1f}s vs {info.duration:.1f}s).')

        rep.stage('finalizing', eta=1.0, base=98.0)
        size = os.path.getsize(out_path)
        with transaction.atomic():
            fresh = VideoExport.objects.select_for_update().get(pk=export_id)
            try:
                if fresh.file and fresh.file.name:
                    fresh.file.delete(save=False)
            except Exception:
                pass
            with open(out_path, 'rb') as f:
                fresh.file.save('e' + P.container_ext(config), File(f), save=False)
            fresh.file_size = size
            fresh.status = 'ready'
            fresh.stage = 'completed'
            fresh.progress = 100.0
            fresh.estimated_remaining_seconds = 0
            fresh.error = ''
            fresh.heartbeat_at = timezone.now()
            fresh.finished_at = timezone.now()
            fresh.expires_at = _expiry()
            fresh.save(update_fields=['file', 'file_size', 'status', 'stage', 'progress',
                                      'estimated_remaining_seconds', 'error', 'heartbeat_at',
                                      'finished_at', 'expires_at'])
        _audit(export, 'export_done', f'{P.config_summary(config)} · {size} bytes em {time.monotonic()-t0:.0f}s')
        logger.info('export #%s pronto em %.0fs (%s, %s bytes)', export_id, time.monotonic()-t0,
                    P.config_summary(config), size)
        _notify()
        return 'ready'
    except vsvc.VideoError as e:
        _fail(export_id, str(e)); _audit(export, 'export_fail', str(e)); _notify()
        logger.warning('export #%s falhou: %s', export_id, e)
        return 'failed'
    except Exception as e:
        logger.exception('erro inesperado na export #%s', export_id)
        _fail(export_id, 'Erro interno na exportação.'); _audit(export, 'export_fail', type(e).__name__); _notify()
        return 'failed'
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _notify():
    try:
        from dashboard.signals import _broadcast
        _broadcast('gallery')
    except Exception:
        pass


def _thread_target(export_id):
    close_old_connections()
    try:
        process_export(export_id, claimed=True)
    except Exception:
        logger.exception('thread de export #%s morreu', export_id)
        try:
            _fail(export_id, 'Erro interno na exportação.')
        except Exception:
            pass
    finally:
        try:
            connection.close()
        except Exception:
            pass


def schedule(export):
    if not getattr(settings, 'VIDEO_PROCESS_INLINE', True):
        return                       # deixa p/ um worker/cron externo
    if not claim(export.pk):
        return
    t = threading.Thread(target=_thread_target, args=(export.pk,), daemon=True, name=f'videxport-{export.pk}')
    transaction.on_commit(t.start)


# ── manutenção: presos + expirados ─────────────────────────────────────────────

def recover_stuck(heartbeat_timeout=None):
    from .models import VideoExport
    from django.db.models import Q
    timeout = heartbeat_timeout if heartbeat_timeout is not None else getattr(settings, 'VIDEO_STUCK_HEARTBEAT_SECONDS', 120)
    cutoff = timezone.now() - timedelta(seconds=timeout)
    stuck = VideoExport.objects.filter(status='processing').filter(
        Q(heartbeat_at__lt=cutoff) | Q(heartbeat_at__isnull=True, started_at__lt=cutoff))
    n = 0
    for e in stuck:
        _fail(e.pk, 'Processamento interrompido. Tente novamente.'); n += 1
    return n


def purge_expired():
    """Remove exports expirados (arquivo + registro). NUNCA toca no original/normalizado."""
    from .models import VideoExport
    now = timezone.now()
    qs = VideoExport.objects.filter(status='ready', expires_at__lt=now)
    n = qs.count()
    for e in qs:                     # .delete() dispara a limpeza do arquivo (file_cleanup)
        e.delete()
    return n
