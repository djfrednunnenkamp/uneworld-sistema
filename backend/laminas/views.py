from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from users_api.permissions import RequirePermission, agency_scope_ids, has_any_perm
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
        # laminas_view = interno (ver e fazer); laminas_agency = usuário de agência.
        if self.action in ('list', 'retrieve', 'roteiros', 'mine'):
            return [IsAuthenticated(), RequirePermission('laminas_view', 'laminas_agency')()]
        return [IsAuthenticated(), RequirePermission('laminas_view')()]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['get', 'patch'])
    def mine(self, request):
        """A ÚNICA lâmina do usuário (get-or-create). GET devolve a config salva;
        PATCH salva automaticamente. Usuário de AGÊNCIA só pode usar a própria
        agência; interno só usa logo de agência se tiver laminas_agency_logo."""
        obj = Lamina.objects.filter(created_by=request.user).order_by('id').first()
        if obj is None:
            obj = Lamina.objects.create(created_by=request.user)
        if request.method == 'PATCH':
            data = dict(request.data)
            scope = agency_scope_ids(request.user)
            if scope is not None:
                # Agência: força a própria agência (só os dados dela).
                data['source'] = 'agency'
                data['agency'] = scope[0] if scope else None
            elif data.get('source') == 'agency' and not has_any_perm(request.user, 'laminas_agency_logo'):
                # Interno sem a permissão de logo de agência → cai para operadora.
                data['source'] = 'operadora'
                data['agency'] = None
            ser = self.get_serializer(obj, data=data, partial=True)
            ser.is_valid(raise_exception=True)
            ser.save()
            return Response(ser.data)
        return Response(self.get_serializer(obj).data)

    @action(detail=False, methods=['get'])
    def roteiros(self, request):
        """Cards dos roteiros disponíveis para a lâmina: PÚBLICOS + PRIVADOS (os "não
        listados" ficam de fora) e que ainda NÃO começaram (start_date no futuro ou
        sem data). Usuário de agência vê os públicos + os privados compartilhados com
        a agência dele. Ordena pelos que começam mais cedo."""
        today = timezone.localdate()
        qs = (Itinerary.objects.filter(is_deleted=False).exclude(status='rascunho')
              .filter(Q(start_date__isnull=True) | Q(start_date__gte=today)))
        scope = agency_scope_ids(request.user)
        if scope is not None:
            qs = qs.filter(Q(visibility='public') | Q(visibility='agencies', shared_agencies__in=scope))
        else:
            qs = qs.filter(visibility__in=['public', 'agencies'])
        qs = qs.prefetch_related('images', 'cities').order_by('start_date', 'name').distinct()
        return Response([_card(it, request) for it in qs])
