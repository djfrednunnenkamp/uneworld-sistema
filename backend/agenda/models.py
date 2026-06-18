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
    receive_deadline_emails  = models.BooleanField('Receber e-mails de prazos de confirmação', default=False)
    receive_task_emails      = models.BooleanField('Receber e-mails de pendências', default=False)
    receive_birthday_emails  = models.BooleanField('Receber e-mails de aniversários de passageiros', default=False)
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


class EmailLog(models.Model):
    EMAIL_TYPES = [
        ('daily_digest',   'Digest diário'),
        ('digest',         'Resumo do calendário'),
        ('deadline',       'Prazo de confirmação'),
        ('task',           'Pendência'),
        ('birthday',       'Aniversário de passageiro'),
        ('reset_password', 'Redefinição de senha'),
        ('invite',         'Convite'),
        ('other',          'Outro'),
    ]

    sent_at    = models.DateTimeField('Enviado em', auto_now_add=True, db_index=True)
    to         = models.TextField('Destinatários')
    subject    = models.CharField('Assunto', max_length=500)
    email_type = models.CharField('Tipo', max_length=30, choices=EMAIL_TYPES, default='other')
    html_body  = models.TextField('Conteúdo HTML', blank=True)
    success    = models.BooleanField('Enviado com sucesso', default=True)

    class Meta:
        ordering            = ['-sent_at']
        verbose_name        = 'Log de e-mail'
        verbose_name_plural = 'Log de e-mails'

    def __str__(self):
        return f'[{self.email_type}] {self.subject} → {self.to}'
