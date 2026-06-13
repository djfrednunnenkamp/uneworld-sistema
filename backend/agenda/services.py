"""Coleta de eventos do calendário e envio dos e-mails de resumo/lembrete."""
from datetime import date, timedelta

from django.db.models import Q

from passengers.models import Passenger
from trips.models import ListEnrollment, PassengerList
from users_api.permissions import has_any_perm

from . import email_service


def collect_events(start: date, end: date, user=None):
    """Retorna a lista de eventos (viagens, prazos e aniversários) entre start e end (inclusive).

    Se `user` for informado, aplica as permissões de calendário: usuários sem
    'calendar_view_birthdays' não veem aniversários, e usuários sem
    'calendar_view_all_deadlines' (e que não são superusuário) só veem os
    prazos de confirmação que eles mesmos definiram.
    """
    events = []

    # ── Viagens (período de cada Lista de Passageiros) ──
    lists = PassengerList.objects.filter(
        start_date__isnull=False, end_date__isnull=False,
        start_date__lte=end, end_date__gte=start,
    )
    for pl in lists:
        events.append({
            'id':    f'trip-{pl.id}',
            'type':  'trip',
            'title': pl.name,
            'start': pl.start_date.isoformat(),
            'end':   pl.end_date.isoformat(),
            'status': pl.status,
            'url':   f'/viagens/{pl.id}',
        })

    # ── Prazos de confirmação (ListEnrollment.pending_until) ──
    enrollments = (
        ListEnrollment.objects
        .exclude(enrollment_status='confirmado')
        .filter(pending_until__isnull=False, pending_until__gte=start, pending_until__lte=end)
        .select_related('passenger', 'passenger_list', 'pending_until_created_by')
    )
    if user is not None and not has_any_perm(user, 'calendar_view_all_deadlines'):
        enrollments = enrollments.filter(pending_until_created_by=user)
    for en in enrollments:
        who = en.passenger.full_name if en.passenger else (en.block_agency or 'Bloqueio')
        creator = en.pending_until_created_by
        creator_name = (creator.get_full_name() or creator.username) if creator else 'desconhecido'
        events.append({
            'id':       f'deadline-{en.id}',
            'type':     'deadline',
            'title':    f'Prazo: {who}',
            'subtitle': f'{en.passenger_list.name} · Definido por {creator_name}',
            'start':    en.pending_until.isoformat(),
            'end':      en.pending_until.isoformat(),
            'url':      f'/viagens/{en.passenger_list_id}',
            'created_by_id': creator.id if creator else None,
        })

    # ── Aniversários dos passageiros ──
    if user is None or has_any_perm(user, 'calendar_view_birthdays'):
        passengers = Passenger.objects.exclude(birth_date__isnull=True).only('id', 'full_name', 'birth_date')
        days = (end - start).days + 1
        for i in range(days):
            d = start + timedelta(days=i)
            for p in passengers:
                if p.birth_date.month == d.month and p.birth_date.day == d.day:
                    events.append({
                        'id':    f'birthday-{p.id}-{d.year}',
                        'type':  'birthday',
                        'title': f'🎂 {p.full_name}',
                        'start': d.isoformat(),
                        'end':   d.isoformat(),
                        'url':   f'/passageiros/{p.id}',
                    })

    return events


def send_digest_email(user, days_ahead=14):
    """Envia um resumo dos eventos dos próximos `days_ahead` dias para o e-mail do usuário."""
    if not user.email:
        return False
    today = date.today()
    events = collect_events(today, today + timedelta(days=days_ahead), user)
    events.sort(key=lambda e: e['start'])
    return email_service.send_calendar_summary(
        email=user.email,
        first_name=user.first_name,
        events=events,
        subject=f'Resumo do calendário — próximos {days_ahead} dias',
        intro=f'Confira o que está agendado para os próximos {days_ahead} dias.',
    )


def send_reminder_email(user, days_before):
    """Envia um lembrete apenas dos prazos de confirmação que vencem em até `days_before` dias."""
    if not user.email:
        return False
    today = date.today()
    events = collect_events(today, today + timedelta(days=days_before), user)
    deadlines = [e for e in events if e['type'] == 'deadline']
    if not deadlines:
        return False
    deadlines.sort(key=lambda e: e['start'])
    return email_service.send_calendar_summary(
        email=user.email,
        first_name=user.first_name,
        events=deadlines,
        subject=f'Lembrete: prazos de confirmação nos próximos {days_before} dias',
        intro=f'Você tem prazos de confirmação vencendo nos próximos {days_before} dias.',
    )
