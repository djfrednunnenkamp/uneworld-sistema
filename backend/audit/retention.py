"""Poda dos logs de auditoria conforme a retenção configurada no .env.

Duas categorias, cada uma com sua própria idade máxima (em dias):
- NAVEGAÇÃO/MOVIMENTO: páginas visitadas (PageView) + login/logout — é a maior
  parte do volume no dia a dia. Config: AUDIT_NAVIGATION_RETENTION_DAYS.
- MUDANÇAS NO BANCO: criação/edição/exclusão de registros. Config:
  AUDIT_CHANGE_RETENTION_DAYS.

Vazio/ausente (None) = infinito: NÃO poda nada dessa categoria.
"""
import logging
from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

logger = logging.getLogger(__name__)

# Navegação/movimento = navegação de página + login/logout (o resto é "mudança").
_NAV_Q = Q(model_name='PageView') | Q(action__in=['login', 'logout'])


def prune_audit_logs():
    """Apaga os logs além da retenção configurada. Idempotente e incremental
    (só remove o que passou do corte). Devolve o total apagado."""
    from .models import AuditLog
    now = timezone.now()
    total = 0

    nav_days = getattr(settings, 'AUDIT_NAVIGATION_RETENTION_DAYS', None)
    if nav_days:
        cutoff = now - timedelta(days=nav_days)
        n, _ = AuditLog.objects.filter(_NAV_Q, timestamp__lt=cutoff).delete()
        total += n
        if n:
            logger.info('[AUDIT RETENÇÃO] %s log(s) de navegação apagado(s) (>%s dias).', n, nav_days)

    chg_days = getattr(settings, 'AUDIT_CHANGE_RETENTION_DAYS', None)
    if chg_days:
        cutoff = now - timedelta(days=chg_days)
        n, _ = AuditLog.objects.exclude(_NAV_Q).filter(timestamp__lt=cutoff).delete()
        total += n
        if n:
            logger.info('[AUDIT RETENÇÃO] %s log(s) de mudança apagado(s) (>%s dias).', n, chg_days)

    return total
