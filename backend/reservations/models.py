from decimal import Decimal

from django.conf import settings
from django.db import models


class Reservation(models.Model):
    """Reserva de um roteiro por uma agência. Da reserva nasce o contrato.

    Dois tipos que a agência faz: SEM pagamento (segura por um prazo e "cai" se
    não pagar) e pagamento IMEDIATO. Há ainda o tipo exclusivo da operadora. A
    operadora pode criar contrato direto, sem passar por reserva — só as agências
    precisam reservar antes."""
    TYPE_CHOICES = [
        ('sem_pagamento',      'Sem pagamento'),
        ('pagamento_imediato', 'Pagamento imediato'),
        ('operadora',          'Exclusiva da operadora'),
    ]
    STATUS_CHOICES = [
        ('pendente',   'Pendente'),                 # sem pagamento, dentro do prazo
        ('paga',       'Paga'),                      # pagamento imediato confirmado
        ('convertida', 'Convertida em contrato'),    # virou contrato
        ('expirada',   'Expirada'),                  # caiu no prazo
        ('cancelada',  'Cancelada'),
    ]

    itinerary = models.ForeignKey('itineraries.Itinerary', on_delete=models.PROTECT, related_name='reservations', verbose_name='Roteiro')
    agency    = models.ForeignKey('agencies.Agency', on_delete=models.PROTECT, related_name='reservations', verbose_name='Agência')
    reservation_type = models.CharField('Tipo', max_length=20, choices=TYPE_CHOICES, default='sem_pagamento', db_index=True)
    status    = models.CharField('Status', max_length=12, choices=STATUS_CHOICES, default='pendente', db_index=True)
    pax       = models.PositiveIntegerField('Passageiros', default=1)

    # Prazo (snapshot no momento da criação, vindo da config do roteiro/global) e
    # o instante em que a reserva sem pagamento expira.
    deadline_hours = models.PositiveIntegerField('Prazo (horas)', null=True, blank=True)
    expires_at     = models.DateTimeField('Expira em', null=True, blank=True, db_index=True)

    # Valores na moeda base do roteiro. amount_due = quanto era para pagar agora.
    amount_due  = models.DecimalField('Valor a pagar agora', max_digits=14, decimal_places=2, default=Decimal('0'))
    amount_paid = models.DecimalField('Valor pago', max_digits=14, decimal_places=2, default=Decimal('0'))

    # Contrato gerado a partir da reserva (da reserva nasce o contrato).
    contract = models.ForeignKey('contracts.Contract', on_delete=models.SET_NULL, null=True, blank=True, related_name='reservations', verbose_name='Contrato')

    notes      = models.TextField('Observações', blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='reservations_created')
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Reserva'
        verbose_name_plural = 'Reservas'

    def __str__(self):
        return f'Reserva #{self.pk} · roteiro {self.itinerary_id} · agência {self.agency_id}'
