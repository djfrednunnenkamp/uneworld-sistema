from rest_framework import viewsets, filters
from .models import Destination, Trip, Enrollment
from .serializers import DestinationSerializer, TripSerializer, TripListSerializer, EnrollmentSerializer


class DestinationViewSet(viewsets.ModelViewSet):
    queryset = Destination.objects.all()
    serializer_class = DestinationSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['name', 'country']


class TripViewSet(viewsets.ModelViewSet):
    queryset = Trip.objects.select_related('destination').all()
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['title', 'destination__name', 'destination__country']
    ordering_fields = ['departure_date', 'created_at', 'price_per_person']

    def get_serializer_class(self):
        if self.action == 'list':
            return TripListSerializer
        return TripSerializer


class EnrollmentViewSet(viewsets.ModelViewSet):
    queryset = Enrollment.objects.select_related('trip', 'passenger').all()
    serializer_class = EnrollmentSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['passenger__full_name', 'trip__title']
