from django.conf import settings
from django.db import models


class CalendarPreference(models.Model):
    DIGEST_FREQ_CHOICES = [
        ('daily',  'Diário'),
        ('weekly', 'Semanal'),
    ]

    SIDE_PANEL_POSITION_CHOICES = [
        ('left',  'Esquerda'),
        ('right', 'Direita'),
    ]

    user                 = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='calendar_preference')
    digest_enabled       = models.BooleanField('Resumo automático por e-mail', default=False)
    digest_frequency     = models.CharField('Frequência do resumo', max_length=10, choices=DIGEST_FREQ_CHOICES, default='daily')
    reminder_enabled     = models.BooleanField('Lembrete de prazos por e-mail', default=False)
    reminder_days_before = models.PositiveSmallIntegerField('Avisar com quantos dias de antecedência', default=3)
    receive_deadline_emails = models.BooleanField('Receber e-mails de prazos de confirmação', default=False)
    receive_task_emails     = models.BooleanField('Receber e-mails de pendências', default=False)
    side_panel_enabled   = models.BooleanField('Exibir painel lateral do calendário', default=True)
    side_panel_position  = models.CharField('Posição do painel lateral', max_length=5, choices=SIDE_PANEL_POSITION_CHOICES, default='right')
    last_digest_sent     = models.DateField('Último resumo enviado em', null=True, blank=True)
    last_reminder_sent   = models.DateField('Último lembrete enviado em', null=True, blank=True)
    updated_at           = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name        = 'Preferência de calendário'
        verbose_name_plural = 'Preferências de calendário'

    def __str__(self):
        return f'Preferências de {self.user}'
