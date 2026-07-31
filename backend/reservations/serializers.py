from rest_framework import serializers

from .models import Reservation


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
                  'created_by_name', 'created_by_avatar', 'created_by_by_agency', 'itinerary_cover']
        # status/prazo/valores/contrato são definidos pelo servidor (fluxo da reserva).
        read_only_fields = ['status', 'deadline_hours', 'expires_at',
                            'amount_due', 'amount_paid', 'contract']
