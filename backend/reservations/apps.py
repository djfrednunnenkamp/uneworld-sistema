from django.apps import AppConfig


class ReservationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'reservations'
    verbose_name = 'Reservas'

    def ready(self):
        from . import signals  # noqa: F401  (registra os receivers reserva↔contrato)
