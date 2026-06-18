from rest_framework.permissions import BasePermission
from .models import UserPermissions

PERMISSION_FIELDS = [
    # Legado (mantidos para compatibilidade — não exibidos na UI de permissões)
    'manage_users',
    'manage_settings',
    'view_audit_log',
    # Visão Geral (Dashboard)
    'dashboard_view_passengers',
    'dashboard_view_lists',
    'dashboard_view_enrollments',
    # Log de e-mails
    'email_log_view',
    'email_log_preview',
    'email_resend_actions',
    # Passageiros
    'passengers_view_basic',
    'passengers_view_full',
    'passengers_edit',
    'passengers_delete',
    'passengers_download_docs',
    'passengers_upload_docs',
    'passengers_view_logs',
    # Agências
    'agencies_view',
    'agencies_edit',
    'agencies_delete',
    'agencies_view_logs',
    # Listas de Passageiros
    'lists_view',
    'lists_edit',
    'lists_delete',
    'lists_view_logs',
    'lists_download',
    'lists_csv_upload',
    # Passageiros na Lista
    'lists_passengers_add',
    'lists_passengers_edit',
    'lists_passengers_remove',
    # Calendário
    'calendar_view',
    'calendar_view_birthdays',
    'calendar_view_all_deadlines',
    # Usuários
    'users_view',
    'users_edit',
    'users_delete',
    'users_manage_permissions',
    'users_set_password',
    # Configurações
    'settings_view',
    'settings_professions',
    'settings_languages',
    'settings_countries',
    'settings_genders',
    'settings_vaccines',
    'settings_doc_types',
    'settings_prof_cards',
    'settings_destinations',
    'settings_list_additionals',
    'settings_crew_roles',
    # Log do sistema
    'log_view',
    'log_passengers',
    'log_lists',
    'log_agencies',
    'log_users',
    'log_settings',
]

# Permissões que, se concedidas, fazem o usuário ser considerado "staff"
# (acesso administrativo — libera /usuarios, /configuracoes e /log no menu).
STAFF_PERMISSION_FIELDS = [
    # Legacy (mantidos para compatibilidade com usuários existentes)
    'manage_users', 'manage_settings', 'view_audit_log',
    # Usuários
    'users_view', 'users_edit', 'users_delete', 'users_manage_permissions', 'users_set_password',
    # Configurações
    'settings_view', 'settings_professions', 'settings_languages', 'settings_countries',
    'settings_genders', 'settings_vaccines', 'settings_doc_types', 'settings_prof_cards',
    'settings_destinations', 'settings_list_additionals', 'settings_crew_roles',
    # Log do sistema
    'log_view', 'log_passengers', 'log_lists', 'log_agencies', 'log_users', 'log_settings',
]


def get_user_permissions(user):
    """Retorna (criando se necessário) o registro de UserPermissions do usuário."""
    perms, _ = UserPermissions.objects.get_or_create(user=user)
    return perms


def permissions_dict(user):
    """Dict {permissão: bool} pronto para enviar ao frontend. Superusuário = tudo True."""
    if user.is_superuser:
        return {key: True for key in PERMISSION_FIELDS}
    perms = get_user_permissions(user)
    return {key: getattr(perms, key) for key in PERMISSION_FIELDS}


def has_any_perm(user, *perm_keys):
    """True se o usuário for superusuário ou tiver QUALQUER uma das permissões informadas."""
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    perms = get_user_permissions(user)
    return any(getattr(perms, key, False) for key in perm_keys)


def sync_is_staff(user):
    """Recalcula user.is_staff a partir das permissões administrativas atuais."""
    if user.is_superuser:
        return
    perms = get_user_permissions(user)
    should_be_staff = any(getattr(perms, key) for key in STAFF_PERMISSION_FIELDS)
    if user.is_staff != should_be_staff:
        user.is_staff = should_be_staff
        user.save(update_fields=['is_staff'])


def RequirePermission(*perm_keys):
    """Factory de permission class do DRF: libera se o usuário tiver QUALQUER uma das permissões."""

    class _RequirePermission(BasePermission):
        message = 'Você não tem permissão para executar esta ação.'

        def has_permission(self, request, view):
            return has_any_perm(request.user, *perm_keys)

    return _RequirePermission
