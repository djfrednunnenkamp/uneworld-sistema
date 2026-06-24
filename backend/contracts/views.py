from rest_framework import viewsets, filters

from core.pagination import StandardResultsPagination
from core.soft_delete import SoftDeleteViewSetMixin
from users_api.permissions import RequirePermission

from .models import Contract
from .serializers import ContractListSerializer, ContractSerializer


class ContractViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset        = Contract.objects.select_related('agency', 'contratante', 'passenger_list').prefetch_related(
        'accommodation_lines', 'guests', 'installments', 'clauses')
    pagination_class = StandardResultsPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields   = ['reservation_number', 'package_name', 'contratante__full_name',
                       'agency__name', 'agency__company_name']
    ordering_fields = ['created_at', 'contract_date', 'departure_date']

    def get_serializer_class(self):
        return ContractListSerializer if self.action == 'list' else ContractSerializer

    def get_permissions(self):
        if self.action == 'destroy':
            return [RequirePermission('contracts_delete')()]
        if self.action in ('create', 'update', 'partial_update', 'restore', 'purge'):
            return [RequirePermission('contracts_edit')()]
        return [RequirePermission('contracts_view', 'contracts_edit', 'contracts_delete')()]
