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
    user       = models.OneToOneField(User, on_delete=models.CASCADE, related_name='permissions')
    updated_at = models.DateTimeField(auto_now=True)

    # Perfil de permissão vinculado (link VIVO): quando o usuário é criado/atualizado
    # com um perfil, ele fica "amarrado" a ele. Editar o perfil nas Configurações
    # re-aplica as permissões a todos os vinculados (ver PermissionProfileViewSet).
    # Toggle manual de permissão desvincula (vira personalizado). SET_NULL para não
    # perder o usuário se o perfil for excluído.
    profile    = models.ForeignKey(
        'config_api.PermissionProfile', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='linked_permissions',
        verbose_name='Perfil de permissão vinculado',
    )

    # Dados de perfil
    phone      = models.CharField(max_length=30, blank=True, default='')

    # Visão Geral (Dashboard)
    dashboard_view_passengers  = models.BooleanField(default=False)
    dashboard_view_lists       = models.BooleanField(default=False)
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

    # Contratos
    contracts_view   = models.BooleanField(default=False)
    contracts_edit   = models.BooleanField(default=False)
    contracts_delete = models.BooleanField(default=False)
    contracts_view_logs = models.BooleanField(default=False)
    contracts_change_seller = models.BooleanField(default=False)
    contracts_edit_exchange_rate = models.BooleanField(default=False)
    contracts_custom_clauses = models.BooleanField(default=False)
    contracts_clauses_edit = models.BooleanField(default=False)   # editar/criar cláusulas no contrato (sem roteiro)
    contracts_review = models.BooleanField(default=False)         # revisar (aprovar/reprovar) contratos assinados — operadora
    contracts_invoice_view = models.BooleanField(default=False)   # ver as abas "A faturar" e "Faturado"
    contracts_invoice = models.BooleanField(default=False)        # faturar (mover A faturar → Faturado)

    # Roteiros
    roteiros_view   = models.BooleanField(default=False)
    roteiros_edit   = models.BooleanField(default=False)
    roteiros_delete = models.BooleanField(default=False)

    # Administração
    manage_users     = models.BooleanField(default=False)
    manage_settings  = models.BooleanField(default=False)
    view_audit_log   = models.BooleanField(default=False)

    # Calendário
    calendar_view              = models.BooleanField(default=False)
    calendar_view_birthdays    = models.BooleanField(default=False)
    calendar_view_all_deadlines = models.BooleanField(default=False)

    # Log de e-mails
    email_log_view       = models.BooleanField(default=False)
    email_log_preview    = models.BooleanField(default=False)
    email_resend_actions = models.BooleanField(default=False)

    # Usuários
    users_view               = models.BooleanField(default=False)
    users_edit               = models.BooleanField(default=False)
    users_block              = models.BooleanField(default=False)
    users_delete             = models.BooleanField(default=False)
    users_manage_permissions = models.BooleanField(default=False)
    users_set_password       = models.BooleanField(default=False)
    users_view_logs          = models.BooleanField(default=False)

    # Configurações — acesso global
    settings_view             = models.BooleanField(default=False)
    settings_csv_import       = models.BooleanField(default=False)
    settings_csv_export       = models.BooleanField(default=False)
    settings_view_logs        = models.BooleanField(default=False)

    # Configurações — legado (acesso completo à seção; mantido para compatibilidade)
    settings_professions      = models.BooleanField(default=False)
    settings_languages        = models.BooleanField(default=False)
    settings_countries        = models.BooleanField(default=False)
    settings_genders          = models.BooleanField(default=False)
    settings_vaccines         = models.BooleanField(default=False)
    settings_doc_types        = models.BooleanField(default=False)
    settings_prof_cards       = models.BooleanField(default=False)
    settings_user_profiles    = models.BooleanField(default=False)
    settings_list_additionals = models.BooleanField(default=False)
    settings_crew_roles       = models.BooleanField(default=False)

    # Configurações — granular por seção
    settings_professions_view        = models.BooleanField(default=False)
    settings_professions_edit        = models.BooleanField(default=False)
    settings_professions_delete      = models.BooleanField(default=False)
    settings_professions_bulk_delete = models.BooleanField(default=False)
    settings_professions_bulk_import = models.BooleanField(default=False)
    settings_professions_import_web  = models.BooleanField(default=False)
    settings_languages_view          = models.BooleanField(default=False)
    settings_languages_edit          = models.BooleanField(default=False)
    settings_languages_delete        = models.BooleanField(default=False)
    settings_languages_bulk_delete   = models.BooleanField(default=False)
    settings_languages_bulk_import   = models.BooleanField(default=False)
    settings_languages_import_web    = models.BooleanField(default=False)
    settings_countries_view          = models.BooleanField(default=False)
    settings_countries_edit          = models.BooleanField(default=False)
    settings_countries_delete        = models.BooleanField(default=False)
    settings_countries_bulk_delete   = models.BooleanField(default=False)
    settings_countries_bulk_import   = models.BooleanField(default=False)
    settings_countries_import_web    = models.BooleanField(default=False)
    settings_genders_view            = models.BooleanField(default=False)
    settings_genders_edit            = models.BooleanField(default=False)
    settings_genders_delete          = models.BooleanField(default=False)
    settings_genders_bulk_delete     = models.BooleanField(default=False)
    settings_genders_bulk_import     = models.BooleanField(default=False)
    settings_payment_methods_view    = models.BooleanField(default=False)
    settings_payment_methods_edit    = models.BooleanField(default=False)
    settings_payment_methods_delete  = models.BooleanField(default=False)
    settings_payment_methods_bulk_import = models.BooleanField(default=False)
    settings_exchange_rates_view     = models.BooleanField(default=False)
    settings_exchange_rates_edit     = models.BooleanField(default=False)
    settings_exchange_rates_delete   = models.BooleanField(default=False)
    settings_exchange_rates_bulk_import = models.BooleanField(default=False)
    # Câmbio: opções avançadas (auto-atualização / fonte externa) e arredondamento
    # são capacidades extras, controladas à parte do edit básico (taxa + acréscimo).
    settings_exchange_rates_advanced = models.BooleanField(default=False)
    settings_exchange_rates_rounding = models.BooleanField(default=False)
    # Forçar a atualização automática agora (botão "Atualizar câmbio agora").
    settings_exchange_rates_update_now = models.BooleanField(default=False)
    settings_vaccines_view           = models.BooleanField(default=False)
    settings_vaccines_edit           = models.BooleanField(default=False)
    settings_vaccines_delete         = models.BooleanField(default=False)
    settings_vaccines_bulk_delete    = models.BooleanField(default=False)
    settings_vaccines_bulk_import    = models.BooleanField(default=False)
    settings_vaccines_import_web     = models.BooleanField(default=False)
    settings_doc_types_view          = models.BooleanField(default=False)
    settings_doc_types_edit          = models.BooleanField(default=False)
    settings_doc_types_delete        = models.BooleanField(default=False)
    settings_doc_types_bulk_delete   = models.BooleanField(default=False)
    settings_doc_types_bulk_import   = models.BooleanField(default=False)
    settings_prof_cards_view         = models.BooleanField(default=False)
    settings_prof_cards_edit         = models.BooleanField(default=False)
    settings_prof_cards_delete       = models.BooleanField(default=False)
    settings_prof_cards_bulk_delete  = models.BooleanField(default=False)
    settings_prof_cards_bulk_import  = models.BooleanField(default=False)
    settings_prof_cards_import_web   = models.BooleanField(default=False)
    settings_user_profiles_view      = models.BooleanField(default=False)
    settings_user_profiles_edit      = models.BooleanField(default=False)
    settings_user_profiles_delete    = models.BooleanField(default=False)
    settings_user_profiles_bulk_import = models.BooleanField(default=False)
    settings_list_additionals_view         = models.BooleanField(default=False)
    settings_list_additionals_edit         = models.BooleanField(default=False)
    settings_list_additionals_delete       = models.BooleanField(default=False)
    settings_list_additionals_bulk_delete  = models.BooleanField(default=False)
    settings_list_additionals_bulk_import  = models.BooleanField(default=False)
    settings_crew_roles_view         = models.BooleanField(default=False)
    settings_crew_roles_edit         = models.BooleanField(default=False)
    settings_crew_roles_delete       = models.BooleanField(default=False)
    settings_crew_roles_bulk_delete  = models.BooleanField(default=False)
    settings_crew_roles_bulk_import  = models.BooleanField(default=False)
    settings_accommodations_view         = models.BooleanField(default=False)
    settings_accommodations_edit         = models.BooleanField(default=False)
    settings_accommodations_delete       = models.BooleanField(default=False)
    settings_accommodations_bulk_delete  = models.BooleanField(default=False)
    settings_accommodations_bulk_import  = models.BooleanField(default=False)
    settings_list_categories_view         = models.BooleanField(default=False)
    settings_list_categories_edit         = models.BooleanField(default=False)
    settings_list_categories_delete       = models.BooleanField(default=False)
    settings_list_categories_bulk_delete  = models.BooleanField(default=False)
    settings_list_categories_bulk_import  = models.BooleanField(default=False)
    settings_airports_view           = models.BooleanField(default=False)
    settings_airports_edit           = models.BooleanField(default=False)
    settings_airports_delete         = models.BooleanField(default=False)
    settings_airports_bulk_delete    = models.BooleanField(default=False)
    settings_airports_bulk_import    = models.BooleanField(default=False)
    settings_airports_import_web     = models.BooleanField(default=False)
    settings_airlines_view           = models.BooleanField(default=False)
    settings_airlines_edit           = models.BooleanField(default=False)
    settings_airlines_delete         = models.BooleanField(default=False)
    settings_airlines_bulk_delete    = models.BooleanField(default=False)
    settings_airlines_bulk_import    = models.BooleanField(default=False)
    settings_airlines_import_web     = models.BooleanField(default=False)
    settings_bus_maps_view           = models.BooleanField(default=False)
    settings_bus_maps_edit           = models.BooleanField(default=False)
    settings_bus_maps_delete         = models.BooleanField(default=False)
    settings_bus_maps_bulk_import    = models.BooleanField(default=False)
    settings_contract_clauses_view   = models.BooleanField(default=False)
    settings_contract_clauses_edit   = models.BooleanField(default=False)
    settings_contract_clauses_delete = models.BooleanField(default=False)
    settings_contract_clauses_bulk_import = models.BooleanField(default=False)
    settings_terms_view              = models.BooleanField(default=False)
    settings_terms_edit              = models.BooleanField(default=False)
    settings_terms_bulk_import       = models.BooleanField(default=False)
    settings_operating_company_view  = models.BooleanField(default=False)
    settings_operating_company_edit  = models.BooleanField(default=False)
    settings_operating_company_bulk_import = models.BooleanField(default=False)
    settings_itinerary_categories_view        = models.BooleanField(default=False)
    settings_itinerary_categories_edit        = models.BooleanField(default=False)
    settings_itinerary_categories_delete      = models.BooleanField(default=False)
    settings_itinerary_categories_bulk_import = models.BooleanField(default=False)

    # Listas do Roteiro (Tipos de Roteiro · Companhias Marítimas · Moedas)
    settings_itinerary_types_view        = models.BooleanField(default=False)
    settings_itinerary_types_edit        = models.BooleanField(default=False)
    settings_itinerary_types_delete      = models.BooleanField(default=False)
    settings_maritime_companies_view     = models.BooleanField(default=False)
    settings_maritime_companies_edit     = models.BooleanField(default=False)
    settings_maritime_companies_delete   = models.BooleanField(default=False)
    settings_currencies_view             = models.BooleanField(default=False)
    settings_currencies_edit             = models.BooleanField(default=False)
    settings_currencies_delete           = models.BooleanField(default=False)
    settings_keywords_view               = models.BooleanField(default=False)
    settings_keywords_edit               = models.BooleanField(default=False)
    settings_keywords_delete             = models.BooleanField(default=False)
    settings_inclusions_view             = models.BooleanField(default=False)
    settings_inclusions_edit             = models.BooleanField(default=False)
    settings_inclusions_delete           = models.BooleanField(default=False)
    settings_highlights_view             = models.BooleanField(default=False)
    settings_highlights_edit             = models.BooleanField(default=False)
    settings_highlights_delete           = models.BooleanField(default=False)
    settings_special_dates_view          = models.BooleanField(default=False)
    settings_special_dates_edit          = models.BooleanField(default=False)
    settings_special_dates_delete        = models.BooleanField(default=False)

    # Exportar CSV (download) — granular por área. Antes o download dependia só
    # de "_view"; agora cada área tem permissão própria de download.
    settings_professions_export          = models.BooleanField(default=False)
    settings_languages_export            = models.BooleanField(default=False)
    settings_countries_export            = models.BooleanField(default=False)
    settings_genders_export              = models.BooleanField(default=False)
    settings_vaccines_export             = models.BooleanField(default=False)
    settings_doc_types_export            = models.BooleanField(default=False)
    settings_prof_cards_export           = models.BooleanField(default=False)
    settings_user_profiles_export        = models.BooleanField(default=False)
    settings_list_additionals_export     = models.BooleanField(default=False)
    settings_crew_roles_export           = models.BooleanField(default=False)
    settings_accommodations_export       = models.BooleanField(default=False)
    settings_list_categories_export      = models.BooleanField(default=False)
    settings_airports_export             = models.BooleanField(default=False)
    settings_airlines_export             = models.BooleanField(default=False)
    settings_bus_maps_export             = models.BooleanField(default=False)
    settings_contract_clauses_export     = models.BooleanField(default=False)
    settings_payment_methods_export      = models.BooleanField(default=False)
    settings_exchange_rates_export       = models.BooleanField(default=False)
    settings_terms_export                = models.BooleanField(default=False)
    settings_operating_company_export    = models.BooleanField(default=False)
    settings_itinerary_categories_export = models.BooleanField(default=False)
    # Granularidade de massa completada nos campos de Roteiro (antes só item a item)
    settings_itinerary_categories_bulk_delete = models.BooleanField(default=False)

    # Log do sistema — por área usa a mesma permissão "_view_logs" de cada
    # área (passengers_view_logs, lists_view_logs, agencies_view_logs,
    # users_view_logs, settings_view_logs), em vez de duplicar aqui.
    log_view       = models.BooleanField(default=False)
    log_page_views = models.BooleanField(default=False)

    # ── Lixeira (soft-delete) do USUÁRIO — nunca é removido de fato do banco.
    # Fica aqui (não dá pra adicionar campo direto no User do Django).
    is_deleted = models.BooleanField('Excluído', default=False, db_index=True)
    deleted_at = models.DateTimeField('Excluído em', null=True, blank=True)

    # ── Termos e condições — quando o usuário aceitou por último. Se os
    # termos forem editados depois dessa data, precisa aceitar de novo.
    terms_accepted_at = models.DateTimeField('Termos aceitos em', null=True, blank=True)

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
