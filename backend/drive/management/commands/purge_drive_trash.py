"""Apaga de vez os documentos na lixeira do Drive há mais de N dias (padrão 30).

Roda automaticamente pelo agendador (agenda/scheduler.py), mas fica aqui também
para expurgo manual/teste:  python manage.py purge_drive_trash [--days 30]
"""
from django.core.management.base import BaseCommand

from drive.trash import purge_expired


class Command(BaseCommand):
    help = 'Apaga definitivamente os itens da lixeira do Drive mais antigos que N dias (padrão 30).'

    def add_arguments(self, parser):
        parser.add_argument('--days', type=int, default=30, help='Idade mínima na lixeira, em dias.')

    def handle(self, *args, **options):
        days = options['days']
        n = purge_expired(days=days)
        self.stdout.write(self.style.SUCCESS(f'{n} item(ns) expurgado(s) da lixeira do Drive (>{days} dias).'))
