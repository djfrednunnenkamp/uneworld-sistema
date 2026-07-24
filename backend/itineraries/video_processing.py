"""Orquestração do processamento de vídeo da Galeria.

Fluxo de um vídeo (ItineraryImage com `image` = arquivo de vídeo original):

  pending ──(claim)──▶ processing ──(sucesso)──▶ ready
                              └────────(falha)──▶ failed

Etapas (progresso real, com barra na interface):
  queued → probing → transcoding → validating → generating_thumbnail →
  finalizing → completed | failed

Garantias:
  * CLAIM ATÔMICO: só um worker processa um registro por vez (UPDATE condicional
    no status). Idempotente e seguro para thread + comando de gerência simultâneos.
  * ESCRITA ATÔMICA: o MP4 normalizado e a thumbnail são gerados em arquivos
    TEMPORÁRIOS, validados, e só então gravados nos campos do modelo. Uma falha
    nunca deixa um arquivo parcial sendo servido como pronto.
  * FAIL-FAST: sem ffmpeg/ffprobe, ou qualquer exceção, o registro vira 'failed'
    (nunca fica preso em 'processing').
  * HEARTBEAT: durante o trabalho, `processing_heartbeat_at` + progresso são
    atualizados de forma controlada (~1x/s). Um 'processing' sem heartbeat recente
    é considerado ABANDONADO e recuperado (recover_stuck).
  * O arquivo ORIGINAL (`image`) NUNCA é apagado aqui — fonte para reprocessar.

Sem worker dedicado (Celery/RQ): quando `VIDEO_PROCESS_INLINE=True` (padrão), o
upload dispara uma THREAD de fundo (não bloqueia a requisição). O comando
`manage.py reprocess_videos` cobre presos/antigos/falhados (cron, deploy, recuperação).
"""
from __future__ import annotations

import logging
import os
import shutil
import tempfile
import threading
import time

from django.conf import settings
from django.core.files import File
from django.db import close_old_connections, connection, transaction
from django.db.models import Q
from django.utils import timezone

from .services import video as vsvc

logger = logging.getLogger(__name__)


def _audit(action, img, msg=''):
    """Best-effort no Log do Sistema (nunca interrompe o processamento)."""
    try:
        from audit.tracking import log_event
        label = {'process_start': 'Processamento iniciado',
                 'process_done':  'Processamento concluído',
                 'process_fail':  'Falha no processamento'}.get(action, action)
        changes = {label: msg or ('vídeo #%s' % img.pk)}
        log_event('update', model_name='ItineraryImage', model_label='Galeria de mídia',
                  object_id=str(img.pk), object_repr=(img.orig_name or f'vídeo #{img.pk}'),
                  changes=changes)
    except Exception:
        logger.debug('Falha ao auditar %s do vídeo #%s', action, getattr(img, 'pk', '?'), exc_info=True)


# ── barras de progresso por etapa ──────────────────────────────────────────────
# O usuário deve perceber o trabalho COMPLETO (não só o FFmpeg). Distribuímos o
# 0–100 pelas etapas; a transcodificação (a mais longa) ocupa a maior faixa.
_STAGE_START = {
    'queued': 0.0, 'probing': 2.0, 'transcoding': 5.0, 'validating': 85.0,
    'generating_thumbnail': 92.0, 'finalizing': 97.0, 'completed': 100.0,
}
_TRANSCODE_LO, _TRANSCODE_HI = 5.0, 85.0


class _Reporter:
    """Persiste etapa/progresso/heartbeat/ETA de forma CONTROLADA (throttled) e
    MONOTÔNICA (o percentual nunca regride). Emite WS na troca de etapa."""

    def __init__(self, image_id, duration=0.0):
        self.image_id = image_id
        self.duration = duration or 0.0
        self.speed_ema = None
        self.last_write = 0.0
        self.last_progress = 0.0

    def _persist(self, fields, *, force=False, progress=None):
        # Monotônico: nunca grava um progresso menor que o já registrado.
        if progress is not None:
            progress = max(self.last_progress, min(100.0, progress))
            fields['processing_progress'] = progress
        now = time.monotonic()
        advanced = progress is not None and (progress - self.last_progress) >= 3.0
        if not force and (now - self.last_write) < 1.0 and not advanced:
            return
        self.last_write = now
        if progress is not None:
            self.last_progress = progress
        fields['processing_heartbeat_at'] = timezone.now()
        from .models import ItineraryImage
        ItineraryImage.objects.filter(pk=self.image_id).update(**fields)

    def stage(self, name, *, eta=None):
        """Troca de etapa: grava sempre (force) e avisa o front por WS."""
        fields = {'processing_stage': name}
        if eta is not None:
            fields['estimated_remaining_seconds'] = max(0.0, eta)
        self._persist(fields, force=True, progress=_STAGE_START.get(name, self.last_progress))
        _notify_gallery()

    def transcode(self, processed_seconds, speed):
        """Callback do FFmpeg durante a conversão (throttled ~1x/s)."""
        pct = _TRANSCODE_LO
        if self.duration > 0:
            frac = min(1.0, max(0.0, processed_seconds / self.duration))
            pct = _TRANSCODE_LO + frac * (_TRANSCODE_HI - _TRANSCODE_LO)
        if speed and speed > 0:
            self.speed_ema = speed if self.speed_ema is None else 0.3 * speed + 0.7 * self.speed_ema
        eta = None
        if self.duration > 0 and self.speed_ema and self.speed_ema > 0.01:
            remaining_video = max(0.0, self.duration - processed_seconds)
            # tempo de parede restante + folga para validar/thumb/finalizar
            eta = remaining_video / self.speed_ema + max(2.0, self.duration * 0.05)
        fields = {}
        if self.speed_ema is not None:
            fields['processing_speed'] = round(self.speed_ema, 3)
        if eta is not None:
            fields['estimated_remaining_seconds'] = max(0.0, eta)
        self._persist(fields, progress=pct)


def claim(image_id: int, *, force: bool = False) -> bool:
    """Marca o registro como 'processing' de forma atômica e conta a tentativa.
    Retorna True se ESTE chamador conseguiu o claim. `force=True` também reprocessa
    itens 'ready'."""
    from .models import ItineraryImage
    from django.db.models import F
    eligible = ['pending', 'failed'] + (['ready'] if force else [])
    updated = (ItineraryImage.objects
               .filter(pk=image_id, status__in=eligible)
               .update(status='processing', processing_started_at=timezone.now(),
                       processing_finished_at=None, processing_heartbeat_at=timezone.now(),
                       processing_stage='queued', processing_progress=0,
                       estimated_remaining_seconds=None, processing_speed=None,
                       error_message='', processing_attempts=F('processing_attempts') + 1))
    return bool(updated)


def process_video(image_id: int, *, force: bool = False, claimed: bool = False) -> str:
    """Processa UM vídeo: inspeciona → normaliza → valida → thumbnail → grava.
    Retorna o status final ('ready' | 'failed' | 'skipped'). Nunca levanta."""
    from .models import ItineraryImage

    if not claimed and not claim(image_id, force=force):
        return 'skipped'

    try:
        img = ItineraryImage.objects.get(pk=image_id)
    except ItineraryImage.DoesNotExist:
        return 'skipped'

    if not img.is_video:
        ItineraryImage.objects.filter(pk=image_id).update(status='ready', processing_stage='completed',
                                                          processing_progress=100)
        return 'ready'

    # FAIL-FAST: sem ffmpeg/ffprobe não adianta seguir — não deixa preso em processing.
    if not vsvc.ffmpeg_available():
        bins = vsvc.resolved_binaries()
        logger.error('FFmpeg indisponível ao processar vídeo #%s. Resolvido: ffmpeg=%s ffprobe=%s',
                     image_id, bins.get('ffmpeg'), bins.get('ffprobe'))
        _fail(image_id, 'O processamento de vídeo está indisponível no servidor '
                        '(ffmpeg não encontrado). Avise o suporte.')
        _audit('process_fail', img, 'ffmpeg indisponível no processo Django')
        _notify_gallery()
        return 'failed'

    _audit('process_start', img, f'{img.orig_name or img.image.name} ({img.orig_size or "?"} bytes)')
    logger.info('vídeo #%s: início do processamento (tentativa %s)', image_id, img.processing_attempts)

    rep = _Reporter(image_id)
    src_path = getattr(img.image, 'path', None)
    tmpdir = tempfile.mkdtemp(prefix='vidproc_')
    local_src = None
    t0 = time.monotonic()
    try:
        # 1) Garante um caminho local do original (storages remotos → baixa p/ tmp).
        rep.stage('probing')
        if src_path and os.path.exists(src_path):
            work_src = src_path
        else:
            local_src = os.path.join(tmpdir, 'src' + (os.path.splitext(img.image.name or '')[1] or '.bin'))
            with img.image.open('rb') as fh, open(local_src, 'wb') as out:
                for chunk in fh.chunks():
                    out.write(chunk)
            work_src = local_src

        # 2) Inspeção do ORIGINAL (fonte da verdade — nunca confia na extensão).
        info = vsvc.probe(work_src)
        rep.duration = info.duration or 0.0

        # 3) Normalização com PROGRESSO REAL (corrige timestamps, faststart, yuv420p…).
        rep.stage('transcoding')
        out_mp4 = os.path.join(tmpdir, 'out.mp4')
        vsvc.normalize(work_src, out_mp4, on_progress=rep.transcode)

        # 4) Validação do RESULTADO antes de publicar (não serve arquivo quebrado).
        rep.stage('validating', eta=max(2.0, rep.duration * 0.05))
        out_info = vsvc.validate_output(out_mp4)

        # 5) Sanidade de duração — a conversão não pode ter cortado/acelerado o vídeo.
        if info.duration and out_info.duration:
            drift = abs(out_info.duration - info.duration)
            if drift > max(2.0, info.duration * 0.15):
                raise vsvc.VideoError(
                    f'Duração inconsistente após a conversão ({out_info.duration:.1f}s '
                    f'vs {info.duration:.1f}s esperados).')

        # 6) Thumbnail de um frame real (evita frame 0 preto).
        rep.stage('generating_thumbnail', eta=2.0)
        out_thumb = os.path.join(tmpdir, 'thumb.jpg')
        vsvc.make_thumbnail(out_mp4, out_thumb, duration=out_info.duration)

        # 7) GRAVAÇÃO ATÔMICA: só agora escreve nos campos e marca 'ready' (100%).
        rep.stage('finalizing', eta=1.0)
        dw, dh = out_info.display_dims
        with transaction.atomic():
            fresh = ItineraryImage.objects.select_for_update().get(pk=image_id)
            for old in (fresh.video_normalized, fresh.thumbnail):
                try:
                    if old and old.name:
                        old.delete(save=False)
                except Exception:
                    pass
            with open(out_mp4, 'rb') as f:
                fresh.video_normalized.save('n.mp4', File(f), save=False)
            with open(out_thumb, 'rb') as f:
                fresh.thumbnail.save('t.jpg', File(f), save=False)
            fresh.duration = out_info.duration
            fresh.width = dw or None
            fresh.height = dh or None
            fresh.codec = (info.codec or '')[:40]
            fresh.detected_mime = 'video/mp4'
            fresh.status = 'ready'
            fresh.error_message = ''
            fresh.processing_stage = 'completed'
            fresh.processing_progress = 100.0
            fresh.estimated_remaining_seconds = 0
            fresh.processing_heartbeat_at = timezone.now()
            fresh.processing_finished_at = timezone.now()
            fresh.save(update_fields=[
                'video_normalized', 'thumbnail', 'duration', 'width', 'height',
                'codec', 'detected_mime', 'status', 'error_message', 'processing_stage',
                'processing_progress', 'estimated_remaining_seconds',
                'processing_heartbeat_at', 'processing_finished_at'])
        elapsed = time.monotonic() - t0
        _audit('process_done', img, f'{dw}x{dh}, {out_info.duration:.1f}s em {elapsed:.0f}s')
        logger.info('vídeo #%s: pronto em %.0fs (%sx%s, %.1fs)', image_id, elapsed, dw, dh, out_info.duration or 0)
        _notify_gallery()
        return 'ready'

    except vsvc.VideoError as e:
        _fail(image_id, str(e))
        _audit('process_fail', img, str(e))
        logger.warning('vídeo #%s: falha — %s', image_id, e)
        _notify_gallery()
        return 'failed'
    except Exception as e:  # defensivo: QUALQUER exceção termina em 'failed'
        logger.exception('Erro inesperado ao processar vídeo #%s', image_id)
        _fail(image_id, 'Erro interno ao processar o vídeo.')
        _audit('process_fail', img, f'erro interno: {type(e).__name__}')
        _notify_gallery()
        return 'failed'
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _fail(image_id: int, message: str):
    from .models import ItineraryImage
    ItineraryImage.objects.filter(pk=image_id).update(
        status='failed', processing_stage='failed', error_message=message[:2000],
        estimated_remaining_seconds=None, processing_heartbeat_at=timezone.now(),
        processing_finished_at=timezone.now())


def _notify_gallery():
    """Avisa o front (WebSocket) que a galeria mudou — mesmo canal usado nos outros
    pontos que alteram a galeria; o card/modal trocam sozinhos. É o caminho INSTANTÂNEO;
    o polling do modal é a garantia caso o evento se perca."""
    try:
        from dashboard.signals import _broadcast
        _broadcast('gallery')
    except Exception:
        logger.debug('Sem broadcast de galeria (WS indisponível).', exc_info=True)


# ── Detecção/recuperação de processamento ABANDONADO (heartbeat) ────────────────

def is_stuck(img) -> bool:
    """True se o registro está 'processing' mas sem sinal de vida recente
    (heartbeat), ou seja: a thread/processo morreu. Baseado em HEARTBEAT, não na
    duração total — vídeos grandes demoram, mas continuam emitindo heartbeat."""
    if img.status != 'processing':
        return False
    hb = img.processing_heartbeat_at or img.processing_started_at
    if hb is None:
        return True
    timeout = getattr(settings, 'VIDEO_STUCK_HEARTBEAT_SECONDS', 120)
    return (timezone.now() - hb).total_seconds() > timeout


def recover_stuck(heartbeat_timeout: int | None = None) -> dict:
    """Regra CENTRALIZADA de recuperação: registros 'processing' sem heartbeat há
    mais que o limite são reenfileirados ('pending') se ainda houver tentativas,
    ou marcados 'failed' se excederem o máximo. Retorna {'requeued', 'failed'}."""
    from datetime import timedelta
    from .models import ItineraryImage
    timeout = heartbeat_timeout if heartbeat_timeout is not None else getattr(
        settings, 'VIDEO_STUCK_HEARTBEAT_SECONDS', 120)
    max_attempts = getattr(settings, 'VIDEO_MAX_PROCESSING_ATTEMPTS', 3)
    cutoff = timezone.now() - timedelta(seconds=timeout)
    stuck = ItineraryImage.objects.filter(status='processing').filter(
        Q(processing_heartbeat_at__lt=cutoff)
        | Q(processing_heartbeat_at__isnull=True, processing_started_at__lt=cutoff)
        | Q(processing_heartbeat_at__isnull=True, processing_started_at__isnull=True))
    requeued = failed = 0
    for img in stuck:
        if (img.processing_attempts or 0) >= max_attempts:
            _fail(img.pk, 'O processamento foi interrompido e excedeu as tentativas. '
                          'Tente processar novamente.')
            failed += 1
            logger.warning('vídeo #%s: preso e sem tentativas — marcado failed', img.pk)
        else:
            n = ItineraryImage.objects.filter(pk=img.pk, status='processing').update(
                status='pending', processing_stage='queued', estimated_remaining_seconds=None)
            if n:
                requeued += 1
                logger.warning('vídeo #%s: preso (sem heartbeat) — reenfileirado', img.pk)
    return {'requeued': requeued, 'failed': failed}


def requeue_stuck(older_than_minutes: int = 30) -> int:
    """Compat: reenfileira presos usando a regra centralizada (heartbeat). O
    parâmetro em minutos vira o limite de heartbeat, se informado."""
    timeout = older_than_minutes * 60 if older_than_minutes else None
    r = recover_stuck(heartbeat_timeout=timeout)
    return r['requeued'] + r['failed']


# ── Disparo em background (sem worker dedicado) ─────────────────────────────────

def _thread_target(image_id: int, force: bool):
    # Cada thread usa a PRÓPRIA conexão DB; fecha conexões velhas herdadas ao entrar
    # e a sua ao sair (evita conexões penduradas / "server closed connection").
    close_old_connections()
    try:
        process_video(image_id, force=force, claimed=True)
    except Exception:  # blindagem final: nunca deixa a thread morrer silenciosa
        logger.exception('Thread de vídeo #%s morreu inesperadamente', image_id)
        try:
            _fail(image_id, 'Erro interno ao processar o vídeo.')
        except Exception:
            pass
    finally:
        try:
            connection.close()
        except Exception:
            pass


def schedule_processing(img, *, force: bool = False):
    """Coloca o vídeo para processar. Faz o CLAIM já na thread da request (para o
    status virar 'processing' imediatamente na resposta) e dispara o trabalho pesado
    numa thread de fundo. Com `VIDEO_PROCESS_INLINE=False`, apenas garante 'pending'
    e deixa o comando de gerência (cron/worker) processar."""
    if not getattr(settings, 'VIDEO_PROCESS_INLINE', True):
        from .models import ItineraryImage
        ItineraryImage.objects.filter(pk=img.pk).update(status='pending', processing_stage='queued')
        return
    if not claim(img.pk, force=force):
        return  # já está sendo processado
    t = threading.Thread(target=_thread_target, args=(img.pk, force), daemon=True,
                         name=f'vidproc-{img.pk}')
    # on_commit: só inicia a thread DEPOIS que a transação da request comitar (para a
    # thread, na sua própria conexão, enxergar o registro). Fora de transação
    # (autocommit, o caso atual) roda na hora. Robusto mesmo se ATOMIC_REQUESTS ligar.
    transaction.on_commit(t.start)
