"""Apaga os logs de auditoria além da retenção configurada no .env
(AUDIT_NAVIGATION_RETENTION_DAYS / AUDIT_CHANGE_RETENTION_DAYS). Vazio = infinito.

Roda automaticamente pelo agendador (agenda/scheduler.py), mas fica aqui também
para poda manual/teste:  python manage.py prune_audit_logs
"""
from django.core.management.base import BaseCommand

from audit.retention import prune_audit_logs


class Command(BaseCommand):
    help = 'Apaga os logs de auditoria mais antigos que a retenção configurada no .env.'

    def handle(self, *args, **options):
        n = prune_audit_logs()
        self.stdout.write(self.style.SUCCESS(f'{n} log(s) de auditoria apagado(s) pela retenção.'))
