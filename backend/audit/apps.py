from django.apps import AppConfig


class AuditConfig(AppConfig):
    name = 'audit'
    verbose_name = 'Auditoria'

    def ready(self):
        import audit.tracking  # noqa — registra os sinais Django
