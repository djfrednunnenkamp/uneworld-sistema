from django.db import models
from django.contrib.auth.models import User


class AuditLog(models.Model):
    ACTION_CHOICES = [
        ('create', 'Criado'),
        ('update', 'Atualizado'),
        ('delete', 'Apagado'),
        ('restore', 'Restaurado'),
        ('purge', 'Removido definitivamente'),
        ('merge', 'Mesclado'),
        ('download', 'Baixado'),
        ('upload', 'Enviado'),
        ('send', 'Enviado p/ assinatura'),
        ('sign', 'Assinado'),
        ('login', 'Login'),
        ('logout', 'Logout'),
        ('view', 'Visitou'),
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

    # Localização do IP (GeoLite2) — preenchida automaticamente ao salvar
    # quando há ip_address. lat/lng do navegador (mais precisos, com
    # consentimento da pessoa) sobrescrevem os do IP quando disponíveis.
    geo_city      = models.CharField('Cidade', max_length=120, blank=True)
    geo_country   = models.CharField('País', max_length=120, blank=True)
    latitude      = models.FloatField('Latitude', null=True, blank=True)
    longitude     = models.FloatField('Longitude', null=True, blank=True)
    geo_precise   = models.BooleanField('Localização precisa (navegador)', default=False)
    geo_address   = models.CharField('Endereço', max_length=500, blank=True)

    class Meta:
        ordering = ['-timestamp']
        verbose_name = 'Log de auditoria'

    def __str__(self):
        return f'{self.timestamp:%d/%m/%Y %H:%M} | {self.user_display} | {self.get_action_display()} | {self.model_label}'

    def save(self, *args, **kwargs):
        if self.pk is None and self.ip_address and self.latitude is None:
            from .geoip import locate_ip, reverse_geocode
            geo = locate_ip(self.ip_address)
            if geo:
                self.geo_city = geo['city']
                self.geo_country = geo['country']
                self.latitude = geo['latitude']
                self.longitude = geo['longitude']
                # Nominatim tem limite de 1 req/s — só vale a pena chamar pra
                # login/logout (pontual), nunca pra todo AuditLog criado.
                if self.action in ('login', 'logout'):
                    self.geo_address = reverse_geocode(geo['latitude'], geo['longitude'])
        super().save(*args, **kwargs)
