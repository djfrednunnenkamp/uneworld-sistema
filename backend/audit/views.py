from django.http import FileResponse
from rest_framework import serializers, viewsets, filters
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from users_api.permissions import RequirePermission, has_any_perm
from .models import AuditLog
from core.search import AccentInsensitiveSearchFilter


# Modelos cujo log de upload/download aponta para um arquivo servível:
# model_name -> ('app_label.Model', 'campo_do_arquivo')
# O 2º item é o nome do campo de arquivo OU um callable(obj, log) -> FieldFile
# (usado no Contrato, que tem 2 arquivos — o log diz qual em changes['_file_field']).
FILE_MODELS = {
    'ItineraryImage':    ('itineraries.ItineraryImage', 'image'),
    'ItineraryDocument': ('itineraries.ItineraryDocument', 'file'),
    'ConfigHotelMedia':  ('config_api.ConfigHotelMedia', 'file'),
    'ConfigBoatMedia':   ('config_api.ConfigBoatMedia', 'file'),
    'PassengerDocument': ('passengers.PassengerDocument', 'file'),
    'Airline':           ('config_api.Airline', 'logo'),
    'OperatingCompany':  ('config_api.OperatingCompany', 'ceo_signature'),
    # Contrato: só serve o arquivo ARMAZENADO (assinado/comprovante, marcados com
    # _file_field). O "Baixou o PDF" gerado no navegador não fica salvo → devolve
    # None (404) e o front regenera o PDF na hora.
    'Contract':          ('contracts.Contract',
                          lambda obj, log: getattr(obj, (log.changes or {}).get('_file_field'), None)
                          if (log.changes or {}).get('_file_field') else None),
}


class AuditLogSerializer(serializers.ModelSerializer):
    action_label = serializers.CharField(source='get_action_display', read_only=True)
    timestamp_br = serializers.SerializerMethodField()
    has_file     = serializers.SerializerMethodField()
    user_avatar  = serializers.SerializerMethodField()
    source       = serializers.SerializerMethodField()

    def get_source(self, obj):
        # Registros antigos não têm `source` — deriva pela presença de usuário.
        return obj.source or ('user' if obj.user_id else 'system')

    class Meta:
        model = AuditLog
        fields = [
            'id', 'timestamp', 'timestamp_br', 'source',
            'user_display', 'user_avatar', 'action', 'action_label',
            'model_name', 'model_label', 'object_id', 'object_repr',
            'changes', 'ip_address', 'has_file',
            'geo_city', 'geo_country', 'latitude', 'longitude', 'geo_precise', 'geo_address',
        ]

    def get_has_file(self, obj):
        # O log aponta para um arquivo servível (imagem/doc/mídia/PDF)?
        spec = FILE_MODELS.get(obj.model_name)
        if not spec or not obj.object_id:
            return False
        # Campo dinâmico (ex: Contrato tem 2 arquivos) → nos eventos de download
        # (o resolver escolhe pelo _file_field; sem ele, cai no arquivo padrão).
        if callable(spec[1]):
            return obj.action == 'download'
        return True

    def get_user_avatar(self, obj):
        u = obj.user
        perms = getattr(u, 'permissions', None) if u else None
        return perms.avatar.url if (perms and perms.avatar) else None

    def get_timestamp_br(self, obj):
        from django.utils import timezone
        local = timezone.localtime(obj.timestamp)
        return local.strftime('%d/%m/%Y %H:%M:%S')


class AuditPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 200


# Modelos cobertos pelo botão "Log" da página Configurações (scope=settings)
SETTINGS_MODELS = [
    'ConfigProfession', 'ConfigLanguage', 'ConfigCountry', 'ConfigState', 'ConfigCity',
    'ConfigGender', 'ConfigVaccine', 'ConfigProfCard', 'CustomDocType', 'CustomDocField',
    'CustomDocFieldOption',
    'ConfigAccommodation', 'ConfigListCategory', 'ListAdditional', 'CrewRole', 'Destination',
    'Airport', 'Airline', 'BusMap', 'BusMapRow', 'PermissionProfile',
    # Catálogos e configurações adicionais
    'ConfigItineraryCategory', 'ConfigItineraryType', 'ConfigMaritimeCompany', 'ConfigTerrestreCompany',
    'ConfigCurrency', 'ConfigKeyword', 'ConfigInclusion', 'ConfigHighlight', 'ConfigSpecialDate',
    'ConfigContinent', 'ConfigPaymentMethod', 'ConfigPaymentPlan', 'ConfigExchangeRate', 'ConfigExchangeSettings',
    'ConfigHotelCategory', 'ConfigHotel', 'ConfigHotelMedia', 'ConfigBoat', 'ConfigBoatMedia',
    'OperatingCompany', 'OperatingCompanyContact', 'TermsAndConditions', 'SystemSettings',
    'ContractClause',
]

# Botão "Log" de cada área do sistema: clicar nele tem que mostrar TUDO que é
# relevante pra área, não só o modelo "principal" — ex: Lista de Passageiros
# inclui também ListEnrollment (passageiro entrando/saindo/mudando na lista).
CONTRACT_MODELS = [
    'Contract', 'ContractAccommodationLine', 'ContractGuest',
    'ContractInstallment', 'ContractAdjustment',
]

SCOPE_MODELS = {
    'settings':    SETTINGS_MODELS,
    'lists':       ['PassengerList', 'ListEnrollment', 'Enrollment', 'Roteiro', 'Room', 'ListTask',
                    'VoucherList', 'VoucherFlightConfirmation'],
    'passengers':  ['Passenger', 'PassengerDocument'],
    'agencies':    ['Agency', 'AgencyMember'],
    'users':       ['User', 'UserPermissions'],
    'contracts':   CONTRACT_MODELS,
    'itineraries': ['Itinerary', 'ItineraryDocument', 'ItineraryImage', 'ItineraryDeparture',
                    'ItineraryFlight', 'ItineraryHotel', 'ItineraryBoat',
                    'ItineraryTerrestreDeparture', 'ItineraryTerrestreLeg',
                    'ItineraryCostItem', 'ItineraryInventoryBlock', 'ItineraryCurrencyRate',
                    'ConfigShipCabin', 'ConfigFlightClass'],
}


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Qualquer usuário autenticado pode acessar — get_queryset() decide o que ele
    vê: acesso amplo com permissão de log, escopo de uma área específica (ex:
    passengers_view_logs), ou — sem nenhuma permissão de log — só as próprias ações."""
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = AuditPagination
    filter_backends = [AccentInsensitiveSearchFilter, filters.OrderingFilter]
    search_fields = ['user_display', 'object_repr', 'model_label']
    ordering = ['-timestamp']

    @action(detail=True, methods=['get'])
    def file(self, request, pk=None):
        """Serve o arquivo apontado por um log de upload/download (imagem, vídeo,
        PDF…). ?download=1 força baixar; senão, inline (visualizar). get_object
        respeita o escopo/permissão — só serve arquivo de log que a pessoa pode ver."""
        log = self.get_object()
        spec = FILE_MODELS.get(log.model_name)
        if not spec or not log.object_id:
            return Response({'detail': 'Este registro não tem arquivo.'}, status=404)
        from django.apps import apps
        try:
            Model = apps.get_model(spec[0])
        except Exception:
            return Response({'detail': 'Modelo indisponível.'}, status=404)
        obj = Model.objects.filter(pk=log.object_id).first()
        if not obj:
            return Response({'detail': 'Arquivo indisponível (o registro pode ter sido removido).'}, status=404)
        f = spec[1](obj, log) if callable(spec[1]) else getattr(obj, spec[1], None)
        if not f:
            return Response({'detail': 'Arquivo indisponível (o registro pode ter sido removido).'}, status=404)
        as_attachment = request.query_params.get('download') == '1'
        try:
            return FileResponse(f.open('rb'), as_attachment=as_attachment, filename=f.name.split('/')[-1])
        except FileNotFoundError:
            return Response({'detail': 'Arquivo não encontrado no servidor.'}, status=404)

    def get_queryset(self):
        qs = AuditLog.objects.select_related('user', 'user__permissions').all()
        action = self.request.query_params.get('action')
        model  = self.request.query_params.get('model')
        user_search = self.request.query_params.get('user')
        user_id_filter = self.request.query_params.get('user_id')
        date_from = self.request.query_params.get('date_from')
        date_to   = self.request.query_params.get('date_to')
        object_id = self.request.query_params.get('object_id')
        list_id      = self.request.query_params.get('list_id')
        passenger_id = self.request.query_params.get('passenger_id')
        agency_id    = self.request.query_params.get('agency_id')
        contract_id  = self.request.query_params.get('contract_id')
        itinerary_id = self.request.query_params.get('itinerary_id')
        scope        = self.request.query_params.get('scope')
        source       = self.request.query_params.get('source')
        show_nav     = self.request.query_params.get('show_nav') in ('1', 'true', 'True')

        current_user = self.request.user
        # "Ver TODOS os logs" é exclusivo do superusuário. As chaves legadas
        # view_audit_log/log_view foram retiradas da UI de permissões e NÃO
        # podem mais agir como um mestre invisível que libera o log inteiro —
        # senão um usuário com esse campo ainda ligado no banco (sem conseguir
        # desmarcar, porque some da tela) enxerga tudo. O acesso amplo agora é
        # só do superusuário; os demais veem as próprias ações + as áreas cujo
        # "_view_logs" granular foi concedido.
        has_global = bool(current_user.is_superuser)
        # Cada área usa a MESMA permissão "_view_logs" já configurada na sua
        # própria seção (Passageiros, Agências, Listas, Usuários,
        # Configurações) — evita duplicar a mesma decisão em dois lugares.
        has_log_passengers = has_global or has_any_perm(current_user, 'passengers_view_logs')
        has_log_lists      = has_global or has_any_perm(current_user, 'lists_view_logs')
        has_log_agencies   = has_global or has_any_perm(current_user, 'agencies_view_logs')
        has_log_users      = has_global or has_any_perm(current_user, 'users_view_logs')
        has_log_settings   = has_global or has_any_perm(current_user, 'settings_view_logs')
        has_log_contracts  = has_global or has_any_perm(current_user, 'contracts_view_logs')
        has_log_itineraries = has_global or has_any_perm(current_user, 'roteiros_view_logs')
        has_any_area = (has_log_passengers or has_log_lists or has_log_agencies
                        or has_log_users or has_log_settings or has_log_contracts
                        or has_log_itineraries)
        has_page_view_access = has_global or has_any_perm(current_user, 'log_page_views')

        # Navegação entre páginas (PageView) e login/logout: por padrão ficam fora
        # pra não poluir a visão de quem está revisando o log (login sozinho já é
        # a maioria das entradas no dia a dia). Duas formas de trazer de volta —
        # independentes uma da outra:
        # - Tipo = Navegação (páginas): mostra SÓ as entradas de navegação.
        # - Ação = Login/Logout: mostra só essa ação (filtro explícito).
        # - toggle "Ver navegação dos usuários" (show_nav): mistura navegação +
        #   login/logout com tudo que já está sendo mostrado pelos outros filtros
        #   (usuário, ação, período, busca…), sem substituí-los.
        include_page_views = has_page_view_access and (model == 'PageView' or show_nav)
        if model == 'PageView':
            qs = qs.filter(model_name='PageView') if has_page_view_access else qs.none()
            model = ''
        elif not include_page_views:
            qs = qs.exclude(model_name='PageView')

        include_login_noise = show_nav or action in ('login', 'logout')
        if not include_login_noise:
            qs = qs.exclude(action__in=['login', 'logout'])

        scope_perms = {
            'settings': has_log_settings, 'lists': has_log_lists,
            'passengers': has_log_passengers, 'agencies': has_log_agencies, 'users': has_log_users,
            'contracts': has_log_contracts, 'itineraries': has_log_itineraries,
        }
        if scope in scope_perms and not scope_perms[scope]:
            return qs.none()

        # Sem NENHUMA permissão de log (e sem acesso global): a pessoa só pode
        # ver as PRÓPRIAS ações — nunca o log de terceiros. Isso precisa valer
        # MESMO quando ela passa list_id/passenger_id/agency_id/contract_id/
        # scope na URL: sem essa trava, bastava forjar um desses parâmetros pra
        # furar a permissão e cair no fluxo abaixo (que, sem área permitida,
        # não filtra nada) e acabar enxergando TODOS os logs do sistema.
        # has_any_area já embute has_global (liga todas as áreas), então esse
        # return nunca atinge quem tem acesso amplo ou de alguma área.
        if not has_any_area:
            return qs.filter(user=current_user)

        # Se não tem acesso global, filtra apenas as áreas com permissão
        if not has_global:
            from django.db.models import Q as DQ
            area_q = DQ()
            if has_log_passengers:
                area_q |= DQ(model_name__in=SCOPE_MODELS['passengers'])
            if has_log_lists:
                area_q |= DQ(model_name__in=SCOPE_MODELS['lists'])
            if has_log_agencies:
                area_q |= DQ(model_name__in=SCOPE_MODELS['agencies'])
            if has_log_users:
                area_q |= DQ(model_name__in=SCOPE_MODELS['users'])
            if has_log_settings:
                area_q |= DQ(model_name__in=SETTINGS_MODELS)
            if has_log_contracts:
                area_q |= DQ(model_name__in=CONTRACT_MODELS)
            if has_log_itineraries:
                area_q |= DQ(model_name__in=SCOPE_MODELS['itineraries'])
            if show_nav and has_page_view_access:
                area_q |= DQ(model_name='PageView') | DQ(action__in=['login', 'logout'])
            if area_q.children:
                qs = qs.filter(area_q)

        # Navegação (PageView) + login/logout entram MESMO com um escopo/área ativa
        # quando o toggle "Ver navegação" está ligado — senão o filtro de escopo
        # abaixo os removia e o toggle não mostrava nada dentro de Contratos/Roteiros.
        from django.db.models import Q as _NavQ
        nav_q = (_NavQ(model_name='PageView') | _NavQ(action__in=['login', 'logout'])) if (show_nav and has_page_view_access) else None
        if scope in SCOPE_MODELS:
            sq = _NavQ(model_name__in=SCOPE_MODELS[scope])
            if nav_q is not None:
                sq |= nav_q
            qs = qs.filter(sq)
        if action:    qs = qs.filter(action=action)
        # Origem (Sistema/Usuário/CSV). Registros antigos têm source='' — derivam
        # system/user pela presença de usuário, então o filtro cobre os dois.
        from django.db.models import Q as DQ
        if source == 'system':
            qs = qs.filter(DQ(source='system') | (DQ(source='') & DQ(user__isnull=True)))
        elif source == 'user':
            qs = qs.filter(DQ(source='user') | (DQ(source='') & DQ(user__isnull=False)))
        elif source == 'csv':
            qs = qs.filter(source='csv')
        if model:     qs = qs.filter(model_name=model)
        if object_id: qs = qs.filter(object_id=object_id)
        if user_search:    qs = qs.filter(user_display__icontains=user_search)
        if user_id_filter: qs = qs.filter(user_id=user_id_filter)
        if date_from: qs = qs.filter(timestamp__date__gte=date_from)
        if date_to:   qs = qs.filter(timestamp__date__lte=date_to)
        if list_id:
            from trips.models import ListEnrollment
            from django.db.models import Q
            enrollment_ids = list(
                ListEnrollment.objects.filter(passenger_list_id=list_id)
                .values_list('id', flat=True)
            )
            qs = qs.filter(
                Q(model_name='ListEnrollment', object_id__in=[str(i) for i in enrollment_ids]) |
                Q(model_name='PassengerList', object_id=str(list_id))
            )
        if passenger_id:
            from passengers.models import PassengerDocument
            from django.db.models import Q
            doc_ids = list(
                PassengerDocument.objects.filter(passenger_id=passenger_id)
                .values_list('id', flat=True)
            )
            qs = qs.filter(
                Q(model_name='Passenger', object_id=str(passenger_id)) |
                Q(model_name='PassengerDocument', object_id__in=[str(i) for i in doc_ids])
            )
        if agency_id:
            qs = qs.filter(model_name='Agency', object_id=str(agency_id))
        if contract_id:
            from contracts.models import (
                ContractAccommodationLine, ContractGuest,
                ContractInstallment, ContractAdjustment,
            )
            from django.db.models import Q
            child_q = Q(model_name='Contract', object_id=str(contract_id))
            for model_cls, model_name in (
                (ContractAccommodationLine, 'ContractAccommodationLine'),
                (ContractGuest,             'ContractGuest'),
                (ContractInstallment,       'ContractInstallment'),
                (ContractAdjustment,        'ContractAdjustment'),
            ):
                ids = list(
                    model_cls.objects.filter(contract_id=contract_id)
                    .values_list('id', flat=True)
                )
                if ids:
                    child_q |= Q(model_name=model_name, object_id__in=[str(i) for i in ids])
            if show_nav and has_page_view_access:
                child_q |= Q(model_name='PageView', object_id=str(contract_id))
            qs = qs.filter(child_q)
        if itinerary_id:
            from itineraries.models import (
                ItineraryDocument, ItineraryImage, ItineraryDeparture, ItineraryFlight,
                ItineraryHotel, ItineraryBoat, ItineraryTerrestreDeparture, ItineraryTerrestreLeg,
                ItineraryCostItem, ItineraryInventoryBlock, ItineraryCurrencyRate,
            )
            from config_api.models import ConfigShipCabin, ConfigFlightClass
            from django.db.models import Q
            iq = Q(model_name='Itinerary', object_id=str(itinerary_id))
            # Filhos diretos (FK itinerary)
            for model_cls, name in (
                (ItineraryDocument, 'ItineraryDocument'), (ItineraryImage, 'ItineraryImage'),
                (ItineraryDeparture, 'ItineraryDeparture'), (ItineraryHotel, 'ItineraryHotel'),
                (ItineraryBoat, 'ItineraryBoat'), (ItineraryTerrestreDeparture, 'ItineraryTerrestreDeparture'),
                (ItineraryCostItem, 'ItineraryCostItem'), (ItineraryInventoryBlock, 'ItineraryInventoryBlock'),
                (ItineraryCurrencyRate, 'ItineraryCurrencyRate'),
                (ConfigShipCabin, 'ConfigShipCabin'), (ConfigFlightClass, 'ConfigFlightClass'),
            ):
                ids = list(model_cls.objects.filter(itinerary_id=itinerary_id).values_list('id', flat=True))
                if ids:
                    iq |= Q(model_name=name, object_id__in=[str(i) for i in ids])
            # Netos (via departure → itinerary)
            for model_cls, name in ((ItineraryFlight, 'ItineraryFlight'), (ItineraryTerrestreLeg, 'ItineraryTerrestreLeg')):
                ids = list(model_cls.objects.filter(departure__itinerary_id=itinerary_id).values_list('id', flat=True))
                if ids:
                    iq |= Q(model_name=name, object_id__in=[str(i) for i in ids])
            if show_nav and has_page_view_access:
                iq |= Q(model_name='PageView', object_id=str(itinerary_id))
            qs = qs.filter(iq)
        return qs


from rest_framework.decorators import api_view, permission_classes as drf_permission_classes
from rest_framework.response import Response
from audit.middleware import get_current_ip
from audit.tracking import user_display


def _log_client_event(request, action, default_model_name, default_model_label):
    """Registra um upload/download disparado pelo frontend (ex: exportação/importação
    de CSV em Configurações) — esses fluxos não passam por um único request de
    backend que represente "a ação" inteira, então o frontend chama isso direto."""
    label = (request.data.get('label') or '').strip()[:200]
    model_label = (request.data.get('model_label') or default_model_label).strip()[:100]
    summary = request.data.get('summary') or {}
    if not label:
        return Response({'error': 'label é obrigatório.'}, status=400)
    user = request.user
    AuditLog.objects.create(
        user=user, user_display=user_display(user), action=action,
        model_name=request.data.get('model_name') or default_model_name, model_label=model_label,
        object_id=str(request.data.get('object_id') or ''), object_repr=label,
        changes=summary if isinstance(summary, dict) else {},
        ip_address=get_current_ip(),
    )
    return Response({'ok': True}, status=201)


@api_view(['POST'])
@drf_permission_classes([IsAuthenticated])
def log_upload(request):
    return _log_client_event(request, 'upload', 'CsvImport', 'Importação CSV')


@api_view(['POST'])
@drf_permission_classes([IsAuthenticated])
def log_download(request):
    return _log_client_event(request, 'download', 'CsvExport', 'Exportação CSV')


@api_view(['POST'])
@drf_permission_classes([IsAuthenticated])
def log_page_view(request):
    """Registra que o usuário autenticado navegou para uma página do sistema —
    chamado automaticamente pelo frontend a cada troca de rota (ver Layout.jsx)."""
    path  = (request.data.get('path') or '').strip()[:500]
    label = (request.data.get('label') or '').strip()[:200]
    if not path:
        return Response({'error': 'path é obrigatório.'}, status=400)
    user = request.user
    # object_id opcional: amarra a navegação/ação a um registro (ex.: roteiro/
    # contrato) para aparecer no drill "só desse registro" com o toggle ligado.
    AuditLog.objects.create(
        user=user, user_display=user_display(user), action='view',
        model_name='PageView', model_label='Navegação',
        object_id=str(request.data.get('object_id') or ''), object_repr=label or path,
        changes={'Caminho': path} if label else {},
        ip_address=get_current_ip(),
    )
    return Response({'ok': True}, status=201)


@api_view(['POST'])
@drf_permission_classes([IsAuthenticated])
def log_actions(request):
    """Recebe em LOTE as interações da tela (cliques em botões, checkboxes,
    toggles, abas, edição de campos) e grava como navegação. Em lote pra não
    fazer uma requisição por clique. O conteúdo digitado NUNCA vem — só o rótulo
    do que foi clicado/editado."""
    events = request.data.get('events')
    if not isinstance(events, list):
        return Response({'error': 'events (lista) é obrigatório.'}, status=400)
    user = request.user
    ud = user_display(user)
    ip = get_current_ip()
    rows = []
    for e in events[:200]:   # trava de segurança
        label = (str(e.get('label') or '')).strip()[:200]
        if not label:
            continue
        path = (str(e.get('path') or '')).strip()[:500]
        rows.append(AuditLog(
            user=user, user_display=ud, action='view',
            model_name='PageView', model_label='Navegação',
            object_id=str(e.get('object_id') or ''), object_repr=label,
            changes={'Caminho': path} if path else {}, ip_address=ip,
        ))
    if rows:
        AuditLog.objects.bulk_create(rows)
    return Response({'ok': True, 'count': len(rows)}, status=201)


@api_view(['POST'])
@drf_permission_classes([IsAuthenticated])
def refine_login_location(request):
    """Recebe a localização precisa do navegador (com consentimento da
    pessoa, via navigator.geolocation) e refina o login mais recente dela,
    que até então só tinha a localização aproximada pelo IP (GeoLite2)."""
    try:
        lat = float(request.data.get('latitude'))
        lng = float(request.data.get('longitude'))
    except (TypeError, ValueError):
        return Response({'error': 'latitude e longitude são obrigatórios.'}, status=400)

    entry = AuditLog.objects.filter(user=request.user, action='login').order_by('-timestamp').first()
    if not entry:
        return Response({'error': 'Nenhum login recente encontrado.'}, status=404)

    from .geoip import reverse_geocode
    entry.latitude = lat
    entry.longitude = lng
    entry.geo_precise = True
    entry.geo_address = reverse_geocode(lat, lng)
    entry.save(update_fields=['latitude', 'longitude', 'geo_precise', 'geo_address'])
    return Response({'ok': True})
