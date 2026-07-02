from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db import models
from datetime import date
from passengers.models import Passenger
from trips.models import PassengerList, ListEnrollment
from config_api.models import ConfigExchangeRate
from users_api.permissions import has_any_perm, agency_scope_ids


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
                'enrolled_count': (l.list_enrollments.filter(agency_id__in=scope).count()
                                   if scope is not None else l.enrolled_count),
                'block_capacity': l.block_capacity,
                'is_ongoing': _ongoing(l),
                'updated_at': l.updated_at,
            }
            for l in recent
        ]

    exchange_rates = None
    if has_any_perm(user, 'settings_exchange_rates_view'):
        # Cada usuário pode escolher quais moedas ver (configurações pessoais).
        # Sem escolha, mostra as favoritas globais.
        chosen_ids = []
        pref = getattr(user, 'calendar_preference', None)
        if pref and pref.dashboard_currencies:
            chosen_ids = list(pref.dashboard_currencies)
        if chosen_ids:
            rows = {r.id: r for r in ConfigExchangeRate.objects.filter(id__in=chosen_ids)}
            favs = [rows[i] for i in chosen_ids if i in rows]   # preserva a ordem escolhida
        else:
            favs = list(ConfigExchangeRate.objects.filter(is_favorite=True).order_by('from_currency', 'to_currency'))
        exchange_rates = [
            {
                'id': r.id,
                'from_currency': r.from_currency,
                'to_currency': r.to_currency,
                'rate': r.rate,
                # Mostra QUANDO a taxa de fato mudou (não o auto_now, que muda a
                # cada save). Cai pro updated_at só nas linhas antigas sem registro.
                'updated_at': r.rate_updated_at or r.updated_at,
                'history': [p.get('r') for p in (r.rate_history or []) if p.get('r') is not None],
            }
            for r in favs
        ]

    return Response({
        'stats': stats,
        'recent_lists': recent_lists,
        'exchange_rates': exchange_rates,
    })
