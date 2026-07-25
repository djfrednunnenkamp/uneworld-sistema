"""Manutenção das exportações avançadas de vídeo (cache sob demanda).

  manage.py video_exports --purge-expired          # remove exports vencidos (arquivo + registro)
  manage.py video_exports --requeue-stuck          # marca 'failed' os presos (sem heartbeat)
  manage.py video_exports --process-pending        # processa a fila (worker sem thread inline)

Idempotente e seguro por cron. NUNCA toca no original nem no normalizado padrão.
"""
from django.core.management.base import BaseCommand

from itineraries import video_export as VE


class Command(BaseCommand):
    help = 'Manutenção das exportações de vídeo (purga de expirados, recuperação de presos, fila).'

    def add_arguments(self, parser):
        parser.add_argument('--purge-expired', action='store_true', help='Remove exports vencidos.')
        parser.add_argument('--requeue-stuck', action='store_true', help='Recupera exports presos.')
        parser.add_argument('--process-pending', action='store_true', help='Processa a fila (pending/failed).')
        parser.add_argument('--batch', type=int, default=0, help='Limita o process-pending a N.')

    def handle(self, *args, **opts):
        if opts['requeue_stuck']:
            n = VE.recover_stuck()
            self.stdout.write(f'Presos recuperados (→ failed): {n}')
        if opts['purge_expired']:
            n = VE.purge_expired()
            self.stdout.write(f'Exports expirados removidos: {n}')
        if opts['process_pending']:
            from itineraries.models import VideoExport
            qs = VideoExport.objects.filter(status__in=('pending', 'failed')).order_by('created_at')
            ids = list(qs.values_list('id', flat=True))
            if opts['batch']:
                ids = ids[:opts['batch']]
            ok = fail = 0
            for pk in ids:
                r = VE.process_export(pk)
                if r == 'ready':
                    ok += 1; self.stdout.write(self.style.SUCCESS(f'  ✓ export #{pk}'))
                elif r == 'failed':
                    fail += 1; self.stdout.write(self.style.ERROR(f'  ✗ export #{pk}'))
            self.stdout.write(f'Fila: {ok} pronto(s), {fail} falha(s).')
        if not any(opts[k] for k in ('purge_expired', 'requeue_stuck', 'process_pending')):
            self.stdout.write('Nada a fazer. Use --purge-expired / --requeue-stuck / --process-pending.')
