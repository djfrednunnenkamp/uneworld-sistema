import re
from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .models import Agency
from .serializers import AgencySerializer, AgencyListSerializer


class AgencyViewSet(viewsets.ModelViewSet):
    queryset        = Agency.objects.all()
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields   = ['name', 'company_name', 'email', 'cnpj', 'responsible']
    ordering_fields = ['name', 'created_at']

    def get_serializer_class(self):
        return AgencyListSerializer if self.action == 'list' else AgencySerializer

    @action(detail=False, methods=['get'], url_path='check-cnpj',
            permission_classes=[IsAuthenticated])
    def check_cnpj(self, request):
        cnpj = request.query_params.get('cnpj', '').strip()
        if not cnpj:
            return Response({'error': 'CNPJ não informado.'}, status=400)
        digits = re.sub(r'\D', '', cnpj)
        from django.db.models import Q
        agency = Agency.objects.filter(
            Q(cnpj=cnpj) | Q(cnpj=digits)
        ).exclude(cnpj='').first()
        if agency:
            name = agency.company_name or agency.name or f'Agência #{agency.pk}'
            return Response({'exists': True, 'id': agency.id, 'name': name})
        return Response({'exists': False})
