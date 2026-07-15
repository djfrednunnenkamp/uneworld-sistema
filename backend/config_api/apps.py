from django.apps import AppConfig


class ConfigApiConfig(AppConfig):
    name = 'config_api'

    def ready(self):
        from . import signals  # noqa: F401  (registra os receivers de repontamento)
