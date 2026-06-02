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

    @action(detail=True, methods=['get'], url_path='passageiros',
            permission_classes=[IsAuthenticated])
    def list_passengers(self, request, pk=None):
        pl      = self.get_object()
        entries = pl.list_enrollments.select_related('passenger').all()
        return Response(ListEnrollmentSerializer(entries, many=True).data)

    @action(detail=True, methods=['post'], url_path='passageiros',
            permission_classes=[IsAuthenticated])
    def add_passenger(self, request, pk=None):
        pl           = self.get_object()
        passenger_id = request.data.get('passenger')
        notes        = request.data.get('notes', '')
        if not passenger_id:
            return Response({'error': 'passenger é obrigatório.'}, status=400)
        from passengers.models import Passenger as PassengerModel
        try:
            p = PassengerModel.objects.get(pk=passenger_id)
        except PassengerModel.DoesNotExist:
            return Response({'error': 'Passageiro não encontrado.'}, status=404)
        if pl.list_enrollments.filter(passenger=p).exists():
            return Response({'error': 'Passageiro já está nesta lista.'}, status=400)
        e = ListEnrollment.objects.create(passenger_list=pl, passenger=p, notes=notes)
        return Response(ListEnrollmentSerializer(e).data, status=201)

    @action(detail=True, methods=['delete'], url_path=r'passageiros/(?P<enrollment_id>\d+)',
            permission_classes=[IsAuthenticated])
    def remove_passenger(self, request, pk=None, enrollment_id=None):
        pl = self.get_object()
        try:
            pl.list_enrollments.get(id=enrollment_id).delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except ListEnrollment.DoesNotExist:
            return Response({'error': 'Inscrição não encontrada.'}, status=404)
