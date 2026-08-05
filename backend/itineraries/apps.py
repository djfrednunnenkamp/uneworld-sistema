from django.apps import AppConfig


class ItinerariesConfig(AppConfig):
    name = 'itineraries'
    verbose_name = 'Roteiros'

    def ready(self):
        from . import signals  # noqa: F401  (propaga o nome do roteiro p/ a lista)
