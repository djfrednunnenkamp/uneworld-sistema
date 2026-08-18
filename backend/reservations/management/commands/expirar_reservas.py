"""Derruba as reservas sem pagamento que passaram do prazo.

As telas do hub já fazem isso ao abrir (verificação preguiçosa, ver
`ReservationViewSet.expirar_vencidas`), mas o estoque não pode depender de
alguém abrir uma tela: com o hub fechado a noite toda, a vaga continuaria
presa a uma reserva que já caiu. Agende este comando.
"""
from django.core.management.base import BaseCommand

from reservations.views import ReservationViewSet


class Command(BaseCommand):
    help = 'Expira as reservas vencidas (solta o estoque, tira da lista e some do hub).'

    def handle(self, *args, **opts):
        n = ReservationViewSet.expirar_vencidas()
        self.stdout.write(self.style.SUCCESS(f'{n} reserva(s) expirada(s).'))
