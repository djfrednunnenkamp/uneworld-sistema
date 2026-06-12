from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone
from passengers.models import Passenger
from trips.models import PassengerList, ListEnrollment
from meetings.models import Meeting


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_stats(request):
    now = timezone.now()

    upcoming_meetings = Meeting.objects.filter(
        scheduled_at__gte=now,
        status='scheduled'
    ).order_by('scheduled_at')[:5]

    recent_lists = PassengerList.objects.order_by('-created_at')[:5]

    return Response({
        'stats': {
            'total_passengers': Passenger.objects.filter(status='active').count(),
            'open_lists': PassengerList.objects.filter(status='aberta').count(),
            'upcoming_meetings': Meeting.objects.filter(scheduled_at__gte=now, status='scheduled').count(),
            'total_enrollments': ListEnrollment.objects.exclude(enrollment_status='cancelado').count(),
        },
        'upcoming_meetings': [
            {
                'id': m.id,
                'title': m.title,
                'scheduled_at': m.scheduled_at,
                'location': m.location,
                'meeting_type': m.get_meeting_type_display(),
                'participant_count': m.participants.count(),
            }
            for m in upcoming_meetings
        ],
        'recent_lists': [
            {
                'id': l.id,
                'name': l.name,
                'list_type': l.list_type,
                'category': l.category,
                'start_date': l.start_date,
                'end_date': l.end_date,
                'status': l.status,
                'enrolled_count': l.enrolled_count,
                'block_capacity': l.block_capacity,
            }
            for l in recent_lists
        ],
    })
