"""Reprocessa vídeos da Galeria (normalização + thumbnail).

Serve para três coisas:
  1) Worker de fila: processa os que estão 'pending' (quando VIDEO_PROCESS_INLINE
     está desligado, ou algum upload não disparou a thread).
  2) Recuperação: destrava os presos em 'processing' (processo reiniciou no meio)
     e tenta de novo os 'failed' (--failed).
  3) Migração de arquivos antigos: vídeos enviados ANTES desta feature (status
     'ready' de origem, mas sem versão normalizada/thumbnail) — use --legacy.

Idempotente e seguro para rodar em paralelo/cron: cada item é reivindicado
atomicamente (só um worker processa por vez).

Exemplos:
    manage.py reprocess_videos --pending                 # a fila normal
    manage.py reprocess_videos --legacy --dry-run        # o que falta dos antigos
    manage.py reprocess_videos --legacy --batch 20       # migra 20 antigos
    manage.py reprocess_videos --failed                  # retenta os que falharam
    manage.py reprocess_videos --id 123 --force          # um item, forçando
"""
from django.core.management.base import BaseCommand
from django.db.models import Q

from itineraries.models import ItineraryImage
from itineraries import video_processing as vp
from itineraries.services import video as vsvc


class Command(BaseCommand):
    help = 'Normaliza vídeos da Galeria e gera thumbnails (fila, recuperação e migração de antigos).'

    def add_arguments(self, parser):
        parser.add_argument('--pending', action='store_true', help='Processa os status=pending.')
        parser.add_argument('--failed', action='store_true', help='Retenta os status=failed.')
        parser.add_argument('--legacy', action='store_true',
                            help='Vídeos antigos sem versão normalizada/thumbnail.')
        parser.add_argument('--only-missing', action='store_true',
                            help='Só os que não têm normalizado OU thumbnail (qualquer status).')
        parser.add_argument('--id', type=int, default=None, help='Processa um único item por id.')
        parser.add_argument('--force', action='store_true', help='Reprocessa mesmo os já prontos.')
        parser.add_argument('--batch', type=int, default=0, help='Limita a N itens (0 = todos).')
        parser.add_argument('--dry-run', action='store_true', help='Só lista o que faria.')
        parser.add_argument('--requeue-stuck', type=int, default=0, metavar='MIN',
                            help='Antes, destrava os presos em processing há > MIN minutos.')

    def handle(self, *args, **opts):
        if not vsvc.ffmpeg_available():
            self.stderr.write(self.style.ERROR(
                'ffmpeg/ffprobe não encontrados. Instale o FFmpeg (ou configure '
                'FFMPEG_BIN/FFPROBE_BIN) antes de reprocessar.'))
            return

        if opts['requeue_stuck']:
            n = vp.requeue_stuck(opts['requeue_stuck'])
            self.stdout.write(f'Destravados {n} preso(s) em processing.')

        qs = self._select(opts)
        total = qs.count()
        if opts['batch']:
            qs = qs[:opts['batch']]

        ids = list(qs.values_list('id', flat=True))
        self.stdout.write(self.style.NOTICE(
            f'{len(ids)} vídeo(s) selecionado(s) (de {total} elegível(is)).'))
        if opts['dry_run']:
            for pk in ids:
                img = ItineraryImage.objects.get(pk=pk)
                self.stdout.write(f'  [dry-run] #{pk} status={img.status} '
                                  f'orig={img.orig_name or img.image.name}')
            return

        # Antigos/incompletos entram como status='ready' herdado — precisam de force
        # para serem reivindicados e (re)gerar normalizado+thumbnail.
        force = opts['force'] or opts['legacy'] or opts['only_missing']
        ok = failed = skipped = 0
        for pk in ids:
            result = vp.process_video(pk, force=force)
            if result == 'ready':
                ok += 1
                self.stdout.write(self.style.SUCCESS(f'  ✓ #{pk} pronto'))
            elif result == 'failed':
                failed += 1
                img = ItineraryImage.objects.filter(pk=pk).first()
                self.stdout.write(self.style.ERROR(
                    f'  ✗ #{pk} falhou: {getattr(img, "error_message", "")[:120]}'))
            else:
                skipped += 1
                self.stdout.write(f'  – #{pk} pulado (já em processamento?)')

        self.stdout.write(self.style.NOTICE(
            f'Concluído: {ok} pronto(s), {failed} falha(s), {skipped} pulado(s).'))

    def _select(self, opts):
        """Monta o queryset dos vídeos-alvo conforme as flags."""
        base = ItineraryImage.objects.all()
        # Só arquivos de vídeo (pela extensão do original).
        vq = Q()
        for ext in ItineraryImage.VIDEO_EXTS:
            vq |= Q(image__iendswith=ext)
        base = base.filter(vq)

        if opts['id']:
            return base.filter(pk=opts['id'])
        if opts['only_missing']:
            return base.filter(Q(video_normalized='') | Q(video_normalized__isnull=True)
                               | Q(thumbnail='') | Q(thumbnail__isnull=True))
        if opts['legacy']:
            # Antigos: sem normalizado/thumbnail, independente do status herdado.
            return base.filter(Q(video_normalized='') | Q(video_normalized__isnull=True))
        conds = []
        if opts['pending']:
            conds.append(Q(status='pending'))
        if opts['failed']:
            conds.append(Q(status='failed'))
        if opts['force']:
            conds.append(Q(status='ready'))
        if not conds:
            # Padrão: pending + failed (a fila + retentativas).
            conds = [Q(status='pending'), Q(status='failed')]
        q = conds[0]
        for c in conds[1:]:
            q |= c
        return base.filter(q)
