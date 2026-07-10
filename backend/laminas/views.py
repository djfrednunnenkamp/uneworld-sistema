from django.db.models import Q
from django.utils import timezone
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
        if self.action == 'mine' and self.request.method in ('PATCH', 'PUT'):
            return [IsAuthenticated(), RequirePermission('laminas_edit')()]
        if self.action in ('list', 'retrieve', 'roteiros', 'mine'):
            return [IsAuthenticated(), RequirePermission('laminas_view', 'laminas_edit')()]
        return [IsAuthenticated(), RequirePermission('laminas_edit')()]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['get', 'patch'])
    def mine(self, request):
        """A ÚNICA lâmina do usuário (get-or-create). A página é um editor só: GET
        devolve a config salva; PATCH salva automaticamente as alterações."""
        obj = Lamina.objects.filter(created_by=request.user).order_by('id').first()
        if obj is None:
            obj = Lamina.objects.create(created_by=request.user)
        if request.method == 'PATCH':
            ser = self.get_serializer(obj, data=request.data, partial=True)
            ser.is_valid(raise_exception=True)
            ser.save()
            return Response(ser.data)
        return Response(self.get_serializer(obj).data)

    @action(detail=False, methods=['get'])
    def roteiros(self, request):
        """Cards dos roteiros disponíveis para a lâmina: PÚBLICOS (publicados na
        vitrine — os exclusivos/privados ficam de fora) e que ainda NÃO começaram
        (start_date no futuro ou sem data). Ordena pelos que começam mais cedo."""
        today = timezone.localdate()
        qs = (Itinerary.objects.filter(is_deleted=False, is_published=True)
              .filter(Q(start_date__isnull=True) | Q(start_date__gte=today))
              .prefetch_related('images', 'cities')
              .order_by('start_date', 'name'))
        return Response([_card(it, request) for it in qs])
