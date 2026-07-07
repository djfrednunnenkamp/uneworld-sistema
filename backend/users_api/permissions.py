from rest_framework.permissions import BasePermission
from .models import UserPermissions

PERMISSION_FIELDS = [
    # Legado (mantidos para compatibilidade — não exibidos na UI de permissões)
    'manage_users',
    'manage_settings',
    'view_audit_log',
    'log_view',
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
    # Contratos
    'contracts_view',
    'contracts_edit',
    'contracts_delete',
    'contracts_view_logs',
    'contracts_change_seller',
    'contracts_edit_exchange_rate',
    'contracts_custom_clauses',
    'contracts_clauses_edit',
    'contracts_review',
    'contracts_invoice_view',
    'contracts_invoice',
    # Roteiros
    'roteiros_view',
    'roteiros_open',
    'roteiros_edit',
    'roteiros_create',
    'roteiros_delete',
    'roteiros_view_logs',
    'roteiros_publish',
    'roteiros_edit_published',
    'roteiros_docs_view',
    'roteiros_docs_view_own',
    'roteiros_docs_create',
    'roteiros_docs_edit',
    'roteiros_docs_delete',
    'roteiros_docs_delete_own',
    'roteiros_images_from_gallery',
    # Galeria
    'gallery_view',
    'gallery_view_images',
    'gallery_view_videos',
    'gallery_view_laminas',
    'gallery_upload_images',
    'gallery_upload_videos',
    'gallery_upload_laminas',
    'gallery_delete_images',
    'gallery_delete_videos',
    'gallery_delete_laminas',
    'gallery_edit',
    'gallery_delete',
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
    # Guias
    'guides_view',
    # Usuários
    'users_view',
    'users_edit',
    'users_block',
    'users_delete',
    'users_manage_permissions',
    'users_set_password',
    'users_view_logs',
    'log_page_views',
    # Configurações — acesso global
    'settings_view',
    'settings_csv_import',
    'settings_csv_export',
    'settings_view_logs',
    # Configurações — legado
    'settings_professions', 'settings_languages', 'settings_countries',
    'settings_genders', 'settings_vaccines', 'settings_doc_types',
    'settings_prof_cards', 'settings_user_profiles',
    'settings_list_additionals', 'settings_crew_roles',
    # Configurações — granular
    'settings_professions_view', 'settings_professions_edit', 'settings_professions_delete', 'settings_professions_bulk_delete', 'settings_professions_bulk_import', 'settings_professions_import_web', 'settings_professions_export',
    'settings_languages_view', 'settings_languages_edit', 'settings_languages_delete', 'settings_languages_bulk_delete', 'settings_languages_bulk_import', 'settings_languages_import_web', 'settings_languages_export',
    'settings_countries_view', 'settings_countries_edit', 'settings_countries_delete', 'settings_countries_bulk_delete', 'settings_countries_bulk_import', 'settings_countries_import_web', 'settings_countries_export',
    'settings_genders_view', 'settings_genders_edit', 'settings_genders_delete', 'settings_genders_bulk_delete', 'settings_genders_bulk_import', 'settings_genders_export',
    'settings_vaccines_view', 'settings_vaccines_edit', 'settings_vaccines_delete', 'settings_vaccines_bulk_delete', 'settings_vaccines_bulk_import', 'settings_vaccines_import_web', 'settings_vaccines_export',
    'settings_doc_types_view', 'settings_doc_types_edit', 'settings_doc_types_delete', 'settings_doc_types_bulk_delete', 'settings_doc_types_bulk_import', 'settings_doc_types_export',
    'settings_prof_cards_view', 'settings_prof_cards_edit', 'settings_prof_cards_delete', 'settings_prof_cards_bulk_delete', 'settings_prof_cards_bulk_import', 'settings_prof_cards_import_web', 'settings_prof_cards_export',
    'settings_user_profiles_view', 'settings_user_profiles_edit', 'settings_user_profiles_delete', 'settings_user_profiles_bulk_import', 'settings_user_profiles_export',
    'settings_list_additionals_view', 'settings_list_additionals_edit', 'settings_list_additionals_delete', 'settings_list_additionals_bulk_delete', 'settings_list_additionals_bulk_import', 'settings_list_additionals_export',
    'settings_crew_roles_view', 'settings_crew_roles_edit', 'settings_crew_roles_delete', 'settings_crew_roles_bulk_delete', 'settings_crew_roles_bulk_import', 'settings_crew_roles_export',
    'settings_accommodations_view', 'settings_accommodations_edit', 'settings_accommodations_delete', 'settings_accommodations_bulk_delete', 'settings_accommodations_bulk_import', 'settings_accommodations_export',
    'settings_list_categories_view', 'settings_list_categories_edit', 'settings_list_categories_delete', 'settings_list_categories_bulk_delete', 'settings_list_categories_bulk_import', 'settings_list_categories_export',
    'settings_airports_view', 'settings_airports_edit', 'settings_airports_delete', 'settings_airports_bulk_delete', 'settings_airports_bulk_import', 'settings_airports_import_web', 'settings_airports_export',
    'settings_airlines_view', 'settings_airlines_edit', 'settings_airlines_delete', 'settings_airlines_bulk_delete', 'settings_airlines_bulk_import', 'settings_airlines_import_web', 'settings_airlines_export',
    'settings_bus_maps_view', 'settings_bus_maps_edit', 'settings_bus_maps_delete', 'settings_bus_maps_bulk_import', 'settings_bus_maps_export',
    'settings_contract_clauses_view', 'settings_contract_clauses_edit', 'settings_contract_clauses_delete', 'settings_contract_clauses_bulk_import', 'settings_contract_clauses_export',
    'settings_payment_methods_view', 'settings_payment_methods_edit', 'settings_payment_methods_delete', 'settings_payment_methods_bulk_import', 'settings_payment_methods_export',
    'settings_exchange_rates_view', 'settings_exchange_rates_edit', 'settings_exchange_rates_delete', 'settings_exchange_rates_advanced', 'settings_exchange_rates_rounding', 'settings_exchange_rates_update_now', 'settings_exchange_rates_bulk_import', 'settings_exchange_rates_export',
    'settings_terms_view', 'settings_terms_edit', 'settings_terms_bulk_import', 'settings_terms_export',
    'settings_operating_company_view', 'settings_operating_company_edit', 'settings_operating_company_bulk_import', 'settings_operating_company_export',
    'settings_itinerary_categories_view', 'settings_itinerary_categories_edit', 'settings_itinerary_categories_delete', 'settings_itinerary_categories_bulk_delete', 'settings_itinerary_categories_bulk_import', 'settings_itinerary_categories_export',
    'settings_itinerary_types_view', 'settings_itinerary_types_edit', 'settings_itinerary_types_delete',
    'settings_maritime_companies_view', 'settings_maritime_companies_edit', 'settings_maritime_companies_delete',
    'settings_currencies_view', 'settings_currencies_edit', 'settings_currencies_delete',
    'settings_keywords_view', 'settings_keywords_edit', 'settings_keywords_delete',
    'settings_inclusions_view', 'settings_inclusions_edit', 'settings_inclusions_delete',
    'settings_highlights_view', 'settings_highlights_edit', 'settings_highlights_delete',
    'settings_special_dates_view', 'settings_special_dates_edit', 'settings_special_dates_delete',
    'settings_hotels_view', 'settings_hotels_edit', 'settings_hotels_delete',
    'settings_boats_view', 'settings_boats_edit', 'settings_boats_delete', 'settings_boats_bulk_import', 'settings_boats_export',
    'settings_terrestre_companies_view', 'settings_terrestre_companies_edit', 'settings_terrestre_companies_delete',
]

# Permissões que, se concedidas, fazem o usuário ser considerado "staff"
# (acesso administrativo — libera /usuarios, /configuracoes e /log no menu).
STAFF_PERMISSION_FIELDS = [
    # Legacy (mantidos para compatibilidade com usuários existentes).
    # view_audit_log/log_view foram retirados daqui de propósito: são chaves
    # de log aposentadas (somem da UI) e não devem mais marcar a pessoa como
    # "Administrador" — senão um usuário sem nenhuma permissão visível, mas com
    # esse campo ainda ligado no banco, aparece como admin sem ser.
    'manage_users', 'manage_settings',
    # Usuários
    'users_view', 'users_edit', 'users_block', 'users_delete', 'users_manage_permissions', 'users_set_password',
    # Configurações
    'settings_view', 'settings_csv_import', 'settings_csv_export',
    'settings_professions', 'settings_languages', 'settings_countries',
    'settings_genders', 'settings_vaccines', 'settings_doc_types',
    'settings_prof_cards', 'settings_user_profiles',
    'settings_list_additionals', 'settings_crew_roles',
    'settings_professions_view', 'settings_professions_edit', 'settings_professions_delete', 'settings_professions_bulk_delete', 'settings_professions_bulk_import', 'settings_professions_import_web', 'settings_professions_export',
    'settings_languages_view', 'settings_languages_edit', 'settings_languages_delete', 'settings_languages_bulk_delete', 'settings_languages_bulk_import', 'settings_languages_import_web', 'settings_languages_export',
    'settings_countries_view', 'settings_countries_edit', 'settings_countries_delete', 'settings_countries_bulk_delete', 'settings_countries_bulk_import', 'settings_countries_import_web', 'settings_countries_export',
    'settings_genders_view', 'settings_genders_edit', 'settings_genders_delete', 'settings_genders_bulk_delete', 'settings_genders_bulk_import', 'settings_genders_export',
    'settings_vaccines_view', 'settings_vaccines_edit', 'settings_vaccines_delete', 'settings_vaccines_bulk_delete', 'settings_vaccines_bulk_import', 'settings_vaccines_import_web', 'settings_vaccines_export',
    'settings_doc_types_view', 'settings_doc_types_edit', 'settings_doc_types_delete', 'settings_doc_types_bulk_delete', 'settings_doc_types_bulk_import', 'settings_doc_types_export',
    'settings_prof_cards_view', 'settings_prof_cards_edit', 'settings_prof_cards_delete', 'settings_prof_cards_bulk_delete', 'settings_prof_cards_bulk_import', 'settings_prof_cards_import_web', 'settings_prof_cards_export',
    'settings_user_profiles_view', 'settings_user_profiles_edit', 'settings_user_profiles_delete', 'settings_user_profiles_bulk_import', 'settings_user_profiles_export',
    'settings_list_additionals_view', 'settings_list_additionals_edit', 'settings_list_additionals_delete', 'settings_list_additionals_bulk_delete', 'settings_list_additionals_bulk_import', 'settings_list_additionals_export',
    'settings_crew_roles_view', 'settings_crew_roles_edit', 'settings_crew_roles_delete', 'settings_crew_roles_bulk_delete', 'settings_crew_roles_bulk_import', 'settings_crew_roles_export',
    'settings_accommodations_view', 'settings_accommodations_edit', 'settings_accommodations_delete', 'settings_accommodations_bulk_delete', 'settings_accommodations_bulk_import', 'settings_accommodations_export',
    'settings_list_categories_view', 'settings_list_categories_edit', 'settings_list_categories_delete', 'settings_list_categories_bulk_delete', 'settings_list_categories_bulk_import', 'settings_list_categories_export',
    'settings_airports_view', 'settings_airports_edit', 'settings_airports_delete', 'settings_airports_bulk_delete', 'settings_airports_bulk_import', 'settings_airports_import_web', 'settings_airports_export',
    'settings_airlines_view', 'settings_airlines_edit', 'settings_airlines_delete', 'settings_airlines_bulk_delete', 'settings_airlines_bulk_import', 'settings_airlines_import_web', 'settings_airlines_export',
    'settings_bus_maps_view', 'settings_bus_maps_edit', 'settings_bus_maps_delete', 'settings_bus_maps_bulk_import', 'settings_bus_maps_export',
    'settings_contract_clauses_view', 'settings_contract_clauses_edit', 'settings_contract_clauses_delete', 'settings_contract_clauses_bulk_import', 'settings_contract_clauses_export',
    'settings_payment_methods_view', 'settings_payment_methods_edit', 'settings_payment_methods_delete', 'settings_payment_methods_bulk_import', 'settings_payment_methods_export',
    'settings_exchange_rates_view', 'settings_exchange_rates_edit', 'settings_exchange_rates_delete', 'settings_exchange_rates_advanced', 'settings_exchange_rates_rounding', 'settings_exchange_rates_update_now', 'settings_exchange_rates_bulk_import', 'settings_exchange_rates_export',
    'settings_terms_view', 'settings_terms_edit', 'settings_terms_bulk_import', 'settings_terms_export',
    'settings_operating_company_view', 'settings_operating_company_edit', 'settings_operating_company_bulk_import', 'settings_operating_company_export',
    'settings_itinerary_categories_view', 'settings_itinerary_categories_edit', 'settings_itinerary_categories_delete', 'settings_itinerary_categories_bulk_delete', 'settings_itinerary_categories_bulk_import', 'settings_itinerary_categories_export',
    'settings_itinerary_types_view', 'settings_itinerary_types_edit', 'settings_itinerary_types_delete',
    'settings_maritime_companies_view', 'settings_maritime_companies_edit', 'settings_maritime_companies_delete',
    'settings_currencies_view', 'settings_currencies_edit', 'settings_currencies_delete',
    'settings_keywords_view', 'settings_keywords_edit', 'settings_keywords_delete',
    'settings_inclusions_view', 'settings_inclusions_edit', 'settings_inclusions_delete',
    'settings_highlights_view', 'settings_highlights_edit', 'settings_highlights_delete',
    'settings_special_dates_view', 'settings_special_dates_edit', 'settings_special_dates_delete',
    'settings_hotels_view', 'settings_hotels_edit', 'settings_hotels_delete',
    'settings_boats_view', 'settings_boats_edit', 'settings_boats_delete', 'settings_boats_bulk_import', 'settings_boats_export',
    'settings_terrestre_companies_view', 'settings_terrestre_companies_edit', 'settings_terrestre_companies_delete',
    # Log do sistema. log_view (acesso amplo legado) saiu: ver log não torna
    # ninguém Administrador. log_page_views continua porque é uma permissão
    # ativa e concedida de propósito.
    'log_page_views',
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


def agency_scope_ids(user):
    """IDs das agências às quais o usuário pertence QUANDO ele é um 'usuário de
    agência' — membro de ao menos uma agência e SEM ser equipe interna (não staff
    nem superusuário). Nesse caso, o acesso a dados é limitado a essas agências.

    Retorna None quando NÃO há escopo (superusuário, equipe interna/staff, ou
    usuário sem nenhuma agência) — aí vê tudo, sujeito só às permissões normais."""
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    if user.is_superuser or user.is_staff:
        return None
    ids = list(user.agency_memberships.values_list('agency_id', flat=True))
    return ids or None


def is_operadora_user(user):
    """True quando o usuário é uma conta EXTERNA de operadora — membro de ao menos
    uma agência do tipo 'operadora' e SEM ser equipe interna (não staff nem
    superusuário). Usado para restringir o que a operadora vê (ex.: galeria só
    com as lâminas padrão dos roteiros públicos e abertos)."""
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if user.is_superuser or user.is_staff:
        return False
    return user.agency_memberships.filter(agency__agency_type='operadora').exists()


def apply_profile(user, profile):
    """Vincula o usuário ao perfil de permissão e copia as permissões dele.

    O vínculo é VIVO: ao editar o perfil nas Configurações, chamamos isto de novo
    para cada usuário vinculado, mantendo tudo sincronizado (ver
    PermissionProfileViewSet._reapply_to_linked_users). Perfil é um template
    confiável — aplica sem o filtro de "permissões concedíveis" do ator.
    Superusuário é ignorado (tem acesso total de qualquer forma)."""
    if user.is_superuser:
        return
    perms = get_user_permissions(user)
    perms.profile = profile
    src = profile.permissions if (profile and isinstance(profile.permissions, dict)) else {}
    # Um perfil define o conjunto COMPLETO de permissões: chave AUSENTE no perfil
    # vale False (não mantém o valor antigo). Sem isso, permissões antigas do
    # usuário (ex.: um superadmin rebaixado) sobreviviam e ele seguia como staff.
    for key in PERMISSION_FIELDS:
        setattr(perms, key, bool(src.get(key)))
    perms.save()
    sync_is_staff(user)


def agency_admin_ids(user):
    """IDs das agências onde o usuário é ADMIN (AgencyMember.role='admin') e é um
    usuário de agência (não interno). Um admin de agência pode gerenciar os
    usuários dessas agências: criar, excluir, ajustar permissões (limitado às que
    ele próprio tem) e redefinir senha. Retorna [] para interno/superusuário —
    esses usam as permissões normais, não a via de admin de agência."""
    if not user or not getattr(user, 'is_authenticated', False):
        return []
    if user.is_superuser or user.is_staff:
        return []
    return list(user.agency_memberships.filter(role='admin').values_list('agency_id', flat=True))


def can_manage_agency_user(actor, target):
    """True se `actor` (admin de agência) pode gerenciar `target`: o alvo é membro
    de alguma agência administrada por `actor` e NÃO é interno (staff/superusuário).
    Nunca deixa um admin de agência mexer numa conta interna (fronteira de
    privilégio) nem em si mesmo por esta via."""
    if not target or target.is_superuser or target.is_staff:
        return False
    if actor and target.pk == actor.pk:
        return False
    ids = agency_admin_ids(actor)
    if not ids:
        return False
    return target.agency_memberships.filter(agency_id__in=ids).exists()


def drop_agency_memberships_if_internal(user):
    """Conta INTERNA (staff/superusuário) não é usuário de agência → remove os
    vínculos de agência dela. Sem isso, um usuário que foi de agência e virou
    interno continuava aparecendo como membro da agência."""
    if user and (user.is_staff or user.is_superuser):
        from django.apps import apps
        apps.get_model('agencies', 'AgencyMember').objects.filter(user=user).delete()


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
