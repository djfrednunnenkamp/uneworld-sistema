import os

from django.apps import AppConfig


class AgendaConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'agenda'
    verbose_name = 'Agenda'

    def ready(self):
        # Evita iniciar o agendador duas vezes por causa do auto-reload do runserver
        # (o processo "watcher" não tem RUN_MAIN=true).
        if os.environ.get('RUN_MAIN') != 'true':
            return
        from . import scheduler
        scheduler.start()
