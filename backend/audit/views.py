from rest_framework import serializers, viewsets, filters
from rest_framework.pagination import PageNumberPagination
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


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AuditLogSerializer
    permission_classes = [RequirePermission(
        'view_audit_log', 'log_view', 'log_passengers', 'log_lists', 'log_agencies',
        'log_users', 'log_settings', 'lists_view_logs', 'passengers_view_logs', 'agencies_view_logs',
    )]
    pagination_class = AuditPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['user_display', 'object_repr', 'model_label']
    ordering = ['-timestamp']

    def get_queryset(self):
        qs = AuditLog.objects.select_related('user').all()
        action = self.request.query_params.get('action')
        model  = self.request.query_params.get('model')
        user   = self.request.query_params.get('user')
        date_from = self.request.query_params.get('date_from')
        date_to   = self.request.query_params.get('date_to')
        object_id = self.request.query_params.get('object_id')
        list_id      = self.request.query_params.get('list_id')
        passenger_id = self.request.query_params.get('passenger_id')
        agency_id    = self.request.query_params.get('agency_id')

        user = self.request.user
        has_global = has_any_perm(user, 'view_audit_log', 'log_view')
        has_log_passengers = has_global or has_any_perm(user, 'log_passengers')
        has_log_lists      = has_global or has_any_perm(user, 'log_lists')
        has_log_agencies   = has_global or has_any_perm(user, 'log_agencies')
        has_log_users      = has_global or has_any_perm(user, 'log_users')
        has_log_settings   = has_global or has_any_perm(user, 'log_settings')
        has_any_area = (has_log_passengers or has_log_lists or has_log_agencies
                        or has_log_users or has_log_settings)

        if not has_any_area and not (list_id or passenger_id or agency_id):
            return qs.none()

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
                area_q |= DQ(model_name__in=[
                    'ConfigProfession', 'ConfigLanguage', 'ConfigCountry', 'ConfigState',
                    'ConfigGender', 'ConfigVaccine', 'CustomDocType', 'ConfigProfCard',
                    'Destination', 'ListAdditional', 'CrewRole',
                ])
            if area_q.children:
                qs = qs.filter(area_q)

        if action:    qs = qs.filter(action=action)
        if model:     qs = qs.filter(model_name=model)
        if object_id: qs = qs.filter(object_id=object_id)
        if user:      qs = qs.filter(user_display__icontains=user)
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
