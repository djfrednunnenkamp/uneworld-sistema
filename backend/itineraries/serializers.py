from rest_framework import serializers

from config_api.models import ConfigCity
from .models import Itinerary, ItineraryAccommodationLine, ItineraryDay, ItineraryImage


class ItineraryAccommodationLineSerializer(serializers.ModelSerializer):
    accommodation_type_name = serializers.CharField(source='accommodation_type.name', read_only=True, default=None)

    class Meta:
        model  = ItineraryAccommodationLine
        fields = ['id', 'accommodation_type', 'accommodation_type_name', 'value_per_person', 'taxes', 'order']

    # ── Validação de valores monetários (não podem ser negativos) ──
    def validate_value_per_person(self, v):
        if v is not None and v < 0:
            raise serializers.ValidationError('O valor por pessoa não pode ser negativo.')
        return v

    def validate_taxes(self, v):
        if v is not None and v < 0:
            raise serializers.ValidationError('As taxas não podem ser negativas.')
        return v


class CityMiniSerializer(serializers.ModelSerializer):
    """Leitura resumida de cidade (reusa ConfigCity: Cidade→Estado→País)."""
    state_name   = serializers.CharField(source='state.name', read_only=True, default=None)
    country_name = serializers.CharField(source='state.country.name', read_only=True, default=None)

    class Meta:
        model  = ConfigCity
        fields = ['id', 'name', 'state_name', 'country_name']


class ItineraryDaySerializer(serializers.ModelSerializer):
    """Dia-a-dia (child table gravável). day_number é OBRIGATÓRIO e >= 1."""
    class Meta:
        model  = ItineraryDay
        fields = ['id', 'day_number', 'title', 'description', 'order']

    def validate_day_number(self, v):
        if v is None or v < 1:
            raise serializers.ValidationError('O número do dia é obrigatório e deve ser >= 1.')
        return v


class ItineraryImageSerializer(serializers.ModelSerializer):
    """Imagem da galeria. O arquivo (image) é OBRIGATÓRIO. Usada tanto na leitura
    aninhada quanto na action de upload (multipart) do viewset."""
    class Meta:
        model  = ItineraryImage
        fields = ['id', 'image', 'caption', 'is_cover', 'order']


class ItinerarySerializer(serializers.ModelSerializer):
    category_name  = serializers.CharField(source='category.name', read_only=True, default=None)
    continent_name = serializers.CharField(source='continent.name', read_only=True, default=None)
    accommodation_lines = ItineraryAccommodationLineSerializer(many=True, required=False)
    clauses_data        = serializers.SerializerMethodField()

    # ── Novos campos (WordPress) — todos ADITIVOS e opcionais ──
    itinerary_type_name   = serializers.CharField(source='itinerary_type.name', read_only=True, default=None)
    maritime_company_name = serializers.CharField(source='maritime_company.name', read_only=True, default=None)
    # cities: escrita por IDs (M2M); cities_data: leitura resumida.
    cities      = serializers.PrimaryKeyRelatedField(queryset=ConfigCity.objects.all(), many=True, required=False)
    cities_data = CityMiniSerializer(source='cities', many=True, read_only=True)
    days        = ItineraryDaySerializer(many=True, required=False)     # gravável (rebuild)
    images      = ItineraryImageSerializer(many=True, read_only=True)   # leitura; escrita via action

    def validate_custom_clauses(self, value):
        # Sanitiza o HTML das cláusulas personalizadas antes de salvar (A-12).
        from core.sanitize import sanitize_custom_clauses
        return sanitize_custom_clauses(value)

    def validate_days(self, value):
        # Impede day_number duplicado dentro do mesmo payload (viraria IntegrityError
        # pela UniqueConstraint uniq_itinerary_day_number). Erro amigável 400.
        nums = [d.get('day_number') for d in value]
        if len(nums) != len(set(nums)):
            raise serializers.ValidationError('Há dias com o mesmo número — o número do dia deve ser único no roteiro.')
        return value

    def validate(self, attrs):
        # ── Datas consistentes: término não pode ser anterior ao início ──
        start = attrs.get('start_date', getattr(self.instance, 'start_date', None))
        end   = attrs.get('end_date',   getattr(self.instance, 'end_date', None))
        if start and end and end < start:
            raise serializers.ValidationError(
                {'end_date': 'A data de término não pode ser anterior à data de início.'})
        return attrs

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
                  # novos:
                  'itinerary_type', 'itinerary_type_name',
                  'maritime_company', 'maritime_company_name',
                  'cities', 'cities_data', 'days', 'images',
                  'created_at', 'updated_at', 'is_deleted', 'deleted_at']
        # slug agora é GRAVÁVEL (o ItineraryDetail já tinha o input): ModelSerializer
        # aplica o UniqueValidator automático (unique=True no model), que exclui o
        # próprio registro no update — reenviar o slug atual não gera erro. Se enviado
        # em branco, o Itinerary.save() gera o slug automaticamente (comportamento antigo).
        #
        # is_deleted/deleted_at seguem read_only: só as ações destroy/restore/purge do
        # SoftDeleteViewSetMixin podem alterá-los. Se ficassem graváveis, um usuário com
        # apenas 'roteiros_edit' mandaria um roteiro pra lixeira via PATCH, furando a
        # permissão de exclusão (superusuário).
        #
        # NOTA (relacionamentos obrigatórios): category/continent/itinerary_type NÃO são
        # tornados obrigatórios de propósito — o fluxo de criação (ItineraryCreateModal
        # envia só name+datas) e roteiros já existentes com esses campos nulos quebrariam.
        # A obrigatoriedade é aplicada onde é seguro: nas child tables novas (day_number
        # em ItineraryDay, arquivo em ItineraryImage), que nenhum client antigo envia.
        read_only_fields = ['created_at', 'updated_at', 'is_deleted', 'deleted_at']

    # ── Persistência das child tables (padrão rebuild, igual accommodation_lines) ──
    def _save_accommodation_lines(self, itinerary, lines):
        itinerary.accommodation_lines.all().delete()
        for i, line in enumerate(lines):
            ItineraryAccommodationLine.objects.create(itinerary=itinerary, order=i, **line)

    def _save_days(self, itinerary, days):
        itinerary.days.all().delete()
        for i, d in enumerate(days):
            d.setdefault('order', i)
            ItineraryDay.objects.create(itinerary=itinerary, **d)

    def create(self, validated_data):
        accommodation_lines = validated_data.pop('accommodation_lines', [])
        days                = validated_data.pop('days', None)
        itinerary = super().create(validated_data)   # trata cities (M2M), itinerary_type, maritime_company
        self._save_accommodation_lines(itinerary, accommodation_lines)
        if days is not None:
            self._save_days(itinerary, days)
        return itinerary

    def update(self, instance, validated_data):
        accommodation_lines = validated_data.pop('accommodation_lines', None)
        days                = validated_data.pop('days', None)
        instance = super().update(instance, validated_data)
        if accommodation_lines is not None:
            self._save_accommodation_lines(instance, accommodation_lines)
        if days is not None:
            self._save_days(instance, days)
        return instance


class ItineraryListSerializer(serializers.ModelSerializer):
    category_name         = serializers.CharField(source='category.name', read_only=True, default=None)
    continent_name        = serializers.CharField(source='continent.name', read_only=True, default=None)
    # Aditivos (o frontend ignora campos extras) — úteis para novas colunas na listagem.
    itinerary_type_name   = serializers.CharField(source='itinerary_type.name', read_only=True, default=None)
    maritime_company_name = serializers.CharField(source='maritime_company.name', read_only=True, default=None)

    class Meta:
        model  = Itinerary
        fields = ['id', 'name', 'slug', 'start_date', 'end_date', 'trip_type', 'base_currency',
                  'category_name', 'continent_name',
                  'itinerary_type_name', 'maritime_company_name',
                  'created_at', 'updated_at',
                  'is_deleted', 'deleted_at']
