from django.core.management.base import BaseCommand

from contracts.views import _promote_paid_contracts


class Command(BaseCommand):
    help = ("Move os contratos 'Em pagamento' para 'Pagos' quando a última parcela já "
            "venceu. Rode diariamente por cron (a listagem também faz isso ao ser aberta).")

    def handle(self, *args, **options):
        ids = _promote_paid_contracts()
        self.stdout.write(self.style.SUCCESS(f'{len(ids)} contrato(s) movido(s) para Pagos: {ids}'))
