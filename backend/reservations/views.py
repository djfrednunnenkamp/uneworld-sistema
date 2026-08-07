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
                .prefetch_related('itinerary__images', 'contracts_from', 'rooms').all())

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'link_contract', 'record_contract'):
            return [RequirePermission('reservas_create', 'reservas_create_agency')()]
        if self.action == 'destroy':
            return [RequirePermission('reservas_delete')()]
        if self.action == 'cancel':
            return [RequirePermission('reservas_cancel')()]
        return [RequirePermission('reservas_view', 'reservas_view_all')()]

    def get_queryset(self):
        qs = super().get_queryset().filter(is_deleted=False)
        scope = agency_scope_ids(self.request.user)
        # Usuário de agência SÓ vê as reservas da própria agência — barreira dura.
        # `reservas_view_all` só amplia a visão de quem é equipe interna (scope None),
        # nunca deixa uma agência ver as reservas de outra.
        if scope is not None:
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
        from itineraries.capacity import seats_published
        psnap = ((itinerary.published_data or {}).get('pricing_snapshot') or {}).get('config') or {}
        # Capacidade = assentos dos BLOQUEIOS (Valores › Disponibilidade), nunca
        # mais um número digitado. None = sem bloqueio de assento = sem limite.
        seats = seats_published(itinerary)
        if psnap:
            pdefs = psnap.get('reservation_defaults') or {}
            on = psnap.get('reserva_online_percent'); on = on if on is not None else pdefs.get('reserva_online_percent')
            im = psnap.get('pagamento_imediato_percent'); im = im if im is not None else pdefs.get('pagamento_imediato_percent')
        else:
            pricing = getattr(itinerary, 'pricing', None)
            rs = ReservationSettings.get()
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

        # Quartos/cabines escolhidos na tela: confere contra o BLOQUEIO antes de
        # gravar (ver reservations/availability.py). A escolha não pode chegar ao
        # banco sem passar por aqui — o limite é do servidor, não da tela.
        from .availability import validate_rooms
        rooms_in = serializer.validated_data.pop('rooms_input', None) or []
        linhas, erro = validate_rooms(itin, pax, rooms_in) if itin else ([], None)
        if erro:
            raise ValidationError({'rooms': erro})

        res = serializer.save(created_by=user, agency_id=agency_id, original_pax=pax,
                              deadline_hours=hours, expires_at=expires, status=status_val)
        self._save_rooms(res, linhas)
        # Quem organiza a viagem trabalha na LISTA de passageiros: a reserva vai
        # para lá com os quartos montados (e os lugares ainda sem nome como
        # bloqueio da agência), e quem reservou recebe o comprovante. Nada disso
        # pode derrubar a reserva, que já está gravada — ver enrollment.py.
        from .enrollment import sincronizar_e_avisar
        sincronizar_e_avisar(res)

    @staticmethod
    def _save_rooms(res, linhas):
        """Grava as unidades da reserva (troca tudo: é a foto do que ela segura)."""
        from .models import ReservationRoom
        res.rooms.all().delete()
        ReservationRoom.objects.bulk_create([
            ReservationRoom(
                reservation=res, kind=l['kind'], block_id=l['block_id'],
                accommodation_id=l['option']['id'] if l['kind'] == 'terrestre' else None,
                ship_cabin_id=l['option']['id'] if l['kind'] == 'navio' else None,
                label=l['option']['label'] or '', capacity=l['option']['capacity'] or 1,
                quantity=l['quantity'], guests=l.get('guests') or [],
            ) for l in (linhas or [])
        ])

    def perform_update(self, serializer):
        from .availability import validate_rooms
        rooms_in = serializer.validated_data.pop('rooms_input', None)
        res = serializer.instance
        itin = serializer.validated_data.get('itinerary') or res.itinerary
        pax = serializer.validated_data.get('pax') or res.pax
        linhas = None
        if rooms_in is not None:
            linhas, erro = validate_rooms(itin, pax, rooms_in, ignorar_reserva=res.id)
            if erro:
                raise ValidationError({'rooms': erro})
        res = serializer.save()
        if linhas is not None:
            self._save_rooms(res, linhas)
            # Mudou a divisão dos quartos → a lista tem de mudar junto (sem
            # reenviar o comprovante: a reserva é a mesma).
            from .enrollment import sincronizar_e_avisar
            sincronizar_e_avisar(res, avisar=False)

    @action(detail=False, methods=['get'])
    def availability(self, request):
        """GET /api/reservations/availability/?itinerary=<id>[&reservation=<id>]

        O que ainda dá para reservar em QUARTOS e CABINES — é com isto que a tela
        sugere a divisão das pessoas e impede pedir o que não existe."""
        from itineraries.models import Itinerary
        from .availability import pools_for
        itin_id = request.query_params.get('itinerary')
        itin = Itinerary.objects.filter(pk=itin_id, is_deleted=False).first() if itin_id else None
        if itin is None:
            return Response({'error': 'Roteiro não encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        ignorar = request.query_params.get('reservation') or None
        pools = pools_for(itin, ignorar_reserva=ignorar)
        return Response({
            'itinerary': itin.id,
            'pools': pools,
            'has_terrestre': any(p['kind'] == 'terrestre' for p in pools),
            'has_navio': any(p['kind'] == 'navio' for p in pools),
        })

    @staticmethod
    def _reconcile(res):
        """Recalcula a reserva pela SOMA real de passageiros dos contratos gerados
        dela (idempotente): pax = reservado − soma; quando a soma ≥ reservado, a
        reserva é CONSUMIDA (vincula ao contrato mais recente, 'convertida' →
        "Contratadas"); senão fica ativa com o restante em "Reservas"."""
        original = res.original_pax if res.original_pax is not None else res.pax
        cts = list(res.contracts_from.filter(is_deleted=False).order_by('id'))
        consumed = sum(ct.guests.count() for ct in cts)
        remaining = max(0, original - consumed)
        res.pax = remaining
        if consumed >= original and cts:
            res.contract = cts[-1]
            res.status = 'convertida'
        else:
            res.contract = None
            if res.status == 'convertida':
                res.status = 'paga' if res.reservation_type == 'pagamento_imediato' else 'pendente'
        res.save(update_fields=['pax', 'contract', 'status', 'updated_at'])

    @action(detail=True, methods=['post'], url_path='link-contract')
    def link_contract(self, request, pk=None):
        """Registra o contrato como gerado DESTA reserva e recalcula (ver _reconcile):
        a reserva fica com o restante ou, quando a SOMA de passageiros dos contratos
        ≥ reservado, é consumida → "Contratadas" (some no pagamento, ver signals.py).
        O bloqueio de exceder o reservado é feito no front (com reservas_over_reserved)."""
        res = self.get_object()
        cid = request.data.get('contract')
        if not cid:
            return Response({'error': 'Informe o contrato.'}, status=status.HTTP_400_BAD_REQUEST)
        from contracts.models import Contract
        contract = Contract.objects.filter(id=cid, is_deleted=False).first()
        if not contract:
            return Response({'error': 'Contrato não encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        if contract.source_reservation_id != res.id:
            contract.source_reservation = res
            contract.save(update_fields=['source_reservation'])
        # Marca QUEM foi (não só quantos): é o que permite gerar o próximo
        # contrato da mesma reserva sem oferecer de novo quem já está num.
        from .contratados import marcar_contratados
        marcar_contratados(res, contract, slots=request.data.get('slots'))
        self._reconcile(res)
        return Response(self.get_serializer(res).data)

    @action(detail=False, methods=['post'], url_path='record-contract')
    def record_contract(self, request):
        """Cria um registro de reserva JÁ CONTRATADA (pagamento imediato — vai direto
        ao contrato, sem segurar reserva) para acompanhar em "Contratadas" até o
        contrato ser pago. Sem checagem de capacidade (o contrato já existe). Some do
        hub quando o contrato entra em pagamento (signals.py)."""
        from contracts.models import Contract
        user = request.user
        itin = request.data.get('itinerary')
        ag = request.data.get('agency')
        cid = request.data.get('contract')
        try:
            pax = max(1, int(request.data.get('pax') or 1))
        except (TypeError, ValueError):
            pax = 1
        if not (itin and ag and cid):
            return Response({'error': 'Dados incompletos (roteiro, agência e contrato).'}, status=status.HTTP_400_BAD_REQUEST)
        if not Contract.objects.filter(id=cid, is_deleted=False).exists():
            return Response({'error': 'Contrato não encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        scope = agency_scope_ids(user)
        if scope is not None and int(ag) not in scope:
            raise PermissionDenied('Você só pode registrar para a sua agência.')
        res = Reservation.objects.create(
            itinerary_id=itin, agency_id=ag, reservation_type='pagamento_imediato',
            pax=pax, original_pax=pax, status='convertida', contract_id=cid, created_by=user)
        Contract.objects.filter(id=cid).update(source_reservation=res)
        return Response(self.get_serializer(res).data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save(update_fields=['is_deleted', 'deleted_at', 'updated_at'])
        # A reserva saiu de cena: os lugares que ela pôs na lista saem com ela.
        from .enrollment import remover_da_lista
        remover_da_lista(instance)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        obj = self.get_object()
        if obj.status in ('convertida', 'cancelada'):
            return Response({'error': 'Esta reserva não pode ser cancelada.'}, status=status.HTTP_400_BAD_REQUEST)
        obj.status = 'cancelada'
        obj.save(update_fields=['status', 'updated_at'])
        # Reserva cancelada devolve as unidades ao estoque — e some da lista de
        # passageiros, senão a lista continuaria dizendo que essa gente viaja.
        from .enrollment import remover_da_lista
        remover_da_lista(obj)
        return Response(self.get_serializer(obj).data)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Resumo por roteiro para o hub de Reservas. Inclui TODOS os roteiros à
        venda (visibilidade pública) que ainda não começaram, mesmo sem reserva —
        cada card mostra a capa, as datas e a contagem por tipo/status. Roteiros
        que já têm reserva no escopo do usuário entram sempre (ainda que já tenham
        começado / saído do ar), pra não sumir com reserva ativa."""
        from django.db.models import Q, Count, Sum
        from itineraries.models import Itinerary
        from trips.models import ListEnrollment
        from config_api.models import ReservationSettings
        from itineraries.capacity import seats_published
        rsettings = ReservationSettings.get()

        def blank(itin_id):
            return {
                'itinerary': itin_id, 'itinerary_name': None,
                'cover': None, 'start_date': None, 'end_date': None,
                'seats_for_sale': None, 'passengers': 0, 'available': None,
                'online_percent': 0.0, 'imediato_percent': 0.0,
                'available_online': None, 'available_imediato': None, 'reserved_active': 0,
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
                 .select_related('pricing').prefetch_related('images', 'inventory_blocks'))
        vivos = set()
        for itin in itins:
            row = rows[itin.id]
            row['itinerary_name'] = itin.name
            row['start_date'] = itin.start_date
            row['end_date'] = itin.end_date
            row['cover'] = self._cover_url(itin, request)
            # Capacidade/percentuais de reserva vêm da FOTO PUBLICADA (published_data),
            # não do vivo — alterações só valem no hub após republicar. O snapshot
            # congela os BLOQUEIOS (de onde saem os assentos) e o
            # ItineraryPricingConfigSerializer (percentuais + reservation_defaults).
            psnap = ((itin.published_data or {}).get('pricing_snapshot') or {}).get('config') or {}
            seats = seats_published(itin)
            if psnap:
                pdefs = psnap.get('reservation_defaults') or {}
                on = psnap.get('reserva_online_percent')
                on = on if on is not None else pdefs.get('reserva_online_percent')
                im = psnap.get('pagamento_imediato_percent')
                im = im if im is not None else pdefs.get('pagamento_imediato_percent')
            else:
                # Fallback: roteiro ainda sem foto publicada de valores — usa o vivo.
                pricing = getattr(itin, 'pricing', None)
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

        # Reservas ATIVAS (seguram vaga mas ainda não viraram passageiro na lista):
        # pendente dentro do prazo + paga; convertida/expirada NÃO seguram. Soma o
        # `pax` (restante) por roteiro — é o que já foi reservado e ainda não pago/contratado.
        now = timezone.now()
        held_rows = (Reservation.objects
                     .filter(itinerary_id__in=vivos, is_deleted=False,
                             status__in=('pendente', 'paga'))
                     .exclude(status='pendente', expires_at__isnull=False, expires_at__lte=now)
                     .values('itinerary_id')
                     .annotate(n=Sum('pax')))
        held_by_itin = {r['itinerary_id']: int(r['n'] or 0) for r in held_rows}

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
                held = held_by_itin.get(itin_id, 0)   # reservas já ativas
                row['reserved_active'] = held
                # Vagas físicas realmente livres: disponível − reservas ativas.
                phys = max(0, avail - held)
                # Cota por tipo (disponível × %) MENOS as reservas já feitas, com teto
                # nas vagas físicas livres. Reserva normal = online%; pagamento agora
                # inclui o bloco normal + imediato (online% + imediato%), teto 100%.
                # Arredonda (não trunca) — assim 1 vaga não vira 0 por causa do 60%/80%.
                quota_online   = round(avail * on / 100.0)
                quota_imediato = round(avail * min(100.0, on + im) / 100.0)
                row['available_online']   = min(phys, max(0, quota_online - held))
                row['available_imediato'] = min(phys, max(0, quota_imediato - held))

        data = sorted((r for k, r in rows.items() if k in vivos), key=lambda x: (
            x['start_date'] is None, str(x['start_date'] or ''), (x['itinerary_name'] or '').lower()))

        # Permissão de ver a disponibilidade: sem ela, zeramos os números de
        # disponibilidade/capacidade na resposta (o front esconde as colunas).
        perms = getattr(request.user, 'permissions', None)
        show_avail = request.user.is_superuser or getattr(perms, 'reservas_view_availability', True)
        if not show_avail:
            for row in data:
                for f in ('seats_for_sale', 'passengers', 'available', 'available_online',
                          'available_imediato', 'reserved_active', 'online_percent', 'imediato_percent'):
                    row[f] = None
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
