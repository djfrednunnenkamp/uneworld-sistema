from django.db import models
from passengers.models import Passenger
from trips.models import Trip


class Meeting(models.Model):
    STATUS_CHOICES = [
        ('scheduled', 'Agendada'),
        ('completed', 'Realizada'),
        ('cancelled', 'Cancelada'),
        ('no_show', 'Não compareceu'),
    ]

    TYPE_CHOICES = [
        ('presentation', 'Apresentação de viagem'),
        ('consultation', 'Consulta'),
        ('followup', 'Acompanhamento'),
        ('other', 'Outro'),
    ]

    title = models.CharField('Título', max_length=200)
    trip = models.ForeignKey(Trip, on_delete=models.SET_NULL, null=True, blank=True, related_name='meetings', verbose_name='Viagem relacionada')
    meeting_type = models.CharField('Tipo', max_length=20, choices=TYPE_CHOICES, default='consultation')
    scheduled_at = models.DateTimeField('Agendada para')
    duration_minutes = models.PositiveIntegerField('Duração (minutos)', default=60)
    location = models.CharField('Local / Link', max_length=300, blank=True)
    status = models.CharField('Status', max_length=20, choices=STATUS_CHOICES, default='scheduled')
    notes = models.TextField('Notas', blank=True)
    created_at = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at = models.DateTimeField('Atualizado em', auto_now=True)

    class Meta:
        verbose_name = 'Reunião'
        verbose_name_plural = 'Reuniões'
        ordering = ['-scheduled_at']

    def __str__(self):
        return f'{self.title} — {self.scheduled_at:%d/%m/%Y %H:%M}'


class MeetingParticipant(models.Model):
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name='participants', verbose_name='Reunião')
    passenger = models.ForeignKey(Passenger, on_delete=models.CASCADE, related_name='meetings', verbose_name='Passageiro')
    confirmed = models.BooleanField('Confirmado', default=False)

    class Meta:
        verbose_name = 'Participante'
        verbose_name_plural = 'Participantes'
        unique_together = ['meeting', 'passenger']

    def __str__(self):
        return f'{self.passenger} @ {self.meeting}'
