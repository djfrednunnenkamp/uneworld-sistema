from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from users_api.permissions import RequirePermission
from itineraries.models import Itinerary
from itineraries.views import _itinerary_cover_url
from .models import Lamina
from .serializers import LaminaSerializer


def _card(it, request):
    """Dados de um roteiro para um card da lâmina: capa, título, destinos e datas."""
    return {
        'id': it.id,
        'name': it.name,
        'cover': _itinerary_cover_url(it, request),
        'cities': [c.name for c in it.cities.all() if c.name],
        'start_date': it.start_date,
        'end_date': it.end_date,
        'nights_override': it.nights_override,
    }


class LaminaViewSet(viewsets.ModelViewSet):
    """CRUD das lâminas (cartazes de roteiros). Ver exige laminas_view; criar/
    editar/excluir exige laminas_edit."""
    serializer_class = LaminaSerializer
    queryset = Lamina.objects.all()

    def get_permissions(self):
        if self.action in ('list', 'retrieve', 'roteiros'):
            return [IsAuthenticated(), RequirePermission('laminas_view', 'laminas_edit')()]
        return [IsAuthenticated(), RequirePermission('laminas_edit')()]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['get'])
    def roteiros(self, request):
        """Cards de TODOS os roteiros (para escolher e renderizar na lâmina)."""
        qs = (Itinerary.objects.filter(is_deleted=False)
              .prefetch_related('images', 'cities')
              .order_by('-start_date', 'name'))
        return Response([_card(it, request) for it in qs])
