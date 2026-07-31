from rest_framework import serializers

from .models import Reservation


class ReservationSerializer(serializers.ModelSerializer):
    itinerary_name = serializers.CharField(source='itinerary.name', read_only=True, default=None)
    agency_name    = serializers.CharField(source='agency.name', read_only=True, default=None)
    agency_logo_url = serializers.SerializerMethodField()
    type_display   = serializers.CharField(source='get_reservation_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    contract_id    = serializers.IntegerField(source='contract.id', read_only=True, default=None)

    def get_agency_logo_url(self, obj):
        # Absoluto (build_absolute_uri) — carregado no front pelo MediaImg/CoverThumb.
        ag = obj.agency
        if not ag or not getattr(ag, 'logo', None):
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(ag.logo.url) if request else ag.logo.url

    class Meta:
        model = Reservation
        fields = ['id', 'itinerary', 'itinerary_name', 'agency', 'agency_name', 'agency_logo_url',
                  'reservation_type', 'type_display', 'status', 'status_display', 'pax',
                  'deadline_hours', 'expires_at', 'amount_due', 'amount_paid',
                  'contract', 'contract_id', 'notes', 'created_at', 'updated_at']
        # status/prazo/valores/contrato são definidos pelo servidor (fluxo da reserva).
        read_only_fields = ['status', 'deadline_hours', 'expires_at',
                            'amount_due', 'amount_paid', 'contract']
