from rest_framework import serializers

from .models import Reservation, ReservationRoom


class ReservationRoomSerializer(serializers.ModelSerializer):
    """Quarto/cabine da reserva. Só leitura: quem grava é a view, depois de
    conferir contra o bloqueio (reservations/availability.py) — deixar o cliente
    gravar direto seria deixá-lo escolher o próprio limite."""
    people = serializers.IntegerField(read_only=True)

    class Meta:
        model = ReservationRoom
        fields = ['id', 'kind', 'block', 'accommodation', 'ship_cabin', 'label', 'capacity', 'quantity', 'guests', 'people']
        read_only_fields = fields


class ReservationSerializer(serializers.ModelSerializer):
    itinerary_name = serializers.CharField(source='itinerary.name', read_only=True, default=None)
    agency_name    = serializers.CharField(source='agency.name', read_only=True, default=None)
    agency_logo_url = serializers.SerializerMethodField()
    type_display   = serializers.CharField(source='get_reservation_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    contract_id    = serializers.IntegerField(source='contract.id', read_only=True, default=None)
    created_by_name = serializers.SerializerMethodField()
    created_by_avatar = serializers.SerializerMethodField()
    created_by_by_agency = serializers.SerializerMethodField()
    itinerary_cover = serializers.SerializerMethodField()
    contracts_from = serializers.SerializerMethodField()
    rooms = ReservationRoomSerializer(many=True, read_only=True)
    # A escolha de quartos/cabines chega por aqui e é conferida na view.
    rooms_input = serializers.ListField(child=serializers.DictField(), write_only=True, required=False)
    responsible_user_name = serializers.SerializerMethodField()
    responsible_user_avatar = serializers.SerializerMethodField()
    # O PRAZO quando quem reserva é a operadora: ou um número de horas, ou uma
    # data e hora exatas. Sem nenhum dos dois, a reserva não vence (ver a view).
    # Entram como campos de escrita próprios porque `deadline_hours`/`expires_at`
    # são a FOTO do que ficou valendo — quem os define é o servidor.
    # Pessoas sem unidade própria (acomodação já existente na lista, ou nenhuma).
    list_guests = serializers.ListField(child=serializers.DictField(), required=False)
    deadline_hours_input = serializers.IntegerField(write_only=True, required=False, allow_null=True, min_value=1, max_value=8760)
    expires_at_input     = serializers.DateTimeField(write_only=True, required=False, allow_null=True)

    def get_contracts_from(self, obj):
        # Todos os contratos gerados a partir desta reserva + etapa/status de cada.
        out = []
        for ct in obj.contracts_from.all():
            if getattr(ct, 'is_deleted', False):
                continue
            out.append({
                'id': ct.id,
                'reservation_number': ct.reservation_number or f'#{ct.id}',
                'stage': ct.stage,
                'stage_display': ct.get_stage_display(),
                'status': ct.status,
                'created_at': ct.created_at,
            })
        return sorted(out, key=lambda x: x['id'])

    def get_itinerary_cover(self, obj):
        # Capa do roteiro (kind='cover'; senão 1ª imagem, nunca vídeo) — absoluta.
        it = obj.itinerary
        if not it:
            return None
        imgs = list(it.images.all())
        cover = next((i for i in imgs if i.kind == 'cover' and not i.is_video), None) \
            or next((i for i in imgs if i.day_id is None and not i.is_video), None)
        if not cover or not cover.image:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(cover.image.url) if request else cover.image.url

    def get_agency_logo_url(self, obj):
        # Absoluto (build_absolute_uri) — carregado no front pelo MediaImg/CoverThumb.
        ag = obj.agency
        if not ag or not getattr(ag, 'logo', None):
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(ag.logo.url) if request else ag.logo.url

    def _brief_user(self, u):
        if not u:
            return None
        return f'{u.first_name} {u.last_name}'.strip() or u.username

    def get_responsible_user_name(self, obj):
        return self._brief_user(obj.responsavel)

    def get_responsible_user_avatar(self, obj):
        u = obj.responsavel
        av = getattr(getattr(u, 'permissions', None), 'avatar', None) if u else None
        if not av:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(av.url) if request else av.url

    def get_created_by_name(self, obj):
        u = obj.created_by
        if not u:
            return None
        return f'{u.first_name} {u.last_name}'.strip() or u.username

    def get_created_by_avatar(self, obj):
        u = obj.created_by
        av = getattr(getattr(u, 'permissions', None), 'avatar', None) if u else None
        if not av:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(av.url) if request else av.url

    def get_created_by_by_agency(self, obj):
        # True = feita pela própria agência; False = feita pela operadora (interno).
        from users_api.permissions import agency_scope_ids
        u = obj.created_by
        if not u:
            return None
        return agency_scope_ids(u) is not None

    class Meta:
        model = Reservation
        fields = ['id', 'itinerary', 'itinerary_name', 'agency', 'agency_name', 'agency_logo_url',
                  'reservation_type', 'type_display', 'status', 'status_display', 'pax',
                  'deadline_hours', 'expires_at', 'amount_due', 'amount_paid',
                  'contract', 'contract_id', 'notes', 'created_at', 'updated_at',
                  'created_by_name', 'created_by_avatar', 'created_by_by_agency', 'itinerary_cover',
                  'contracts_from', 'rooms', 'rooms_input',
                  'responsible_user', 'responsible_user_name', 'responsible_user_avatar',
                  'deadline_hours_input', 'expires_at_input', 'list_guests']
        # status/prazo/valores/contrato são definidos pelo servidor (fluxo da reserva).
        read_only_fields = ['status', 'deadline_hours', 'expires_at',
                            'amount_due', 'amount_paid', 'contract']
