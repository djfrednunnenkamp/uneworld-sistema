from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from users_api.permissions import RequirePermission, agency_scope_ids, has_any_perm
from itineraries.models import Itinerary
from itineraries.views import _itinerary_cover_url
from .models import Lamina, UserColorPalette
from .serializers import LaminaSerializer, UserColorPaletteSerializer


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


class ColorPaletteViewSet(viewsets.ModelViewSet):
    """Paletas de cores PESSOAIS do usuário (aba Lâminas). Cada usuário só enxerga,
    edita e exclui as próprias paletas — o escopo é sempre `request.user`, então não
    há como ver/alterar paleta de outro usuário (mesmo passando id na URL: 404)."""
    serializer_class = UserColorPaletteSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name']
    ordering_fields = ['name', 'updated_at', 'created_at', 'is_favorite', 'sort_order']
    ordering = ['-is_favorite', 'sort_order', 'name']

    def get_permissions(self):
        # Reusa as permissões de lâminas: quem pode ver/fazer lâminas gerencia as
        # próprias paletas. (Não há administração de paleta de terceiros.)
        return [IsAuthenticated(), RequirePermission('laminas_view', 'laminas_agency')()]

    def get_queryset(self):
        return UserColorPalette.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save()  # o serializer define user = request.user

    @action(detail=True, methods=['post'])
    def duplicate(self, request, pk=None):
        """Duplica a paleta (própria OU uma recomendada enviada no corpo) para o
        usuário. A cópia sempre pertence ao usuário autenticado."""
        src = self.get_object()
        if UserColorPalette.objects.filter(user=request.user).count() >= UserColorPalette.MAX_PER_USER:
            return Response({'error': f'Limite de {UserColorPalette.MAX_PER_USER} paletas atingido.'},
                            status=status.HTTP_400_BAD_REQUEST)
        copy = UserColorPalette.objects.create(
            user=request.user, name=f'{src.name} (cópia)'[:60], colors=list(src.colors or []))
        return Response(self.get_serializer(copy).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def favorite(self, request, pk=None):
        """Alterna o favorito da paleta."""
        obj = self.get_object()
        obj.is_favorite = not obj.is_favorite
        obj.save(update_fields=['is_favorite', 'updated_at'])
        return Response(self.get_serializer(obj).data)


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
