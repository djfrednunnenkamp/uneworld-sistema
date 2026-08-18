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
    # Nº reservado originalmente. `pax` vira o RESTANTE conforme contratos são
    # gerados; original_pax mantém o total pra recalcular (idempotente).
    original_pax = models.PositiveIntegerField('Passageiros reservados', null=True, blank=True)

    # Prazo (snapshot no momento da criação, vindo da config do roteiro/global) e
    # o instante em que a reserva sem pagamento expira.
    deadline_hours = models.PositiveIntegerField('Prazo (horas)', null=True, blank=True)
    expires_at     = models.DateTimeField('Expira em', null=True, blank=True, db_index=True)

    # Valores na moeda base do roteiro. amount_due = quanto era para pagar agora.
    amount_due  = models.DecimalField('Valor a pagar agora', max_digits=14, decimal_places=2, default=Decimal('0'))
    amount_paid = models.DecimalField('Valor pago', max_digits=14, decimal_places=2, default=Decimal('0'))

    # Contrato gerado a partir da reserva (da reserva nasce o contrato).
    contract = models.ForeignKey('contracts.Contract', on_delete=models.SET_NULL, null=True, blank=True, related_name='reservations', verbose_name='Contrato')

    # Pessoas que a reserva leva SEM segurar uma unidade nova de quarto: vão
    # para uma acomodação que já existe na lista de passageiros, ou para nenhuma.
    # É o caso de reservar da própria lista — "mais uma pessoa, que dorme com
    # quem já está lá" não consome outro quarto, e obrigar a criar um quarto só
    # para poder registrá-la seria inventar estoque. Formato de cada item:
    # {'name', 'passenger', 'room'} (room = nome da acomodação na lista, ou '').
    list_guests = models.JSONField('Pessoas sem unidade própria', default=list, blank=True)

    notes      = models.TextField('Observações', blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='reservations_created')
    # Quem, NA AGÊNCIA, responde por esta reserva — recebe o comprovante e é o
    # responsável dos assentos na lista de passageiros. Quando a agência reserva
    # sozinha é quem fez (e o campo fica vazio, ver `responsavel`); quando a
    # OPERADORA reserva em nome dela, precisa ser dito: o operador que digitou
    # não é quem vai acompanhar a viagem.
    responsible_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                         null=True, blank=True, related_name='reservations_responsible',
                                         verbose_name='Responsável na agência')
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Reserva'
        verbose_name_plural = 'Reservas'

    def __str__(self):
        return f'Reserva #{self.pk} · roteiro {self.itinerary_id} · agência {self.agency_id}'

    @property
    def responsavel(self):
        """Quem responde pela reserva. Sem alguém escolhido, é quem a fez — que é
        o caso da agência reservando sozinha, e evita um campo obrigatório para
        dizer o óbvio."""
        return self.responsible_user or self.created_by


class ReservationRoom(models.Model):
    """Quarto (hotel) ou cabine (navio) que a reserva SEGURA.

    Reservar não é só guardar N assentos: 3 pessoas podem ir num triplo, num
    duplo + um single, ou em três singles — e o que existe para vender é o que
    está bloqueado (Valores › Disponibilidade), que conta UNIDADES de quarto e
    de cabine, não pessoas. Sem esta tabela a operadora só saberia "3 lugares",
    e descobriria na hora de montar o contrato que não havia duplo nenhum.

    `block` é o bloqueio de onde a unidade sai. Guardá-lo é o que torna a conta
    de disponibilidade exata quando o mesmo tipo de quarto aparece em blocos
    diferentes (bloco fixo × pool compartilhado) — sem ele, dar baixa no bloco
    certo viraria adivinhação.

    `label` e `capacity` ficam denormalizados: se o catálogo do roteiro mudar
    depois, a reserva continua dizendo o que foi reservado naquele dia.
    """
    KIND_CHOICES = [('terrestre', 'Quarto (hotel)'), ('navio', 'Cabine (navio)')]

    reservation   = models.ForeignKey(Reservation, on_delete=models.CASCADE, related_name='rooms')
    kind          = models.CharField('Tipo', max_length=10, choices=KIND_CHOICES)
    block         = models.ForeignKey('itineraries.ItineraryInventoryBlock', null=True, blank=True,
                                      on_delete=models.SET_NULL, related_name='+', verbose_name='Bloqueio')
    accommodation = models.ForeignKey('config_api.ConfigAccommodation', null=True, blank=True,
                                      on_delete=models.SET_NULL, related_name='+', verbose_name='Acomodação')
    ship_cabin    = models.ForeignKey('config_api.ConfigShipCabin', null=True, blank=True,
                                      on_delete=models.SET_NULL, related_name='+', verbose_name='Cabine')
    label         = models.CharField('Rótulo', max_length=200, blank=True, default='')
    capacity      = models.PositiveIntegerField('Pessoas por unidade', default=1)
    quantity      = models.PositiveIntegerField('Unidades', default=1)
    # QUEM vai nesta unidade, na ordem. Nome VAZIO é normal e esperado: na hora
    # de reservar quase nunca se sabe o nome de todo mundo — o que importa é que
    # a pessoa já tem lugar. Quando a reserva vira contrato, é aqui que estão as
    # pessoas para casar com os passageiros de verdade.
    guests        = models.JSONField('Pessoas', default=list, blank=True)

    class Meta:
        ordering = ['kind', 'id']
        verbose_name = 'Quarto/cabine da reserva'
        verbose_name_plural = 'Quartos/cabines da reserva'

    def __str__(self):
        return f'{self.quantity}× {self.label or self.kind} (reserva {self.reservation_id})'

    @property
    def people(self):
        """Quantas pessoas estão NESTA unidade. Com a lista de pessoas montada,
        são elas; sem ela (reserva só por contagem), é a capacidade cheia."""
        if self.guests:
            return len(self.guests)
        return (self.capacity or 0) * (self.quantity or 0)
