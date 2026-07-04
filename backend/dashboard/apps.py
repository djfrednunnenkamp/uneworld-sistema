from django.apps import AppConfig


class DashboardConfig(AppConfig):
    name = 'dashboard'

    def ready(self):
        import dashboard.signals  # noqa: F401
        # Limpeza de arquivos físicos ao excluir/trocar (cross-app).
        from core.file_cleanup import register_file_cleanup
        register_file_cleanup()
