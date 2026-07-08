from django.apps import AppConfig


class VouchersConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'vouchers'
    verbose_name = 'Vouchers'

    def ready(self):
        from . import signals  # noqa: F401  (registra a criação automática do voucher)
