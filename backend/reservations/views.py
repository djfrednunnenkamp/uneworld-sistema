from datetime import timedelta

from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from users_api.permissions import RequirePermission, agency_scope_ids, has_any_perm
from .models import Reservation
from .serializers import ReservationSerializer


class ReservationViewSet(viewsets.ModelViewSet):
    """CRUD de reservas, com escopo por agência.

    Agência vê só as próprias reservas; quem tem `reservas_view_all` (operadora)
    vê as de todas as agências."""
    serializer_class = ReservationSerializer
    queryset = Reservation.objects.select_related('itinerary', 'agency', 'contract').all()

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update'):
            return [RequirePermission('reservas_create', 'reservas_create_agency')()]
        if self.action in ('destroy', 'cancel'):
            return [RequirePermission('reservas_cancel')()]
        return [RequirePermission('reservas_view', 'reservas_view_all')()]

    def get_queryset(self):
        qs = super().get_queryset().filter(is_deleted=False)
        scope = agency_scope_ids(self.request.user)
        # Usuário de agência só vê as próprias reservas, a menos que possa ver todas.
        if scope is not None and not has_any_perm(self.request.user, 'reservas_view_all'):
            qs = qs.filter(agency_id__in=scope)
        return qs

    def perform_create(self, serializer):
        from config_api.models import ReservationSettings

        user = self.request.user
        itin = serializer.validated_data.get('itinerary')
        agency = serializer.validated_data.get('agency')
        rtype = serializer.validated_data.get('reservation_type', 'sem_pagamento')

        # Agência só reserva para a própria agência; se tiver uma só, assume-a.
        scope = agency_scope_ids(user)
        if scope is not None:
            if agency is None and len(scope) == 1:
                agency = None  # preenchido abaixo via agency_id
                agency_id = scope[0]
            elif agency is not None and agency.id in scope:
                agency_id = agency.id
            else:
                raise PermissionDenied('Você só pode criar reservas para a sua agência.')
        else:
            # Usuário interno (operadora) criando em nome de uma agência: exige a
            # permissão específica de criar reserva para agência.
            if not (user.is_superuser or has_any_perm(user, 'reservas_create_agency')):
                raise PermissionDenied('Você não tem permissão para criar reservas em nome de uma agência.')
            if agency is None:
                raise ValidationError({'agency': 'Informe a agência da reserva.'})
            agency_id = agency.id

        # Prazo efetivo da reserva sem pagamento: override do roteiro > padrão global.
        hours = None
        if rtype == 'sem_pagamento':
            hours = getattr(getattr(itin, 'pricing', None), 'reservation_deadline_hours', None)
            if hours is None:
                hours = ReservationSettings.get().deadline_hours
        expires = timezone.now() + timedelta(hours=hours) if hours else None
        status_val = 'paga' if rtype == 'pagamento_imediato' else 'pendente'

        serializer.save(created_by=user, agency_id=agency_id,
                        deadline_hours=hours, expires_at=expires, status=status_val)

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save(update_fields=['is_deleted', 'deleted_at', 'updated_at'])

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        obj = self.get_object()
        if obj.status in ('convertida', 'cancelada'):
            return Response({'error': 'Esta reserva não pode ser cancelada.'}, status=status.HTTP_400_BAD_REQUEST)
        obj.status = 'cancelada'
        obj.save(update_fields=['status', 'updated_at'])
        return Response(self.get_serializer(obj).data)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Resumo por roteiro (nome + contagem por tipo/status), respeitando o
        escopo do usuário. Alimenta o hub de Reservas."""
        rows = {}
        for r in self.get_queryset():
            key = r.itinerary_id
            it = rows.setdefault(key, {
                'itinerary': r.itinerary_id,
                'itinerary_name': r.itinerary.name if r.itinerary else None,
                'total': 0, 'sem_pagamento': 0, 'pagamento_imediato': 0, 'operadora': 0,
                'pendente': 0, 'paga': 0, 'convertida': 0, 'expirada': 0, 'cancelada': 0,
            })
            it['total'] += 1
            if r.reservation_type in it:
                it[r.reservation_type] += 1
            if r.status in it:
                it[r.status] += 1
        data = sorted(rows.values(), key=lambda x: (x['itinerary_name'] or '').lower())
        return Response(data)
