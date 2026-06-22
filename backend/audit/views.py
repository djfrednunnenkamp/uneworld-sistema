from rest_framework import serializers, viewsets, filters
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from users_api.permissions import RequirePermission, has_any_perm
from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    action_label = serializers.CharField(source='get_action_display', read_only=True)
    timestamp_br = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            'id', 'timestamp', 'timestamp_br',
            'user_display', 'action', 'action_label',
            'model_label', 'object_id', 'object_repr',
            'changes', 'ip_address',
        ]

    def get_timestamp_br(self, obj):
        from django.utils import timezone
        local = timezone.localtime(obj.timestamp)
        return local.strftime('%d/%m/%Y %H:%M:%S')


class AuditPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 200


# Modelos cobertos pelo botão "Log" da página Configurações (scope=settings)
SETTINGS_MODELS = [
    'ConfigProfession', 'ConfigLanguage', 'ConfigCountry', 'ConfigState', 'ConfigCity',
    'ConfigGender', 'ConfigVaccine', 'ConfigProfCard', 'CustomDocType', 'CustomDocField',
    'ConfigAccommodation', 'ConfigListCategory', 'ListAdditional', 'CrewRole', 'Destination',
    'Airport', 'Airline', 'BusMap', 'PermissionProfile',
]

# Botão "Log" de cada área do sistema: clicar nele tem que mostrar TUDO que é
# relevante pra área, não só o modelo "principal" — ex: Lista de Passageiros
# inclui também ListEnrollment (passageiro entrando/saindo/mudando na lista).
SCOPE_MODELS = {
    'settings':   SETTINGS_MODELS,
    'lists':      ['PassengerList', 'ListEnrollment'],
    'passengers': ['Passenger', 'PassengerDocument'],
    'agencies':   ['Agency'],
    'users':      ['User', 'UserPermissions'],
}


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Qualquer usuário autenticado pode acessar — get_queryset() decide o que ele
    vê: acesso amplo com permissão de log, escopo de uma área específica (ex:
    passengers_view_logs), ou — sem nenhuma permissão de log — só as próprias ações."""
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = AuditPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['user_display', 'object_repr', 'model_label']
    ordering = ['-timestamp']

    def get_queryset(self):
        qs = AuditLog.objects.select_related('user').all()
        action = self.request.query_params.get('action')
        model  = self.request.query_params.get('model')
        user_search = self.request.query_params.get('user')
        user_id_filter = self.request.query_params.get('user_id')
        date_from = self.request.query_params.get('date_from')
        date_to   = self.request.query_params.get('date_to')
        object_id = self.request.query_params.get('object_id')
        list_id      = self.request.query_params.get('list_id')
        passenger_id = self.request.query_params.get('passenger_id')
        agency_id    = self.request.query_params.get('agency_id')
        scope        = self.request.query_params.get('scope')
        show_nav     = self.request.query_params.get('show_nav') in ('1', 'true', 'True')

        current_user = self.request.user
        has_global = has_any_perm(current_user, 'view_audit_log', 'log_view')
        has_log_passengers = has_global or has_any_perm(current_user, 'log_passengers')
        has_log_lists      = has_global or has_any_perm(current_user, 'log_lists')
        has_log_agencies   = has_global or has_any_perm(current_user, 'log_agencies')
        has_log_users      = has_global or has_any_perm(current_user, 'log_users')
        has_log_settings   = has_global or has_any_perm(current_user, 'log_settings')
        has_any_area = (has_log_passengers or has_log_lists or has_log_agencies
                        or has_log_users or has_log_settings)
        has_page_view_access = has_global or has_any_perm(current_user, 'log_page_views')

        # Navegação entre páginas (PageView) e login/logout: por padrão ficam fora
        # pra não poluir a visão de quem está revisando o log (login sozinho já é
        # a maioria das entradas no dia a dia). Duas formas de trazer de volta —
        # independentes uma da outra:
        # - Tipo = Navegação (páginas): mostra SÓ as entradas de navegação.
        # - Ação = Login/Logout: mostra só essa ação (filtro explícito).
        # - toggle "Ver navegação dos usuários" (show_nav): mistura navegação +
        #   login/logout com tudo que já está sendo mostrado pelos outros filtros
        #   (usuário, ação, período, busca…), sem substituí-los.
        include_page_views = has_page_view_access and (model == 'PageView' or show_nav)
        if model == 'PageView':
            qs = qs.filter(model_name='PageView') if has_page_view_access else qs.none()
            model = ''
        elif not include_page_views:
            qs = qs.exclude(model_name='PageView')

        include_login_noise = show_nav or action in ('login', 'logout')
        if not include_login_noise:
            qs = qs.exclude(action__in=['login', 'logout'])

        scope_perms = {
            'settings': has_log_settings, 'lists': has_log_lists,
            'passengers': has_log_passengers, 'agencies': has_log_agencies, 'users': has_log_users,
        }
        if scope in scope_perms and not scope_perms[scope]:
            return qs.none()

        # Sem nenhuma permissão de log e sem pedir um escopo específico (lista,
        # passageiro, agência…): em vez de não mostrar nada, mostra só as
        # próprias ações da pessoa — todo usuário pode ver seu próprio histórico.
        if not has_any_area and not (list_id or passenger_id or agency_id or scope):
            return qs.filter(user=current_user)

        # Se não tem acesso global, filtra apenas as áreas com permissão
        if not has_global:
            from django.db.models import Q as DQ
            area_q = DQ()
            if has_log_passengers:
                area_q |= DQ(model_name__in=SCOPE_MODELS['passengers'])
            if has_log_lists:
                area_q |= DQ(model_name__in=SCOPE_MODELS['lists'])
            if has_log_agencies:
                area_q |= DQ(model_name__in=SCOPE_MODELS['agencies'])
            if has_log_users:
                area_q |= DQ(model_name__in=SCOPE_MODELS['users'])
            if has_log_settings:
                area_q |= DQ(model_name__in=SETTINGS_MODELS)
            if show_nav and has_page_view_access:
                area_q |= DQ(model_name='PageView') | DQ(action__in=['login', 'logout'])
            if area_q.children:
                qs = qs.filter(area_q)

        if scope in SCOPE_MODELS: qs = qs.filter(model_name__in=SCOPE_MODELS[scope])
        if action:    qs = qs.filter(action=action)
        if model:     qs = qs.filter(model_name=model)
        if object_id: qs = qs.filter(object_id=object_id)
        if user_search:    qs = qs.filter(user_display__icontains=user_search)
        if user_id_filter: qs = qs.filter(user_id=user_id_filter)
        if date_from: qs = qs.filter(timestamp__date__gte=date_from)
        if date_to:   qs = qs.filter(timestamp__date__lte=date_to)
        if list_id:
            from trips.models import ListEnrollment
            from django.db.models import Q
            enrollment_ids = list(
                ListEnrollment.objects.filter(passenger_list_id=list_id)
                .values_list('id', flat=True)
            )
            qs = qs.filter(
                Q(model_name='ListEnrollment', object_id__in=[str(i) for i in enrollment_ids]) |
                Q(model_name='PassengerList', object_id=str(list_id))
            )
        if passenger_id:
            from passengers.models import PassengerDocument
            from django.db.models import Q
            doc_ids = list(
                PassengerDocument.objects.filter(passenger_id=passenger_id)
                .values_list('id', flat=True)
            )
            qs = qs.filter(
                Q(model_name='Passenger', object_id=str(passenger_id)) |
                Q(model_name='PassengerDocument', object_id__in=[str(i) for i in doc_ids])
            )
        if agency_id:
            qs = qs.filter(model_name='Agency', object_id=str(agency_id))
        return qs


from rest_framework.decorators import api_view, permission_classes as drf_permission_classes
from rest_framework.response import Response
from audit.middleware import get_current_ip
from audit.tracking import user_display


def _log_client_event(request, action, default_model_name, default_model_label):
    """Registra um upload/download disparado pelo frontend (ex: exportação/importação
    de CSV em Configurações) — esses fluxos não passam por um único request de
    backend que represente "a ação" inteira, então o frontend chama isso direto."""
    label = (request.data.get('label') or '').strip()[:200]
    model_label = (request.data.get('model_label') or default_model_label).strip()[:100]
    summary = request.data.get('summary') or {}
    if not label:
        return Response({'error': 'label é obrigatório.'}, status=400)
    user = request.user
    AuditLog.objects.create(
        user=user, user_display=user_display(user), action=action,
        model_name=request.data.get('model_name') or default_model_name, model_label=model_label,
        object_id='', object_repr=label,
        changes=summary if isinstance(summary, dict) else {},
        ip_address=get_current_ip(),
    )
    return Response({'ok': True}, status=201)


@api_view(['POST'])
@drf_permission_classes([IsAuthenticated])
def log_upload(request):
    return _log_client_event(request, 'upload', 'CsvImport', 'Importação CSV')


@api_view(['POST'])
@drf_permission_classes([IsAuthenticated])
def log_download(request):
    return _log_client_event(request, 'download', 'CsvExport', 'Exportação CSV')


@api_view(['POST'])
@drf_permission_classes([IsAuthenticated])
def log_page_view(request):
    """Registra que o usuário autenticado navegou para uma página do sistema —
    chamado automaticamente pelo frontend a cada troca de rota (ver Layout.jsx)."""
    path  = (request.data.get('path') or '').strip()[:500]
    label = (request.data.get('label') or '').strip()[:200]
    if not path:
        return Response({'error': 'path é obrigatório.'}, status=400)
    user = request.user
    AuditLog.objects.create(
        user=user, user_display=user_display(user), action='view',
        model_name='PageView', model_label='Página',
        object_id='', object_repr=label or path,
        changes={'Caminho': path} if label else {},
        ip_address=get_current_ip(),
    )
    return Response({'ok': True}, status=201)
