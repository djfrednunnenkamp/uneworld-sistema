from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from .models import Meeting, MeetingParticipant
from .serializers import MeetingSerializer, MeetingListSerializer, MeetingParticipantSerializer


class MeetingViewSet(viewsets.ModelViewSet):
    queryset = Meeting.objects.select_related('trip').prefetch_related('participants__passenger').all()
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['title', 'trip__title', 'location']
    ordering_fields = ['scheduled_at', 'created_at']

    def get_serializer_class(self):
        if self.action == 'list':
            return MeetingListSerializer
        return MeetingSerializer

    @action(detail=False, methods=['get'])
    def upcoming(self, request):
        qs = self.get_queryset().filter(
            scheduled_at__gte=timezone.now(),
            status='scheduled'
        ).order_by('scheduled_at')[:10]
        serializer = MeetingListSerializer(qs, many=True)
        return Response(serializer.data)
