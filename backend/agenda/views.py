import logging
from datetime import datetime

from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from users_api.permissions import RequirePermission

from .models import CalendarPreference
from .serializers import CalendarPreferenceSerializer
from .services import collect_events, send_digest_email

logger = logging.getLogger(__name__)


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
    permission_classes = [RequirePermission('manage_users', 'users_edit')]

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


# ── Webhook da Resend (entrega/abertura de e-mail) ─────────────────────────────
#
# Configurar em https://resend.com/webhooks: URL "<seu domínio>/api/agenda/resend-webhook/",
# eventos email.sent/delivered/bounced/delivery_delayed/opened. Copiar o "Signing Secret"
# gerado lá para RESEND_WEBHOOK_SECRET no .env.

from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from rest_framework.decorators import throttle_classes
from rest_framework.permissions import AllowAny

from core.throttling import WebhookRateThrottle


def _verify_resend_signature(request) -> bool:
    """Verifica a assinatura Svix usada pela Resend.

    FAIL-CLOSED em produção (A-07): sem secret configurado (ou sem a lib svix), a
    requisição é REJEITADA quando DEBUG=False — nunca aceitar webhook sem verificar
    a assinatura em produção. Em DEBUG=True aceita sem verificar, só para facilitar
    o desenvolvimento local (nenhum segredo configurado)."""
    secret = settings.RESEND_WEBHOOK_SECRET
    if not secret:
        return bool(settings.DEBUG)  # prod sem segredo → rejeita; dev → permite
    try:
        from svix.webhooks import Webhook, WebhookVerificationError
    except ImportError:
        return bool(settings.DEBUG)  # sem a lib não dá pra verificar → só permite em dev
    headers = {
        'svix-id':        request.headers.get('svix-id', ''),
        'svix-timestamp': request.headers.get('svix-timestamp', ''),
        'svix-signature': request.headers.get('svix-signature', ''),
    }
    try:
        Webhook(secret).verify(request.body, headers)
        return True
    except WebhookVerificationError:
        # Assinatura inválida: pode ser configuração errada do secret ou tentativa de
        # forjar eventos de entrega. Registra para observabilidade (sem alterar a resposta).
        logger.warning('Webhook Resend rejeitado: assinatura inválida (svix-id=%s).',
                       request.headers.get('svix-id', ''))
        return False


@csrf_exempt
@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([WebhookRateThrottle])
def resend_webhook_view(request):
    """Recebe eventos de entrega/abertura da Resend e atualiza o EmailLog correspondente."""
    if not _verify_resend_signature(request):
        return Response(status=401)

    event_type = request.data.get('type', '')
    data       = request.data.get('data', {}) or {}
    resend_id  = data.get('email_id')
    if not resend_id:
        return Response(status=200)  # evento sem id rastreável — ignora silenciosamente

    try:
        log = EmailLog.objects.get(resend_id=resend_id)
    except EmailLog.DoesNotExist:
        return Response(status=200)

    if event_type == 'email.delivered':
        log.status = 'delivered'
        log.delivered_at = timezone.now()
        log.save(update_fields=['status', 'delivered_at'])
    elif event_type == 'email.bounced':
        # Atraso (email.delivery_delayed) NÃO é bounce — o Resend ainda tenta reentregar.
        # Marcar como "Não entregue" rotularia errado e-mails que podem chegar normalmente.
        log.status = 'bounced'
        log.save(update_fields=['status'])
    elif event_type == 'email.complained':
        log.status = 'bounced'
        log.save(update_fields=['status'])
    elif event_type == 'email.opened' and not log.opened_at:
        log.opened_at = timezone.now()
        log.save(update_fields=['opened_at'])

    return Response(status=200)
