from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Passenger
from .serializers import PassengerSerializer, PassengerListSerializer


class PassengerViewSet(viewsets.ModelViewSet):
    queryset = Passenger.objects.all()
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['full_name', 'email', 'phone', 'document_number', 'city']
    ordering_fields = ['full_name', 'created_at', 'city']

    def get_serializer_class(self):
        if self.action == 'list':
            return PassengerListSerializer
        return PassengerSerializer

    @action(detail=False, methods=['get'])
    def active(self, request):
        qs = self.get_queryset().filter(status='active')
        serializer = PassengerListSerializer(qs, many=True)
        return Response(serializer.data)
