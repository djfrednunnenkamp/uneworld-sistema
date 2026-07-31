"""Ciclo de vida reserva ↔ contrato.

A reserva vive no hub enquanto NÃO virou contrato ("Reservas") ou enquanto o
contrato ainda está em processo ("Contratadas"). Quando o contrato entra em
PAGAMENTO (stage 'em_pagamento') — ou é faturado/excluído — a reserva perde a
função e é REMOVIDA (soft-delete) do hub. A partir daí o contrato é a fonte da
verdade.
"""
from django.db.models.signals import post_save, pre_delete
from django.dispatch import receiver
from django.utils import timezone

from contracts.models import Contract

# Etapas em que a reserva já não deve mais aparecer no hub.
_DROP_STAGES = ('em_pagamento', 'faturado')


def _drop_reservations(contract):
    from .models import Reservation
    Reservation.objects.filter(contract=contract, is_deleted=False).update(
        is_deleted=True, deleted_at=timezone.now(), updated_at=timezone.now())


@receiver(post_save, sender=Contract)
def drop_reservation_on_contract_progress(sender, instance, **kwargs):
    # Contrato em pagamento / faturado / excluído (soft-delete) → some a reserva.
    if getattr(instance, 'is_deleted', False) or instance.stage in _DROP_STAGES:
        _drop_reservations(instance)


@receiver(pre_delete, sender=Contract)
def drop_reservation_on_contract_delete(sender, instance, **kwargs):
    # Exclusão de verdade: roda ANTES do SET_NULL zerar o FK da reserva.
    _drop_reservations(instance)
