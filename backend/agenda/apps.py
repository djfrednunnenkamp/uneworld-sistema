import os

from django.apps import AppConfig


class AgendaConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'agenda'
    verbose_name = 'Agenda'

    def ready(self):
        # RUN_MAIN só existe no processo filho do auto-reload do runserver (dev).
        # Em produção (Daphne, sem auto-reload) ele nunca é setado — por isso o
        # entrypoint do container define RUN_SCHEDULER=1 só no comando de servidor
        # de longa duração, nunca em comandos pontuais como migrate/shell.
        if os.environ.get('RUN_MAIN') != 'true' and os.environ.get('RUN_SCHEDULER') != '1':
            return
        from . import scheduler
        scheduler.start()
