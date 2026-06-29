from rest_framework import serializers

from .models import Itinerary, ItineraryServiceLine, ItineraryAccommodationLine


def _country_brief(c):
    return {'id': c.id, 'name': c.name, 'code': c.code}


def _destination_brief(d):
    return {'id': d.id, 'name': d.name}


class ItineraryServiceLineSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source='supplier.name', read_only=True, default=None)
    services_data = serializers.SerializerMethodField()

    class Meta:
        model  = ItineraryServiceLine
        fields = ['id', 'supplier', 'supplier_name', 'services', 'services_data', 'percentage', 'order']

    def get_services_data(self, obj):
        return [{'id': s.id, 'name': s.name} for s in obj.services.all()]


class ItineraryAccommodationLineSerializer(serializers.ModelSerializer):
    accommodation_type_name = serializers.CharField(source='accommodation_type.name', read_only=True, default=None)

    class Meta:
        model  = ItineraryAccommodationLine
        fields = ['id', 'accommodation_type', 'accommodation_type_name', 'value_per_person', 'taxes', 'order']


class ItinerarySerializer(serializers.ModelSerializer):
    countries_data    = serializers.SerializerMethodField()
    destinations_data = serializers.SerializerMethodField()
    category_name  = serializers.CharField(source='category.name', read_only=True, default=None)
    continent_name = serializers.CharField(source='continent.name', read_only=True, default=None)
    holiday_name   = serializers.CharField(source='holiday.name', read_only=True, default=None)
    service_lines       = ItineraryServiceLineSerializer(many=True, required=False)
    accommodation_lines = ItineraryAccommodationLineSerializer(many=True, required=False)

    class Meta:
        model  = Itinerary
        fields = ['id', 'name', 'slug', 'start_date', 'end_date', 'trip_type',
                  'category', 'category_name', 'continent', 'continent_name',
                  'countries', 'countries_data', 'destinations', 'destinations_data',
                  'cover_title', 'internal_title', 'subtitle', 'short_description',
                  'holiday', 'holiday_name', 'is_featured', 'is_active', 'is_full', 'is_listed',
                  'has_notice', 'notice_color', 'notice_message',
                  'day_count_correction', 'cash_discount_percent', 'base_currency', 'additional_spread_percent',
                  'service_lines', 'accommodation_lines',
                  'about_destination', 'day_by_day', 'package_includes', 'package_excludes',
                  'insurance_info', 'pricing_info', 'payment_info', 'terms_info',
                  'hotels_reserved', 'transport_info', 'documentation_info', 'extras',
                  'created_at', 'updated_at', 'is_deleted', 'deleted_at']
        # is_deleted/deleted_at só podem ser alterados pelas ações destroy/restore/purge
        # do SoftDeleteViewSetMixin. Se ficarem graváveis aqui, um usuário com apenas
        # 'roteiros_edit' conseguiria mandar um roteiro pra lixeira (ou restaurá-lo)
        # via PATCH, furando o controle de permissão de exclusão (superusuário).
        read_only_fields = ['slug', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def get_countries_data(self, obj):
        return [_country_brief(c) for c in obj.countries.all()]

    def get_destinations_data(self, obj):
        return [_destination_brief(d) for d in obj.destinations.all()]

    def _save_service_lines(self, itinerary, lines):
        itinerary.service_lines.all().delete()
        for i, line in enumerate(lines):
            services = line.pop('services', [])
            obj = ItineraryServiceLine.objects.create(itinerary=itinerary, order=i, **line)
            obj.services.set(services)

    def _save_accommodation_lines(self, itinerary, lines):
        itinerary.accommodation_lines.all().delete()
        for i, line in enumerate(lines):
            ItineraryAccommodationLine.objects.create(itinerary=itinerary, order=i, **line)

    def create(self, validated_data):
        service_lines = validated_data.pop('service_lines', [])
        accommodation_lines = validated_data.pop('accommodation_lines', [])
        itinerary = super().create(validated_data)
        self._save_service_lines(itinerary, service_lines)
        self._save_accommodation_lines(itinerary, accommodation_lines)
        return itinerary

    def update(self, instance, validated_data):
        service_lines = validated_data.pop('service_lines', None)
        accommodation_lines = validated_data.pop('accommodation_lines', None)
        instance = super().update(instance, validated_data)
        if service_lines is not None:
            self._save_service_lines(instance, service_lines)
        if accommodation_lines is not None:
            self._save_accommodation_lines(instance, accommodation_lines)
        return instance


class ItineraryListSerializer(serializers.ModelSerializer):
    category_name  = serializers.CharField(source='category.name', read_only=True, default=None)
    continent_name = serializers.CharField(source='continent.name', read_only=True, default=None)

    class Meta:
        model  = Itinerary
        fields = ['id', 'name', 'slug', 'start_date', 'end_date', 'trip_type', 'base_currency',
                  'category_name', 'continent_name', 'created_at', 'updated_at',
                  'is_deleted', 'deleted_at']
