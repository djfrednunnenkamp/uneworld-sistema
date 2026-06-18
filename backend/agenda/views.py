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

def _can_email_resend(user):
    return user.is_superuser or getattr(getattr(user, 'permissions', None), 'email_resend_actions', False)


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
        'can_resend':  _can_email_resend(request.user),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def email_resend_action(request, pk):
    """Reenvia redefinição de senha ou convite para o destinatário do e-mail original."""
    if not _can_email_log(request.user):
        return Response(status=403)
    if not _can_email_resend(request.user):
        return Response(status=403)
    try:
        log = EmailLog.objects.get(pk=pk)
    except EmailLog.DoesNotExist:
        return Response(status=404)

    if log.email_type not in ('reset_password', 'invite'):
        return Response({'detail': 'Reenvio disponível apenas para e-mails de redefinição de senha ou convite.'}, status=400)

    from django.contrib.auth import get_user_model
    from users_api.models import PasswordResetToken, InviteToken
    from users_api.email_service import send_reset_password, send_invite

    User = get_user_model()
    try:
        user = User.objects.get(email__iexact=log.to.strip())
    except User.DoesNotExist:
        return Response({'detail': f'Nenhum usuário encontrado com o e-mail "{log.to}".'}, status=404)
    except User.MultipleObjectsReturned:
        user = User.objects.filter(email__iexact=log.to.strip()).first()

    if log.email_type == 'reset_password':
        token = PasswordResetToken.objects.create(user=user)
        url = f"{settings.FRONTEND_URL}/redefinir-senha?token={token.token}"
        send_reset_password(user.email, user.first_name, url)
        return Response({'message': f'E-mail de redefinição de senha reenviado para {user.email}.'})

    # invite
    invite = InviteToken.objects.create(
        email=user.email, first_name=user.first_name, last_name=user.last_name,
        is_staff=user.is_staff, created_by=request.user,
    )
    url = f"{settings.FRONTEND_URL}/aceitar-convite?token={invite.token}"
    invited_by = request.user.get_full_name() or request.user.username
    send_invite(user.email, user.first_name, url, invited_by)
    return Response({'message': f'Convite reenviado para {user.email}.'})
