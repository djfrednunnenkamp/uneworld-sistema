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
