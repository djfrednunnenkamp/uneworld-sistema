import json

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
from users_api.permissions import RequirePermission, is_operadora_user, has_any_perm

from . import onlyoffice
from .models import (Itinerary, ItineraryImage, ItineraryFieldTemplate, ItineraryDeparture,
                     ItineraryFlight, ItineraryHotel, ItineraryBoat,
                     ItineraryTerrestreDeparture, ItineraryTerrestreLeg, ItineraryDocument, ItineraryDocumentFolder,
                     ItineraryPricingConfig, ItineraryCostItem, ItineraryCurrencyRate,
                     ItineraryInventoryBlock)
from .serializers import (ItinerarySerializer, ItineraryListSerializer,
                          ItineraryImageSerializer, ItineraryFieldTemplateSerializer,
                          ItineraryDepartureSerializer, ItineraryFlightSerializer,
                          ItineraryHotelSerializer, ItineraryBoatSerializer,
                          ItineraryTerrestreDepartureSerializer, ItineraryTerrestreLegSerializer,
                          ItineraryDocumentSerializer, ItineraryDocumentFolderSerializer,
                          ItineraryPricingConfigSerializer, ItineraryCostItemSerializer,
                          ItineraryCurrencyRateSerializer, ItineraryInventoryBlockSerializer)
from core.search import AccentInsensitiveSearchFilter


def _itinerary_cover_url(it, request):
    """URL absoluta da capa do roteiro (imagem kind='cover' ou 1ª da galeria)."""
    imgs = list(it.images.all())
    cover = next((i for i in imgs if i.kind == 'cover'), None) \
        or next((i for i in imgs if i.day_id is None), None)
    if not cover or not cover.image:
        return None
    return request.build_absolute_uri(cover.image.url) if request else cover.image.url


def _roteiro_edit_permissions(self):
    """Ler: quem vê roteiros; criar/editar/excluir: quem edita roteiros."""
    if self.action in ('list', 'retrieve'):
        return [RequirePermission('roteiros_view', 'roteiros_edit', 'roteiros_delete')()]
    return [RequirePermission('roteiros_edit')()]


def _roteiro_read_or_contract_permissions(self):
    """Igual ao de cima, MAS a leitura também é liberada p/ quem faz contratos — o
    seletor de roteiro do contrato precisa ler as saídas do roteiro. O que cada um
    ENXERGA continua limitado pelo get_queryset (agência só vê público/compartilhado)."""
    if self.action in ('list', 'retrieve'):
        return [RequirePermission('roteiros_view', 'roteiros_edit', 'roteiros_delete',
                                  'contracts_view', 'contracts_edit')()]
    return [RequirePermission('roteiros_edit')()]


def _scope_child_to_visible(qs, request):
    """Restringe child tables (saídas) do roteiro ao que o usuário de agência pode
    ver: roteiro público OU exclusivo compartilhado com a agência dele. Interno = tudo."""
    from users_api.permissions import agency_scope_ids
    from django.db.models import Q
    scope = agency_scope_ids(request.user)
    if scope is None:
        return qs
    return qs.exclude(itinerary__status='rascunho').filter(
        Q(itinerary__visibility='public') | Q(itinerary__visibility='agencies', itinerary__shared_agencies__in=scope)
    ).distinct()


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
    get_permissions  = _roteiro_read_or_contract_permissions

    def get_queryset(self):
        qs = ItineraryDeparture.objects.select_related('airport')
        if self.action == 'list':   # o filtro só vale na listagem; detalhe (get/put/delete) usa tudo
            itinerary = self.request.query_params.get('itinerary')
            qs = qs.filter(itinerary_id=itinerary) if itinerary else qs.none()
        return _scope_child_to_visible(qs, self.request)

    @action(detail=False, methods=['post'], url_path='reorder')
    def reorder(self, request):
        """Reordena os aeroportos de saída: body {"order": [id1, id2, ...]}."""
        ids = request.data.get('order') or []
        valid = set(ItineraryDeparture.objects.filter(pk__in=ids).values_list('id', flat=True))
        with transaction.atomic():
            for pos, did in enumerate(ids):
                if did in valid:
                    ItineraryDeparture.objects.filter(pk=did).update(order=pos)
        first = ItineraryDeparture.objects.filter(pk__in=ids).select_related('itinerary').first()
        if first and first.itinerary_id:
            _audit(request, 'update', first.itinerary, changes={'Aeroportos de saída': {'antes': '—', 'depois': 'reordenados'}})
        return Response(status=status.HTTP_204_NO_CONTENT)


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
    get_permissions  = _roteiro_read_or_contract_permissions

    def get_queryset(self):
        qs = ItineraryTerrestreDeparture.objects.select_related('city__state__country')
        if self.action == 'list':
            itinerary = self.request.query_params.get('itinerary')
            qs = qs.filter(itinerary_id=itinerary) if itinerary else qs.none()
        return _scope_child_to_visible(qs, self.request)


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


class ItineraryDocumentFolderViewSet(viewsets.ModelViewSet):
    """Pastas (aninháveis) para organizar os documentos do roteiro. Mesmas
    permissões dos documentos (roteiros_docs_*). Filtra por ?itinerary=<id>.
    Excluir uma pasta remove suas subpastas e documentos (CASCADE no modelo)."""
    serializer_class = ItineraryDocumentFolderSerializer
    pagination_class = None

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [RequirePermission('roteiros_docs_view', 'roteiros_docs_view_own')()]
        if self.action == 'create':
            return [RequirePermission('roteiros_docs_create')()]
        if self.action == 'destroy':
            # Excluir pasta remove tudo dentro (subpastas + documentos, inclusive de
            # outros donos) → exige a permissão de excluir COMPLETA.
            return [RequirePermission('roteiros_docs_delete')()]
        return [RequirePermission('roteiros_docs_edit')()]

    def get_queryset(self):
        qs = ItineraryDocumentFolder.objects.all()
        if self.action == 'list':
            itinerary = self.request.query_params.get('itinerary')
            return qs.filter(itinerary_id=itinerary) if itinerary else qs.none()
        return qs

    def perform_create(self, serializer):
        itinerary = serializer.validated_data.get('itinerary')
        last = ItineraryDocumentFolder.objects.filter(itinerary=itinerary).order_by('-order').first()
        folder = serializer.save(order=(last.order + 1) if last else 0, owner=self.request.user)
        _audit(self.request, 'create', folder,
               model_name='ItineraryDocumentFolder', model_label='Pasta de documentos do roteiro')

    def perform_update(self, serializer):
        folder = serializer.save()
        _audit(self.request, 'update', folder,
               model_name='ItineraryDocumentFolder', model_label='Pasta de documentos do roteiro')

    def perform_destroy(self, instance):
        _audit(self.request, 'delete', instance,
               model_name='ItineraryDocumentFolder', model_label='Pasta de documentos do roteiro')
        instance.delete()


class ItineraryDocumentViewSet(viewsets.ModelViewSet):
    """Documentos anexados ao roteiro (painel da aba Observações). Filtra por
    ?itinerary=<id>. Aceita upload de arquivo (multipart) ou link (JSON)."""
    serializer_class = ItineraryDocumentSerializer
    pagination_class = None
    parser_classes   = [MultiPartParser, FormParser, JSONParser]

    def get_permissions(self):
        # Documentos têm permissões PRÓPRIAS — permissão de roteiro (edit/delete)
        # NÃO dá acesso aos documentos. Cada ação exige a permissão de documento.
        if self.action in ('list', 'retrieve', 'config', 'download'):
            return [RequirePermission('roteiros_docs_view', 'roteiros_docs_view_own')()]
        if self.action in ('create', 'create_blank'):
            return [RequirePermission('roteiros_docs_create')()]
        if self.action == 'destroy':
            # Excluir todos OU só os próprios (o dono é checado no destroy()).
            return [RequirePermission('roteiros_docs_delete', 'roteiros_docs_delete_own')()]
        # update/partial_update/reorder e demais escritas.
        return [RequirePermission('roteiros_docs_edit')()]

    def destroy(self, request, *args, **kwargs):
        doc = self.get_object()
        u = request.user
        can_all = getattr(u, 'is_superuser', False) or has_any_perm(u, 'roteiros_docs_delete')
        can_own = has_any_perm(u, 'roteiros_docs_delete_own') and doc.owner_id == getattr(u, 'id', None)
        if not (can_all or can_own):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Você só pode excluir os documentos que você mesmo enviou.')
        return super().destroy(request, *args, **kwargs)

    def _docs_scope(self):
        """'all' = vê todos; 'own' = só os próprios; 'none' = nenhum.
        'Ver só os próprios' restringe mesmo quando 'Ver documentos' está marcado."""
        u = self.request.user
        if getattr(u, 'is_superuser', False):
            return 'all'
        if has_any_perm(u, 'roteiros_docs_view_own'):
            return 'own'
        if has_any_perm(u, 'roteiros_docs_view'):
            return 'all'
        return 'none'

    def get_queryset(self):
        qs = ItineraryDocument.objects.all()
        # Quem só pode ver os PRÓPRIOS documentos fica restrito ao owner=ele.
        scope = self._docs_scope()
        if scope == 'own':
            qs = qs.filter(owner=self.request.user)
        elif scope == 'none':
            qs = qs.none()
        if self.action == 'list':
            itinerary = self.request.query_params.get('itinerary')
            return qs.filter(itinerary_id=itinerary) if itinerary else qs.none()
        return qs

    def perform_create(self, serializer):
        itinerary = serializer.validated_data.get('itinerary')
        last = ItineraryDocument.objects.filter(itinerary=itinerary).order_by('-order').first()
        doc = serializer.save(order=(last.order + 1) if last else 0, owner=self.request.user)
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
        # Pasta opcional (tem que ser do mesmo roteiro).
        folder = None
        folder_id = request.data.get('folder')
        if folder_id not in (None, '', 'null'):
            folder = ItineraryDocumentFolder.objects.filter(pk=folder_id, itinerary=itinerary).first()
            if folder is None:
                return Response({'detail': 'Pasta inválida.'}, status=status.HTTP_400_BAD_REQUEST)
        last = ItineraryDocument.objects.filter(itinerary=itinerary).order_by('-order').first()
        doc = ItineraryDocument(itinerary=itinerary, folder=folder, name=name, order=(last.order + 1) if last else 0,
                                owner=request.user if request.user.is_authenticated else None)
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

    # Fail-closed: este endpoint é AllowAny (o DS chama sem sessão), então sem o
    # OnlyOffice configurado E sem o segredo JWT definido um POST forjado por
    # qualquer anônimo controlaria `url` → SSRF/LFI e sobrescrita de documento.
    # Exigimos o JWT: sem ele, recusamos em vez de "pular a validação".
    secret = getattr(settings, 'ONLYOFFICE_JWT_SECRET', '')
    if not onlyoffice.is_configured() or not secret:
        return Response({'error': 1})
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
                content = onlyoffice.fetch_saved_file(file_url)
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
        # create/update/destroy: a permissão é POR TEMPLATE (field) — validada nos
        # perform_*; aqui só exige estar autenticado.
        from rest_framework.permissions import IsAuthenticated
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = ItineraryFieldTemplate.objects.all()
        field = self.request.query_params.get('field')
        return qs.filter(field=field) if field else qs

    def _require_template(self, field, action):
        """Permissão individual do template `field` (settings_tpl_<field>_<action>),
        com manage_settings como atalho geral."""
        if not has_any_perm(self.request.user, 'manage_settings', f'settings_tpl_{field}_{action}'):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Você não tem permissão para este template.')

    def perform_create(self, serializer):
        self._require_template(serializer.validated_data.get('field'), 'edit')
        serializer.save()

    def perform_update(self, serializer):
        self._require_template(serializer.instance.field, 'edit')
        template = serializer.save()
        template.apply_to_linked()   # propaga o novo conteúdo aos roteiros vinculados

    def perform_destroy(self, instance):
        self._require_template(instance.field, 'delete')
        instance.delete()


def _payment_plan_snapshot(p):
    """Copia um Modelo de pagamento global (ConfigPaymentPlan) para o formato de
    item usado em Itinerary.payment_plans (JSON). Decimais viram float p/ o JSON."""
    def _f(v):
        return float(v) if v is not None else 0
    return {
        # _cfgId liga a cópia ao Modelo global de origem — assim o seletor
        # "Escolher forma de pagamento" do roteiro já mostra os favoritos
        # marcados (e desmarcar remove), igual às formas adicionadas à mão.
        '_cfgId': p.id,
        'name': p.name,
        'a_vista': p.a_vista,
        'has_down_payment': p.has_down_payment,
        'down_payment_mode': p.down_payment_mode,
        'down_payment_value': _f(p.down_payment_value),
        'down_payment_method': p.down_payment_method or '',
        'down_payment_rounding': _f(p.down_payment_rounding),
        'installments_count': p.installments_count,
        'payment_method': p.payment_method or '',
        'installment_rounding': _f(p.installment_rounding),
        'interest_tiers': p.interest_tiers or [],
        'first_due_days': p.first_due_days,
        'interval_days': p.interval_days,
    }


class ItineraryViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset         = Itinerary.objects.select_related(
        'category', 'continent', 'itinerary_type', 'maritime_company',
    ).prefetch_related(
        'accommodation_lines__accommodation_type',
        'cities__state__country__continent', 'countries__continent', 'airports', 'keywords', 'inclusions', 'highlights',
        'itinerary_types', 'special_dates', 'continents',
        'days__city', 'days__images', 'images', 'shared_agencies',
    )
    pagination_class = StandardResultsPagination
    filter_backends  = [AccentInsensitiveSearchFilter, filters.OrderingFilter]
    search_fields    = ['name', 'slug']
    ordering_fields  = ['created_at', 'start_date', 'name']

    def handle_exception(self, exc):
        # Loga o detalhe de validação (qual campo falhou) ao salvar — diagnóstico do 400.
        from rest_framework.exceptions import ValidationError as DRFValidationError
        if isinstance(exc, DRFValidationError):
            import logging
            logging.getLogger('django.request').warning('Itinerary save 400 detail: %s', exc.detail)
        return super().handle_exception(exc)

    def update(self, request, *args, **kwargs):
        # Descarta linhas de acomodação que apontam para uma SAÍDA já excluída
        # (flight/terrestre_departure de outro id ou removida). Sem isso, a FK
        # inexistente derruba o Salvar inteiro do roteiro com 400.
        self._drop_orphan_accommodation_lines(request)
        return super().update(request, *args, **kwargs)

    def _drop_orphan_accommodation_lines(self, request):
        lines = request.data.get('accommodation_lines') if hasattr(request, 'data') else None
        if not isinstance(lines, list) or not lines:
            return
        itin_id = self.kwargs.get('pk')
        valid_f = set(ItineraryDeparture.objects.filter(itinerary_id=itin_id).values_list('id', flat=True))
        valid_t = set(ItineraryTerrestreDeparture.objects.filter(itinerary_id=itin_id).values_list('id', flat=True))

        def ok(l):
            fd, td = l.get('flight_departure'), l.get('terrestre_departure')
            if fd is not None:
                try:
                    if int(fd) not in valid_f:
                        return False
                except (TypeError, ValueError):
                    return False
            if td is not None:
                try:
                    if int(td) not in valid_t:
                        return False
                except (TypeError, ValueError):
                    return False
            return True

        cleaned = [l for l in lines if ok(l)]
        if len(cleaned) != len(lines):
            try:
                if hasattr(request.data, '_mutable'):
                    request.data._mutable = True
                request.data['accommodation_lines'] = cleaned
            except Exception:
                pass

    def get_queryset(self):
        from django.db.models import Q
        from users_api.permissions import agency_scope_ids
        qs = super().get_queryset()   # aplica o filtro is_deleted do mixin
        u = self.request.user
        # Usuário de agência: só enxerga roteiros PÚBLICOS (visibility='public', que
        # toda agência pode contratar) OU EXCLUSIVOS compartilhados com a agência dele.
        # Nunca vê rascunho nem "não listado" (interno da operadora).
        scope = agency_scope_ids(u)
        if scope is not None:
            return qs.exclude(status='rascunho').filter(
                Q(visibility='public') | Q(visibility='agencies', shared_agencies__in=scope)
            ).distinct()
        # Rascunho é PRIVADO do criador — NEM o superusuário vê o de outra pessoa.
        # (Rascunhos legados sem dono ficam só p/ o superusuário, para limpeza.)
        own_draft = Q(created_by=u)
        if getattr(u, 'is_superuser', False):
            own_draft |= Q(created_by__isnull=True)
        if self.action == 'list':     # só a listagem separa rascunho de ativo
            if self.request.query_params.get('status') == 'rascunho':
                qs = qs.filter(status='rascunho').filter(own_draft)
            else:
                qs = qs.exclude(status='rascunho')
        else:
            # Abrir/editar: rascunho de outra pessoa não é acessível (nem p/ admin).
            qs = qs.filter(~Q(status='rascunho') | own_draft)
        return qs

    def perform_create(self, serializer):
        u = self.request.user
        it = serializer.save(created_by=u if getattr(u, 'is_authenticated', False) else None)
        # Roteiro NOVO já nasce com os modelos de pagamento marcados como FAVORITOS
        # nas Configurações (cada um vira uma cópia editável só deste roteiro — o
        # usuário pode desmarcar/editar sem afetar o modelo global). Só quando o
        # roteiro ainda não trouxe planos (criação em branco, não duplicação).
        if not it.payment_plans:
            from config_api.models import ConfigPaymentPlan
            favs = ConfigPaymentPlan.objects.filter(is_favorite=True).order_by('name')
            plans = [_payment_plan_snapshot(p) for p in favs]
            if plans:
                it.payment_plans = plans
                it.payment_plan = plans[0]   # compat.: contrato ainda lê um só
                it.save(update_fields=['payment_plans', 'payment_plan'])

    @action(detail=False, methods=['get'], url_path='with_documents')
    def with_documents(self, request):
        """Roteiros que têm documentos VISÍVEIS ao usuário — alimenta a aba
        'Roteiros' do Drive (cada roteiro vira uma pasta com a capa dele).
        Respeita o escopo de documentos: todos vs só os próprios."""
        from django.db.models import Count
        u = request.user
        if getattr(u, 'is_superuser', False) or has_any_perm(u, 'roteiros_docs_view'):
            docs = ItineraryDocument.objects.all()
        elif has_any_perm(u, 'roteiros_docs_view_own'):
            docs = ItineraryDocument.objects.filter(owner=u)
        else:
            return Response([])   # sem permissão de ver documentos do roteiro
        counts = dict(docs.values('itinerary_id').annotate(n=Count('id')).values_list('itinerary_id', 'n'))
        if not counts:
            return Response([])
        qs = self.get_queryset().filter(id__in=list(counts.keys())).prefetch_related('images')
        out = [{'id': it.id, 'name': it.name, 'cover': _itinerary_cover_url(it, request),
                'doc_count': counts.get(it.id, 0)} for it in qs]
        out.sort(key=lambda r: (r['name'] or '').lower())
        return Response(out)

    @action(detail=True, methods=['post'])
    def duplicate(self, request, pk=None):
        """Duplica o roteiro por completo (cópia editável, nasce como RASCUNHO).
        body: { name?, start_date?, end_date? }. Clona campos, M2M, dias, imagens
        (com os arquivos), voos/terrestre + preços, hotéis, barcos e documentos."""
        import os
        from django.db.models import Q
        from django.utils.dateparse import parse_date
        orig = self.get_object()
        u = request.user
        name = (request.data.get('name') or f'{orig.name} (cópia)').strip()[:300] or f'{orig.name} (cópia)'

        def as_date(v):
            if not v: return None
            return parse_date(v) if isinstance(v, str) else v
        start_date = as_date(request.data.get('start_date'))
        end_date   = as_date(request.data.get('end_date'))

        def grab(field):
            """(basename, bytes) do arquivo de um FileField, ou (None, None)."""
            if not field or not field.name:
                return None, None
            try:
                field.open('rb'); data = field.read(); field.close()
                return os.path.basename(field.name), data
            except Exception:
                return None, None

        with transaction.atomic():
            copy = Itinerary.objects.get(pk=orig.pk)
            copy.pk = None; copy.id = None; copy._state.adding = True
            copy.name = name
            copy.start_date = start_date
            copy.end_date = end_date
            copy.slug = ''                       # regenera slug único no save()
            # Nasce como RASCUNHO PRÓPRIO de quem duplicou: fica privado, some da
            # lista pública e só é finalizado quando a pessoa escolher no Salvar.
            copy.status = 'rascunho'
            copy.is_published = False
            copy.visibility = 'unlisted'   # cópia nasce não listada (sem herdar agências)
            copy.published_data = None
            copy.published_at = None
            copy.has_unpublished_changes = False
            copy.is_deleted = False
            copy.deleted_at = None
            copy.created_by = u if getattr(u, 'is_authenticated', False) else None
            last = Itinerary.objects.filter(is_deleted=False).order_by('-order').first()
            copy.order = (last.order + 1) if last else 0
            copy.save()

            # Many-to-many (apontam para itens de configuração — seguros de compartilhar)
            for f in ('continents', 'cities', 'countries', 'airports', 'keywords', 'inclusions',
                      'highlights', 'itinerary_types', 'special_dates', 'clauses'):
                getattr(copy, f).set(getattr(orig, f).all())

            # Aéreo: partidas + voos
            dep_map = {}
            for dep in list(orig.departures.all()):
                flights = list(dep.flights.all())
                old = dep.pk
                dep.pk = None; dep.id = None; dep._state.adding = True; dep.itinerary = copy; dep.save()
                dep_map[old] = dep
                for fl in flights:
                    fl.pk = None; fl.id = None; fl._state.adding = True; fl.departure = dep; fl.save()

            # Terrestre: partidas + trechos
            ter_map = {}
            for t in list(orig.terrestre_departures.all()):
                legs = list(t.legs.all())
                old = t.pk
                t.pk = None; t.id = None; t._state.adding = True; t.itinerary = copy; t.save()
                ter_map[old] = t
                for lg in legs:
                    lg.pk = None; lg.id = None; lg._state.adding = True; lg.departure = t; lg.save()

            # Dias
            day_map = {}
            old_day_ids = list(orig.days.values_list('id', flat=True))
            for d in list(orig.days.all()):
                old = d.pk
                d.pk = None; d.id = None; d._state.adding = True; d.itinerary = copy; d.save()
                day_map[old] = d

            # Imagens (galeria/capa/lâminas + imagens de dia) — copiando os arquivos
            for img in list(ItineraryImage.objects.filter(Q(itinerary=orig) | Q(day_id__in=old_day_ids)).distinct()):
                fname, data = grab(img.image)
                new_day = day_map.get(img.day_id) if img.day_id else None
                img.pk = None; img.id = None; img._state.adding = True
                img.itinerary = copy; img.day = new_day
                if data is not None:
                    img.image.save(fname, ContentFile(data), save=False)
                img.save()

            # Linhas de acomodação (preços) — remapear as partidas
            for al in list(orig.accommodation_lines.all()):
                al.pk = None; al.id = None; al._state.adding = True; al.itinerary = copy
                al.flight_departure = dep_map.get(al.flight_departure_id) if al.flight_departure_id else None
                al.terrestre_departure = ter_map.get(al.terrestre_departure_id) if al.terrestre_departure_id else None
                al.save()

            # Hotéis e barcos
            for h in list(orig.hotels.all()):
                h.pk = None; h.id = None; h._state.adding = True; h.itinerary = copy; h.save()
            for b in list(orig.boats.all()):
                b.pk = None; b.id = None; b._state.adding = True; b.itinerary = copy; b.save()

            # Documentos (copiar arquivo; dono = quem duplicou; edit_key zerado)
            for doc in list(orig.documents.all()):
                fname, data = grab(doc.file)
                doc.pk = None; doc.id = None; doc._state.adding = True
                doc.itinerary = copy
                doc.owner = u if getattr(u, 'is_authenticated', False) else None
                doc.edit_key = ''
                if data is not None:
                    doc.file.save(fname, ContentFile(data), save=False)
                doc.save()

        # A cópia nasce como rascunho não público → cria a sua lista 1:1.
        from trips.services import sync_passenger_list_for_itinerary
        sync_passenger_list_for_itinerary(copy, allow_create=True)

        return Response({'id': copy.id, 'name': copy.name, 'status': copy.status,
                         'is_published': copy.is_published}, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        u = request.user
        can_delete = getattr(u, 'is_superuser', False) or has_any_perm(u, 'roteiros_delete')
        is_own_draft = obj.status == 'rascunho' and obj.created_by_id == getattr(u, 'id', None)
        # Sem 'excluir roteiros', só dá pra excluir o PRÓPRIO rascunho.
        if not (can_delete or is_own_draft):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Você não tem permissão para excluir roteiros. '
                                   'Você só pode excluir os seus próprios rascunhos.')
        # Vínculo 1:1: ao excluir o roteiro, a sua lista de passageiros vai junto
        # para a lixeira (só ela pode ser removida — a lista sozinha não).
        # delete_passengers=1 (padrão do pop-up) → também apaga os passageiros
        # (inscrições) da lista vinculada.
        delete_pax = request.query_params.get('delete_passengers') in ('1', 'true', 'True')
        linked_lists = list(obj.passenger_lists.filter(is_deleted=False))
        resp = super().destroy(request, *args, **kwargs)
        from django.utils import timezone
        now = timezone.now()
        for pl in linked_lists:
            if delete_pax:
                pl.list_enrollments.all().delete()
            pl.is_deleted = True
            pl.deleted_at = now
            pl.save(update_fields=['is_deleted', 'deleted_at'])
        return resp

    def get_serializer_class(self):
        return ItineraryListSerializer if self.action == 'list' else ItinerarySerializer

    def get_permissions(self):
        if self.action == 'destroy':
            # Excluir exige 'roteiros_delete' — MAS o dono pode excluir o próprio
            # rascunho mesmo sem essa permissão (checado no destroy()). Por isso o
            # gate aqui também aceita quem edita/cria (donos de rascunho).
            return [RequirePermission('roteiros_delete', 'roteiros_edit', 'roteiros_create')()]
        if self.action in ('publish', 'unpublish'):
            return [RequirePermission('roteiros_publish')()]
        if self.action == 'adopt_image':
            # Pegar imagem da galeria (banco) pro roteiro exige permissão própria;
            # sem ela, a pessoa só consegue fazer upload das próprias imagens.
            return [RequirePermission('roteiros_images_from_gallery')()]
        if self.action in ('create', 'create_blank', 'duplicate'):
            return [RequirePermission('roteiros_create')()]
        if self.action == 'with_documents':
            # Exige ver roteiros; a permissão de ver DOCUMENTOS é checada na action
            # (sem ela, devolve lista vazia). Assim a aba só tem conteúdo com as duas.
            return [RequirePermission('roteiros_view', 'roteiros_open', 'roteiros_edit',
                                      'roteiros_create', 'roteiros_delete')()]
        # Ações de imagem: quem edita o roteiro OU tem a permissão restrita de
        # lâminas. A restrição a kind='blocking' é aplicada dentro de cada ação.
        if self.action in ('upload_image', 'delete_image', 'reorder_images',
                           'set_image_kind', 'update_image_meta'):
            return [RequirePermission('roteiros_edit', 'roteiros_laminas_edit')()]
        if self.action in ('update', 'partial_update', 'restore', 'purge', 'reorder', 'draft',
                           'pricing_config', 'import_kml_preview'):
            return [RequirePermission('roteiros_edit')()]
        if self.action == 'list':
            # Também quem faz contratos: o seletor de roteiro do contrato lista os
            # roteiros. O get_queryset limita a agência a público/compartilhado.
            return [RequirePermission('roteiros_view', 'roteiros_laminas_edit',
                                      'contracts_view', 'contracts_edit')()]
        # retrieve/config/published/demais leituras de UM roteiro = abrir (só leitura),
        # ou quem faz contratos (precisa ler a foto pública p/ travar os valores).
        return [RequirePermission('roteiros_open', 'roteiros_edit', 'roteiros_create',
                                  'roteiros_delete', 'roteiros_laminas_edit',
                                  'contracts_view', 'contracts_edit')()]

    def _laminas_only(self):
        """True quando o usuário só tem a permissão restrita de lâminas (pode mexer
        SÓ nas imagens de lâmina — kind='blocking'). Superusuário e quem tem
        roteiros_edit não são restritos."""
        u = self.request.user
        if getattr(u, 'is_superuser', False):
            return False
        return has_any_perm(u, 'roteiros_laminas_edit') and not has_any_perm(u, 'roteiros_edit')

    @action(detail=True, methods=['post'], url_path='import-kml/preview')
    def import_kml_preview(self, request, pk=None):
        """POST /api/itineraries/{id}/import-kml/preview/ — analisa um KML/KMZ do
        Google My Maps (multipart, campo `file`) e devolve a PRÉVIA dos destinos
        (cidades) encontrados, casados com o catálogo. NÃO grava nada: a confirmação
        acontece no formulário do roteiro (as cidades selecionadas entram no M2M
        `cities` e são salvas junto com o roteiro, com a auditoria já existente)."""
        from .services.kml_import_service import (
            build_kml_preview, KmlImportError, MAX_UPLOAD_BYTES, ALLOWED_EXTS)
        it = self.get_object()   # 404 + escopo/permissão (roteiros_edit)
        f = request.FILES.get('file')
        if not f:
            return Response({'error': 'Envie um arquivo KML ou KMZ.'}, status=status.HTTP_400_BAD_REQUEST)
        if not (f.name or '').lower().endswith(ALLOWED_EXTS):
            return Response({'error': 'O arquivo enviado não é um KML ou KMZ válido.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if f.size and f.size > MAX_UPLOAD_BYTES:
            return Response({'error': 'O arquivo ultrapassa o tamanho máximo permitido.'},
                            status=status.HTTP_400_BAD_REQUEST)
        prefer = list(it.countries.values_list('id', flat=True))
        try:
            preview = build_kml_preview(f.read(), f.name, prefer_country_ids=prefer)
        except KmlImportError as e:
            return Response({'error': str(e), 'code': e.code}, status=status.HTTP_400_BAD_REQUEST)
        return Response(preview)


    # ── Ordem manual da listagem (arrastar) — alimenta a ordem do site público ──
    @action(detail=False, methods=['post'])
    def reorder(self, request):
        ids = request.data.get('order') or []
        # Ignora ids não-inteiros (payload malformado não deve derrubar em 500 no filter).
        ids = [pk for pk in ids if isinstance(pk, int) or (isinstance(pk, str) and pk.isdigit())]
        # Atômico (como os demais reorders de voo/trecho/imagem): uma falha no meio
        # não pode deixar a lista meio-reordenada (alimenta a ordem do site público).
        with transaction.atomic():
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
        obj.visibility = 'public'   # publicar = tornar público (todas as agências)
        obj.has_unpublished_changes = False
        obj.published_at = timezone.now()
        obj._skip_audit_signal = True   # eu logo 'publish'; evita 'update' duplicado
        obj.save(update_fields=['published_data', 'is_published', 'visibility', 'has_unpublished_changes', 'published_at'])
        _audit(request, 'publish', obj)
        return Response(ItinerarySerializer(obj, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'])
    def unpublish(self, request, pk=None):
        obj = self.get_object()
        obj.is_published = False
        # Ao despublicar, cai para "exclusivo" se já tinha agências, senão "não listado".
        obj.visibility = 'agencies' if obj.shared_agencies.exists() else 'unlisted'
        obj._skip_audit_signal = True   # eu logo 'unpublish'; evita 'update' duplicado
        obj.save(update_fields=['is_published', 'visibility'])
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

    # ── Precificação (aba Valores) ──
    @action(detail=True, methods=['get', 'patch'], url_path='pricing-config')
    def pricing_config(self, request, pk=None):
        """Config do cálculo (get-or-create). PATCH atualiza a quantidade-base, margem etc."""
        obj = self.get_object()
        cfg, _ = ItineraryPricingConfig.objects.get_or_create(itinerary=obj)
        if request.method == 'PATCH':
            ser = ItineraryPricingConfigSerializer(cfg, data=request.data, partial=True)
            ser.is_valid(raise_exception=True)
            ser.save()
            _audit(request, 'update', obj, changes={'Precificação': {'antes': '—', 'depois': 'config atualizada'}})
            return Response(ser.data)
        return Response(ItineraryPricingConfigSerializer(cfg).data)

    @action(detail=True, methods=['get'], url_path='pricing')
    def pricing(self, request, pk=None):
        """Cálculo consolidado (fonte da verdade). ?pax= sobrescreve a quantidade-base."""
        from . import pricing as pricing_engine
        obj = self.get_object()
        pax = request.query_params.get('pax')
        return Response(pricing_engine.compute(obj, pax=int(pax) if pax else None))

    @action(detail=True, methods=['get'], url_path='pricing-simulate')
    def pricing_simulate(self, request, pk=None):
        """Simulador por quantidade (?pax=10,15,20) + ponto de equilíbrio."""
        from . import pricing as pricing_engine
        obj = self.get_object()
        raw = request.query_params.get('pax', '')
        pax_list = [p for p in (raw.split(',') if raw else []) if p.strip()]
        if not pax_list:
            cfg, _ = ItineraryPricingConfig.objects.get_or_create(itinerary=obj)
            b = cfg.base_pax or 15
            pax_list = sorted({max(1, b - 5), b, b + 5, b + 10})
        return Response({
            'scenarios': pricing_engine.simulate(obj, pax_list),
            'break_even': pricing_engine.break_even(obj),
        })

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
        # Permissão restrita de lâminas: só pode enviar imagem de LÂMINA (blocking).
        if self._laminas_only() and kind != 'blocking':
            return Response({'detail': 'Sem permissão: só é permitido enviar imagens das lâminas.'},
                            status=status.HTTP_403_FORBIDDEN)
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
        save_kwargs = {'itinerary': itinerary, 'day': day, 'kind': kind}
        # Imagem de lâmina (bloqueio) já é classificada como "lâmina" — não precisa
        # do pop-up de classificação.
        if kind == 'blocking':
            save_kwargs['subject_type'] = 'lamina'
        img = ser.save(**save_kwargs)
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
        if self._laminas_only() and img.kind != 'blocking':
            return Response({'detail': 'Sem permissão: só é permitido gerenciar imagens das lâminas.'},
                            status=status.HTTP_403_FORBIDDEN)
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
        # Restrito a lâminas: só pode mexer numa lâmina e mantê-la como lâmina.
        if self._laminas_only() and (kind != 'blocking' or img.kind != 'blocking'):
            return Response({'detail': 'Sem permissão: só é permitido gerenciar imagens das lâminas.'},
                            status=status.HTTP_403_FORBIDDEN)
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
        if self._laminas_only() and img.kind != 'blocking':
            return Response({'detail': 'Sem permissão: só é permitido gerenciar imagens das lâminas.'},
                            status=status.HTTP_403_FORBIDDEN)
        try:
            fields = _apply_image_meta(img, request.data)
        except ValueError as e:
            key = str(e)
            msg = {'city': 'Cidade inválida.', 'country': 'País inválido.',
                   'continent': 'Continente inválido.'}.get(key, 'Valor inválido.')
            return Response({key: [msg]}, status=status.HTTP_400_BAD_REQUEST)
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
        imgs = itinerary.images.filter(day__isnull=True)
        # Restrito a lâminas: só reordena entre lâminas (ignora outros tipos).
        if self._laminas_only():
            imgs = imgs.filter(kind='blocking')
        valid = set(imgs.values_list('id', flat=True))
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
    """Aplica subject_type/caption e a geo FLEXÍVEL (cidade OU país OU continente) a
    uma imagem (mutando-a) e devolve o conjunto de campos alterados. Precedência:
    cidade > país > continente — a mais específica preenchida deriva as demais.
    Fora de 'landscape' a geo é limpa. Levanta ValueError('city'|'country'|'continent')
    se um id for inválido."""
    from config_api.models import ConfigCity, ConfigCountry, ConfigContinent
    fields = set()
    if 'subject_type' in data:
        st = data.get('subject_type') or ''
        valid = {c[0] for c in ItineraryImage.SUBJECT_CHOICES}
        img.subject_type = st if st in valid else ''
        fields.add('subject_type')
    if 'caption' in data:
        img.caption = (data.get('caption') or '')[:300]
        fields.add('caption')

    # Geo: resolve na ordem cidade → país → continente. A primeira preenchida vence
    # e deriva as demais; as seguintes só se aplicam quando a mais específica está
    # ausente (por isso o país manual funciona mesmo com `city: null` no payload).
    city_set = country_set = False
    if 'city' in data:
        cid = data.get('city')
        if cid:
            city = ConfigCity.objects.select_related('state__country__continent').filter(pk=cid).first()
            if city is None:
                raise ValueError('city')
            img.city = city
            img.country_id = city.state.country_id
            img.continent_id = getattr(getattr(city.state, 'country', None), 'continent_id', None)
            fields.update({'city', 'country', 'continent'})
            city_set = True
        else:
            img.city = None
            fields.add('city')
    if not city_set and 'country' in data:
        cid = data.get('country')
        if cid:
            country = ConfigCountry.objects.select_related('continent').filter(pk=cid).first()
            if country is None:
                raise ValueError('country')
            img.country = country
            img.city = None
            img.continent_id = country.continent_id
            fields.update({'country', 'city', 'continent'})
            country_set = True
        else:
            img.country = None
            fields.update({'country'})
    if not city_set and not country_set and 'continent' in data:
        cid = data.get('continent')
        if cid:
            continent = ConfigContinent.objects.filter(pk=cid).first()
            if continent is None:
                raise ValueError('continent')
            img.continent = continent
            fields.add('continent')
        else:
            img.continent = None
            fields.add('continent')

    if img.subject_type in ('object', 'lamina'):
        img.city = None
        img.country = None
        img.continent = None
        fields.update({'city', 'country', 'continent'})
    return fields


# Permissões amplas (vêem/gerenciam TODOS os tipos) — atalho de compatibilidade.
# A galeria é controlada por permissões PRÓPRIAS: permissão de roteiro NÃO dá
# acesso à galeria (só 'roteiros_images_from_gallery', p/ escolher no picker).
GALLERY_BROAD = ('gallery_edit', 'gallery_delete')
# Qualquer uma destas dá ACESSO de leitura à galeria.
GALLERY_VIEW_PERMS = ('gallery_view', 'gallery_view_images', 'gallery_view_videos',
                      'gallery_view_laminas', 'roteiros_images_from_gallery') + GALLERY_BROAD

VIDEO_EXTS_TUP = ('.mp4', '.webm', '.mov', '.m4v', '.ogv')


def _gallery_laminas_only(user):
    """Visão restrita "só as lâminas padrão dos roteiros públicos e abertos" — é
    exclusiva das contas de OPERADORA (a restrição fina de conteúdo)."""
    return is_operadora_user(user)


def _gallery_allowed_types(user):
    """Quais tipos de mídia o usuário pode VER: {'image','video','lamina'}.
    Sem nenhum tipo específico marcado (só 'ver a galeria'/roteiros) → vê todos."""
    if getattr(user, 'is_superuser', False) or has_any_perm(user, *GALLERY_BROAD):
        return {'image', 'video', 'lamina'}
    types = set()
    if has_any_perm(user, 'gallery_view_images'):  types.add('image')
    if has_any_perm(user, 'gallery_view_videos'):  types.add('video')
    if has_any_perm(user, 'gallery_view_laminas'): types.add('lamina')
    if types:
        return types
    # 'ver a galeria' (base) ou o acesso do picker do roteiro → vê todos os tipos.
    if has_any_perm(user, 'gallery_view', 'roteiros_images_from_gallery'):
        return {'image', 'video', 'lamina'}
    return set()


def _gallery_can_upload(user, media):   # media: 'image' | 'video' | 'lamina'
    perm = {'image': 'gallery_upload_images', 'video': 'gallery_upload_videos',
            'lamina': 'gallery_upload_laminas'}[media]
    return getattr(user, 'is_superuser', False) or has_any_perm(user, perm, 'gallery_edit')


def _gallery_can_delete(user, media):
    perm = {'image': 'gallery_delete_images', 'video': 'gallery_delete_videos',
            'lamina': 'gallery_delete_laminas'}[media]
    return getattr(user, 'is_superuser', False) or has_any_perm(user, perm, 'gallery_delete')


def _gallery_media_of(img):
    if img.kind == 'blocking':
        return 'lamina'
    import os as _os
    return 'video' if _os.path.splitext(img.image.name or '')[1].lower() in VIDEO_EXTS_TUP else 'image'


class _GalleryReadPermission(RequirePermission(*GALLERY_VIEW_PERMS)):
    """Leitura da galeria: qualquer permissão de visão (geral ou por tipo), de
    roteiros, OU conta de operadora. O filtro por tipo é feito no queryset."""
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
        if self.action == 'create':
            # Gate amplo aqui; o tipo específico (imagem/vídeo) é checado no create().
            return [RequirePermission('gallery_upload_images', 'gallery_upload_videos', 'gallery_edit')()]
        if self.action == 'destroy':
            return [RequirePermission('gallery_delete_images', 'gallery_delete_videos',
                                      'gallery_delete_laminas', 'gallery_delete')()]
        # Editar metadados (legenda/cidade) de um item — quem gerencia a galeria.
        return [RequirePermission('gallery_edit', 'gallery_upload_images',
                                  'gallery_upload_videos', 'gallery_upload_laminas')()]

    def _type_filter(self, qs):
        """Restringe a galeria aos tipos de mídia que o usuário pode ver."""
        from django.db.models import Q
        allowed = _gallery_allowed_types(self.request.user)
        vq = self._video_q()
        if 'lamina' not in allowed:
            qs = qs.exclude(kind='blocking')
        if 'video' not in allowed:
            qs = qs.exclude(vq & ~Q(kind='blocking'))
        if 'image' not in allowed:
            qs = qs.exclude(~vq & ~Q(kind='blocking'))
        return qs

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
                             ('itinerary_id', 'itinerary')]:
            if p.get(param):
                qs = qs.filter(**{field: p[param]})
        # Geo: casa por campo explícito OU derivado da cidade (país/continente).
        if p.get('city'):
            qs = qs.filter(city_id=p['city'])
        if p.get('country'):
            qs = qs.filter(Q(country_id=p['country']) | Q(city__state__country_id=p['country']))
        if p.get('continent'):
            qs = qs.filter(Q(continent_id=p['continent'])
                           | Q(country__continent_id=p['continent'])
                           | Q(city__state__country__continent_id=p['continent']))
        return qs

    def get_queryset(self):
        p = self.request.query_params
        qs = (ItineraryImage.objects
              .select_related('city__state__country__continent', 'country__continent', 'itinerary')
              .filter(day__isnull=True))               # só imagens "de topo", não as de um DIA
        # Visão "só lâminas" (operadora ou perfil com essa permissão): vê SÓ as
        # lâminas padrão dos roteiros públicos e abertos — ignora as abas/mídia;
        # ainda respeita a busca e os filtros comuns.
        if _gallery_laminas_only(self.request.user):
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
        qs = self._type_filter(qs)   # respeita as permissões de tipo (imagens/vídeos/lâminas)
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
        media = 'video' if is_video else 'image'
        if not _gallery_can_upload(request.user, media):
            return Response({'detail': f'Você não tem permissão para enviar {"vídeos" if is_video else "imagens"}.'},
                            status=status.HTTP_403_FORBIDDEN)
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
            msg = {'city': 'Cidade inválida.', 'country': 'País inválido.',
                   'continent': 'Continente inválido.'}.get(key, 'Valor inválido.')
            return Response({key: [msg]}, status=status.HTTP_400_BAD_REQUEST)
        if fields:
            img.save(update_fields=list(fields))
        return Response(ItineraryImageSerializer(img, context=self.get_serializer_context()).data)

    def destroy(self, request, *args, **kwargs):
        """Só imagens do BANCO (sem roteiro) podem ser excluídas pela galeria. Se
        estiver anexada a um roteiro, bloqueia e explica onde ela está sendo usada."""
        img = self.get_object()
        media = _gallery_media_of(img)
        if not _gallery_can_delete(request.user, media):
            label = {'image': 'imagens', 'video': 'vídeos', 'lamina': 'lâminas'}[media]
            return Response({'detail': f'Você não tem permissão para excluir {label}.'},
                            status=status.HTTP_403_FORBIDDEN)
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

    @action(detail=False, methods=['get'], url_path='facets')
    def facets(self, request):
        """GET /api/itineraries/gallery/facets/ — continentes, países e cidades que
        REALMENTE aparecem na galeria (por campo explícito OU derivado da cidade),
        para os filtros só listarem o que retorna resultado. Cada país traz seu
        continente e cada cidade traz país+continente (para os filtros se ligarem)."""
        base = ItineraryImage.objects.filter(day__isnull=True)
        if _gallery_laminas_only(request.user):
            base = self._operadora_restrict(base)

        continents = {}
        for src in (
            base.filter(continent__isnull=False).values_list('continent_id', 'continent__name'),
            base.filter(country__continent__isnull=False).values_list('country__continent_id', 'country__continent__name'),
            base.filter(city__state__country__continent__isnull=False).values_list('city__state__country__continent_id', 'city__state__country__continent__name'),
        ):
            for cid, name in src.distinct():
                if cid and cid not in continents:
                    continents[cid] = {'id': cid, 'name': name}

        countries = {}
        for src in (
            base.filter(country__isnull=False).values_list('country_id', 'country__name', 'country__continent_id'),
            base.filter(city__isnull=False).values_list('city__state__country_id', 'city__state__country__name', 'city__state__country__continent_id'),
        ):
            for cid, name, contid in src.distinct():
                if cid and cid not in countries:
                    countries[cid] = {'id': cid, 'name': name, 'continent': contid}

        cities = {}
        for cid, name, coid, contid, coname in base.filter(city__isnull=False).values_list(
                'city_id', 'city__name', 'city__state__country_id',
                'city__state__country__continent_id', 'city__state__country__name').distinct():
            if cid and cid not in cities:
                cities[cid] = {'id': cid, 'name': name, 'country': coid, 'continent': contid,
                               'label': f'{name}, {coname}' if coname else name}

        low = lambda k: (k or '').lower()
        return Response({
            'continents': sorted(continents.values(), key=lambda c: low(c['name'])),
            'countries':  sorted(countries.values(),  key=lambda c: low(c['name'])),
            'cities':     sorted(cities.values(),     key=lambda c: low(c['label'])),
        })

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
        laminas_only = _gallery_laminas_only(request.user)
        if laminas_only:
            # Só baixa as lâminas que a pessoa pode ver (padrão / público / aberto).
            qs = self._apply_common_filters(self._operadora_restrict(qs), p)
        ids = [] if laminas_only else [int(x) for x in (p.get('ids') or '').split(',') if x.strip().isdigit()]
        if ids:
            # Seleção manual: baixa exatamente esses itens (ignora tipos/filtros).
            qs = qs.filter(pk__in=ids)
        elif not laminas_only:
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
        if not laminas_only:
            qs = self._type_filter(qs)   # respeita as permissões de tipo do usuário
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


# ═══════════ Precificação (aba Valores) ═══════════
class ItineraryCostItemViewSet(viewsets.ModelViewSet):
    """Itens de custo do roteiro (aba Valores). Filtra por ?itinerary=<id>."""
    serializer_class = ItineraryCostItemSerializer
    pagination_class = None
    get_permissions  = _roteiro_edit_permissions

    def get_queryset(self):
        qs = ItineraryCostItem.objects.select_related('accommodation_type')
        if self.action == 'list':
            it = self.request.query_params.get('itinerary')
            return qs.filter(itinerary_id=it) if it else qs.none()
        return qs

    @action(detail=False, methods=['post'], url_path='reorder')
    def reorder(self, request):
        ids = request.data.get('order') or []
        with transaction.atomic():
            for pos, cid in enumerate(ids):
                ItineraryCostItem.objects.filter(pk=cid).update(order=pos)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='duplicate')
    def duplicate(self, request, pk=None):
        obj = self.get_object()
        obj.pk = None
        obj.description = f'{obj.description} (cópia)'
        obj.save()
        return Response(self.get_serializer(obj).data, status=status.HTTP_201_CREATED)


class ItineraryCurrencyRateViewSet(viewsets.ModelViewSet):
    """Cotações travadas do roteiro. Filtra por ?itinerary=<id>."""
    serializer_class = ItineraryCurrencyRateSerializer
    pagination_class = None
    get_permissions  = _roteiro_edit_permissions

    def get_queryset(self):
        qs = ItineraryCurrencyRate.objects.all()
        if self.action == 'list':
            it = self.request.query_params.get('itinerary')
            return qs.filter(itinerary_id=it) if it else qs.none()
        return qs


class ItineraryInventoryBlockViewSet(viewsets.ModelViewSet):
    """Bloqueios / disponibilidade do roteiro (aba Valores › Disponibilidade).
    Filtra por ?itinerary=<id>."""
    serializer_class = ItineraryInventoryBlockSerializer
    pagination_class = None
    get_permissions  = _roteiro_edit_permissions

    def get_queryset(self):
        qs = (ItineraryInventoryBlock.objects
              .select_related('ship_cabin', 'airline', 'flight_class')
              .prefetch_related('accommodations'))
        if self.action == 'list':
            it = self.request.query_params.get('itinerary')
            return qs.filter(itinerary_id=it) if it else qs.none()
        return qs

    @action(detail=False, methods=['post'], url_path='reorder')
    def reorder(self, request):
        ids = request.data.get('order') or []
        with transaction.atomic():
            for pos, cid in enumerate(ids):
                ItineraryInventoryBlock.objects.filter(pk=cid).update(order=pos)
        return Response(status=status.HTTP_204_NO_CONTENT)
