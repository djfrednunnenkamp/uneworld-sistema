from rest_framework import viewsets, filters
from .models import Agency
from .serializers import AgencySerializer, AgencyListSerializer


class AgencyViewSet(viewsets.ModelViewSet):
    queryset        = Agency.objects.all()
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields   = ['name', 'email', 'cnpj', 'responsible']
    ordering_fields = ['name', 'created_at']

    def get_serializer_class(self):
        return AgencyListSerializer if self.action == 'list' else AgencySerializer
