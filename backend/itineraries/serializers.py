from rest_framework import serializers

from .models import Itinerary, ItineraryAccommodationLine


class ItineraryAccommodationLineSerializer(serializers.ModelSerializer):
    accommodation_type_name = serializers.CharField(source='accommodation_type.name', read_only=True, default=None)

    class Meta:
        model  = ItineraryAccommodationLine
        fields = ['id', 'accommodation_type', 'accommodation_type_name', 'value_per_person', 'taxes', 'order']


class ItinerarySerializer(serializers.ModelSerializer):
    category_name  = serializers.CharField(source='category.name', read_only=True, default=None)
    continent_name = serializers.CharField(source='continent.name', read_only=True, default=None)
    accommodation_lines = ItineraryAccommodationLineSerializer(many=True, required=False)
    clauses_data        = serializers.SerializerMethodField()

    def validate_custom_clauses(self, value):
        # Sanitiza o HTML das cláusulas personalizadas antes de salvar (A-12).
        from core.sanitize import sanitize_custom_clauses
        return sanitize_custom_clauses(value)

    def get_clauses_data(self, obj):
        data = [{'id': c.id, 'name': c.name, 'content': c.content} for c in obj.clauses.all()]
        for cc in (obj.custom_clauses or []):
            if isinstance(cc, dict) and (cc.get('name') or cc.get('content')):
                data.append({'id': None, 'name': cc.get('name') or '', 'content': cc.get('content') or '', 'custom': True})
        return data

    class Meta:
        model  = Itinerary
        fields = ['id', 'name', 'slug', 'start_date', 'end_date', 'trip_type',
                  'clauses', 'custom_clauses', 'clauses_data',
                  'category', 'category_name', 'continent', 'continent_name',
                  'base_currency',
                  'accommodation_lines',
                  'payment_plan', 'payment_plans',
                  'created_at', 'updated_at', 'is_deleted', 'deleted_at']
        # is_deleted/deleted_at só podem ser alterados pelas ações destroy/restore/purge
        # do SoftDeleteViewSetMixin. Se ficarem graváveis aqui, um usuário com apenas
        # 'roteiros_edit' conseguiria mandar um roteiro pra lixeira (ou restaurá-lo)
        # via PATCH, furando o controle de permissão de exclusão (superusuário).
        read_only_fields = ['slug', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def _save_accommodation_lines(self, itinerary, lines):
        itinerary.accommodation_lines.all().delete()
        for i, line in enumerate(lines):
            ItineraryAccommodationLine.objects.create(itinerary=itinerary, order=i, **line)

    def create(self, validated_data):
        accommodation_lines = validated_data.pop('accommodation_lines', [])
        itinerary = super().create(validated_data)
        self._save_accommodation_lines(itinerary, accommodation_lines)
        return itinerary

    def update(self, instance, validated_data):
        accommodation_lines = validated_data.pop('accommodation_lines', None)
        instance = super().update(instance, validated_data)
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
