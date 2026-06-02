from rest_framework import serializers, viewsets, filters
from rest_framework.permissions import IsAdminUser
from rest_framework.pagination import PageNumberPagination
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
    permission_classes = [IsAdminUser]
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
        if action:    qs = qs.filter(action=action)
        if model:     qs = qs.filter(model_name=model)
        if object_id: qs = qs.filter(object_id=object_id)
        if user:      qs = qs.filter(user_display__icontains=user)
        if date_from: qs = qs.filter(timestamp__date__gte=date_from)
        if date_to:   qs = qs.filter(timestamp__date__lte=date_to)
        return qs
