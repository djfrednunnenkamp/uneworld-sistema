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


class DestinationViewSet(viewsets.ModelViewSet):
    queryset         = Destination.objects.all()
    serializer_class = DestinationSerializer
    filter_backends  = [filters.SearchFilter]
    search_fields    = ['name', 'country']


class TripViewSet(viewsets.ModelViewSet):
    queryset        = Trip.objects.select_related('destination').all()
    pagination_class = StandardResultsPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields   = ['title', 'destination__name', 'destination__country']
    ordering_fields = ['departure_date', 'created_at', 'price_per_person']

    def get_serializer_class(self):
        return TripListSerializer if self.action == 'list' else TripSerializer


class EnrollmentViewSet(viewsets.ModelViewSet):
    queryset         = Enrollment.objects.select_related('trip', 'passenger').all()
    serializer_class = EnrollmentSerializer
    filter_backends  = [filters.SearchFilter]
    search_fields    = ['passenger__full_name', 'trip__title']


# ── Lista de Passageiros ─────────────────────────────────────────────────────

def _cleanup_empty_rooms(pl):
    """Apaga acomodações (Room) que não têm nenhuma inscrição ativa."""
    occupied = set(
        pl.list_enrollments.exclude(accommodation='').values_list('accommodation', flat=True)
    )
    Room.objects.filter(passenger_list=pl).exclude(name__in=occupied).delete()

class SupplierViewSet(viewsets.ModelViewSet):
    queryset         = Supplier.objects.all()
    serializer_class = SupplierSerializer
    filter_backends  = [filters.SearchFilter]
    search_fields    = ['name']


class ListAdditionalViewSet(viewsets.ModelViewSet):
    queryset         = ListAdditional.objects.all()
    serializer_class = ListAdditionalSerializer
    filter_backends  = [filters.SearchFilter]
    search_fields    = ['name']


class CrewRoleViewSet(viewsets.ModelViewSet):
    queryset         = CrewRole.objects.all()
    serializer_class = CrewRoleSerializer
    filter_backends  = [filters.SearchFilter]
    search_fields    = ['name']


class RoteiroViewSet(viewsets.ModelViewSet):
    queryset         = Roteiro.objects.all()
    serializer_class = RoteiroSerializer
    filter_backends  = [filters.SearchFilter]
    search_fields    = ['name']


class PassengerListViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset         = PassengerList.objects.select_related(
        'default_airport', 'departure_country', 'departure_state', 'departure_city'
    ).prefetch_related('suppliers', 'additionals', 'roteiros').all()
    serializer_class = PassengerListSerializer
    pagination_class = StandardResultsPagination
    filter_backends  = [filters.SearchFilter, filters.OrderingFilter]
    search_fields    = ['name']
    ordering_fields  = ['name', 'start_date', 'created_at']

    def get_queryset(self):
        qs     = super().get_queryset()
        status = self.request.query_params.get('status')
        if status:
            qs = qs.filter(status=status)
        return qs

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
        if self.action in ('tasks', 'manage_task'):
            return [RequirePermission('lists_view')()]
        return super().get_permissions()

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
                'additionals', 'crew_roles', 'passenger__agencies',
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

            return Response(ListEnrollmentSerializer(
                entries, many=True, context={'country_codes': country_codes}
            ).data)

        return self._add_passenger(request, pl)

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
            quantity    = int(request.data.get('block_quantity', 1))
            if not agency_name:
                return Response({'error': 'Nome da agência é obrigatório.'}, status=400)
            if quantity < 1 or quantity > 100:
                return Response({'error': 'Quantidade inválida (1–100).'}, status=400)
            created = []
            from django.contrib.auth.models import User as DjUser
            resp_user = DjUser.objects.filter(pk=responsible_uid).first() if responsible_uid else None
            from agencies.models import Agency as AgencyModel
            agency_obj = AgencyModel.objects.filter(pk=agency_id).first() if agency_id else None
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
            p = PassengerModel.objects.get(pk=passenger_id)
        except PassengerModel.DoesNotExist:
            return Response({'error': 'Passageiro não encontrado.'}, status=404)
        if pl.list_enrollments.filter(passenger=p).exists():
            return Response({'error': 'Passageiro já está nesta lista.'}, status=400)
        from django.contrib.auth.models import User as DjUser
        resp_user = DjUser.objects.filter(pk=responsible_uid).first() if responsible_uid else None
        from agencies.models import Agency as AgencyModel
        agency_obj = AgencyModel.objects.filter(pk=agency_id).first() if agency_id else None
        e = ListEnrollment.objects.create(
            passenger_list=pl, passenger=p,
            agency=agency_obj, responsible_user=resp_user,
            accommodation=accommodation, enrollment_status=estatus, notes=notes,
        )
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
                passenger = PassengerModel.objects.filter(cpf=cpf).exclude(cpf='').first()
            if not passenger and email:
                passenger = PassengerModel.objects.filter(email=email).first()

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
            )
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
        for field in ('accommodation', 'seat', 'enrollment_status', 'order_in_list', 'notes',
                      'pending_until', 'pending_reason',
                      'ticket_status', 'connection_ticket_status', 'origin_mode'):
            if field in request.data:
                val = request.data[field]
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
        if 'additionals' in request.data:
            from .models import ListAdditional
            e.additionals.set(ListAdditional.objects.filter(pk__in=request.data['additionals']))
        if 'crew_roles' in request.data:
            from .models import CrewRole
            e.crew_roles.set(CrewRole.objects.filter(pk__in=request.data['crew_roles']))
        if 'agency' in request.data:
            from agencies.models import Agency
            ag_id = request.data['agency']
            e.agency = Agency.objects.filter(pk=ag_id).first() if ag_id else None
        if 'responsible_user' in request.data:
            from django.contrib.auth.models import User
            ru_id = request.data['responsible_user']
            e.responsible_user = User.objects.filter(pk=ru_id).first() if ru_id else None
        # Vincular / trocar / desvincular passageiro
        if 'passenger' in request.data:
            from passengers.models import Passenger as PassengerModel
            pid = request.data['passenger']
            if pid:
                p = PassengerModel.objects.filter(pk=pid).first()
                if p:
                    e.passenger    = p
                    e.is_block     = False
                    e.is_provisional = False
            else:
                # Desvincular: converte de volta para bloco
                e.passenger = None
                e.is_block  = True
        e.save()
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

        if request.method == 'DELETE':
            occupants = pl.list_enrollments.filter(accommodation=room.name)
            if occupants.exists():
                resolution = request.data.get('resolution')
                if resolution == 'unassign':
                    occupants.update(accommodation='')
                elif resolution == 'cancel':
                    occupants.update(enrollment_status='cancelado', accommodation='')
                elif resolution == 'remove':
                    occupants.delete()
                else:
                    return Response({'error': 'Não é possível excluir uma acomodação com passageiros.'}, status=400)
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
            pl.list_enrollments.filter(accommodation=old_name).update(accommodation=new_name)
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

