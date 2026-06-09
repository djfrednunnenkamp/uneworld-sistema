from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .models import Destination, Trip, Enrollment, Supplier, ListAdditional, Roteiro, PassengerList, ListEnrollment, Room, FlightLeg, PassengerFlightLeg, FeederLeg
from .serializers import (
    DestinationSerializer, TripSerializer, TripListSerializer, EnrollmentSerializer,
    SupplierSerializer, ListAdditionalSerializer, RoteiroSerializer, PassengerListSerializer, ListEnrollmentSerializer,
    RoomSerializer, FlightLegSerializer, PassengerFlightLegSerializer, FeederLegSerializer,
)


class DestinationViewSet(viewsets.ModelViewSet):
    queryset         = Destination.objects.all()
    serializer_class = DestinationSerializer
    filter_backends  = [filters.SearchFilter]
    search_fields    = ['name', 'country']


class TripViewSet(viewsets.ModelViewSet):
    queryset        = Trip.objects.select_related('destination').all()
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


class RoteiroViewSet(viewsets.ModelViewSet):
    queryset         = Roteiro.objects.all()
    serializer_class = RoteiroSerializer
    filter_backends  = [filters.SearchFilter]
    search_fields    = ['name']


class PassengerListViewSet(viewsets.ModelViewSet):
    queryset         = PassengerList.objects.prefetch_related('suppliers', 'additionals').all()
    serializer_class = PassengerListSerializer
    filter_backends  = [filters.SearchFilter, filters.OrderingFilter]
    search_fields    = ['name']
    ordering_fields  = ['name', 'start_date', 'created_at']

    def get_queryset(self):
        qs     = super().get_queryset()
        status = self.request.query_params.get('status')
        if status:
            qs = qs.filter(status=status)
        return qs

    # ── Passageiros na lista ─────────────────────────────────────────────────

    @action(detail=True, methods=['get', 'post'], url_path='passageiros',
            permission_classes=[IsAuthenticated])
    def passageiros(self, request, pk=None):
        """GET: lista passageiros. POST: adiciona passageiro ou bloqueio."""
        pl = self.get_object()

        if request.method == 'GET':
            entries = pl.list_enrollments.select_related(
                'passenger', 'agency', 'responsible_user', 'departure_airport'
            ).all()
            return Response(ListEnrollmentSerializer(entries, many=True).data)

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
                    pending_until=pending_until, pending_reason=pending_reason, notes=notes,
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

    @action(detail=True, methods=['patch', 'delete'], url_path=r'passageiros/(?P<enrollment_id>\d+)',
            permission_classes=[IsAuthenticated])
    def manage_passenger(self, request, pk=None, enrollment_id=None):
        """PATCH: atualiza enrollment. DELETE: remove enrollment."""
        pl = self.get_object()
        try:
            e = pl.list_enrollments.get(id=enrollment_id)
        except ListEnrollment.DoesNotExist:
            return Response({'error': 'Inscrição não encontrada.'}, status=404)

        if request.method == 'DELETE':
            e.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        # PATCH
        for field in ('accommodation', 'enrollment_status', 'order_in_list', 'notes',
                      'pending_until', 'pending_reason',
                      'ticket_status', 'ticket_number', 'ticket_seat',
                      'connection_ticket_status', 'connection_ticket_number', 'connection_ticket_seat'):
            if field in request.data:
                val = request.data[field]
                setattr(e, field, (val or None) if field == 'pending_until' else val)
        if 'departure_airport' in request.data:
            e.departure_airport_id = request.data['departure_airport'] or None
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
        return Response(ListEnrollmentSerializer(e).data)

    # ── Trechos individuais de voo por passageiro ───────────────────────────

    def _get_enrollment(self, pl, enrollment_id):
        try:
            return pl.list_enrollments.get(id=enrollment_id)
        except ListEnrollment.DoesNotExist:
            return None

    @action(detail=True, methods=['get', 'post'],
            url_path=r'passageiros/(?P<enrollment_id>\d+)/legs',
            permission_classes=[IsAuthenticated])
    def passenger_legs(self, request, pk=None, enrollment_id=None):
        pl = self.get_object()
        e  = self._get_enrollment(pl, enrollment_id)
        if not e:
            return Response({'error': 'Inscrição não encontrada.'}, status=404)

        if request.method == 'GET':
            legs = e.passenger_flight_legs.select_related('origin_airport', 'destination_airport').all()
            direction = request.query_params.get('direction')
            if direction:
                legs = legs.filter(direction=direction)
            return Response(PassengerFlightLegSerializer(legs, many=True).data)

        leg = PassengerFlightLeg(
            enrollment=e,
            direction=request.data.get('direction', 'ida'),
            order=int(request.data.get('order', 0)),
            flight_number=request.data.get('flight_number', ''),
            airline=request.data.get('airline', ''),
            departure_date=request.data.get('departure_date') or None,
            departure_time=request.data.get('departure_time') or None,
            arrival_date=request.data.get('arrival_date') or None,
            arrival_time=request.data.get('arrival_time') or None,
            origin_airport_id=request.data.get('origin_airport') or None,
            destination_airport_id=request.data.get('destination_airport') or None,
        )
        leg.save()
        return Response(PassengerFlightLegSerializer(leg).data, status=201)

    @action(detail=True, methods=['patch', 'delete'],
            url_path=r'passageiros/(?P<enrollment_id>\d+)/legs/(?P<leg_id>\d+)',
            permission_classes=[IsAuthenticated])
    def manage_passenger_leg(self, request, pk=None, enrollment_id=None, leg_id=None):
        pl = self.get_object()
        e  = self._get_enrollment(pl, enrollment_id)
        if not e:
            return Response({'error': 'Inscrição não encontrada.'}, status=404)
        try:
            leg = PassengerFlightLeg.objects.select_related('origin_airport', 'destination_airport').get(enrollment=e, id=leg_id)
        except PassengerFlightLeg.DoesNotExist:
            return Response({'error': 'Trecho não encontrado.'}, status=404)

        if request.method == 'DELETE':
            leg.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        for field in ('direction', 'order', 'flight_number', 'airline'):
            if field in request.data:
                setattr(leg, field, request.data[field])
        for field in ('departure_date', 'departure_time', 'arrival_date', 'arrival_time'):
            if field in request.data:
                setattr(leg, field, request.data[field] or None)
        for fk in ('origin_airport', 'destination_airport'):
            if fk in request.data:
                setattr(leg, f'{fk}_id', request.data[fk] or None)
        leg.save()
        leg.refresh_from_db()
        return Response(PassengerFlightLegSerializer(leg).data)

    @action(detail=True, methods=['post'],
            url_path=r'passageiros/(?P<enrollment_id>\d+)/legs/copy',
            permission_classes=[IsAuthenticated])
    def copy_legs_from_block(self, request, pk=None, enrollment_id=None):
        """Copia os trechos do bloqueio para o passageiro, substituindo os existentes."""
        pl = self.get_object()
        e  = self._get_enrollment(pl, enrollment_id)
        if not e:
            return Response({'error': 'Inscrição não encontrada.'}, status=404)

        e.passenger_flight_legs.all().delete()
        block_legs = pl.flight_legs.select_related('origin_airport', 'destination_airport').all()
        new_legs = [
            PassengerFlightLeg(
                enrollment=e,
                direction=bl.direction,
                order=bl.order,
                origin_airport=bl.origin_airport,
                destination_airport=bl.destination_airport,
                flight_number=bl.flight_number,
                airline=bl.airline,
                departure_date=bl.departure_date,
                departure_time=bl.departure_time,
                arrival_date=bl.arrival_date,
                arrival_time=bl.arrival_time,
            )
            for bl in block_legs
        ]
        PassengerFlightLeg.objects.bulk_create(new_legs)
        legs = e.passenger_flight_legs.select_related('origin_airport', 'destination_airport').all()
        return Response(PassengerFlightLegSerializer(legs, many=True).data, status=201)

    # ── Acomodações (quartos) ────────────────────────────────────────────────

    @action(detail=True, methods=['get', 'post'], url_path='rooms',
            permission_classes=[IsAuthenticated])
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

    @action(detail=True, methods=['patch', 'delete'], url_path=r'rooms/(?P<room_id>\d+)',
            permission_classes=[IsAuthenticated])
    def manage_room(self, request, pk=None, room_id=None):
        """PATCH: renomeia acomodação (e sincroniza inscrições). DELETE: remove acomodação vazia."""
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

    # ── Trechos de acesso (feeder legs) ─────────────────────────────────────

    @action(detail=True, methods=['get', 'post'], url_path='feeder-legs',
            permission_classes=[IsAuthenticated])
    def feeder_legs(self, request, pk=None):
        """GET: lista trechos de acesso (filtrado por ?airport=id). POST: cria."""
        pl = self.get_object()
        if request.method == 'GET':
            airport_id = request.query_params.get('airport')
            qs = FeederLeg.objects.filter(passenger_list=pl).select_related(
                'origin_airport', 'destination_airport', 'departure_airport')
            if airport_id:
                qs = qs.filter(departure_airport_id=airport_id)
            return Response(FeederLegSerializer(qs, many=True).data)

        airport_id = request.data.get('departure_airport')
        if not airport_id:
            return Response({'error': 'departure_airport é obrigatório.'}, status=400)
        leg = FeederLeg(
            passenger_list=pl,
            departure_airport_id=airport_id,
            order=int(request.data.get('order', 0)),
            flight_number=request.data.get('flight_number', ''),
            airline=request.data.get('airline', ''),
            departure_date=request.data.get('departure_date') or None,
            departure_time=request.data.get('departure_time') or None,
            arrival_date=request.data.get('arrival_date') or None,
            arrival_time=request.data.get('arrival_time') or None,
            blocked_seats=request.data.get('blocked_seats') or None,
            origin_airport_id=request.data.get('origin_airport') or None,
            destination_airport_id=request.data.get('destination_airport') or None,
        )
        leg.save()
        leg.refresh_from_db()
        leg = FeederLeg.objects.select_related(
            'origin_airport', 'destination_airport', 'departure_airport').get(pk=leg.pk)
        return Response(FeederLegSerializer(leg).data, status=201)

    @action(detail=True, methods=['patch', 'delete'], url_path=r'feeder-legs/(?P<leg_id>\d+)',
            permission_classes=[IsAuthenticated])
    def manage_feeder_leg(self, request, pk=None, leg_id=None):
        pl = self.get_object()
        try:
            leg = FeederLeg.objects.select_related(
                'origin_airport', 'destination_airport', 'departure_airport').get(passenger_list=pl, id=leg_id)
        except FeederLeg.DoesNotExist:
            return Response({'error': 'Trecho não encontrado.'}, status=404)
        if request.method == 'DELETE':
            leg.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        for field in ('order', 'flight_number', 'airline'):
            if field in request.data:
                setattr(leg, field, request.data[field])
        for field in ('departure_date', 'departure_time', 'arrival_date', 'arrival_time'):
            if field in request.data:
                setattr(leg, field, request.data[field] or None)
        if 'blocked_seats' in request.data:
            leg.blocked_seats = request.data['blocked_seats'] or None
        for fk in ('origin_airport', 'destination_airport'):
            if fk in request.data:
                setattr(leg, f'{fk}_id', request.data[fk] or None)
        leg.save()
        leg.refresh_from_db()
        return Response(FeederLegSerializer(leg).data)

    # ── Trechos de voo ──────────────────────────────────────────────────────

    @action(detail=True, methods=['get', 'post'], url_path='flights',
            permission_classes=[IsAuthenticated])
    def flights(self, request, pk=None):
        """GET: lista trechos. POST: cria trecho."""
        pl = self.get_object()
        if request.method == 'GET':
            legs = pl.flight_legs.select_related('origin_airport', 'destination_airport').all()
            return Response(FlightLegSerializer(legs, many=True).data)
        data = request.data.copy()
        data['passenger_list'] = pl.id
        for fk in ('origin_airport', 'destination_airport'):
            if fk in data and not data[fk]:
                data[fk] = None
        leg = FlightLeg(
            passenger_list=pl,
            direction=data.get('direction', 'ida'),
            order=int(data.get('order', 0)),
            flight_number=data.get('flight_number', ''),
            airline=data.get('airline', ''),
            departure_date=data.get('departure_date') or None,
            departure_time=data.get('departure_time') or None,
            arrival_date=data.get('arrival_date') or None,
            arrival_time=data.get('arrival_time') or None,
            blocked_seats=data.get('blocked_seats') or None,
            origin_airport_id=data.get('origin_airport') or None,
            destination_airport_id=data.get('destination_airport') or None,
        )
        leg.save()
        return Response(FlightLegSerializer(leg).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch', 'delete'], url_path=r'flights/(?P<leg_id>\d+)',
            permission_classes=[IsAuthenticated])
    def manage_flight(self, request, pk=None, leg_id=None):
        """PATCH: atualiza trecho. DELETE: remove trecho."""
        pl = self.get_object()
        try:
            leg = FlightLeg.objects.select_related('origin_airport', 'destination_airport').get(passenger_list=pl, id=leg_id)
        except FlightLeg.DoesNotExist:
            return Response({'error': 'Trecho não encontrado.'}, status=404)
        if request.method == 'DELETE':
            leg.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        for field in ('direction', 'order', 'flight_number', 'airline'):
            if field in request.data:
                setattr(leg, field, request.data[field])
        for field in ('departure_date', 'departure_time', 'arrival_date', 'arrival_time'):
            if field in request.data:
                setattr(leg, field, request.data[field] or None)
        if 'blocked_seats' in request.data:
            leg.blocked_seats = request.data['blocked_seats'] or None
        for fk in ('origin_airport', 'destination_airport'):
            if fk in request.data:
                setattr(leg, f'{fk}_id', request.data[fk] or None)
        leg.save()
        leg.refresh_from_db()
        return Response(FlightLegSerializer(leg).data)

