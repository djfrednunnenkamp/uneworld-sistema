import uuid
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from datetime import timedelta


class PasswordResetToken(models.Model):
    user       = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reset_tokens')
    token      = models.UUIDField(default=uuid.uuid4, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used       = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(hours=2)
        super().save(*args, **kwargs)

    @property
    def is_valid(self):
        return not self.used and timezone.now() < self.expires_at


class UserPermissions(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='permissions')

    # Visão Geral (Dashboard)
    dashboard_view_passengers  = models.BooleanField(default=False)
    dashboard_view_lists       = models.BooleanField(default=False)
    dashboard_view_meetings    = models.BooleanField(default=False)
    dashboard_view_enrollments = models.BooleanField(default=False)

    # Passageiros
    passengers_view_basic    = models.BooleanField(default=False)
    passengers_view_full     = models.BooleanField(default=False)
    passengers_edit          = models.BooleanField(default=False)
    passengers_delete        = models.BooleanField(default=False)
    passengers_download_docs = models.BooleanField(default=False)
    passengers_upload_docs   = models.BooleanField(default=False)
    passengers_view_logs     = models.BooleanField(default=False)

    # Listas de Passageiros
    lists_view       = models.BooleanField(default=False)
    lists_edit       = models.BooleanField(default=False)
    lists_delete     = models.BooleanField(default=False)
    lists_view_logs  = models.BooleanField(default=False)
    lists_download   = models.BooleanField(default=False)
    lists_csv_upload = models.BooleanField(default=False)

    # Passageiros na Lista
    lists_passengers_add    = models.BooleanField(default=False)
    lists_passengers_edit   = models.BooleanField(default=False)
    lists_passengers_remove = models.BooleanField(default=False)

    # Agências
    agencies_view      = models.BooleanField(default=False)
    agencies_edit      = models.BooleanField(default=False)
    agencies_delete    = models.BooleanField(default=False)
    agencies_view_logs = models.BooleanField(default=False)

    # Administração
    manage_users     = models.BooleanField(default=False)
    manage_settings  = models.BooleanField(default=False)
    view_audit_log   = models.BooleanField(default=False)

    class Meta:
        verbose_name = 'Permissões de usuário'
        verbose_name_plural = 'Permissões de usuários'

    def __str__(self):
        return f'Permissões de {self.user.username}'


class InviteToken(models.Model):
    email       = models.EmailField()
    first_name  = models.CharField(max_length=100, blank=True)
    last_name   = models.CharField(max_length=100, blank=True)
    is_staff    = models.BooleanField(default=False)
    token       = models.UUIDField(default=uuid.uuid4, unique=True)
    created_by  = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='sent_invites')
    created_at  = models.DateTimeField(auto_now_add=True)
    expires_at  = models.DateTimeField()
    used        = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(days=7)
        super().save(*args, **kwargs)

    @property
    def is_valid(self):
        return not self.used and timezone.now() < self.expires_at
