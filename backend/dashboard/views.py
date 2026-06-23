from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db import models
from datetime import date
from passengers.models import Passenger
from trips.models import PassengerList, ListEnrollment


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_stats(request):
    today = date.today()

    # Exclui viagens já encerradas (end_date preenchida e no passado)
    qs = PassengerList.objects.filter(
        models.Q(end_date__isnull=True) | models.Q(end_date__gte=today), is_deleted=False,
    ).order_by('-created_at')[:20]

    def _ongoing(l):
        return bool(l.start_date and l.end_date and l.start_date <= today <= l.end_date)

    # Em andamento aparecem primeiro, depois as demais
    recent = sorted(qs, key=lambda l: (0 if _ongoing(l) else 1))[:10]

    return Response({
        'stats': {
            'total_passengers': Passenger.objects.filter(status='active', is_deleted=False).count(),
            'open_lists': PassengerList.objects.filter(status='aberta', is_deleted=False).count(),
            'total_enrollments': ListEnrollment.objects.exclude(enrollment_status='cancelado').count(),
        },
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
                'is_ongoing': _ongoing(l),
            }
            for l in recent
        ],
    })
