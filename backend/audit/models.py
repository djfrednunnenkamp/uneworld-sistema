from django.db import models
from django.contrib.auth.models import User


class AuditLog(models.Model):
    ACTION_CHOICES = [
        ('create', 'Criado'),
        ('update', 'Atualizado'),
        ('delete', 'Apagado'),
        ('download', 'Baixado'),
    ]

    timestamp    = models.DateTimeField('Data/Hora', auto_now_add=True, db_index=True)
    user         = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL,
                                     verbose_name='Usuário', related_name='audit_logs')
    user_display = models.CharField('Usuário', max_length=200, blank=True)
    action       = models.CharField('Ação', max_length=20, choices=ACTION_CHOICES, db_index=True)
    model_name   = models.CharField('Modelo', max_length=100, db_index=True)
    model_label  = models.CharField('Tipo de registro', max_length=100, blank=True)
    object_id    = models.CharField('ID', max_length=50, blank=True)
    object_repr  = models.CharField('Descrição', max_length=500, blank=True)
    changes      = models.JSONField('Alterações', default=dict)
    ip_address   = models.GenericIPAddressField('Endereço IP', null=True, blank=True)

    class Meta:
        ordering = ['-timestamp']
        verbose_name = 'Log de auditoria'

    def __str__(self):
        return f'{self.timestamp:%d/%m/%Y %H:%M} | {self.user_display} | {self.get_action_display()} | {self.model_label}'
