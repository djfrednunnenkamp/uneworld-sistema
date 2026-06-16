from datetime import datetime

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from users_api.permissions import RequirePermission

from .models import CalendarPreference
from .serializers import CalendarPreferenceSerializer
from .services import collect_events, send_digest_email


@api_view(['GET'])
@permission_classes([RequirePermission('calendar_view')])
def calendar_events(request):
    start_str = request.query_params.get('start')
    end_str   = request.query_params.get('end')
    if not start_str or not end_str:
        return Response({'detail': 'Parâmetros "start" e "end" são obrigatórios (YYYY-MM-DD).'}, status=400)
    try:
        start = datetime.strptime(start_str, '%Y-%m-%d').date()
        end   = datetime.strptime(end_str, '%Y-%m-%d').date()
    except ValueError:
        return Response({'detail': 'Datas inválidas. Use o formato YYYY-MM-DD.'}, status=400)

    list_id_str = request.query_params.get('list_id')
    list_id = int(list_id_str) if list_id_str and list_id_str.isdigit() else None
    return Response({'events': collect_events(start, end, request.user, list_id=list_id)})


class CalendarPreferenceView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        pref, _ = CalendarPreference.objects.get_or_create(user=request.user)
        return Response(CalendarPreferenceSerializer(pref).data)

    def patch(self, request):
        pref, _ = CalendarPreference.objects.get_or_create(user=request.user)
        serializer = CalendarPreferenceSerializer(pref, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def send_now(request):
    ok = send_digest_email(request.user)
    if not ok:
        return Response({'detail': 'Não foi possível enviar o e-mail.'}, status=400)
    return Response({'ok': True})
