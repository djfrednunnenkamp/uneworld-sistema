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

        # Navegação entre páginas (PageView) só aparece quando explicitamente
        # pedida via filtro Tipo, e só para quem tem a permissão — por padrão
        # fica de fora pra não poluir a visão de quem está revisando o log.
        if model == 'PageView':
            qs = qs.filter(model_name='PageView') if has_page_view_access else qs.none()
            model = ''
        else:
            qs = qs.exclude(model_name='PageView')

        if scope == 'settings' and not has_log_settings:
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
                area_q |= DQ(model_name__in=['Passenger', 'PassengerDocument'])
            if has_log_lists:
                area_q |= DQ(model_name__in=['PassengerList', 'ListEnrollment'])
            if has_log_agencies:
                area_q |= DQ(model_name='Agency')
            if has_log_users:
                area_q |= DQ(model_name__in=['User', 'UserPermissions'])
            if has_log_settings:
                area_q |= DQ(model_name__in=SETTINGS_MODELS)
            if area_q.children:
                qs = qs.filter(area_q)

        if scope == 'settings': qs = qs.filter(model_name__in=SETTINGS_MODELS)
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


@api_view(['POST'])
@drf_permission_classes([IsAuthenticated])
def log_upload(request):
    """Registra um upload/importação de CSV feito pelo frontend (ex: FlatImport,
    GeoImport) — esses fluxos chamam várias APIs de criação em sequência e não
    têm, no backend, um único request que represente "o upload" inteiro."""
    label = (request.data.get('label') or '').strip()[:200]
    model_label = (request.data.get('model_label') or 'Importação CSV').strip()[:100]
    summary = request.data.get('summary') or {}
    if not label:
        return Response({'error': 'label é obrigatório.'}, status=400)
    user = request.user
    AuditLog.objects.create(
        user=user, user_display=user_display(user), action='upload',
        model_name=request.data.get('model_name') or 'CsvImport', model_label=model_label,
        object_id='', object_repr=label,
        changes=summary if isinstance(summary, dict) else {},
        ip_address=get_current_ip(),
    )
    return Response({'ok': True}, status=201)


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
