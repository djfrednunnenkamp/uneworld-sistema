"""Loop em background que envia os e-mails de resumo/lembrete agendados pelos usuários."""
import logging
import threading
import time
from datetime import timedelta

logger = logging.getLogger(__name__)

CHECK_INTERVAL = 3600  # 1 hora
EXCHANGE_INTERVAL = 60  # 1 minuto — câmbio precisa de precisão de minutos

_started = False


def start():
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, daemon=True).start()
    threading.Thread(target=_exchange_loop, daemon=True).start()


def _loop():
    from django.db import connections
    while True:
        try:
            run_once()
        except Exception as e:
            logger.exception('[AGENDA SCHEDULER] erro no ciclo: %s', e)
        finally:
            # Threads de background não passam pelo ciclo de request do Django,
            # então a conexão fica aberta entre as iterações. Com SQLite isso
            # pode segurar um lock e causar "database is locked" nas requisições.
            connections.close_all()
        time.sleep(CHECK_INTERVAL)


def _exchange_loop():
    """Verifica de minuto em minuto os câmbios com atualização automática, para
    honrar o horário (HH:MM) configurado em cada um.

    Este é o ÚNICO caminho não-superusuário em que scripts customizados de câmbio
    executam (include_scripts=True, padrão). É intencional e seguro: o campo
    `script` só pode ser escrito por superusuário (ExchangeRateSerializer) e roda
    no sandbox (RestrictedPython + subprocesso isolado + anti-SSRF). Ou seja, o
    agendador só executa código previamente aprovado por um superusuário — nunca
    conteúdo injetado por um usuário comum. O disparo MANUAL de scripts continua
    restrito a superusuário (run_now/update_one em config_api/views.py)."""
    from django.db import connections
    while True:
        try:
            from config_api.exchange_service import update_due
            update_due()
        except Exception as e:
            logger.exception('[CÂMBIO SCHEDULER] erro no ciclo: %s', e)
        finally:
            connections.close_all()
        time.sleep(EXCHANGE_INTERVAL)


def run_once():
    from django.db.models import Q
    from django.utils import timezone
    from .models import CalendarPreference
    from .services import send_digest_email, send_reminder_email

    # Usa o fuso configurado (TIME_ZONE/USE_TZ). date.today()/datetime.now() usariam o
    # horário local do processo (normalmente UTC em container), disparando o e-mail na
    # hora errada e podendo virar o dia no momento errado perto da meia-noite.
    now          = timezone.localtime()
    today        = now.date()
    current_hour = now.hour

    prefs = CalendarPreference.objects.select_related('user').filter(
        Q(digest_enabled=True) | Q(reminder_enabled=True)
    )

    for pref in prefs:
        if pref.digest_enabled and pref.last_digest_sent != today and current_hour >= pref.digest_send_hour:
            is_due = pref.digest_frequency == 'daily' or today.weekday() == 0
            if is_due and send_digest_email(pref.user):
                pref.last_digest_sent = today
                pref.save(update_fields=['last_digest_sent'])

        if pref.reminder_enabled and pref.last_reminder_sent != today and current_hour >= pref.digest_send_hour:
            if send_reminder_email(pref.user, pref.reminder_days_before):
                pref.last_reminder_sent = today
                pref.save(update_fields=['last_reminder_sent'])

    _send_daily_notifications(today, current_hour)


# ── Coletores de dados ────────────────────────────────────────────────────────

def _collect_deadline_entries(today, days_ahead):
    """Retorna (entries_list, set_of_list_level_emails)."""
    from trips.models import ListEnrollment

    target_date = today + timedelta(days=days_ahead)
    enrollments = (
        ListEnrollment.objects
        .filter(pending_until=target_date, passenger_list__is_deleted=False)
        .exclude(enrollment_status='confirmado')
        .exclude(passenger__is_deleted=True)  # ignora passageiros na lixeira (mantém bloqueios, sem passageiro)
        .select_related('passenger', 'passenger_list', 'pending_until_created_by')
    )
    entries    = []
    list_emails = set()
    for en in enrollments:
        creator = en.pending_until_created_by
        entries.append({
            'passenger_name': en.passenger.full_name if en.passenger else (en.block_agency or 'Bloqueio'),
            'list_name':      en.passenger_list.name,
            'pending_reason': en.pending_reason or '',
            'created_by':     (creator.get_full_name() or creator.username) if creator else '—',
        })
        for email in (en.passenger_list.notification_emails or []):
            if email and '@' in email:
                list_emails.add(email)
    return entries, list_emails


def _collect_task_entries(today):
    from trips.models import ListTask

    tasks = (
        ListTask.objects
        .filter(due_date=today, done=False, passenger_list__is_deleted=False)
        .select_related('passenger_list', 'created_by')
    )
    return [
        {
            'title':      t.title,
            'list_name':  t.passenger_list.name,
            'created_by': (t.created_by.get_full_name() or t.created_by.username) if t.created_by else '—',
        }
        for t in tasks
    ]


def _collect_birthday_entries(today):
    from passengers.models import Passenger

    passengers = Passenger.objects.filter(
        birth_date__month=today.month,
        birth_date__day=today.day,
        is_deleted=False,
    ).exclude(birth_date__isnull=True)
    return [
        {
            'name':       p.full_name,
            'birth_date': p.birth_date.strftime('%d/%m/%Y'),
            'age':        today.year - p.birth_date.year,
        }
        for p in passengers
    ]


# ── Envio consolidado ─────────────────────────────────────────────────────────

def _send_daily_notifications(today, current_hour):
    """Envia UM único e-mail por destinatário consolidando prazos, pendências e aniversários.
    Respeita o horário configurado e não reenvia se já enviou hoje."""
    from django.db.models import Q
    from users_api.models import UserPermissions
    from .models import CalendarPreference
    from .email_service import send_daily_digest

    deadline_today, list_emails_today = _collect_deadline_entries(today, days_ahead=0)
    deadline_2d,    list_emails_2d    = _collect_deadline_entries(today, days_ahead=2)
    tasks     = _collect_task_entries(today)
    birthdays = _collect_birthday_entries(today)

    if not deadline_today and not deadline_2d and not tasks and not birthdays:
        return

    eligible_birthday_ids = set(
        UserPermissions.objects.filter(passengers_view_full=True).values_list('user_id', flat=True)
    )

    # Apenas usuários cujo horário configurado já chegou E ainda não receberam hoje
    prefs = CalendarPreference.objects.filter(
        Q(receive_deadline_emails=True) | Q(receive_task_emails=True) | Q(receive_birthday_emails=True)
    ).filter(
        send_hour__lte=current_hour
    ).exclude(
        last_daily_sent=today
    ).select_related('user')

    user_emails = set()
    for pref in prefs:
        user = pref.user
        if not user.email or '@' not in user.email:
            continue
        user_emails.add(user.email)

        d_today = deadline_today if pref.receive_deadline_emails else []
        d_2d    = deadline_2d    if pref.receive_deadline_emails else []
        t       = tasks          if pref.receive_task_emails     else []
        b = []
        if pref.receive_birthday_emails and (user.is_superuser or user.id in eligible_birthday_ids):
            b = birthdays

        if d_today or d_2d or t or b:
            if send_daily_digest(user.email, today, d_today, d_2d, t, b):
                pref.last_daily_sent = today
                pref.save(update_fields=['last_daily_sent'])

    # E-mails de lista (externos, sem controle de horário por usuário)
    extra_emails = (list_emails_today | list_emails_2d) - user_emails
    if extra_emails and (deadline_today or deadline_2d):
        for email in extra_emails:
            send_daily_digest(email, today, deadline_today, deadline_2d, [], [])
