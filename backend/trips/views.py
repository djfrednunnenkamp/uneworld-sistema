from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .models import Destination, Trip, Enrollment, Supplier, ListAdditional, Roteiro, PassengerList, ListEnrollment
from .serializers import (
    DestinationSerializer, TripSerializer, TripListSerializer, EnrollmentSerializer,
    SupplierSerializer, ListAdditionalSerializer, RoteiroSerializer, PassengerListSerializer, ListEnrollmentSerializer,
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
                'passenger', 'agency', 'responsible_user'
            ).all()
            return Response(ListEnrollmentSerializer(entries, many=True).data)

        return self._add_passenger(request, pl)

    def _add_passenger(self, request, pl):
        is_block          = request.data.get('is_block', False)
        accommodation     = request.data.get('accommodation', '')
        estatus           = request.data.get('enrollment_status', 'pendente')
        notes             = request.data.get('notes', '')
        agency_id         = request.data.get('agency')
        responsible_uid   = request.data.get('responsible_user')

        if is_block:
            # Bloqueio de agência — cria N vagas sem passageiro
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
                    is_block=True, block_agency=agency_name,
                    agency=agency_obj, responsible_user=resp_user,
                    accommodation=accommodation, enrollment_status=estatus, notes=notes,
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
                      'pending_until', 'pending_reason'):
            if field in request.data:
                val = request.data[field]
                setattr(e, field, (val or None) if field == 'pending_until' else val)
        # Atribuir passageiro a um bloco
        if 'passenger' in request.data and request.data['passenger']:
            from passengers.models import Passenger as PassengerModel
            p = PassengerModel.objects.filter(pk=request.data['passenger']).first()
            if p:
                e.passenger = p
                e.is_block  = False
        e.save()
        return Response(ListEnrollmentSerializer(e).data)

