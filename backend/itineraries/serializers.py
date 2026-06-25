from rest_framework import serializers

from .models import Itinerary


def _country_brief(c):
    return {'id': c.id, 'name': c.name, 'code': c.code}


def _destination_brief(d):
    return {'id': d.id, 'name': d.name}


class ItinerarySerializer(serializers.ModelSerializer):
    countries_data    = serializers.SerializerMethodField()
    destinations_data = serializers.SerializerMethodField()
    category_name  = serializers.CharField(source='category.name', read_only=True, default=None)
    continent_name = serializers.CharField(source='continent.name', read_only=True, default=None)

    class Meta:
        model  = Itinerary
        fields = ['id', 'name', 'slug', 'start_date', 'end_date', 'trip_type',
                  'category', 'category_name', 'continent', 'continent_name',
                  'countries', 'countries_data', 'destinations', 'destinations_data',
                  'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def get_countries_data(self, obj):
        return [_country_brief(c) for c in obj.countries.all()]

    def get_destinations_data(self, obj):
        return [_destination_brief(d) for d in obj.destinations.all()]


class ItineraryListSerializer(serializers.ModelSerializer):
    category_name  = serializers.CharField(source='category.name', read_only=True, default=None)
    continent_name = serializers.CharField(source='continent.name', read_only=True, default=None)

    class Meta:
        model  = Itinerary
        fields = ['id', 'name', 'slug', 'start_date', 'end_date', 'trip_type',
                  'category_name', 'continent_name', 'created_at', 'updated_at',
                  'is_deleted', 'deleted_at']
