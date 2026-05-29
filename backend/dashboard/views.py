from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone
from passengers.models import Passenger
from trips.models import Trip, Enrollment
from meetings.models import Meeting


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_stats(request):
    now = timezone.now()

    upcoming_meetings = Meeting.objects.filter(
        scheduled_at__gte=now,
        status='scheduled'
    ).order_by('scheduled_at')[:5]

    active_trips = Trip.objects.exclude(status__in=['completed', 'cancelled']).order_by('departure_date')[:5]

    return Response({
        'stats': {
            'total_passengers': Passenger.objects.filter(status='active').count(),
            'total_trips': Trip.objects.count(),
            'active_trips': Trip.objects.exclude(status__in=['completed', 'cancelled']).count(),
            'upcoming_meetings': Meeting.objects.filter(scheduled_at__gte=now, status='scheduled').count(),
            'total_enrollments': Enrollment.objects.filter(status='confirmed').count(),
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
        'active_trips': [
            {
                'id': t.id,
                'title': t.title,
                'destination': str(t.destination),
                'departure_date': t.departure_date,
                'return_date': t.return_date,
                'status': t.get_status_display(),
                'enrolled_count': t.enrolled_count,
                'available_spots': t.available_spots,
            }
            for t in active_trips
        ],
    })
