from django.apps import AppConfig


class AuditConfig(AppConfig):
    name = 'audit'
    verbose_name = 'Auditoria'

    def ready(self):
        import audit.tracking  # noqa — registra os sinais Django
        # Detecta (loud) colisões de nome de modelo rastreado entre apps — a whitelist
        # é chaveada pelo nome puro; uma colisão futura seria silenciosa sem isto.
        try:
            audit.tracking.check_tracked_model_collisions()
        except Exception:
            pass
