"""Provisionamento automático do usuário admin de uma agência.

Ao finalizar o cadastro de uma agência (sai de rascunho / é criada já ativa)
com um e-mail preenchido, o sistema cria automaticamente um usuário para esse
e-mail e o torna ADMIN da agência — aplicando o perfil padrão de agência e
enviando o convite para ele definir a própria senha. Se já existir um usuário
comum com esse e-mail, ele é apenas vinculado como admin (não recriamos nem
mexemos em contas internas/privilegiadas)."""
from django.conf import settings
from django.contrib.auth.models import User


def _admin_name(agency):
    """Primeiro/último nome do usuário admin a partir dos dados da agência."""
    base = (agency.responsible or agency.name or agency.company_name or '').strip()
    if not base:
        return '', ''
    parts = base.split()
    return parts[0], ' '.join(parts[1:])


def ensure_agency_admin_user(agency, actor=None):
    """Garante o usuário admin da agência. Idempotente: não faz nada se a
    agência ainda é rascunho, não tem e-mail, ou já possui algum membro."""
    if not agency or agency.status == 'rascunho':
        return None
    email = (agency.email or '').strip().lower()
    if not email:
        return None
    # Já tem qualquer membro? Não reprovisiona nem duplica.
    if agency.members.exists():
        return None

    from .models import AgencyMember

    existing = User.objects.filter(email__iexact=email).first()
    if existing:
        # Nunca anexa/rebaixa contas internas ou privilegiadas automaticamente.
        if existing.is_staff or existing.is_superuser:
            return None
        member, _ = AgencyMember.objects.get_or_create(
            agency=agency, user=existing, defaults={'role': 'admin'})
        return member.user

    first, last = _admin_name(agency)
    user = User.objects.create_user(
        username=email, password=None, email=email,
        first_name=first, last_name=last,
    )
    # Perfil padrão de agência (template confiável) — aplica pleno.
    from config_api.models import PermissionProfile
    from users_api.permissions import apply_profile
    prof = PermissionProfile.objects.filter(is_agency_default=True, is_deleted=False).first()
    if prof:
        apply_profile(user, prof, actor=None)

    AgencyMember.objects.create(agency=agency, user=user, role='admin')

    # Convite por e-mail para o admin definir a própria senha. Falha no envio
    # não cancela a criação.
    try:
        from users_api.models import InviteToken
        from users_api.email_service import send_invite
        invite = InviteToken.objects.create(
            email=user.email, first_name=user.first_name, last_name=user.last_name,
            is_staff=False, created_by=actor,
        )
        url = f"{settings.FRONTEND_URL}/aceitar-convite?token={invite.token}"
        invited_by = (actor.get_full_name() or actor.username) if actor else ''
        send_invite(user.email, user.first_name, url, invited_by)
    except Exception:
        pass

    return user
