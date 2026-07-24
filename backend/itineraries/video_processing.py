"""Orquestração do processamento de vídeo da Galeria.

Fluxo de um vídeo (ItineraryImage com `image` = arquivo de vídeo original):

  pending ──(claim)──▶ processing ──(sucesso)──▶ ready
                              └────────(falha)──▶ failed

Garantias:
  * CLAIM ATÔMICO: só um worker processa um registro por vez (UPDATE condicional
    no status). Idempotente e seguro para thread + comando de gerência simultâneos.
  * ESCRITA ATÔMICA: o MP4 normalizado e a thumbnail são gerados em arquivos
    TEMPORÁRIOS, validados, e só então gravados nos campos do modelo. Uma falha
    nunca deixa um arquivo parcial sendo servido como pronto.
  * O arquivo ORIGINAL (`image`) NUNCA é apagado aqui — fica como fonte para
    reprocessar. A limpeza dos temporários é sempre feita (finally).
  * Auditoria: registra início/fim/falha no Log do Sistema.

Sem worker dedicado (Celery/RQ): quando `VIDEO_PROCESS_INLINE=True`, o upload
dispara uma THREAD de fundo. O comando `manage.py reprocess_videos` cobre os
presos/antigos/falhados (cron, deploy, recuperação após reinício).
"""
from __future__ import annotations

import logging
import os
import tempfile
import threading

from django.conf import settings
from django.core.files import File
from django.db import connection, transaction
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


def claim(image_id: int, *, force: bool = False) -> bool:
    """Marca o registro como 'processing' de forma atômica. Retorna True se ESTE
    chamador conseguiu o claim (deve processar), False se outro já está cuidando
    ou o registro não é elegível. `force=True` também reprocessa itens 'ready'."""
    from .models import ItineraryImage
    eligible = ['pending', 'failed'] + (['ready'] if force else [])
    updated = (ItineraryImage.objects
               .filter(pk=image_id, status__in=eligible)
               .update(status='processing', processing_started_at=timezone.now(),
                       processing_finished_at=None, error_message=''))
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
        # Não é vídeo (imagem) — não deveria chegar aqui; normaliza o status.
        ItineraryImage.objects.filter(pk=image_id).update(status='ready')
        return 'ready'

    _audit('process_start', img, f'{img.orig_name or img.image.name} ({img.orig_size or "?"} bytes)')

    src_path = getattr(img.image, 'path', None)
    tmpdir = tempfile.mkdtemp(prefix='vidproc_')
    local_src = None
    try:
        # 1) Garante um caminho local do original (storages remotos → baixa p/ tmp).
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

        # 3) Normalização → MP4 tocável (corrige timestamps, faststart, yuv420p…).
        out_mp4 = os.path.join(tmpdir, 'out.mp4')
        vsvc.normalize(work_src, out_mp4)

        # 4) Validação do RESULTADO antes de publicar (não serve arquivo quebrado).
        out_info = vsvc.validate_output(out_mp4)

        # 5) Sanidade de duração — a conversão não pode ter cortado/acelerado o vídeo.
        if info.duration and out_info.duration:
            drift = abs(out_info.duration - info.duration)
            if drift > max(2.0, info.duration * 0.15):
                raise vsvc.VideoError(
                    f'Duração inconsistente após a conversão ({out_info.duration:.1f}s '
                    f'vs {info.duration:.1f}s esperados).')

        # 6) Thumbnail de um frame real (evita frame 0 preto).
        out_thumb = os.path.join(tmpdir, 'thumb.jpg')
        vsvc.make_thumbnail(out_mp4, out_thumb, duration=out_info.duration)

        # 7) GRAVAÇÃO ATÔMICA: só agora escreve nos campos e marca 'ready'.
        dw, dh = out_info.display_dims
        with transaction.atomic():
            fresh = ItineraryImage.objects.select_for_update().get(pk=image_id)
            # Remove arquivos antigos (reprocessamento) antes de anexar os novos.
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
            fresh.processing_finished_at = timezone.now()
            fresh.save(update_fields=[
                'video_normalized', 'thumbnail', 'duration', 'width', 'height',
                'codec', 'detected_mime', 'status', 'error_message', 'processing_finished_at'])
        _audit('process_done', img, f'{dw}x{dh}, {out_info.duration:.1f}s')
        _notify_gallery()
        return 'ready'

    except vsvc.VideoError as e:
        _fail(image_id, str(e))
        _audit('process_fail', img, str(e))
        _notify_gallery()
        return 'failed'
    except Exception as e:  # pragma: no cover — defensivo
        logger.exception('Erro inesperado ao processar vídeo #%s', image_id)
        _fail(image_id, 'Erro interno ao processar o vídeo.')
        _audit('process_fail', img, f'erro interno: {type(e).__name__}')
        _notify_gallery()
        return 'failed'
    finally:
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)


def _fail(image_id: int, message: str):
    from .models import ItineraryImage
    ItineraryImage.objects.filter(pk=image_id).update(
        status='failed', error_message=message[:2000], processing_finished_at=timezone.now())


def _notify_gallery():
    """Avisa o front (WebSocket) que a galeria mudou — mesmo canal usado nos outros
    pontos que alteram a galeria; assim o card troca de 'processando' para
    pronto/erro sozinho, sem o usuário recarregar."""
    try:
        from dashboard.signals import _broadcast
        _broadcast('gallery')
    except Exception:
        logger.debug('Sem broadcast de galeria (WS indisponível).', exc_info=True)


# ── Disparo em background (sem worker dedicado) ─────────────────────────────────

def _thread_target(image_id: int, force: bool):
    try:
        process_video(image_id, force=force, claimed=True)
    finally:
        # Fecha a conexão DB desta thread (evita conexões penduradas).
        try:
            connection.close()
        except Exception:
            pass


def schedule_processing(img, *, force: bool = False):
    """Coloca o vídeo para processar. Faz o CLAIM já na thread da request (para o
    status virar 'processing' imediatamente na resposta), e dispara o trabalho
    pesado numa thread de fundo. Se `VIDEO_PROCESS_INLINE=False`, apenas garante
    o status 'pending' e deixa o comando de gerência processar."""
    if not getattr(settings, 'VIDEO_PROCESS_INLINE', True):
        from .models import ItineraryImage
        ItineraryImage.objects.filter(pk=img.pk).update(status='pending')
        return
    if not claim(img.pk, force=force):
        return  # já está sendo processado
    t = threading.Thread(target=_thread_target, args=(img.pk, force), daemon=True,
                         name=f'vidproc-{img.pk}')
    t.start()


def requeue_stuck(older_than_minutes: int = 30) -> int:
    """Volta para 'pending' os registros presos em 'processing' há muito tempo
    (ex.: processo reiniciou no meio). Retorna quantos foram destravados."""
    from datetime import timedelta
    from .models import ItineraryImage
    cutoff = timezone.now() - timedelta(minutes=older_than_minutes)
    return (ItineraryImage.objects
            .filter(status='processing', processing_started_at__lt=cutoff)
            .update(status='pending'))
