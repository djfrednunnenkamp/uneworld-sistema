from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db import models
from datetime import date
from passengers.models import Passenger
from trips.models import PassengerList, ListEnrollment
from config_api.models import ConfigExchangeRate
from users_api.permissions import has_any_perm, agency_scope_ids


def _days_until_birthday(bd, today):
    """Dias até o próximo aniversário (0 = hoje). 29/02 cai em 28/02 fora de bissexto."""
    def _this_year(year):
        try:
            return bd.replace(year=year)
        except ValueError:      # 29/02 em ano não-bissexto
            return bd.replace(year=year, day=28)
    nxt = _this_year(today.year)
    if nxt < today:
        nxt = _this_year(today.year + 1)
    return (nxt - today).days, nxt


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_birthdays(request):
    """Próximos aniversários de passageiros (hoje primeiro, depois amanhã…).
    Janela padrão de 30 dias. Respeita o escopo de agência."""
    user = request.user
    if not has_any_perm(user, 'dashboard_view_birthdays'):
        return Response({'birthdays': []})
    today = date.today()
    window = 30
    scope = agency_scope_ids(user)

    pq = Passenger.objects.filter(status='active', is_deleted=False, birth_date__isnull=False)
    if scope is not None:
        pq = pq.filter(agencies__in=scope).distinct()
    pq = pq.only('id', 'full_name', 'first_name', 'last_name', 'birth_date')

    rows = []
    for p in pq:
        bd = p.birth_date
        days, nxt = _days_until_birthday(bd, today)
        if days > window:
            continue
        name = (p.full_name or f'{p.first_name} {p.last_name}').strip()
        rows.append({
            'id': p.id,
            'name': name or 'Sem nome',
            'birth_date': bd,
            'day': bd.day,
            'month': bd.month,
            'days_until': days,
            'turning_age': nxt.year - bd.year,
        })
    rows.sort(key=lambda r: (r['days_until'], r['name']))
    return Response({'birthdays': rows})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_stats(request):
    today = date.today()
    user  = request.user
    # Usuário de agência só vê números da(s) agência(s) dele (ver
    # project_agency_users_scope). scope=None → interno, vê tudo.
    scope = agency_scope_ids(user)

    def _ongoing(l):
        return bool(l.start_date and l.end_date and l.start_date <= today <= l.end_date)

    # Cada bloco respeita a permissão específica do próprio card no frontend.
    # Sem isso, qualquer autenticado conseguia ler as estatísticas chamando a API direto.
    stats = {}
    if has_any_perm(user, 'dashboard_view_passengers'):
        pq = Passenger.objects.filter(status='active', is_deleted=False)
        if scope is not None:
            pq = pq.filter(agencies__in=scope).distinct()
        stats['total_passengers'] = pq.count()
    if has_any_perm(user, 'dashboard_view_lists'):
        lq = PassengerList.objects.filter(status='aberta', is_deleted=False)
        if scope is not None:
            lq = lq.filter(list_enrollments__agency_id__in=scope).distinct()
        stats['open_lists'] = lq.count()
    if has_any_perm(user, 'dashboard_view_enrollments'):
        # Conta só inscrições de listas/passageiros vivos (soft-delete não deve inflar o total).
        eq = (
            ListEnrollment.objects
            .exclude(enrollment_status='cancelado')
            .filter(passenger_list__is_deleted=False)
            .exclude(passenger__is_deleted=True)
        )
        if scope is not None:
            eq = eq.filter(agency_id__in=scope)
        stats['total_enrollments'] = eq.count()

    recent_lists = []
    if has_any_perm(user, 'dashboard_view_lists'):
        # Exclui viagens já encerradas (end_date preenchida e no passado)
        qs = PassengerList.objects.filter(
            models.Q(end_date__isnull=True) | models.Q(end_date__gte=today), is_deleted=False,
        )
        if scope is not None:
            # Só listas em que a agência dele tem passageiros.
            qs = qs.filter(list_enrollments__agency_id__in=scope).distinct()
        qs = qs.order_by('-created_at')[:20]
        # Em andamento aparecem primeiro, depois as demais
        recent = sorted(qs, key=lambda l: (0 if _ongoing(l) else 1))[:10]
        recent_lists = [
            {
                'id': l.id,
                'name': l.name,
                'list_type': l.list_type,
                'category': l.category,
                'start_date': l.start_date,
                'end_date': l.end_date,
                'status': l.status,
                # Para usuário de agência, mostra só a contagem de passageiros DELE na lista.
                'enrolled_count': (l.list_enrollments.filter(agency_id__in=scope).exclude(passenger__is_deleted=True).count()
                                   if scope is not None else l.enrolled_count),
                'block_capacity': l.block_capacity,
                'is_ongoing': _ongoing(l),
                'updated_at': l.updated_at,
            }
            for l in recent
        ]

    exchange_rates = None
    pref = getattr(user, 'calendar_preference', None)
    # Intervalo do gráfico de câmbio escolhido pelo usuário (semana/mês/6m/ano).
    RANGE_DAYS = {'week': 7, 'month': 31, '6months': 186, 'year': 366}
    chart_range = (getattr(pref, 'dashboard_chart_range', None) or 'week')
    if chart_range not in RANGE_DAYS:
        chart_range = 'week'
    if has_any_perm(user, 'settings_exchange_rates_view'):
        from datetime import timedelta
        cutoff = (today - timedelta(days=RANGE_DAYS[chart_range] - 1)).isoformat()
        # Cada usuário pode escolher quais moedas ver (configurações pessoais).
        # Sem escolha, mostra as favoritas globais.
        chosen_ids = list(pref.dashboard_currencies) if (pref and pref.dashboard_currencies) else []
        if chosen_ids:
            rows = {r.id: r for r in ConfigExchangeRate.objects.filter(id__in=chosen_ids)}
            favs = [rows[i] for i in chosen_ids if i in rows]   # preserva a ordem escolhida
        else:
            favs = list(ConfigExchangeRate.objects.filter(is_favorite=True).order_by('from_currency', 'to_currency'))

        def _history(r):
            # Pontos dentro do intervalo, com valor e horário de captura (t; cai
            # pra data d nos pontos antigos sem horário).
            out = []
            for p in (r.rate_history or []):
                if p.get('r') is None or (p.get('d') or '') < cutoff:
                    continue
                out.append({'r': p['r'], 't': p.get('t') or p.get('d')})
            return out

        exchange_rates = [
            {
                'id': r.id,
                'from_currency': r.from_currency,
                'to_currency': r.to_currency,
                'rate': r.rate,
                # Mostra QUANDO a taxa de fato mudou (não o auto_now, que muda a
                # cada save). Cai pro updated_at só nas linhas antigas sem registro.
                'updated_at': r.rate_updated_at or r.updated_at,
                'history': _history(r),
            }
            for r in favs
        ]

    return Response({
        'stats': stats,
        'recent_lists': recent_lists,
        'exchange_rates': exchange_rates,
        'chart_range': chart_range,
    })
