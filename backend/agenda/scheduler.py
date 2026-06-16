"""Loop em background que envia os e-mails de resumo/lembrete agendados pelos usuários."""
import threading
import time
from datetime import date

CHECK_INTERVAL = 3600  # 1 hora

_started = False


def start():
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, daemon=True).start()


def _loop():
    while True:
        try:
            run_once()
        except Exception as e:
            print(f'[AGENDA SCHEDULER] erro: {e}')
        time.sleep(CHECK_INTERVAL)


def run_once():
    from django.db.models import Q

    from .models import CalendarPreference
    from .services import send_digest_email, send_reminder_email

    today = date.today()
    prefs = CalendarPreference.objects.select_related('user').filter(
        Q(digest_enabled=True) | Q(reminder_enabled=True)
    )

    for pref in prefs:
        if pref.digest_enabled and pref.last_digest_sent != today:
            is_due = pref.digest_frequency == 'daily' or today.weekday() == 0  # semanal -> segunda-feira
            if is_due and send_digest_email(pref.user):
                pref.last_digest_sent = today
                pref.save(update_fields=['last_digest_sent'])

        if pref.reminder_enabled and pref.last_reminder_sent != today:
            if send_reminder_email(pref.user, pref.reminder_days_before):
                pref.last_reminder_sent = today
                pref.save(update_fields=['last_reminder_sent'])

    _send_list_deadline_reminders(today)


def _send_list_deadline_reminders(today):
    """Envia e-mails de lembrete de prazo para os e-mails configurados nas listas."""
    from trips.models import ListEnrollment
    from config_api.models import SystemSettings
    from .email_service import send_deadline_reminder

    global_emails = list(SystemSettings.get().deadline_notification_emails or [])

    enrollments = (
        ListEnrollment.objects
        .filter(pending_until=today)
        .exclude(enrollment_status='confirmado')
        .select_related('passenger', 'passenger_list', 'pending_until_created_by')
    )
    if not enrollments:
        return

    # Agrupa por lista para montar o e-mail
    by_list = {}
    for en in enrollments:
        by_list.setdefault(en.passenger_list_id, {'list': en.passenger_list, 'entries': []})
        creator = en.pending_until_created_by
        by_list[en.passenger_list_id]['entries'].append({
            'passenger_name': en.passenger.full_name if en.passenger else (en.block_agency or 'Bloqueio'),
            'list_name':      en.passenger_list.name,
            'pending_reason': en.pending_reason or '',
            'created_by':     (creator.get_full_name() or creator.username) if creator else '—',
        })

    # Um único e-mail por destinatário com todos os prazos do dia
    all_entries = []
    recipient_emails = set(global_emails)
    for data in by_list.values():
        all_entries.extend(data['entries'])
        list_emails = data['list'].notification_emails or []
        recipient_emails.update(list_emails)

    recipient_emails = [e for e in recipient_emails if e and '@' in e]
    if recipient_emails and all_entries:
        send_deadline_reminder(recipient_emails, today, all_entries)
