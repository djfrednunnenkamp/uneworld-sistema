from django.apps import AppConfig


class ConfigApiConfig(AppConfig):
    name = 'config_api'

    def ready(self):
        from . import signals  # noqa: F401  (registra os receivers de repontamento)
        # Avisa se o servidor ficou sem HEIC/AVIF (pipeline central de imagem).
        from django.core.checks import register
        from core.images import check_image_codecs
        register(check_image_codecs)
