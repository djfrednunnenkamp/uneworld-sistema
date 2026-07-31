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
    queryset = (Reservation.objects
                .select_related('itinerary', 'agency', 'contract', 'created_by__permissions')
                .prefetch_related('itinerary__images', 'contracts_from').all())

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'link_contract'):
            return [RequirePermission('reservas_create', 'reservas_create_agency')()]
        if self.action == 'destroy':
            return [RequirePermission('reservas_delete')()]
        if self.action == 'cancel':
            return [RequirePermission('reservas_cancel')()]
        return [RequirePermission('reservas_view', 'reservas_view_all')()]

    def get_queryset(self):
        qs = super().get_queryset().filter(is_deleted=False)
        scope = agency_scope_ids(self.request.user)
        # Usuário de agência só vê as próprias reservas, a menos que possa ver todas.
        if scope is not None and not has_any_perm(self.request.user, 'reservas_view_all'):
            qs = qs.filter(agency_id__in=scope)
        # Filtro por roteiro (pop-up "reservas deste roteiro").
        itin = self.request.query_params.get('itinerary')
        if itin:
            qs = qs.filter(itinerary_id=itin)
        return qs

    @staticmethod
    def _type_capacity(itinerary, rtype):
        """Vagas para uma reserva do tipo `rtype`, mesma conta do hub (à venda −
        passageiros reais nas listas, × percentual do tipo), a partir da FOTO
        PUBLICADA. Retorna None quando não há capacidade definida (sem limite)."""
        from trips.models import ListEnrollment
        from config_api.models import ReservationSettings
        psnap = ((itinerary.published_data or {}).get('pricing_snapshot') or {}).get('config') or {}
        if psnap:
            pdefs = psnap.get('reservation_defaults') or {}
            seats = psnap.get('seats_for_sale')
            on = psnap.get('reserva_online_percent'); on = on if on is not None else pdefs.get('reserva_online_percent')
            im = psnap.get('pagamento_imediato_percent'); im = im if im is not None else pdefs.get('pagamento_imediato_percent')
        else:
            pricing = getattr(itinerary, 'pricing', None)
            rs = ReservationSettings.get()
            seats = pricing.seats_for_sale if pricing else None
            on = pricing.reserva_online_percent if (pricing and pricing.reserva_online_percent is not None) else rs.reserva_online_percent
            im = pricing.pagamento_imediato_percent if (pricing and pricing.pagamento_imediato_percent is not None) else rs.pagamento_imediato_percent
        if seats is None:
            return None
        on = float(on or 0); im = float(im or 0)
        pax = (ListEnrollment.objects
               .filter(passenger_list__roteiros=itinerary, passenger_list__is_deleted=False,
                       passenger__isnull=False, passenger__is_deleted=False)
               .count())
        avail = max(0, int(seats) - pax)
        pct = min(100.0, on + im) if rtype == 'pagamento_imediato' else on
        return min(avail, round(avail * pct / 100.0))

    def perform_create(self, serializer):
        from config_api.models import ReservationSettings

        user = self.request.user
        itin = serializer.validated_data.get('itinerary')
        agency = serializer.validated_data.get('agency')
        rtype = serializer.validated_data.get('reservation_type', 'sem_pagamento')

        # Capacidade do tipo: bloqueia passar das vagas, salvo permissão de overbook.
        pax = serializer.validated_data.get('pax') or 1
        cap = self._type_capacity(itin, rtype) if itin else None
        if cap is not None and pax > cap and not (user.is_superuser or has_any_perm(user, 'reservas_overbook')):
            raise ValidationError({'pax': f'Só há {cap} vaga(s) para este tipo de reserva neste roteiro.'})

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

    @action(detail=True, methods=['post'], url_path='link-contract')
    def link_contract(self, request, pk=None):
        """Consome a reserva ao criar um contrato a partir dela. `used_pax` = nº de
        passageiros do contrato:
        - usados < reservados → a reserva FICA com o restante (segue ativa em "Reservas");
        - usados >= reservados → a reserva é CONSUMIDA: vincula ao contrato, status
          'convertida' → sub-aba "Contratadas" (some do hub quando o contrato entra
          em pagamento, ver signals.py).
        Exceder o reservado exige `reservas_over_reserved` (ou superuser)."""
        res = self.get_object()
        cid = request.data.get('contract')
        if not cid:
            return Response({'error': 'Informe o contrato.'}, status=status.HTTP_400_BAD_REQUEST)
        from contracts.models import Contract
        contract = Contract.objects.filter(id=cid, is_deleted=False).first()
        if not contract:
            return Response({'error': 'Contrato não encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        # Registra a reserva de origem no contrato (1 reserva → N contratos).
        if contract.source_reservation_id != res.id:
            contract.source_reservation = res
            contract.save(update_fields=['source_reservation'])
        raw = request.data.get('used_pax')
        try:
            used = int(raw) if raw not in (None, '') else res.pax
        except (TypeError, ValueError):
            used = res.pax
        used = max(1, used)
        if used > res.pax and not (request.user.is_superuser or has_any_perm(request.user, 'reservas_over_reserved')):
            return Response({'error': f'O contrato tem {used} passageiro(s), mais que os {res.pax} reservados. '
                                      f'Sem permissão para exceder o reservado.'},
                            status=status.HTTP_400_BAD_REQUEST)
        remaining = res.pax - used
        if remaining > 0:
            # Consumo parcial: a reserva continua ativa com o restante.
            res.pax = remaining
            res.save(update_fields=['pax', 'updated_at'])
        else:
            # Consumo total (igual ou acima): zera e vira contrato ("Contratadas").
            res.pax = 0
            res.contract_id = cid
            res.status = 'convertida'
            res.save(update_fields=['pax', 'contract', 'status', 'updated_at'])
        return Response(self.get_serializer(res).data)

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
        """Resumo por roteiro para o hub de Reservas. Inclui TODOS os roteiros à
        venda (visibilidade pública) que ainda não começaram, mesmo sem reserva —
        cada card mostra a capa, as datas e a contagem por tipo/status. Roteiros
        que já têm reserva no escopo do usuário entram sempre (ainda que já tenham
        começado / saído do ar), pra não sumir com reserva ativa."""
        from django.db.models import Q, Count
        from itineraries.models import Itinerary
        from trips.models import ListEnrollment
        from config_api.models import ReservationSettings
        rsettings = ReservationSettings.get()

        def blank(itin_id):
            return {
                'itinerary': itin_id, 'itinerary_name': None,
                'cover': None, 'start_date': None, 'end_date': None,
                'seats_for_sale': None, 'passengers': 0, 'available': None,
                'online_percent': 0.0, 'imediato_percent': 0.0,
                'available_online': None, 'available_imediato': None,
                'total': 0, 'sem_pagamento': 0, 'pagamento_imediato': 0, 'operadora': 0,
                'pendente': 0, 'paga': 0, 'convertida': 0, 'expirada': 0, 'cancelada': 0,
            }

        rows = {}
        # 1) Contagens a partir das reservas no escopo do usuário.
        for r in self.get_queryset():
            it = rows.setdefault(r.itinerary_id, blank(r.itinerary_id))
            it['total'] += 1
            if r.reservation_type in it:
                it[r.reservation_type] += 1
            if r.status in it:
                it[r.status] += 1

        # 2) Roteiros à venda que ainda não começaram (públicos = visíveis no site).
        #    EXCLUI os excluídos (soft-delete) — não podem ser oferecidos.
        today = timezone.localdate()
        elegiveis = (Itinerary.objects
                     .filter(is_deleted=False, visibility='public')
                     .filter(Q(start_date__isnull=True) | Q(start_date__gte=today)))
        for itin_id in elegiveis.values_list('id', flat=True):
            rows.setdefault(itin_id, blank(itin_id))

        # 3) Metadados só dos roteiros NÃO excluídos. Roteiro excluído (mesmo que
        #    tivesse reserva antiga) sai do hub — Itinerary.objects não filtra
        #    soft-delete, então é obrigatório o is_deleted=False aqui.
        itins = (Itinerary.objects.filter(id__in=list(rows.keys()), is_deleted=False)
                 .select_related('pricing').prefetch_related('images'))
        vivos = set()
        for itin in itins:
            row = rows[itin.id]
            row['itinerary_name'] = itin.name
            row['start_date'] = itin.start_date
            row['end_date'] = itin.end_date
            row['cover'] = self._cover_url(itin, request)
            # Capacidade/percentuais de reserva vêm da FOTO PUBLICADA (published_data),
            # não do vivo — alterações só valem no hub após republicar. O snapshot
            # congela o ItineraryPricingConfigSerializer (inclui seats_for_sale, os
            # percentuais e o reservation_defaults do momento da publicação).
            psnap = ((itin.published_data or {}).get('pricing_snapshot') or {}).get('config') or {}
            if psnap:
                pdefs = psnap.get('reservation_defaults') or {}
                seats = psnap.get('seats_for_sale')
                on = psnap.get('reserva_online_percent')
                on = on if on is not None else pdefs.get('reserva_online_percent')
                im = psnap.get('pagamento_imediato_percent')
                im = im if im is not None else pdefs.get('pagamento_imediato_percent')
            else:
                # Fallback: roteiro ainda sem foto publicada de valores — usa o vivo.
                pricing = getattr(itin, 'pricing', None)
                seats = pricing.seats_for_sale if pricing else None
                on = pricing.reserva_online_percent if (pricing and pricing.reserva_online_percent is not None) else rsettings.reserva_online_percent
                im = pricing.pagamento_imediato_percent if (pricing and pricing.pagamento_imediato_percent is not None) else rsettings.pagamento_imediato_percent
            row['seats_for_sale'] = seats
            row['online_percent'] = float(on or 0)
            row['imediato_percent'] = float(im or 0)
            vivos.add(itin.id)

        # Passageiros já nas listas do roteiro (passageiro real, não bloqueio; lista e
        # passageiro não excluídos). Disponível = à venda − passageiros, nunca < 0.
        pax_rows = (ListEnrollment.objects
                    .filter(passenger_list__roteiros__in=vivos,
                            passenger_list__is_deleted=False,
                            passenger__isnull=False, passenger__is_deleted=False)
                    .values('passenger_list__roteiros')
                    .annotate(n=Count('id', distinct=True)))
        pax_by_itin = {r['passenger_list__roteiros']: r['n'] for r in pax_rows}
        for itin_id in vivos:
            row = rows[itin_id]
            pax = pax_by_itin.get(itin_id, 0)
            row['passengers'] = pax
            seats = row['seats_for_sale']
            avail = None if seats is None else max(0, seats - pax)
            row['available'] = avail
            if avail is None:
                row['available_online'] = None
                row['available_imediato'] = None
            else:
                on = row['online_percent']
                im = row['imediato_percent']
                # Reserva normal = disponível × online%. Pagamento agora inclui o
                # bloco normal + o imediato (online% + imediato%), teto em 100%.
                # Arredonda (não trunca) e limita ao disponível — assim 1 vaga não
                # vira 0 por causa do 60%/80%.
                row['available_online'] = min(avail, round(avail * on / 100.0))
                row['available_imediato'] = min(avail, round(avail * min(100.0, on + im) / 100.0))

        data = sorted((r for k, r in rows.items() if k in vivos), key=lambda x: (
            x['start_date'] is None, str(x['start_date'] or ''), (x['itinerary_name'] or '').lower()))
        return Response(data)

    @staticmethod
    def _cover_url(itin, request):
        """Capa do roteiro (imagem kind='cover'; senão 1ª imagem da galeria, nunca
        vídeo) — mesma regra do ItineraryListSerializer.get_cover."""
        imgs = list(itin.images.all())
        cover = next((i for i in imgs if i.kind == 'cover' and not i.is_video), None) \
            or next((i for i in imgs if i.day_id is None and not i.is_video), None)
        if not cover or not cover.image:
            return None
        return request.build_absolute_uri(cover.image.url) if request else cover.image.url
