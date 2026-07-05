import urllib.request

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils.crypto import get_random_string
from django.views.decorators.csrf import csrf_exempt
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action, api_view, permission_classes, authentication_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from core.pagination import StandardResultsPagination
from core.soft_delete import SoftDeleteViewSetMixin
from users_api.permissions import RequirePermission

from . import onlyoffice
from .models import (Itinerary, ItineraryImage, ItineraryFieldTemplate, ItineraryDeparture,
                     ItineraryFlight, ItineraryHotel, ItineraryBoat,
                     ItineraryTerrestreDeparture, ItineraryTerrestreLeg, ItineraryDocument)
from .serializers import (ItinerarySerializer, ItineraryListSerializer,
                          ItineraryImageSerializer, ItineraryFieldTemplateSerializer,
                          ItineraryDepartureSerializer, ItineraryFlightSerializer,
                          ItineraryHotelSerializer, ItineraryBoatSerializer,
                          ItineraryTerrestreDepartureSerializer, ItineraryTerrestreLegSerializer,
                          ItineraryDocumentSerializer)


def _roteiro_edit_permissions(self):
    """Ler: quem vê roteiros; criar/editar/excluir: quem edita roteiros."""
    if self.action in ('list', 'retrieve'):
        return [RequirePermission('roteiros_view', 'roteiros_edit', 'roteiros_delete')()]
    return [RequirePermission('roteiros_edit')()]


class ItineraryDepartureViewSet(viewsets.ModelViewSet):
    """Aeroportos de saída de um roteiro (aba Voo). Filtra por ?itinerary=<id>."""
    serializer_class = ItineraryDepartureSerializer
    pagination_class = None
    get_permissions  = _roteiro_edit_permissions

    def get_queryset(self):
        qs = ItineraryDeparture.objects.select_related('airport')
        if self.action == 'list':   # o filtro só vale na listagem; detalhe (get/put/delete) usa tudo
            itinerary = self.request.query_params.get('itinerary')
            return qs.filter(itinerary_id=itinerary) if itinerary else qs.none()
        return qs


class ItineraryFlightViewSet(viewsets.ModelViewSet):
    """Voos de um aeroporto de saída (aba Voo). Filtra por ?departure=<id>."""
    serializer_class = ItineraryFlightSerializer
    pagination_class = None
    get_permissions  = _roteiro_edit_permissions

    def get_queryset(self):
        qs = ItineraryFlight.objects.select_related('airline', 'origin', 'destination')
        if self.action == 'list':   # filtro só na listagem; detalhe (get/put/delete) usa tudo
            departure = self.request.query_params.get('departure')
            return qs.filter(departure_id=departure) if departure else qs.none()
        return qs

    @action(detail=False, methods=['post'], url_path='reorder')
    def reorder(self, request):
        """Reordena os voos na sequência informada: body {"order": [id1, id2, ...]}."""
        ids = request.data.get('order') or []
        valid = set(ItineraryFlight.objects.filter(pk__in=ids).values_list('id', flat=True))
        with transaction.atomic():
            for pos, fid in enumerate(ids):
                if fid in valid:
                    ItineraryFlight.objects.filter(pk=fid).update(order=pos)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ItineraryTerrestreDepartureViewSet(viewsets.ModelViewSet):
    """Cidades de partida de um roteiro (aba Terrestre). Filtra por ?itinerary=<id>."""
    serializer_class = ItineraryTerrestreDepartureSerializer
    pagination_class = None
    get_permissions  = _roteiro_edit_permissions

    def get_queryset(self):
        qs = ItineraryTerrestreDeparture.objects.select_related('city__state__country')
        if self.action == 'list':
            itinerary = self.request.query_params.get('itinerary')
            return qs.filter(itinerary_id=itinerary) if itinerary else qs.none()
        return qs


class ItineraryTerrestreLegViewSet(viewsets.ModelViewSet):
    """Trechos terrestres de uma cidade de partida. Filtra por ?departure=<id>."""
    serializer_class = ItineraryTerrestreLegSerializer
    pagination_class = None
    get_permissions  = _roteiro_edit_permissions

    def get_queryset(self):
        qs = ItineraryTerrestreLeg.objects.select_related('company', 'origin__state__country', 'destination__state__country')
        if self.action == 'list':
            departure = self.request.query_params.get('departure')
            return qs.filter(departure_id=departure) if departure else qs.none()
        return qs

    @action(detail=False, methods=['post'], url_path='reorder')
    def reorder(self, request):
        ids = request.data.get('order') or []
        valid = set(ItineraryTerrestreLeg.objects.filter(pk__in=ids).values_list('id', flat=True))
        with transaction.atomic():
            for pos, lid in enumerate(ids):
                if lid in valid:
                    ItineraryTerrestreLeg.objects.filter(pk=lid).update(order=pos)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ItineraryHotelViewSet(viewsets.ModelViewSet):
    """Hotéis reservados de um roteiro (aba Hotéis). Filtra por ?itinerary=<id>."""
    serializer_class = ItineraryHotelSerializer
    pagination_class = None
    get_permissions  = _roteiro_edit_permissions

    def get_queryset(self):
        qs = ItineraryHotel.objects.all()
        if self.action == 'list':
            itinerary = self.request.query_params.get('itinerary')
            return qs.filter(itinerary_id=itinerary) if itinerary else qs.none()
        return qs


class ItineraryBoatViewSet(viewsets.ModelViewSet):
    """Barcos reservados de um roteiro (aba Barco). Filtra por ?itinerary=<id>."""
    serializer_class = ItineraryBoatSerializer
    pagination_class = None
    get_permissions  = _roteiro_edit_permissions

    def get_queryset(self):
        qs = ItineraryBoat.objects.all()
        if self.action == 'list':
            itinerary = self.request.query_params.get('itinerary')
            return qs.filter(itinerary_id=itinerary) if itinerary else qs.none()
        return qs


class ItineraryDocumentViewSet(viewsets.ModelViewSet):
    """Documentos anexados ao roteiro (painel da aba Observações). Filtra por
    ?itinerary=<id>. Aceita upload de arquivo (multipart) ou link (JSON)."""
    serializer_class = ItineraryDocumentSerializer
    pagination_class = None
    parser_classes   = [MultiPartParser, FormParser, JSONParser]
    get_permissions  = _roteiro_edit_permissions

    def get_queryset(self):
        qs = ItineraryDocument.objects.all()
        if self.action == 'list':
            itinerary = self.request.query_params.get('itinerary')
            return qs.filter(itinerary_id=itinerary) if itinerary else qs.none()
        return qs

    def perform_create(self, serializer):
        itinerary = serializer.validated_data.get('itinerary')
        last = ItineraryDocument.objects.filter(itinerary=itinerary).order_by('-order').first()
        serializer.save(order=(last.order + 1) if last else 0)

    @action(detail=True, methods=['get'], url_path='config')
    def config(self, request, pk=None):
        """Config assinada para o editor OnlyOffice no navegador."""
        doc = self.get_object()
        if not onlyoffice.is_configured():
            return Response({'detail': 'Editor OnlyOffice não configurado.'}, status=status.HTTP_409_CONFLICT)
        if not doc.file:
            return Response({'detail': 'Este item é um link, não um arquivo.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            return Response(onlyoffice.editor_config(doc, request.user))
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@csrf_exempt
@api_view(['POST'])
@authentication_classes([])          # o DS chama sem sessão de usuário
@permission_classes([AllowAny])      # protegido pela assinatura JWT, não por login
def document_callback(request, pk):
    """Callback do OnlyOffice: ao salvar, o DS envia o arquivo editado aqui."""
    doc = ItineraryDocument.objects.filter(pk=pk).first()
    if not doc:
        return Response({'error': 1})
    payload = request.data or {}

    # Valida o JWT do callback (corpo pode vir assinado dentro de `token`).
    secret = getattr(settings, 'ONLYOFFICE_JWT_SECRET', '')
    if secret:
        token = payload.get('token') or (request.headers.get('Authorization', '').replace('Bearer ', '') or '')
        try:
            decoded = onlyoffice.jwt_decode(token, secret)
            payload = decoded.get('payload', decoded)
        except Exception:
            return Response({'error': 1})

    # status 2 = pronto para salvar; 6 = force save (salvamento manual/intermediário).
    if payload.get('status') in (2, 6):
        file_url = payload.get('url')
        if file_url:
            try:
                with urllib.request.urlopen(file_url, timeout=30) as resp:
                    content = resp.read()
                doc.file.save(doc.file.name.split('/')[-1], ContentFile(content), save=False)
                doc.edit_key = get_random_string(12)
                doc.save(update_fields=['file', 'edit_key', 'updated_at'])
            except Exception:
                return Response({'error': 1})
    return Response({'error': 0})


class ItineraryFieldTemplateViewSet(viewsets.ModelViewSet):
    """CRUD dos templates de campo (aba Informações do Roteiro). Ler é liberado a
    quem edita roteiros (para escolher no dropdown); criar/editar/excluir exige
    quem gerencia Configurações. Ao editar um template, o texto é reaplicado aos
    roteiros vinculados (vínculo vivo)."""
    serializer_class = ItineraryFieldTemplateSerializer
    pagination_class = None

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [RequirePermission('manage_settings', 'roteiros_view', 'roteiros_edit', 'roteiros_delete')()]
        return [RequirePermission('manage_settings')()]

    def get_queryset(self):
        qs = ItineraryFieldTemplate.objects.all()
        field = self.request.query_params.get('field')
        return qs.filter(field=field) if field else qs

    def perform_update(self, serializer):
        template = serializer.save()
        template.apply_to_linked()   # propaga o novo conteúdo aos roteiros vinculados


class ItineraryViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset         = Itinerary.objects.select_related(
        'category', 'continent', 'itinerary_type', 'maritime_company',
    ).prefetch_related(
        'accommodation_lines__accommodation_type',
        'cities__state__country', 'countries', 'airports', 'keywords', 'inclusions', 'highlights',
        'itinerary_types', 'special_dates', 'continents',
        'days__city', 'days__images', 'images',
    )
    pagination_class = StandardResultsPagination
    filter_backends  = [filters.SearchFilter, filters.OrderingFilter]
    search_fields    = ['name', 'slug']
    ordering_fields  = ['created_at', 'start_date', 'name']

    def get_queryset(self):
        qs = super().get_queryset()   # aplica o filtro is_deleted do mixin
        if self.action == 'list':     # só a listagem separa rascunho de ativo
            if self.request.query_params.get('status') == 'rascunho':
                qs = qs.filter(status='rascunho')
            else:
                qs = qs.exclude(status='rascunho')
        return qs

    def get_serializer_class(self):
        return ItineraryListSerializer if self.action == 'list' else ItinerarySerializer

    def get_permissions(self):
        if self.action == 'destroy':
            return [RequirePermission('roteiros_delete')()]
        if self.action in ('create', 'update', 'partial_update', 'restore', 'purge',
                           'upload_image', 'delete_image', 'reorder_images', 'set_image_kind'):
            return [RequirePermission('roteiros_edit')()]
        return [RequirePermission('roteiros_view', 'roteiros_edit', 'roteiros_delete')()]

    # ── Galeria de imagens (upload multipart — não cabe no PUT/JSON) ──
    @action(detail=True, methods=['post'], url_path='images')
    def upload_image(self, request, pk=None):
        """POST /api/itineraries/{id}/images/  (multipart: image, caption?, kind?, order?, day?).
        `kind`: gallery (padrão), cover, blocking, blocking_promo. Se `day` (id de um
        ItineraryDay deste roteiro) vier, a imagem é do DIA (kind = gallery)."""
        itinerary = self.get_object()
        day = None
        day_id = request.data.get('day')
        if day_id:
            day = itinerary.days.filter(pk=day_id).first()
            if day is None:
                return Response({'detail': 'Dia inválido para este roteiro.'}, status=status.HTTP_400_BAD_REQUEST)
        ser = ItineraryImageSerializer(data=request.data, context=self.get_serializer_context())
        ser.is_valid(raise_exception=True)
        # Validação de segurança (tamanho, extensão × magic bytes, anti image-bomb,
        # re-processamento que remove metadados/payloads) — mesma dos passageiros.
        from passengers.validators import validate_document_file
        from django.core.exceptions import ValidationError as DjangoValidationError
        try:
            validate_document_file(ser.validated_data['image'],
                                   allowed_exts={'.jpg', '.jpeg', '.png'}, allow_images=True)
        except DjangoValidationError as e:
            return Response({'image': e.messages}, status=status.HTTP_400_BAD_REQUEST)
        kind = ser.validated_data.get('kind') or 'gallery'
        if day is not None:
            kind = 'gallery'
        img = ser.save(itinerary=itinerary, day=day, kind=kind)
        out = ItineraryImageSerializer(img, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'images/(?P<image_id>[0-9]+)')
    def delete_image(self, request, pk=None, image_id=None):
        """DELETE /api/itineraries/{id}/images/{image_id}/"""
        itinerary = self.get_object()
        img = itinerary.images.filter(pk=image_id).first()
        if img is None:
            return Response({'detail': 'Imagem não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        img.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path=r'images/(?P<image_id>[0-9]+)/kind')
    def set_image_kind(self, request, pk=None, image_id=None):
        """POST /api/itineraries/{id}/images/{image_id}/kind/  body: {"kind": "..."}.
        Move a imagem entre capa/galeria/lâminas (arrastar de um campo para outro).
        Ao mover para uma lâmina (single), o ocupante anterior vira galeria."""
        itinerary = self.get_object()
        img = itinerary.images.filter(pk=image_id, day__isnull=True).first()
        if img is None:
            return Response({'detail': 'Imagem não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        kind = request.data.get('kind')
        valid = {c[0] for c in ItineraryImage.KIND_CHOICES}
        if kind not in valid:
            return Response({'detail': 'Tipo inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            if kind in ('blocking', 'blocking_promo'):
                itinerary.images.filter(kind=kind, day__isnull=True).exclude(pk=img.pk).update(kind='gallery')
            img.kind = kind
            img.save(update_fields=['kind'])
        out = ItineraryImageSerializer(img, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='images/reorder')
    def reorder_images(self, request, pk=None):
        """POST /api/itineraries/{id}/images/reorder/  body: {"order": [id1, id2, ...]}.
        Reordena as imagens da GALERIA (day nulo) na sequência informada."""
        itinerary = self.get_object()
        order = request.data.get('order') or []
        valid = set(itinerary.images.filter(day__isnull=True).values_list('id', flat=True))
        with transaction.atomic():
            for pos, img_id in enumerate(order):
                if img_id in valid:
                    itinerary.images.filter(pk=img_id).update(order=pos)
        return Response(status=status.HTTP_204_NO_CONTENT)
