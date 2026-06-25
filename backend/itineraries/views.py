from rest_framework import viewsets, filters

from core.pagination import StandardResultsPagination
from core.soft_delete import SoftDeleteViewSetMixin
from users_api.permissions import RequirePermission

from .models import Itinerary
from .serializers import ItinerarySerializer, ItineraryListSerializer


class ItineraryViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset         = Itinerary.objects.select_related('category', 'continent').prefetch_related('countries', 'cities')
    pagination_class = StandardResultsPagination
    filter_backends  = [filters.SearchFilter, filters.OrderingFilter]
    search_fields    = ['name', 'slug']
    ordering_fields  = ['created_at', 'start_date', 'name']

    def get_serializer_class(self):
        return ItineraryListSerializer if self.action == 'list' else ItinerarySerializer

    def get_permissions(self):
        if self.action == 'destroy':
            return [RequirePermission('roteiros_delete')()]
        if self.action in ('create', 'update', 'partial_update', 'restore', 'purge'):
            return [RequirePermission('roteiros_edit')()]
        return [RequirePermission('roteiros_view', 'roteiros_edit', 'roteiros_delete')()]
