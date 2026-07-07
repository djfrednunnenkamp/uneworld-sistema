import json
import urllib.request

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from django.utils.crypto import get_random_string
from django.views.decorators.csrf import csrf_exempt
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action, api_view, permission_classes, authentication_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from core.pagination import StandardResultsPagination
from core.soft_delete import SoftDeleteViewSetMixin
from users_api.permissions import RequirePermission, is_operadora_user

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


def _audit(request, action, obj, model_name='Itinerary', model_label='Roteiro', changes=None):
    """Registra um evento de auditoria de roteiro (publicar, upload, reordenar…).
    Eventos que os signals automáticos não capturam (ações e bulk updates)."""
    from audit.models import AuditLog
    from audit.tracking import user_display
    from audit.middleware import get_current_ip
    user = getattr(request, 'user', None)
    authed = getattr(user, 'is_authenticated', False)
    AuditLog.objects.create(
        user=user if authed else None,
        user_display=user_display(user) if authed else 'Sistema',
        action=action, model_name=model_name, model_label=model_label,
        object_id=str(getattr(obj, 'pk', '') or ''), object_repr=str(obj)[:500],
        changes=changes or {}, ip_address=get_current_ip(),
    )


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
        first = ItineraryFlight.objects.filter(pk__in=ids).select_related('departure__itinerary').first()
        if first and first.departure and first.departure.itinerary_id:
            _audit(request, 'update', first.departure.itinerary, changes={'Voos': {'antes': '—', 'depois': 'reordenados'}})
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
        first = ItineraryTerrestreLeg.objects.filter(pk__in=ids).select_related('departure__itinerary').first()
        if first and first.departure and first.departure.itinerary_id:
            _audit(request, 'update', first.departure.itinerary, changes={'Trechos terrestres': {'antes': '—', 'depois': 'reordenados'}})
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

    def get_permissions(self):
        # Ler/abrir/baixar: quem vê roteiros; enviar/excluir: quem edita.
        if self.action in ('list', 'retrieve', 'config', 'download'):
            return [RequirePermission('roteiros_view', 'roteiros_edit', 'roteiros_delete')()]
        return [RequirePermission('roteiros_edit')()]

    def get_queryset(self):
        qs = ItineraryDocument.objects.all()
        if self.action == 'list':
            itinerary = self.request.query_params.get('itinerary')
            return qs.filter(itinerary_id=itinerary) if itinerary else qs.none()
        return qs

    def perform_create(self, serializer):
        itinerary = serializer.validated_data.get('itinerary')
        last = ItineraryDocument.objects.filter(itinerary=itinerary).order_by('-order').first()
        doc = serializer.save(order=(last.order + 1) if last else 0)
        _audit(self.request, 'upload' if doc.file else 'create', doc,
               model_name='ItineraryDocument', model_label='Documento do roteiro')

    def perform_update(self, serializer):
        doc = serializer.save()
        _audit(self.request, 'update', doc,
               model_name='ItineraryDocument', model_label='Documento do roteiro')

    def perform_destroy(self, instance):
        _audit(self.request, 'delete', instance,
               model_name='ItineraryDocument', model_label='Documento do roteiro')
        instance.delete()

    @action(detail=False, methods=['post'], url_path='create_blank')
    def create_blank(self, request):
        """Cria um documento Office EM BRANCO (Word/Excel/PowerPoint) já anexado ao
        roteiro, pronto para editar no OnlyOffice. body: {itinerary, kind, name?}.
        kind = word|cell|slide."""
        from django.core.files.base import ContentFile
        from . import blank_office
        itinerary_id = request.data.get('itinerary')
        kind = request.data.get('kind')
        ext = blank_office.KIND_EXT.get(kind)
        if not ext:
            return Response({'detail': 'Tipo inválido (use word, cell ou slide).'}, status=status.HTTP_400_BAD_REQUEST)
        itinerary = Itinerary.objects.filter(pk=itinerary_id).first()
        if itinerary is None:
            return Response({'detail': 'Roteiro inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        default = {'word': 'Documento', 'cell': 'Planilha', 'slide': 'Apresentação'}[kind]
        name = (request.data.get('name') or '').strip() or default
        if not name.lower().endswith('.' + ext):
            name = f'{name}.{ext}'
        last = ItineraryDocument.objects.filter(itinerary=itinerary).order_by('-order').first()
        doc = ItineraryDocument(itinerary=itinerary, name=name, order=(last.order + 1) if last else 0)
        doc.file.save(f'novo.{ext}', ContentFile(blank_office.blank_file(kind)), save=False)
        doc.save()
        _audit(request, 'create', doc, model_name='ItineraryDocument', model_label='Documento do roteiro')
        return Response(ItineraryDocumentSerializer(doc, context={'request': request}).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        doc = self.get_object()
        if not doc.file:
            return Response({'detail': 'Este item é um link, não um arquivo.'}, status=status.HTTP_400_BAD_REQUEST)
        _audit(request, 'download', doc, model_name='ItineraryDocument', model_label='Documento do roteiro')
        return FileResponse(doc.file.open('rb'), as_attachment=True, filename=doc.name or doc.file.name.split('/')[-1])

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
                _audit(request, 'update', doc, model_name='ItineraryDocument', model_label='Documento do roteiro',
                       changes={'Conteúdo': {'antes': '—', 'depois': 'editado no editor'}})
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
                           'upload_image', 'delete_image', 'reorder_images', 'set_image_kind',
                           'update_image_meta', 'adopt_image',
                           'publish', 'unpublish', 'reorder', 'draft'):
            return [RequirePermission('roteiros_edit')()]
        return [RequirePermission('roteiros_view', 'roteiros_edit', 'roteiros_delete')()]

    # ── Ordem manual da listagem (arrastar) — alimenta a ordem do site público ──
    @action(detail=False, methods=['post'])
    def reorder(self, request):
        ids = request.data.get('order') or []
        for i, pk in enumerate(ids):
            Itinerary.objects.filter(pk=pk).update(order=i)
        # Evento único (a ordem da lista alimenta o site) — não é de um roteiro só.
        from audit.models import AuditLog
        from audit.tracking import user_display
        from audit.middleware import get_current_ip
        u = request.user
        AuditLog.objects.create(
            user=u if getattr(u, 'is_authenticated', False) else None,
            user_display=user_display(u) if getattr(u, 'is_authenticated', False) else 'Sistema',
            action='update', model_name='Itinerary', model_label='Roteiro',
            object_id='', object_repr='Ordem da lista de roteiros',
            changes={'Ordem dos roteiros': {'antes': '—', 'depois': f'{len(ids)} roteiro(s) reordenado(s)'}},
            ip_address=get_current_ip(),
        )
        return Response({'ok': True, 'count': len(ids)})

    # ── Publicação: tira a FOTO do estado atual (published_data) e liga is_published.
    # É o que o site público mostra; editar depois não muda a foto até republicar. ──
    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        obj = self.get_object()
        snapshot = ItinerarySerializer(obj, context=self.get_serializer_context()).data
        obj.published_data = json.loads(json.dumps(snapshot, cls=DjangoJSONEncoder))
        obj.is_published = True
        obj.has_unpublished_changes = False
        obj.published_at = timezone.now()
        obj._skip_audit_signal = True   # eu logo 'publish'; evita 'update' duplicado
        obj.save(update_fields=['published_data', 'is_published', 'has_unpublished_changes', 'published_at'])
        _audit(request, 'publish', obj)
        return Response(ItinerarySerializer(obj, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'])
    def unpublish(self, request, pk=None):
        obj = self.get_object()
        obj.is_published = False
        obj._skip_audit_signal = True   # eu logo 'unpublish'; evita 'update' duplicado
        obj.save(update_fields=['is_published'])
        _audit(request, 'unpublish', obj)
        return Response(ItinerarySerializer(obj, context=self.get_serializer_context()).data)

    # ── Foto PUBLICADA (o que o público / contrato deve ver). Se o roteiro está
    # publicado, devolve o snapshot congelado (published_data) — alterações não
    # publicadas ficam invisíveis. Sem foto (nunca publicado), cai no estado vivo. ──
    @action(detail=True, methods=['get'])
    def public(self, request, pk=None):
        obj = self.get_object()
        if obj.is_published and obj.published_data:
            return Response(obj.published_data)
        return Response(ItinerarySerializer(obj, context=self.get_serializer_context()).data)

    # ── Rascunho de autosave (por usuário): edições ficam aqui até clicar Salvar. ──
    @action(detail=True, methods=['get', 'put', 'delete'])
    def draft(self, request, pk=None):
        from .models import ItineraryDraft
        obj = self.get_object()
        if request.method == 'GET':
            d = ItineraryDraft.objects.filter(itinerary=obj, user=request.user).first()
            return Response({'data': d.data if d else None,
                             'updated_at': d.updated_at if d else None})
        if request.method == 'PUT':
            data = request.data.get('data')
            if not isinstance(data, dict):
                return Response({'detail': 'Campo "data" inválido.'}, status=status.HTTP_400_BAD_REQUEST)
            ItineraryDraft.objects.update_or_create(
                itinerary=obj, user=request.user, defaults={'data': data})
            return Response({'ok': True})
        ItineraryDraft.objects.filter(itinerary=obj, user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── Galeria de imagens (upload multipart — não cabe no PUT/JSON) ──
    @action(detail=True, methods=['post'], url_path='images')
    def upload_image(self, request, pk=None):
        """POST /api/itineraries/{id}/images/  (multipart: image, caption?, kind?, order?, day?).
        `kind`: gallery (padrão), cover, blocking. Se `day` (id de um ItineraryDay
        deste roteiro) vier, a imagem é do DIA (kind = gallery)."""
        itinerary = self.get_object()
        day = None
        day_id = request.data.get('day')
        if day_id:
            day = itinerary.days.filter(pk=day_id).first()
            if day is None:
                return Response({'detail': 'Dia inválido para este roteiro.'}, status=status.HTTP_400_BAD_REQUEST)
        ser = ItineraryImageSerializer(data=request.data, context=self.get_serializer_context())
        ser.is_valid(raise_exception=True)
        upload = ser.validated_data['image']
        kind = ser.validated_data.get('kind') or 'gallery'
        if day is not None:
            kind = 'gallery'
        # Vídeo só é aceito na GALERIA (não em capa/lâminas). Imagem: jpg/png com
        # re-processamento; vídeo: validação de contêiner (mesma base dos passageiros).
        import os as _os
        from passengers.validators import validate_document_file, validate_video_file, VIDEO_EXTENSIONS
        from django.core.exceptions import ValidationError as DjangoValidationError
        is_video = _os.path.splitext(upload.name or '')[1].lower() in VIDEO_EXTENSIONS
        try:
            if is_video:
                if kind != 'gallery':
                    return Response({'image': ['Vídeos só podem ser adicionados à galeria.']},
                                    status=status.HTTP_400_BAD_REQUEST)
                validate_video_file(upload)
            else:
                validate_document_file(upload, allowed_exts={'.jpg', '.jpeg', '.png', '.webp'}, allow_images=True)
        except DjangoValidationError as e:
            return Response({'image': e.messages}, status=status.HTTP_400_BAD_REQUEST)
        img = ser.save(itinerary=itinerary, day=day, kind=kind)
        if not is_video:
            _apply_dominant_color(img)
        out = ItineraryImageSerializer(img, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'images/(?P<image_id>[0-9]+)')
    def delete_image(self, request, pk=None, image_id=None):
        """DELETE /api/itineraries/{id}/images/{image_id}/?scope=roteiro|system
        scope=roteiro → só desanexa do roteiro (a imagem fica no banco da galeria).
        scope=system (padrão) → exclui do sistema (registro + arquivo)."""
        itinerary = self.get_object()
        img = itinerary.images.filter(pk=image_id).first()
        if img is None:
            return Response({'detail': 'Imagem não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        if (request.query_params.get('scope') or 'system') == 'roteiro':
            img.itinerary = None
            img.save(update_fields=['itinerary'])
        else:
            img.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='images/adopt')
    def adopt_image(self, request, pk=None):
        """POST /api/itineraries/{id}/images/adopt/  body: {source_id, kind}.
        Copia uma imagem/vídeo da galeria (banco ou outro roteiro) para ESTE roteiro
        — novo arquivo + novo registro, preservando descrição/tipo/cidade/país/cor."""
        import os as _os
        from django.core.files.base import ContentFile
        itinerary = self.get_object()
        src = ItineraryImage.objects.filter(pk=request.data.get('source_id')).first()
        if src is None:
            return Response({'detail': 'Imagem de origem não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        kind = request.data.get('kind') or 'gallery'
        if kind not in {c[0] for c in ItineraryImage.KIND_CHOICES}:
            kind = 'gallery'
        try:
            src.image.open('rb')
            data = src.image.read()
        except Exception:
            return Response({'detail': 'Não foi possível ler o arquivo de origem.'}, status=status.HTTP_400_BAD_REQUEST)
        finally:
            try:
                src.image.close()
            except Exception:
                pass
        ext = _os.path.splitext(src.image.name or '')[1] or '.jpg'
        new = ItineraryImage(itinerary=itinerary, kind=kind, caption=src.caption,
                             subject_type=src.subject_type, city_id=src.city_id, country_id=src.country_id,
                             dominant_color=src.dominant_color, color_bucket=src.color_bucket)
        new.image.save(f'copy{ext}', ContentFile(data), save=False)
        new.save()
        out = ItineraryImageSerializer(new, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path=r'images/(?P<image_id>[0-9]+)/kind')
    def set_image_kind(self, request, pk=None, image_id=None):
        """POST /api/itineraries/{id}/images/{image_id}/kind/  body: {"kind": "..."}.
        Move a imagem entre capa/galeria/lâminas (arrastar de um campo para outro).
        Capa, galeria e lâminas aceitam várias imagens."""
        itinerary = self.get_object()
        img = itinerary.images.filter(pk=image_id, day__isnull=True).first()
        if img is None:
            return Response({'detail': 'Imagem não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        kind = request.data.get('kind')
        valid = {c[0] for c in ItineraryImage.KIND_CHOICES}
        if kind not in valid:
            return Response({'detail': 'Tipo inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        img.kind = kind
        img.save(update_fields=['kind'])
        out = ItineraryImageSerializer(img, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['patch'], url_path=r'images/(?P<image_id>[0-9]+)/meta')
    def update_image_meta(self, request, pk=None, image_id=None):
        """PATCH /api/itineraries/{id}/images/{image_id}/meta/  body: {subject_type?,
        caption?, city?, country?}. `subject_type`: landscape|object|lamina. Se
        `city` vier, o país é DERIVADO dela (cidade→estado→país); se vier só
        `country`, a cidade é desvinculada. Fora de 'landscape' a geo é limpa.
        Continente é sempre derivado."""
        itinerary = self.get_object()
        img = itinerary.images.filter(pk=image_id).first()
        if img is None:
            return Response({'detail': 'Imagem não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            fields = _apply_image_meta(img, request.data)
        except ValueError as e:
            key = str(e)
            return Response({key: ['Cidade inválida.' if key == 'city' else 'País inválido.']},
                            status=status.HTTP_400_BAD_REQUEST)
        if fields:
            img.save(update_fields=list(fields))
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
        _audit(request, 'update', itinerary, changes={'Imagens': {'antes': '—', 'depois': 'reordenadas'}})
        return Response(status=status.HTTP_204_NO_CONTENT)


def _apply_dominant_color(img):
    """Calcula e grava a cor dominante da imagem (best-effort; ignora falhas)."""
    from .imagecolor import dominant_color
    hexc, bucket = '', ''
    try:
        img.image.open('rb')
        hexc, bucket = dominant_color(img.image)
    except Exception:
        pass
    finally:
        try:
            img.image.close()
        except Exception:
            pass
    if hexc:
        img.dominant_color = hexc
        img.color_bucket = bucket
        img.save(update_fields=['dominant_color', 'color_bucket'])


def _apply_image_meta(img, data):
    """Aplica subject_type/caption/city/country a uma imagem (mutando-a) e devolve o
    conjunto de campos alterados. Cidade deriva o país; país manual desvincula a
    cidade; fora de 'landscape' a geo é limpa. Levanta ValueError('city'|'country')
    se um id for inválido."""
    from config_api.models import ConfigCity, ConfigCountry
    fields = set()
    if 'subject_type' in data:
        st = data.get('subject_type') or ''
        valid = {c[0] for c in ItineraryImage.SUBJECT_CHOICES}
        img.subject_type = st if st in valid else ''
        fields.add('subject_type')
    if 'caption' in data:
        img.caption = (data.get('caption') or '')[:300]
        fields.add('caption')
    if 'city' in data:
        cid = data.get('city')
        if cid:
            city = ConfigCity.objects.select_related('state__country').filter(pk=cid).first()
            if city is None:
                raise ValueError('city')
            img.city = city
            img.country_id = city.state.country_id
            fields.update({'city', 'country'})
        else:
            img.city = None
            fields.add('city')
    if 'country' in data and 'city' not in data:
        cid = data.get('country')
        if cid:
            country = ConfigCountry.objects.filter(pk=cid).first()
            if country is None:
                raise ValueError('country')
            img.country = country
            img.city = None
            fields.update({'country', 'city'})
        else:
            img.country = None
            fields.add('country')
    if img.subject_type in ('object', 'lamina'):
        img.city = None
        img.country = None
        fields.update({'city', 'country'})
    return fields


class _GalleryReadPermission(RequirePermission(
        'roteiros_view', 'roteiros_edit', 'roteiros_delete',
        'gallery_view', 'gallery_edit', 'gallery_delete')):
    """Leitura da galeria: quem tem permissão de galeria (ou de roteiros) OU uma
    conta de operadora — que enxerga só as lâminas padrão dos roteiros públicos e
    abertos (restrição feita no queryset e no download)."""
    def has_permission(self, request, view):
        return super().has_permission(request, view) or is_operadora_user(request.user)


class GalleryImageViewSet(viewsets.ModelViewSet):
    """Galeria GLOBAL: todas as imagens dos roteiros + as do banco geral (itinerary
    nulo). GET lista com filtros (busca por descrição/cidade/país/roteiro, tipo,
    cor, cidade/país/continente, roteiro; lâminas ocultas por padrão); POST envia
    ao banco (sem roteiro); PATCH edita metadados; DELETE exclui.
    Ordem padrão: mais recentes primeiro."""
    serializer_class = ItineraryImageSerializer
    pagination_class = StandardResultsPagination
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_permissions(self):
        if self.action in ('list', 'retrieve', 'download'):
            return [_GalleryReadPermission()]
        if self.action == 'destroy':
            return [RequirePermission('roteiros_edit', 'gallery_edit', 'gallery_delete')()]
        return [RequirePermission('roteiros_edit', 'gallery_edit')()]

    @staticmethod
    def _operadora_restrict(qs):
        """Galeria da OPERADORA: só as lâminas PADRÃO (a de menor `order` de cada
        roteiro) e só de roteiros públicos (como no site) e ainda ABERTOS (que não
        terminaram). Roteiros que já passaram não mostram mais lâminas."""
        from django.db.models import Q, OuterRef, Subquery
        today = timezone.localdate()
        qs = qs.filter(
            kind='blocking',
            itinerary__isnull=False,
            itinerary__is_published=True,
            itinerary__status='ativo',
            itinerary__is_deleted=False,
        ).filter(Q(itinerary__end_date__isnull=True) | Q(itinerary__end_date__gte=today))
        # A lâmina "favorita/publicada" de cada roteiro = a de menor order (a padrão).
        default_id = (ItineraryImage.objects
                      .filter(kind='blocking', itinerary=OuterRef('itinerary'))
                      .order_by('order', 'id').values('id')[:1])
        return qs.filter(id=Subquery(default_id))

    VIDEO_EXTS = ('.mp4', '.webm', '.mov', '.m4v', '.ogv')

    @classmethod
    def _video_q(cls):
        from django.db.models import Q
        vq = Q()
        for ext in cls.VIDEO_EXTS:
            vq |= Q(image__iendswith=ext)
        return vq

    @staticmethod
    def _apply_common_filters(qs, p):
        """Busca (descrição/cidade/país/roteiro) + filtros por tipo/cor/cidade/país/
        continente/roteiro. Compartilhado pela listagem e pelo download."""
        from django.db.models import Q
        search = (p.get('search') or '').strip()
        if search:
            qs = qs.filter(Q(caption__icontains=search)
                           | Q(city__name__icontains=search)
                           | Q(country__name__icontains=search)
                           | Q(itinerary__name__icontains=search))
        for field, param in [('subject_type', 'subject_type'), ('color_bucket', 'color'),
                             ('itinerary_id', 'itinerary'), ('city_id', 'city'),
                             ('country_id', 'country'), ('country__continent_id', 'continent')]:
            if p.get(param):
                qs = qs.filter(**{field: p[param]})
        return qs

    def get_queryset(self):
        p = self.request.query_params
        qs = (ItineraryImage.objects
              .select_related('city__state__country__continent', 'country__continent', 'itinerary')
              .filter(day__isnull=True))               # só imagens "de topo", não as de um DIA
        # Operadora: vê SÓ as lâminas padrão dos roteiros públicos e abertos —
        # ignora as abas/mídia; ainda respeita a busca e os filtros comuns.
        if is_operadora_user(self.request.user):
            qs = self._operadora_restrict(qs)
            return self._apply_common_filters(qs, p).order_by('-created_at', '-id')
        # Abas: kind explícito (ex.: 'blocking' = lâminas) tem prioridade; senão as
        # lâminas ficam ocultas, a não ser que include_laminas peça o contrário.
        if p.get('kind'):
            qs = qs.filter(kind=p['kind'])
        elif p.get('include_laminas') not in ('1', 'true', 'True'):
            qs = qs.exclude(kind='blocking')
        # Filtro por mídia (aba Imagens/Vídeos), pela extensão do arquivo.
        media = p.get('media')
        if media in ('image', 'video'):
            vq = self._video_q()
            qs = qs.filter(vq) if media == 'video' else qs.exclude(vq)
        qs = self._apply_common_filters(qs, p)
        return qs.order_by('-created_at', '-id')

    def create(self, request, *args, **kwargs):
        """Upload de imagem/vídeo para o BANCO (sem roteiro)."""
        import os as _os
        from passengers.validators import validate_document_file, validate_video_file, VIDEO_EXTENSIONS
        from django.core.exceptions import ValidationError as DjangoValidationError
        ser = ItineraryImageSerializer(data=request.data, context=self.get_serializer_context())
        ser.is_valid(raise_exception=True)
        upload = ser.validated_data['image']
        is_video = _os.path.splitext(upload.name or '')[1].lower() in VIDEO_EXTENSIONS
        try:
            if is_video:
                validate_video_file(upload)
            else:
                validate_document_file(upload, allowed_exts={'.jpg', '.jpeg', '.png', '.webp'}, allow_images=True)
        except DjangoValidationError as e:
            return Response({'image': e.messages}, status=status.HTTP_400_BAD_REQUEST)
        img = ser.save(itinerary=None, day=None, kind='gallery')
        if not is_video:
            _apply_dominant_color(img)
        out = ItineraryImageSerializer(img, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        img = self.get_object()
        try:
            fields = _apply_image_meta(img, request.data)
        except ValueError as e:
            key = str(e)
            return Response({key: ['Cidade inválida.' if key == 'city' else 'País inválido.']},
                            status=status.HTTP_400_BAD_REQUEST)
        if fields:
            img.save(update_fields=list(fields))
        return Response(ItineraryImageSerializer(img, context=self.get_serializer_context()).data)

    def destroy(self, request, *args, **kwargs):
        """Só imagens do BANCO (sem roteiro) podem ser excluídas pela galeria. Se
        estiver anexada a um roteiro, bloqueia e explica onde ela está sendo usada."""
        img = self.get_object()
        reasons = []
        if img.itinerary_id:
            kind_label = dict(ItineraryImage.KIND_CHOICES).get(img.kind, 'imagem')
            reasons.append(f'{kind_label} do roteiro "{img.itinerary.name}"')
        if reasons:
            return Response(
                {'detail': 'Não pode ser excluída porque está anexada a: ' + '; '.join(reasons)
                           + '. Remova-a de dentro do roteiro primeiro.',
                 'reasons': reasons},
                status=status.HTTP_409_CONFLICT)
        img.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'], url_path='download')
    def download(self, request):
        """GET /api/itineraries/gallery/download/  — baixa um ZIP com os arquivos
        filtrados, organizados em pastas (imagens/, videos/, laminas/).
        `types`: quais incluir (image,video,lamina — padrão: todos). Os demais
        params são os mesmos filtros da listagem (search/color/subject_type/…)."""
        import io
        import os as _os
        import zipfile
        from django.db.models import Q
        from django.utils.text import slugify
        from django.http import HttpResponse

        p = request.query_params
        qs = (ItineraryImage.objects
              .select_related('city', 'country', 'itinerary')
              .filter(day__isnull=True))
        operadora = is_operadora_user(request.user)
        if operadora:
            # Operadora só baixa as lâminas que ela pode ver (padrão / público / aberto).
            qs = self._apply_common_filters(self._operadora_restrict(qs), p)
        ids = [] if operadora else [int(x) for x in (p.get('ids') or '').split(',') if x.strip().isdigit()]
        if ids:
            # Seleção manual: baixa exatamente esses itens (ignora tipos/filtros).
            qs = qs.filter(pk__in=ids)
        elif not operadora:
            types = {t for t in (p.get('types') or 'image,video,lamina').split(',') if t}
            qs = self._apply_common_filters(qs, p)
            vq = self._video_q()
            typeq = Q(pk__in=[])
            if 'lamina' in types:
                typeq |= Q(kind='blocking')
            if 'image' in types:
                typeq |= (~vq & ~Q(kind='blocking'))
            if 'video' in types:
                typeq |= (vq & ~Q(kind='blocking'))
            qs = qs.filter(typeq)
        qs = qs.order_by('-created_at', '-id')

        buf = io.BytesIO()
        used = set()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            for img in qs.iterator():
                name = img.image.name or ''
                ext = _os.path.splitext(name)[1].lower()
                is_vid = ext in self.VIDEO_EXTS
                folder = 'laminas' if img.kind == 'blocking' else ('videos' if is_vid else 'imagens')
                label = (img.caption
                         or (img.city.name if img.city_id else '')
                         or (img.itinerary.name if img.itinerary_id else '')
                         or 'arquivo')
                base = f'{img.id}-{slugify(label)[:60] or "arquivo"}'
                fname = f'{folder}/{base}{ext}'
                i = 2
                while fname in used:
                    fname = f'{folder}/{base}-{i}{ext}'
                    i += 1
                used.add(fname)
                try:
                    img.image.open('rb')
                    zf.writestr(fname, img.image.read())
                except Exception:
                    continue
                finally:
                    try:
                        img.image.close()
                    except Exception:
                        pass

        resp = HttpResponse(buf.getvalue(), content_type='application/zip')
        resp['Content-Disposition'] = 'attachment; filename="galeria.zip"'
        return resp
