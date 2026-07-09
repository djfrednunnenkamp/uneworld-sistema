from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from core.pagination import StandardResultsPagination
from core.soft_delete import SoftDeleteViewSetMixin
from users_api.permissions import RequirePermission
from .models import Destination, Trip, Enrollment, Supplier, ListAdditional, CrewRole, Roteiro, PassengerList, ListEnrollment, Room, ListTask
from .serializers import (
    DestinationSerializer, TripSerializer, TripListSerializer, EnrollmentSerializer,
    SupplierSerializer, ListAdditionalSerializer, CrewRoleSerializer, RoteiroSerializer, PassengerListSerializer, ListEnrollmentSerializer,
    RoomSerializer, ListTaskSerializer,
)
from core.search import AccentInsensitiveSearchFilter


def _rbac(view=(), write=(), delete=()):
    """Factory de get_permissions RBAC — mesmo padrão de PassengerListViewSet e do
    _settings_perm de config_api: cada ação exige QUALQUER uma das permissões do
    conjunto correspondente (superusuário sempre passa). Sem isto os ViewSets
    caíam no default global IsAuthenticated, liberando CRUD (inclusive DELETE) a
    qualquer usuário logado.

    Fornecedores/adicionais/roteiros/tripulação são catálogos globais que também
    são criados/removidos pelo popup de edição de lista (ListModal) — por isso os
    conjuntos de escrita/exclusão incluem lists_edit/roteiros_edit além da
    permissão específica de Configurações, para não quebrar esse fluxo."""
    def get_permissions(self):
        if self.action == 'destroy':
            return [RequirePermission(*delete)()]
        if self.action in ('create', 'update', 'partial_update'):
            return [RequirePermission(*write)()]
        return [RequirePermission(*view)()]
    return get_permissions


class DestinationViewSet(viewsets.ModelViewSet):
    queryset         = Destination.objects.all()
    serializer_class = DestinationSerializer
    filter_backends  = [AccentInsensitiveSearchFilter]
    search_fields    = ['name', 'country']
    get_permissions  = _rbac(
        view=['settings_destinations_view', 'lists_view', 'manage_settings'],
        write=['settings_destinations_edit', 'manage_settings'],
        delete=['settings_destinations_delete', 'manage_settings'],
    )


class TripViewSet(viewsets.ModelViewSet):
    queryset        = Trip.objects.select_related('destination').all()
    pagination_class = StandardResultsPagination
    filter_backends = [AccentInsensitiveSearchFilter, filters.OrderingFilter]
    search_fields   = ['title', 'destination__name', 'destination__country']
    ordering_fields = ['departure_date', 'created_at', 'price_per_person']
    get_permissions = _rbac(
        view=['lists_view', 'manage_settings'],
        write=['lists_edit', 'manage_settings'],
        delete=['lists_delete', 'manage_settings'],
    )

    def get_serializer_class(self):
        return TripListSerializer if self.action == 'list' else TripSerializer


class EnrollmentViewSet(viewsets.ModelViewSet):
    queryset         = Enrollment.objects.select_related('trip', 'passenger').all()
    serializer_class = EnrollmentSerializer
    filter_backends  = [AccentInsensitiveSearchFilter]
    search_fields    = ['passenger__full_name', 'trip__title']
    get_permissions  = _rbac(
        view=['lists_view', 'manage_settings'],
        write=['lists_edit', 'manage_settings'],
        delete=['lists_delete', 'manage_settings'],
    )


# ── Lista de Passageiros ─────────────────────────────────────────────────────

def _doc_type_labels():
    """Mapa doc_type -> rótulo legível (CustomDocType configurável + fallback dos
    tipos padrão). Usado para nomear os documentos no ZIP e no seletor."""
    from passengers.models import PassengerDocument
    labels = dict(PassengerDocument.DOC_TYPE_CHOICES)
    try:
        from config_api.models import CustomDocType
        for k, l in CustomDocType.objects.values_list('key', 'label'):
            if l:
                labels[k] = l
    except Exception:
        pass
    return labels


def _doc_parts(d, type_labels):
    """Divide o documento em (grupo, variante, nome_completo):

    - grupo    = rótulo do TIPO (Passaporte, Vacina, Visto, RG…).
    - variante = o que distingue dentro do tipo (Brasil, Covid, Americano…);
                 vem do nome personalizado (label) e/ou, no passaporte, da ORIGEM
                 (país emissor, guardado em issued_by).
    - nome_completo = grupo + variante (ex.: "Passaporte Brasil").

    Assim o seletor pode agrupar por tipo e perguntar "qual?" e o download por
    nome completo continua batendo."""
    from core.search import strip_accents
    group = (type_labels.get(d.doc_type) or d.doc_type or 'Documento').strip()
    parts = []
    lbl = (d.label or '').strip()
    if lbl:
        if strip_accents(lbl).lower().startswith(strip_accents(group).lower()):
            rest = lbl[len(group):].strip(' -–—·').strip()
            if rest:
                parts.append(rest)
        else:
            parts.append(lbl)
    origin = (d.issued_by or '').strip()
    if origin and d.doc_type == 'passport' \
            and not any(strip_accents(origin).lower() in strip_accents(p).lower() for p in parts):
        parts.append(origin)
    variant = ' '.join(parts).strip()
    full = f'{group} {variant}'.strip() if variant else group
    return group, variant, full


def _doc_display_name(d, type_labels):
    """Nome completo do documento (grupo + variante) — usado no nome do arquivo."""
    return _doc_parts(d, type_labels)[2]


def _autocheck_guia(enrollment):
    """Se o passageiro é guia no CADASTRO (is_guide), já marca a função "Guia" na
    Equipe Técnica desta inscrição — a caixinha vem checada por padrão (pode ser
    desmarcada depois). É isso que faz a viagem contar no counter de guias.
    Passageiros sem is_guide entram sem a caixa (podem ser marcados à mão)."""
    from core.search import strip_accents
    from .models import CrewRole
    p = enrollment.passenger
    if not p or not p.is_guide:
        return
    guia = next((r for r in CrewRole.objects.all()
                 if strip_accents(r.name or '').lower() == 'guia'), None)
    if guia:
        enrollment.crew_roles.add(guia)


def _cleanup_empty_rooms(pl):
    """Apaga acomodações (Room) que não têm nenhuma inscrição ativa."""
    occupied = set(
        pl.list_enrollments.exclude(accommodation='').values_list('accommodation', flat=True)
    )
    Room.objects.filter(passenger_list=pl).exclude(name__in=occupied).delete()


def _as_int(value):
    """Converte para int com segurança; None se não for numérico. Evita que um
    id malformado (ex.: "abc") em filter(pk=...)/get(pk=...) estoure ValueError → 500."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return None

class SupplierViewSet(viewsets.ModelViewSet):
    queryset         = Supplier.objects.all()
    serializer_class = SupplierSerializer
    filter_backends  = [AccentInsensitiveSearchFilter]
    search_fields    = ['name']
    get_permissions  = _rbac(
        view=['lists_view', 'roteiros_view', 'manage_settings'],
        write=['lists_edit', 'roteiros_edit', 'manage_settings'],
        delete=['lists_edit', 'roteiros_edit', 'manage_settings'],
    )


class ListAdditionalViewSet(viewsets.ModelViewSet):
    queryset         = ListAdditional.objects.all()
    serializer_class = ListAdditionalSerializer
    filter_backends  = [AccentInsensitiveSearchFilter]
    search_fields    = ['name']
    get_permissions  = _rbac(
        view=['settings_list_additionals_view', 'lists_view', 'manage_settings'],
        write=['settings_list_additionals_edit', 'lists_edit', 'manage_settings'],
        delete=['settings_list_additionals_delete', 'lists_edit', 'manage_settings'],
    )


class CrewRoleViewSet(viewsets.ModelViewSet):
    queryset         = CrewRole.objects.all()
    serializer_class = CrewRoleSerializer
    filter_backends  = [AccentInsensitiveSearchFilter]
    search_fields    = ['name']
    get_permissions  = _rbac(
        view=['settings_crew_roles_view', 'lists_view', 'manage_settings'],
        write=['settings_crew_roles_edit', 'lists_edit', 'manage_settings'],
        delete=['settings_crew_roles_delete', 'lists_edit', 'manage_settings'],
    )


class RoteiroViewSet(viewsets.ReadOnlyModelViewSet):
    """Roteiros disponíveis para vincular a uma lista de passageiros: só os
    ATIVOS e que ainda não terminaram (prontos/futuros) — os que já passaram não
    aparecem. Fonte: itineraries.Itinerary (a página Roteiros)."""
    serializer_class = RoteiroSerializer
    filter_backends  = [AccentInsensitiveSearchFilter]
    search_fields    = ['name']
    get_permissions  = _rbac(
        view=['roteiros_view', 'lists_view', 'lists_edit', 'manage_settings'],
    )

    def get_queryset(self):
        from itineraries.models import Itinerary
        from django.db.models import Q
        from django.utils import timezone
        today = timezone.localdate()
        return (Itinerary.objects
                .filter(status='ativo', is_deleted=False)
                .filter(Q(end_date__isnull=True) | Q(end_date__gte=today))
                .order_by('name'))


class PassengerListViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset         = PassengerList.objects.select_related(
        'default_airport', 'departure_country', 'departure_state', 'departure_city', 'bus_map'
    ).prefetch_related(
        'suppliers', 'additionals', 'roteiros', 'default_airports',
        # Guias da lista (passageiros marcados como guia, não cancelados) — p/ a
        # coluna "Guia" na listagem, sem N+1.
        Prefetch('list_enrollments',
                 queryset=ListEnrollment.objects.filter(passenger__is_guide=True)
                          .exclude(enrollment_status='cancelado').select_related('passenger'),
                 to_attr='guide_enrollments'),
    ).all()
    serializer_class = PassengerListSerializer
    pagination_class = StandardResultsPagination
    filter_backends  = [AccentInsensitiveSearchFilter, filters.OrderingFilter]
    search_fields    = ['name']
    ordering_fields  = ['name', 'start_date', 'created_at']

    def get_queryset(self):
        from users_api.permissions import agency_scope_ids
        qs     = super().get_queryset()
        # Usuário de agência só vê listas em que a agência dele tem passageiros
        # (a Lista não tem agência direta; o vínculo é via ListEnrollment.agency).
        scope = agency_scope_ids(self.request.user)
        if scope is not None:
            qs = qs.filter(list_enrollments__agency_id__in=scope).distinct()
        status = self.request.query_params.get('status')
        if status:
            qs = qs.filter(status=status)
        return qs

    def destroy(self, request, *args, **kwargs):
        # Lista vinculada 1:1 a um roteiro ATIVO NÃO pode ser excluída aqui — ela
        # só sai junto quando o roteiro é excluído. Mas se o roteiro já está na
        # lixeira, o vínculo não vale mais e a lista (avulsa) pode ser excluída.
        instance = self.get_object()
        if instance.roteiros.filter(is_deleted=False).exists():
            return Response(
                {'error': 'Esta lista pertence a um roteiro. Para removê-la, '
                          'exclua o roteiro correspondente.'},
                status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)

    def get_permissions(self):
        if self.action == 'destroy':
            return [RequirePermission('lists_delete')()]
        if self.action in ('create', 'update', 'partial_update'):
            return [RequirePermission('lists_edit')()]
        if self.action in ('list', 'retrieve'):
            return [RequirePermission('lists_view')()]
        if self.action == 'passageiros':
            if self.request.method == 'GET':
                return [RequirePermission('lists_view')()]
            return [RequirePermission('lists_passengers_add')()]
        if self.action == 'rooms':
            if self.request.method == 'GET':
                return [RequirePermission('lists_view')()]
            return [RequirePermission('lists_edit')()]
        if self.action == 'manage_passenger':
            if self.request.method == 'DELETE':
                return [RequirePermission('lists_passengers_remove')()]
            return [RequirePermission('lists_passengers_edit')()]
        if self.action == 'manage_room':
            return [RequirePermission('lists_edit')()]
        if self.action == 'import_csv':
            return [RequirePermission('lists_csv_upload')()]
        if self.action == 'log_download':
            return [RequirePermission('lists_download')()]
        if self.action in ('documents_zip', 'document_types'):
            return [RequirePermission('passengers_download_docs')()]
        if self.action in ('tasks', 'manage_task'):
            return [RequirePermission('lists_view')()]
        return super().get_permissions()

    @action(detail=True, methods=['get'], url_path='document-types')
    def document_types(self, request, pk=None):
        """Tipos de documento disponíveis entre os passageiros da lista, para o
        seletor de download. Cada item: {key, label, count} — ex.: Passaporte,
        Visto Americano, Vacina Febre Amarela — com quantos arquivos existem."""
        from users_api.permissions import agency_scope_ids
        pl = self.get_object()
        type_labels = _doc_type_labels()
        agg = {}
        seen = set()
        # Isolamento por agência (A-01): usuário de agência só conta/baixa documentos
        # dos passageiros da própria agência, mesmo numa lista compartilhada.
        scope = agency_scope_ids(request.user)
        enr = (pl.list_enrollments.select_related('passenger')
               .prefetch_related('passenger__documents').filter(passenger__isnull=False))
        if scope is not None:
            enr = enr.filter(agency_id__in=scope)
        for e in enr:
            p = e.passenger
            if p.id in seen:
                continue
            seen.add(p.id)
            for d in p.documents.all():
                if not d.file:
                    continue
                group, variant, full = _doc_parts(d, type_labels)
                entry = agg.setdefault(full, {
                    'group': group, 'variant': variant, 'doc_type': d.doc_type, 'count': 0,
                })
                entry['count'] += 1
        items = [{'key': k, 'label': k, 'group': v['group'], 'variant': v['variant'],
                  'doc_type': v['doc_type'], 'count': v['count']}
                 for k, v in sorted(agg.items(), key=lambda kv: kv[0].lower())]
        return Response(items)

    @action(detail=True, methods=['post'], url_path='documents-zip')
    def documents_zip(self, request, pk=None):
        """ZIP com os documentos dos passageiros, numa ÚNICA pasta nomeada com a
        lista e as datas da viagem. Cada arquivo: "Nº - Documento Nome completo".
        Body: `doc_names` (tipos escolhidos; vazio = todos) e `passenger_ids`
        (opcional; restringe aos selecionados)."""
        import io, os, re, zipfile
        from urllib.parse import quote
        from django.http import HttpResponse

        pl = self.get_object()
        ids = request.data.get('passenger_ids') or None
        wanted = request.data.get('doc_names') or None
        wanted_set = set(wanted) if wanted else None
        type_labels = _doc_type_labels()

        def safe(s):
            # Remove caracteres inválidos de nome de arquivo e limita o tamanho
            # (nomes muito longos estouram o path ao extrair em alguns sistemas).
            return (re.sub(r'[\\/:*?"<>|]+', '-', (s or '').strip()).strip('. ')[:110]).strip() or 'sem-nome'

        # Numeração dos passageiros = a mesma da tela: ordem padrão da inscrição
        # (order_in_list, enrolled_at) e os cancelados fora da contagem.
        seqmap = {}
        seq = 0
        for e in pl.list_enrollments.all():
            if e.enrollment_status == 'cancelado':
                continue
            seq += 1
            seqmap[e.id] = seq

        enrolls = (pl.list_enrollments.select_related('passenger')
                   .prefetch_related('passenger__documents').filter(passenger__isnull=False))
        # Isolamento por agência (A-01): não incluir no ZIP documentos de passageiros
        # de outra agência numa lista compartilhada.
        from users_api.permissions import agency_scope_ids
        scope = agency_scope_ids(request.user)
        if scope is not None:
            enrolls = enrolls.filter(agency_id__in=scope)
        if ids:
            enrolls = enrolls.filter(passenger_id__in=ids)

        # Nome da pasta: "Lista  DD-MM-AAAA a DD-MM-AAAA".
        def br(dt):
            return dt.strftime('%d-%m-%Y') if dt else ''
        folder_parts = [pl.name or f'lista-{pl.id}']
        if pl.start_date or pl.end_date:
            folder_parts.append(f'{br(pl.start_date) or "?"} a {br(pl.end_date) or "?"}')
        folder = safe(' '.join(folder_parts))

        buf = io.BytesIO()
        count = 0
        used = {}   # nome de arquivo -> contador, evita sobrescrever nomes iguais
        seen = set()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            for e in enrolls:
                p = e.passenger
                if p.id in seen:
                    continue
                seen.add(p.id)
                num = seqmap.get(e.id)
                full = (p.full_name or f'passageiro-{p.id}').strip()
                for d in p.documents.all():
                    if not d.file:
                        continue
                    name = _doc_display_name(d, type_labels)
                    if wanted_set is not None and name not in wanted_set:
                        continue
                    ext = os.path.splitext(d.file.name)[1] or os.path.splitext(d.original_name or '')[1] or ''
                    prefix = f'{num} - ' if num else ''
                    base = safe(f'{prefix}{name} {full}')
                    key = base + ext
                    n = used.get(key, 0)
                    used[key] = n + 1
                    fname = f'{base}{ext}' if n == 0 else f'{base} ({n + 1}){ext}'
                    try:
                        d.file.open('rb')
                        zf.writestr(f'{folder}/{fname}', d.file.read())
                        d.file.close()
                        count += 1
                    except Exception:
                        continue

        if count == 0:
            return Response({'error': 'Nenhum documento encontrado para baixar.'},
                            status=status.HTTP_400_BAD_REQUEST)
        buf.seek(0)
        zipname = folder + '.zip'
        from audit.tracking import log_event
        log_event('download', model_name='PassengerList', model_label='Lista de Passageiros',
                  object_id=pl.id, object_repr=str(pl),
                  changes={'Documentos (ZIP)': {'antes': '—', 'depois': f'{count} arquivo(s) baixado(s)'}})
        resp = HttpResponse(buf.getvalue(), content_type='application/zip')
        resp['Content-Disposition'] = f"attachment; filename*=UTF-8''{quote(zipname)}"
        return resp

    # ── Passageiros na lista ─────────────────────────────────────────────────

    @action(detail=True, methods=['get', 'post'], url_path='passageiros')
    def passageiros(self, request, pk=None):
        """GET: lista passageiros. POST: adiciona passageiro ou bloqueio."""
        pl = self.get_object()

        if request.method == 'GET':
            from passengers.models import PassengerDocument
            from config_api.models import ConfigCountry

            passport_docs_qs = PassengerDocument.objects.filter(
                doc_type='passport'
            ).exclude(doc_number='').order_by('-expiry_date', 'id')

            entries = list(pl.list_enrollments.select_related(
                'passenger', 'agency', 'responsible_user', 'departure_airport', 'selected_passport'
            ).prefetch_related(
                'additionals', 'crew_roles', 'passenger__agencies', 'passenger__special_needs',
                Prefetch('passenger__documents', queryset=passport_docs_qs, to_attr='passport_docs'),
            ).all())

            # Resolve códigos de país dos passaportes em UMA única consulta
            # (em vez de 1 consulta a ConfigCountry por passageiro)
            issued_by_names = set()
            for e in entries:
                if e.passenger:
                    for d in e.passenger.passport_docs[:2]:
                        if d.issued_by:
                            issued_by_names.add(d.issued_by)
            country_codes = dict(
                ConfigCountry.objects.filter(name__in=issued_by_names).values_list('name', 'code')
            )

            contracts_by_passenger = self._contracts_by_passenger(request.user, pl)

            # Confirmação de voo do voucher, por passageiro (entry_key + URL).
            voucher_by_passenger = {}
            try:
                from vouchers import build as voucher_build
                from vouchers.models import VoucherList
                voucher = VoucherList.objects.filter(passenger_list=pl).first()
                for en in voucher_build.build_entries(pl, request=request, voucher=voucher):
                    for pid in en.get('passenger_ids', []):
                        voucher_by_passenger[pid] = {
                            'entry_key': en['key'],
                            'flight_confirmation': en.get('flight_confirmation'),
                        }
            except Exception:
                voucher_by_passenger = {}

            return Response(ListEnrollmentSerializer(
                entries, many=True, context={
                    'country_codes': country_codes,
                    'contracts_by_passenger': contracts_by_passenger,
                    'voucher_by_passenger': voucher_by_passenger,
                }
            ).data)

        return self._add_passenger(request, pl)

    def _contracts_by_passenger(self, user, pl):
        """Mapa {passenger_id: {...}} do contrato de cada passageiro relacionado
        a ESTA lista — o contrato com o mesmo roteiro da lista OU vinculado a
        ela. Preenchido só para quem pode ver contratos. Prioridade: contrato
        ligado à própria lista e, dentro disso, o mais recente."""
        from users_api.permissions import has_any_perm
        if not has_any_perm(user, 'contracts_view'):
            return {}
        from django.db.models import Q
        from contracts.models import Contract
        roteiro_ids = list(pl.roteiros.values_list('id', flat=True))
        q = Q(passenger_list=pl)
        if roteiro_ids:
            q |= Q(itinerary_id__in=roteiro_ids)
        contracts = list(
            Contract.objects.filter(q, is_deleted=False).prefetch_related('guests')
        )
        # ordena por prioridade CRESCENTE — o último a sobrescrever vence:
        # (não-desta-lista antes de desta-lista; mais antigo antes de mais novo)
        contracts.sort(key=lambda c: (c.passenger_list_id == pl.id, c.created_at))
        out = {}
        for c in contracts:
            info = {
                'id': c.id,
                'status': c.status,
                'status_label': c.get_status_display(),
                'stage': c.stage,
                'stage_label': c.get_stage_display(),
            }
            for g in c.guests.all():
                if g.passenger_id:
                    out[g.passenger_id] = info
        return out

    def _add_passenger(self, request, pl):
        is_block          = request.data.get('is_block', False)
        is_provisional    = request.data.get('is_provisional', False)
        accommodation     = request.data.get('accommodation', '')
        estatus           = request.data.get('enrollment_status', 'pendente')
        pending_until     = request.data.get('pending_until') or None
        pending_reason    = request.data.get('pending_reason', '')
        notes             = request.data.get('notes', '')
        agency_id         = request.data.get('agency')
        responsible_uid   = request.data.get('responsible_user')

        if is_block:
            # Bloqueio de agência ou passageiro provisório — cria N vagas sem passageiro
            agency_name = request.data.get('block_agency', '').strip()
            quantity    = _as_int(request.data.get('block_quantity', 1))
            if not agency_name:
                return Response({'error': 'Nome da agência é obrigatório.'}, status=400)
            if quantity is None or quantity < 1 or quantity > 100:
                return Response({'error': 'Quantidade inválida (1–100).'}, status=400)
            created = []
            from django.contrib.auth.models import User as DjUser
            resp_user = DjUser.objects.filter(pk=_as_int(responsible_uid)).first() if responsible_uid else None
            from agencies.models import Agency as AgencyModel
            agency_obj = AgencyModel.objects.filter(pk=_as_int(agency_id)).first() if agency_id else None
            for _ in range(quantity):
                e = ListEnrollment.objects.create(
                    passenger_list=pl, passenger=None,
                    is_block=True, is_provisional=bool(is_provisional), block_agency=agency_name,
                    agency=agency_obj, responsible_user=resp_user,
                    accommodation=accommodation, enrollment_status=estatus,
                    pending_until=pending_until, pending_until_created_by=(request.user if pending_until else None),
                    pending_reason=pending_reason, notes=notes,
                )
                created.append(ListEnrollmentSerializer(e).data)
            return Response(created, status=201)

        # Passageiro individual
        passenger_id = request.data.get('passenger')
        if not passenger_id:
            return Response({'error': 'passenger é obrigatório.'}, status=400)
        from passengers.models import Passenger as PassengerModel
        try:
            p = PassengerModel.objects.get(pk=_as_int(passenger_id))
        except PassengerModel.DoesNotExist:
            return Response({'error': 'Passageiro não encontrado.'}, status=404)
        if pl.list_enrollments.filter(passenger=p).exists():
            return Response({'error': 'Passageiro já está nesta lista.'}, status=400)
        from django.contrib.auth.models import User as DjUser
        resp_user = DjUser.objects.filter(pk=_as_int(responsible_uid)).first() if responsible_uid else None
        from agencies.models import Agency as AgencyModel
        agency_obj = AgencyModel.objects.filter(pk=_as_int(agency_id)).first() if agency_id else None
        e = ListEnrollment.objects.create(
            passenger_list=pl, passenger=p,
            agency=agency_obj, responsible_user=resp_user,
            accommodation=accommodation, enrollment_status=estatus, notes=notes,
            # Embarque padrão = aeroporto preferido da lista (pré-preenche o EMB).
            departure_airport=pl.default_airport,
        )
        _autocheck_guia(e)   # guia de cadastro já entra com a função "Guia" marcada
        return Response(ListEnrollmentSerializer(e).data, status=201)

    @action(detail=True, methods=['post'], url_path='import-csv',
            parser_classes=[MultiPartParser, FormParser])
    def import_csv(self, request, pk=None):
        """Importa passageiros em massa via CSV e os adiciona à lista."""
        import csv
        import io
        from datetime import datetime
        from passengers.models import Passenger as PassengerModel

        pl = self.get_object()
        file = request.FILES.get('file')
        if not file:
            return Response({'error': 'Arquivo CSV não enviado.'}, status=400)

        try:
            decoded = file.read().decode('utf-8-sig')
        except UnicodeDecodeError:
            decoded = file.read().decode('latin-1')

        sample = decoded[:1024]
        delimiter = ';' if sample.count(';') > sample.count(',') else ','
        reader = csv.DictReader(io.StringIO(decoded), delimiter=delimiter)

        def norm_key(k):
            return (k or '').strip().lower()

        def get_field(row, *names):
            for k, v in row.items():
                if norm_key(k) in names:
                    return (v or '').strip()
            return ''

        def parse_date(s):
            s = (s or '').strip()
            if not s:
                return None
            for fmt in ('%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y'):
                try:
                    return datetime.strptime(s, fmt).date()
                except ValueError:
                    continue
            return None

        valid_statuses = dict(ListEnrollment.STATUS_CHOICES)
        created_passengers = 0
        added = 0
        skipped = []
        errors = []
        enrollments = []

        for i, row in enumerate(reader, start=2):  # linha 1 = cabeçalho
            full_name = get_field(row, 'nome', 'nome completo', 'nome_completo', 'passageiro')
            cpf       = get_field(row, 'cpf')
            email     = get_field(row, 'email', 'e-mail')
            mobile    = get_field(row, 'telefone', 'celular')
            gender    = get_field(row, 'genero', 'gênero', 'sexo')
            birth     = parse_date(get_field(row, 'data_nascimento', 'data de nascimento', 'nascimento'))
            nationality   = get_field(row, 'nacionalidade')
            accommodation = get_field(row, 'acomodacao', 'acomodação', 'quarto')
            notes         = get_field(row, 'observacoes', 'observações', 'notas')

            status_raw = get_field(row, 'status').lower()
            enrollment_status = status_raw if status_raw in valid_statuses else 'pendente'

            if not full_name and not cpf and not email:
                continue  # linha vazia

            if not full_name:
                errors.append(f'Linha {i}: nome é obrigatório.')
                continue

            passenger = None
            if cpf:
                passenger = PassengerModel.objects.filter(cpf=cpf, is_deleted=False).exclude(cpf='').first()
            if not passenger and email:
                passenger = PassengerModel.objects.filter(email=email, is_deleted=False).first()

            if not passenger:
                if not email:
                    errors.append(f'Linha {i}: e-mail é obrigatório para cadastrar "{full_name}".')
                    continue
                try:
                    # full_name sozinho não preenche os campos Primeiro nome/
                    # Sobrenome usados na tela de edição — divide na primeira
                    # palavra (heurística simples, sem isso ficam vazios lá).
                    name_parts = full_name.split(' ', 1)
                    first_name = name_parts[0]
                    last_name  = name_parts[1] if len(name_parts) > 1 else ''
                    passenger = PassengerModel.objects.create(
                        full_name=full_name,
                        first_name=first_name,
                        last_name=last_name,
                        email=email,
                        cpf=cpf,
                        mobile=mobile,
                        gender=gender,
                        birth_date=birth,
                        nationality=nationality or 'BRASILEIRA',
                    )
                    created_passengers += 1
                except Exception as exc:
                    errors.append(f'Linha {i}: erro ao criar passageiro "{full_name}" ({exc}).')
                    continue

            if pl.list_enrollments.filter(passenger=passenger).exists():
                skipped.append(f'{passenger.full_name}: já está nesta lista.')
                continue

            e = ListEnrollment.objects.create(
                passenger_list=pl, passenger=passenger,
                accommodation=accommodation,
                enrollment_status=enrollment_status,
                notes=notes,
                # Embarque padrão = aeroporto preferido da lista (pré-preenche o EMB).
                departure_airport=pl.default_airport,
            )
            _autocheck_guia(e)   # guia de cadastro já entra com a função "Guia" marcada
            added += 1
            enrollments.append(ListEnrollmentSerializer(e).data)

        from audit.models import AuditLog
        from audit.middleware import get_current_user, get_current_ip
        from audit.tracking import user_display
        log_user = get_current_user()
        AuditLog.objects.create(
            user=log_user, user_display=user_display(log_user), action='upload',
            model_name='PassengerList', model_label='Lista de Passageiros',
            object_id=str(pl.pk), object_repr=str(pl)[:500],
            changes={
                'Arquivo': file.name,
                'Passageiros adicionados': added,
                'Passageiros novos criados': created_passengers,
                'Ignorados': len(skipped),
                'Erros': len(errors),
            },
            ip_address=get_current_ip(),
        )

        return Response({
            'added': added,
            'created_passengers': created_passengers,
            'skipped': skipped,
            'errors': errors,
            'enrollments': enrollments,
        }, status=201)

    @action(detail=True, methods=['patch', 'delete'], url_path=r'passageiros/(?P<enrollment_id>\d+)')
    def manage_passenger(self, request, pk=None, enrollment_id=None):
        """PATCH: atualiza enrollment. DELETE: remove enrollment."""
        pl = self.get_object()
        try:
            e = pl.list_enrollments.get(id=enrollment_id)
        except ListEnrollment.DoesNotExist:
            return Response({'error': 'Inscrição não encontrada.'}, status=404)

        if request.method == 'DELETE':
            e.delete()
            _cleanup_empty_rooms(pl)
            return Response(status=status.HTTP_204_NO_CONTENT)

        # PATCH
        _valid_status = {c[0] for c in ListEnrollment.STATUS_CHOICES}
        for field in ('accommodation', 'seat', 'enrollment_status', 'order_in_list', 'notes',
                      'pending_until', 'pending_reason',
                      'ticket_status', 'connection_ticket_status', 'origin_mode'):
            if field in request.data:
                val = request.data[field]
                if field == 'enrollment_status' and val not in _valid_status:
                    return Response({'error': 'Status de inscrição inválido.'}, status=400)
                if field == 'order_in_list':
                    # PositiveIntegerField: valor não-numérico estouraria no save() → 500.
                    val = _as_int(val)
                    if val is None or val < 0:
                        return Response({'error': 'order_in_list inválido.'}, status=400)
                if field == 'pending_until':
                    val = val or None
                    e.pending_until_created_by = request.user if val else None
                setattr(e, field, val)
        if 'departure_airport' in request.data:
            e.departure_airport_id = request.data['departure_airport'] or None
        if 'origin_country' in request.data:
            e.origin_country_id = request.data['origin_country'] or None
        if 'origin_state' in request.data:
            e.origin_state_id = request.data['origin_state'] or None
        if 'origin_city' in request.data:
            e.origin_city_id = request.data['origin_city'] or None
        if 'origin_airport' in request.data:
            e.origin_airport_id = request.data['origin_airport'] or None
        if 'selected_passport' in request.data:
            e.selected_passport_id = request.data['selected_passport'] or None
        _old_add = set(e.additionals.values_list('name', flat=True)) if 'additionals' in request.data else None
        _old_crew = set(e.crew_roles.values_list('name', flat=True)) if 'crew_roles' in request.data else None
        if 'additionals' in request.data:
            from .models import ListAdditional
            e.additionals.set(ListAdditional.objects.filter(pk__in=request.data['additionals']))
        if 'crew_roles' in request.data:
            from .models import CrewRole
            e.crew_roles.set(CrewRole.objects.filter(pk__in=request.data['crew_roles']))
            # A função "Guia" é POR VIAGEM: não marca a pessoa como guia no cadastro
            # (is_guide). Mesmo sem is_guide, a página Guias já a inclui por ter a
            # função "Guia" em alguma viagem.
        if 'agency' in request.data:
            from agencies.models import Agency
            ag_id = request.data['agency']
            e.agency = Agency.objects.filter(pk=_as_int(ag_id)).first() if ag_id else None
        if 'responsible_user' in request.data:
            from django.contrib.auth.models import User
            ru_id = request.data['responsible_user']
            e.responsible_user = User.objects.filter(pk=_as_int(ru_id)).first() if ru_id else None
        # Vincular / trocar / desvincular passageiro
        if 'passenger' in request.data:
            from passengers.models import Passenger as PassengerModel
            pid = request.data['passenger']
            if pid:
                p = PassengerModel.objects.filter(pk=_as_int(pid)).first()
                if p:
                    # unique_together(passenger_list, passenger): impedir duplicar o mesmo
                    # passageiro na lista (senão e.save() estoura IntegrityError → 500).
                    if pl.list_enrollments.filter(passenger=p).exclude(pk=e.pk).exists():
                        return Response(
                            {'error': 'Este passageiro já está nesta lista.'}, status=400)
                    e.passenger    = p
                    e.is_block     = False
                    e.is_provisional = False
                    # Ao virar passageiro real, se ainda não tem embarque, herda o
                    # aeroporto padrão da lista.
                    if e.departure_airport_id is None:
                        e.departure_airport = pl.default_airport
                    _autocheck_guia(e)   # guia de cadastro já entra com a função "Guia"
            else:
                # Desvincular: converte de volta para bloco
                e.passenger = None
                e.is_block  = True
        e.save()
        # M2M (adicionais/equipe técnica) não entram no diff do signal — loga à parte.
        _m2m = {}
        if _old_add is not None:
            _new = set(e.additionals.values_list('name', flat=True))
            if _new != _old_add:
                _m2m['Adicionais'] = {'antes': sorted(_old_add), 'depois': sorted(_new)}
        if _old_crew is not None:
            _new = set(e.crew_roles.values_list('name', flat=True))
            if _new != _old_crew:
                _m2m['Equipe técnica'] = {'antes': sorted(_old_crew), 'depois': sorted(_new)}
        if _m2m:
            from audit.tracking import log_event
            log_event('update', model_name='ListEnrollment', model_label='Passageiro na lista',
                      object_id=e.id, object_repr=str(e), changes=_m2m)
        _cleanup_empty_rooms(pl)
        return Response(ListEnrollmentSerializer(e).data)

    # ── Trechos individuais de voo por passageiro ───────────────────────────

    def _get_enrollment(self, pl, enrollment_id):
        try:
            return pl.list_enrollments.get(id=enrollment_id)
        except ListEnrollment.DoesNotExist:
            return None

    # ── Acomodações (quartos) ────────────────────────────────────────────────

    @action(detail=True, methods=['get', 'post'], url_path='rooms')
    def rooms(self, request, pk=None):
        """GET: lista acomodações (com backfill das que só existem como string nas inscrições). POST: cria acomodação vazia."""
        pl = self.get_object()

        if request.method == 'GET':
            existing_names = set(Room.objects.filter(passenger_list=pl).values_list('name', flat=True))
            derived_names = set(
                pl.list_enrollments.exclude(accommodation='').values_list('accommodation', flat=True)
            )
            for name in derived_names - existing_names:
                Room.objects.get_or_create(passenger_list=pl, name=name)
            rooms = Room.objects.filter(passenger_list=pl)
            return Response(RoomSerializer(rooms, many=True).data)

        name = (request.data.get('name') or '').strip()
        if not name:
            return Response({'error': 'Nome da acomodação é obrigatório.'}, status=400)
        if Room.objects.filter(passenger_list=pl, name=name).exists():
            return Response({'error': 'Já existe uma acomodação com esse nome.'}, status=400)
        room = Room.objects.create(passenger_list=pl, name=name)
        return Response(RoomSerializer(room).data, status=201)

    @action(detail=True, methods=['patch', 'delete'], url_path=r'rooms/(?P<room_id>\d+)')
    def manage_room(self, request, pk=None, room_id=None):
        """PATCH: renomeia acomodação e/ou confirma aviso de mesmo sexo (e sincroniza inscrições). DELETE: remove acomodação vazia."""
        pl = self.get_object()
        try:
            room = Room.objects.get(passenger_list=pl, id=room_id)
        except Room.DoesNotExist:
            return Response({'error': 'Acomodação não encontrada.'}, status=404)

        from audit.tracking import log_event
        if request.method == 'DELETE':
            occupants = pl.list_enrollments.filter(accommodation=room.name)
            n = occupants.count()
            if occupants.exists():
                resolution = request.data.get('resolution')
                if resolution == 'unassign':
                    occupants.update(accommodation='')
                    effect = f'{n} passageiro(s) desatribuído(s) da acomodação "{room.name}"'
                elif resolution == 'cancel':
                    occupants.update(enrollment_status='cancelado', accommodation='')
                    effect = f'{n} passageiro(s) cancelado(s) ao excluir "{room.name}"'
                elif resolution == 'remove':
                    occupants.delete()
                    effect = f'{n} passageiro(s) removido(s) da lista ao excluir "{room.name}"'
                else:
                    return Response({'error': 'Não é possível excluir uma acomodação com passageiros.'}, status=400)
                log_event('update', model_name='PassengerList', model_label='Lista de Passageiros',
                          object_id=pl.id, object_repr=str(pl), changes={'Acomodação': {'antes': room.name, 'depois': effect}})
            room.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        # PATCH — confirmar aviso de mesmo sexo (não exige nome)
        if 'same_sex_ack' in request.data and 'name' not in request.data:
            room.same_sex_ack = bool(request.data.get('same_sex_ack'))
            room.save(update_fields=['same_sex_ack'])
            return Response(RoomSerializer(room).data)

        # PATCH — renomear
        new_name = (request.data.get('name') or '').strip()
        if not new_name:
            return Response({'error': 'Nome da acomodação é obrigatório.'}, status=400)
        if new_name != room.name and Room.objects.filter(passenger_list=pl, name=new_name).exists():
            return Response({'error': 'Já existe uma acomodação com esse nome.'}, status=400)
        old_name = room.name
        room.name = new_name
        room.save()
        if old_name != new_name:
            moved = pl.list_enrollments.filter(accommodation=old_name).update(accommodation=new_name)
            if moved:
                log_event('update', model_name='PassengerList', model_label='Lista de Passageiros',
                          object_id=pl.id, object_repr=str(pl),
                          changes={'Acomodação renomeada': {'antes': old_name, 'depois': f'{new_name} ({moved} passageiro(s))'}})
        return Response(RoomSerializer(room).data)

    # ── Log de download (PDF/HTML gerados no frontend) ───────────────────────

    # ── Tarefas / Pendências da lista ─────────────────────────────────────────

    @action(detail=True, methods=['get', 'post'], url_path='tasks')
    def tasks(self, request, pk=None):
        pl = self.get_object()
        if request.method == 'GET':
            qs = pl.tasks.select_related('created_by').all()
            return Response(ListTaskSerializer(qs, many=True).data)
        ser = ListTaskSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ser.save(passenger_list=pl, created_by=request.user)
        return Response(ListTaskSerializer(ser.instance).data, status=201)

    @action(detail=True, methods=['patch', 'delete'], url_path=r'tasks/(?P<task_id>\d+)')
    def manage_task(self, request, pk=None, task_id=None):
        pl   = self.get_object()
        task = get_object_or_404(ListTask, pk=task_id, passenger_list=pl)
        if request.method == 'PATCH':
            ser = ListTaskSerializer(task, data=request.data, partial=True)
            ser.is_valid(raise_exception=True)
            ser.save()
            return Response(ListTaskSerializer(ser.instance).data)
        task.delete()
        return Response(status=204)

    @action(detail=True, methods=['post'], url_path='log-download')
    def log_download(self, request, pk=None):
        """Registra no log de auditoria a exportação da lista (PDF/HTML), gerada no frontend."""
        pl  = self.get_object()
        fmt = (request.data.get('format') or '').upper()
        section_labels = request.data.get('sections') or []

        from audit.models import AuditLog
        from audit.middleware import get_current_user, get_current_ip
        from audit.tracking import user_display
        user = get_current_user()
        AuditLog.objects.create(
            user=user,
            user_display=user_display(user),
            action='download',
            model_name='PassengerList',
            model_label='Lista de Passageiros',
            object_id=str(pl.pk),
            object_repr=str(pl)[:500],
            changes={'Formato': fmt, 'Seções exportadas': ', '.join(section_labels)} if fmt else {},
            ip_address=get_current_ip(),
        )
        return Response({'ok': True})

