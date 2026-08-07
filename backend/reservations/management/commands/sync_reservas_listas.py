"""Põe em dia as listas de passageiros com as reservas e os contratos.

Serve para o que já existia antes de a sincronização automática entrar: reservas
cujos lugares nunca chegaram à lista e contratos que deram nome a lugares
guardados sem que a lista soubesse. É idempotente — rodar de novo não duplica
nada —, então também vale como conserto quando algo ficou para trás.
"""
from django.core.management.base import BaseCommand

from contracts.models import Contract
from reservations.enrollment import sincronizar_contrato, sincronizar_lista
from reservations.models import Reservation

# Reservas que ainda seguram lugar. 'convertida' entra porque os lugares dela
# viraram (ou vão virar) as pessoas do contrato.
ATIVAS = ('pendente', 'paga', 'convertida')


class Command(BaseCommand):
    help = 'Sincroniza as listas de passageiros com as reservas e os contratos existentes.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Só mostra o que faria.')

    def handle(self, *args, **opts):
        seco = opts['dry_run']
        reservas = Reservation.objects.filter(is_deleted=False, status__in=ATIVAS).order_by('id')
        for res in reservas:
            if seco:
                self.stdout.write(f'reserva {res.id}: sincronizaria os quartos')
                continue
            pl, criadas = sincronizar_lista(res)
            destino = pl.name if pl else '(roteiro sem lista)'
            self.stdout.write(f'reserva {res.id} → {destino}: {len(criadas)} lugar(es)')

        contratos = (Contract.objects.filter(is_deleted=False, status='ativo',
                                             source_reservation__isnull=False).order_by('id'))
        for ct in contratos:
            if seco:
                self.stdout.write(f'contrato {ct.id}: levaria os nomes à lista')
                continue
            pl, mudou = sincronizar_contrato(ct)
            destino = pl.name if pl else '(roteiro sem lista)'
            self.stdout.write(f'contrato {ct.id} → {destino}: {mudou} nome(s)')

        self.stdout.write(self.style.SUCCESS('Listas em dia.'))
