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


class UserCalendarPreferenceView(APIView):
    """Admin: lê/atualiza CalendarPreference de qualquer usuário."""
    permission_classes = [IsAuthenticated]

    def _get_pref(self, user_id):
        from django.contrib.auth import get_user_model
        from django.shortcuts import get_object_or_404
        user = get_object_or_404(get_user_model(), pk=user_id)
        pref, _ = CalendarPreference.objects.get_or_create(user=user)
        return pref

    def get(self, request, user_id):
        return Response(CalendarPreferenceSerializer(self._get_pref(user_id)).data)

    def patch(self, request, user_id):
        pref = self._get_pref(user_id)
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


# ── Log de e-mails ─────────────────────────────────────────────────────────────

from django.conf import settings
from rest_framework.views import APIView
from .models import EmailLog
from .serializers import EmailLogListSerializer, EmailLogDetailSerializer


def _can_email_log(user):
    return user.is_superuser or getattr(getattr(user, 'permissions', None), 'email_log_view', False)

def _can_email_preview(user):
    return user.is_superuser or getattr(getattr(user, 'permissions', None), 'email_log_preview', False)


class EmailLogListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _can_email_log(request.user):
            return Response(status=403)
        qs = EmailLog.objects.order_by('-sent_at')[:50]
        return Response(EmailLogListSerializer(qs, many=True).data)


class EmailLogDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not _can_email_log(request.user):
            return Response(status=403)
        if not settings.EMAIL_PREVIEW_ENABLED:
            return Response({'detail': 'Preview desativado.'}, status=403)
        if not _can_email_preview(request.user):
            return Response(status=403)
        try:
            log = EmailLog.objects.get(pk=pk)
        except EmailLog.DoesNotExist:
            return Response(status=404)
        from .email_service import _html_for_preview
        data = EmailLogDetailSerializer(log).data
        data['html_body'] = _html_for_preview(data.get('html_body') or '')
        return Response(data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def email_preview_enabled(request):
    """Informa ao frontend se o preview está ativo e qual permissão o usuário tem."""
    return Response({
        'preview_enabled': settings.EMAIL_PREVIEW_ENABLED,
        'can_view':    _can_email_log(request.user),
        'can_preview': _can_email_preview(request.user) and settings.EMAIL_PREVIEW_ENABLED,
    })
