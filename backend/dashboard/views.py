from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db import models
from datetime import date
from passengers.models import Passenger
from trips.models import PassengerList, ListEnrollment
from config_api.models import ConfigExchangeRate
from users_api.permissions import has_any_perm


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_stats(request):
    today = date.today()
    user  = request.user

    def _ongoing(l):
        return bool(l.start_date and l.end_date and l.start_date <= today <= l.end_date)

    # Cada bloco respeita a permissão específica do próprio card no frontend.
    # Sem isso, qualquer autenticado conseguia ler as estatísticas chamando a API direto.
    stats = {}
    if has_any_perm(user, 'dashboard_view_passengers'):
        stats['total_passengers'] = Passenger.objects.filter(status='active', is_deleted=False).count()
    if has_any_perm(user, 'dashboard_view_lists'):
        stats['open_lists'] = PassengerList.objects.filter(status='aberta', is_deleted=False).count()
    if has_any_perm(user, 'dashboard_view_enrollments'):
        # Conta só inscrições de listas/passageiros vivos (soft-delete não deve inflar o total).
        stats['total_enrollments'] = (
            ListEnrollment.objects
            .exclude(enrollment_status='cancelado')
            .filter(passenger_list__is_deleted=False)
            .exclude(passenger__is_deleted=True)
            .count()
        )

    recent_lists = []
    if has_any_perm(user, 'dashboard_view_lists'):
        # Exclui viagens já encerradas (end_date preenchida e no passado)
        qs = PassengerList.objects.filter(
            models.Q(end_date__isnull=True) | models.Q(end_date__gte=today), is_deleted=False,
        ).order_by('-created_at')[:20]
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
                'enrolled_count': l.enrolled_count,
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
                'updated_at': r.updated_at,
                'history': [p.get('r') for p in (r.rate_history or []) if p.get('r') is not None],
            }
            for r in favs
        ]

    return Response({
        'stats': stats,
        'recent_lists': recent_lists,
        'exchange_rates': exchange_rates,
    })
