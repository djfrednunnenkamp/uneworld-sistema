from django.db import transaction
from rest_framework import serializers

from config_api.models import ConfigCity, ConfigCountry, Airport, Airline, ConfigKeyword, ConfigInclusion, ConfigHighlight, ConfigItineraryType, ConfigSpecialDate, ConfigContinent, ConfigHotel, ConfigBoat, ConfigTerrestreCompany
from .models import (Itinerary, ItineraryAccommodationLine, ItineraryDay, ItineraryImage,
                     ItineraryFieldTemplate, ItineraryDeparture, ItineraryFlight, ItineraryHotel, ItineraryBoat,
                     ItineraryTerrestreDeparture, ItineraryTerrestreLeg, ItineraryDocument)
from . import onlyoffice

TEMP_DAY_BASE = 100000  # base de day_number temporário no upsert (evita colisão da UniqueConstraint)


class ItineraryFieldTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItineraryFieldTemplate
        fields = ['id', 'field', 'name', 'content', 'order']


class ItineraryAccommodationLineSerializer(serializers.ModelSerializer):
    accommodation_type_name = serializers.CharField(source='accommodation_type.name', read_only=True, default=None)

    class Meta:
        model  = ItineraryAccommodationLine
        fields = ['id', 'accommodation_type', 'accommodation_type_name', 'value_per_person', 'taxes', 'order',
                  'flight_departure', 'terrestre_departure']

    # ── Validação de valores monetários (não podem ser negativos) ──
    def validate_value_per_person(self, v):
        if v is not None and v < 0:
            raise serializers.ValidationError('O valor por pessoa não pode ser negativo.')
        return v

    def validate_taxes(self, v):
        if v is not None and v < 0:
            raise serializers.ValidationError('As taxas não podem ser negativas.')
        return v


class ItineraryDocumentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    kind     = serializers.SerializerMethodField()   # word|excel|powerpoint|pdf|other|link
    editable = serializers.SerializerMethodField()   # dá pra editar no OnlyOffice?
    is_link  = serializers.SerializerMethodField()
    owner_name = serializers.SerializerMethodField()

    class Meta:
        model  = ItineraryDocument
        fields = ['id', 'itinerary', 'name', 'file', 'file_url', 'url', 'kind', 'editable', 'is_link', 'owner', 'owner_name', 'created_at']
        extra_kwargs = {'file': {'write_only': True, 'required': False}, 'name': {'required': False},
                        'owner': {'read_only': True}}

    def get_owner_name(self, obj):
        u = obj.owner
        if not u:
            return None
        return (f'{u.first_name} {u.last_name}'.strip() or u.username)

    def get_file_url(self, obj):
        if not obj.file:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(obj.file.url) if request else obj.file.url

    def get_is_link(self, obj):
        return bool(obj.url and not obj.file)

    def get_kind(self, obj):
        if obj.url and not obj.file:
            return 'link'
        return onlyoffice.doc_kind(obj.name or (obj.file.name if obj.file else ''))

    def get_editable(self, obj):
        return bool(obj.file) and onlyoffice.is_editable(obj.name or obj.file.name) and onlyoffice.is_configured()

    def validate(self, attrs):
        # Precisa ser OU arquivo OU link.
        has_file = attrs.get('file') is not None
        has_url  = bool(attrs.get('url'))
        if not has_file and not has_url and not self.instance:
            raise serializers.ValidationError('Envie um arquivo ou informe um link.')
        # SEGURANÇA: valida o anexo (extensão × tamanho × magic bytes) — só Office/PDF.
        if has_file:
            from passengers.validators import validate_attachment_file
            from django.core.exceptions import ValidationError as DjangoValidationError
            try:
                validate_attachment_file(attrs['file'])
            except DjangoValidationError as e:
                raise serializers.ValidationError({'file': e.messages})
        # SEGURANÇA: link só pode ser http(s) — bloqueia javascript:, data:, file:, etc.
        if has_url:
            u = (attrs.get('url') or '').strip().lower()
            if not (u.startswith('http://') or u.startswith('https://')):
                raise serializers.ValidationError({'url': 'O link precisa começar com http:// ou https://.'})
        return attrs

    def create(self, validated_data):
        f = validated_data.get('file')
        if f is not None and not validated_data.get('name'):
            validated_data['name'] = f.name        # nome amigável = nome original enviado
        elif not validated_data.get('name') and validated_data.get('url'):
            validated_data['name'] = validated_data['url']
        return super().create(validated_data)


class CityMiniSerializer(serializers.ModelSerializer):
    """Leitura resumida de cidade (reusa ConfigCity: Cidade→Estado→País)."""
    state_name     = serializers.CharField(source='state.name', read_only=True, default=None)
    country_name   = serializers.CharField(source='state.country.name', read_only=True, default=None)
    continent_name = serializers.CharField(source='state.country.continent.name', read_only=True, default=None)

    class Meta:
        model  = ConfigCity
        fields = ['id', 'name', 'state_name', 'country_name', 'continent_name']


class CountryMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ConfigCountry
        fields = ['id', 'name', 'code']


class AirportMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Airport
        fields = ['id', 'name', 'iata_code', 'city', 'country']


class AirlineMiniSerializer(serializers.ModelSerializer):
    logo = serializers.SerializerMethodField()

    class Meta:
        model  = Airline
        fields = ['id', 'name', 'iata_code', 'logo']

    def get_logo(self, obj):
        return obj.logo.url if obj.logo else None


class ItineraryDepartureSerializer(serializers.ModelSerializer):
    airport_data = AirportMiniSerializer(source='airport', read_only=True)

    class Meta:
        model  = ItineraryDeparture
        fields = ['id', 'itinerary', 'airport', 'airport_data', 'order']


class TerrestreCompanyMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ConfigTerrestreCompany
        fields = ['id', 'name', 'is_favorite']


class ItineraryTerrestreDepartureSerializer(serializers.ModelSerializer):
    city_data = CityMiniSerializer(source='city', read_only=True)

    class Meta:
        model  = ItineraryTerrestreDeparture
        fields = ['id', 'itinerary', 'city', 'city_data', 'order']


class ItineraryTerrestreLegSerializer(serializers.ModelSerializer):
    company_data     = TerrestreCompanyMiniSerializer(source='company', read_only=True)
    origin_data      = CityMiniSerializer(source='origin', read_only=True)
    destination_data = CityMiniSerializer(source='destination', read_only=True)

    class Meta:
        model  = ItineraryTerrestreLeg
        fields = ['id', 'departure', 'company', 'company_data', 'service_number',
                  'origin', 'origin_data', 'destination', 'destination_data',
                  'departs_at', 'arrives_at', 'order']


class ConfigHotelMiniSerializer(serializers.ModelSerializer):
    """Dados do hotel do catálogo exibidos junto do hotel reservado."""
    categories = serializers.SerializerMethodField()
    media      = serializers.SerializerMethodField()

    class Meta:
        model  = ConfigHotel
        fields = ['id', 'website', 'description', 'categories', 'media']

    def get_categories(self, obj):
        return [c.name for c in obj.categories.all()]

    def get_media(self, obj):
        out = []
        for m in obj.media.all():
            try:
                url = m.file.url
            except ValueError:
                url = None
            if url:
                out.append({'id': m.id, 'url': url, 'kind': m.kind})
        return out


class ItineraryHotelSerializer(serializers.ModelSerializer):
    config_hotel_data = ConfigHotelMiniSerializer(source='config_hotel', read_only=True)

    class Meta:
        model  = ItineraryHotel
        fields = ['id', 'itinerary', 'config_hotel', 'config_hotel_data', 'config_hotel_linked',
                  'name', 'city', 'check_in', 'check_out', 'address', 'phone', 'notes', 'order']


class ConfigBoatMiniSerializer(serializers.ModelSerializer):
    """Dados do barco do catálogo exibidos junto do barco reservado."""
    media = serializers.SerializerMethodField()

    class Meta:
        model  = ConfigBoat
        fields = ['id', 'website', 'description', 'media']

    def get_media(self, obj):
        out = []
        for m in obj.media.all():
            try:
                url = m.file.url
            except ValueError:
                url = None
            if url:
                out.append({'id': m.id, 'url': url, 'kind': m.kind})
        return out


class ItineraryBoatSerializer(serializers.ModelSerializer):
    config_boat_data = ConfigBoatMiniSerializer(source='config_boat', read_only=True)

    class Meta:
        model  = ItineraryBoat
        fields = ['id', 'itinerary', 'config_boat', 'config_boat_data', 'config_boat_linked',
                  'name', 'check_in', 'check_out', 'notes', 'order']


class ItineraryFlightSerializer(serializers.ModelSerializer):
    airline_data     = AirlineMiniSerializer(source='airline', read_only=True)
    origin_data      = AirportMiniSerializer(source='origin', read_only=True)
    destination_data = AirportMiniSerializer(source='destination', read_only=True)

    class Meta:
        model  = ItineraryFlight
        fields = ['id', 'departure', 'airline', 'airline_data', 'flight_number',
                  'origin', 'origin_data', 'destination', 'destination_data',
                  'departs_at', 'arrives_at', 'order']


class KeywordMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ConfigKeyword
        fields = ['id', 'name']


class InclusionMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ConfigInclusion
        fields = ['id', 'name']


class HighlightMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ConfigHighlight
        fields = ['id', 'name']


class ItineraryTypeMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ConfigItineraryType
        fields = ['id', 'name']


class SpecialDateMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ConfigSpecialDate
        fields = ['id', 'name']


class ContinentMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ConfigContinent
        fields = ['id', 'name']


class ItineraryImageSerializer(serializers.ModelSerializer):
    """Imagem/vídeo da galeria do roteiro OU de um dia. O arquivo (image) é
    OBRIGATÓRIO. Usada na leitura aninhada e na action de upload (multipart).
    Geo: `city`/`country` graváveis; `*_data` e continente são leitura derivada."""
    is_video        = serializers.SerializerMethodField()
    city_data       = CityMiniSerializer(source='city', read_only=True)
    country_data    = CountryMiniSerializer(source='country', read_only=True)
    continent_name  = serializers.SerializerMethodField()
    itinerary_name  = serializers.CharField(source='itinerary.name', read_only=True, default=None)

    class Meta:
        model  = ItineraryImage
        fields = ['id', 'image', 'caption', 'kind', 'order', 'is_video', 'subject_type',
                  'city', 'country', 'city_data', 'country_data', 'continent_name',
                  'dominant_color', 'color_bucket', 'created_at', 'itinerary', 'itinerary_name']

    def get_continent_name(self, obj):
        c = obj.country or (obj.city.state.country if (obj.city_id and obj.city and obj.city.state_id) else None)
        cont = getattr(c, 'continent', None)
        return getattr(cont, 'name', None)

    def get_is_video(self, obj):
        name = (getattr(obj.image, 'name', '') or '').lower()
        return name.endswith(('.mp4', '.webm', '.mov', '.m4v', '.ogv'))


class ItineraryDaySerializer(serializers.ModelSerializer):
    """Dia-a-dia (child table gravável). day_number é OBRIGATÓRIO e >= 1.
    `id` trafega (IntegerField) para o upsert preservar o dia e suas imagens."""
    id         = serializers.IntegerField(required=False)
    city_name  = serializers.CharField(source='city.name', read_only=True, default=None)
    images     = ItineraryImageSerializer(many=True, read_only=True)   # imagens do dia; upload via action

    class Meta:
        model  = ItineraryDay
        fields = ['id', 'day_number', 'title', 'description', 'city', 'city_name', 'order', 'images']

    def validate_day_number(self, v):
        if v is None or v < 1:
            raise serializers.ValidationError('O número do dia é obrigatório e deve ser >= 1.')
        return v


class ItinerarySerializer(serializers.ModelSerializer):
    category_name  = serializers.CharField(source='category.name', read_only=True, default=None)
    continent_name = serializers.CharField(source='continent.name', read_only=True, default=None)
    accommodation_lines = ItineraryAccommodationLineSerializer(many=True, required=False)
    clauses_data        = serializers.SerializerMethodField()

    # ── Novos campos (WordPress) — todos ADITIVOS e opcionais ──
    itinerary_type_name   = serializers.CharField(source='itinerary_type.name', read_only=True, default=None)
    maritime_company_name = serializers.CharField(source='maritime_company.name', read_only=True, default=None)
    # cities/countries/airports: escrita por IDs (M2M); *_data: leitura resumida.
    cities        = serializers.PrimaryKeyRelatedField(queryset=ConfigCity.objects.all(), many=True, required=False)
    cities_data   = CityMiniSerializer(source='cities', many=True, read_only=True)
    countries     = serializers.PrimaryKeyRelatedField(queryset=ConfigCountry.objects.all(), many=True, required=False)
    countries_data = CountryMiniSerializer(source='countries', many=True, read_only=True)
    continents      = serializers.PrimaryKeyRelatedField(queryset=ConfigContinent.objects.all(), many=True, required=False)
    continents_data = ContinentMiniSerializer(source='continents', many=True, read_only=True)
    airports      = serializers.PrimaryKeyRelatedField(queryset=Airport.objects.all(), many=True, required=False)
    airports_data = AirportMiniSerializer(source='airports', many=True, read_only=True)
    keywords      = serializers.PrimaryKeyRelatedField(queryset=ConfigKeyword.objects.all(), many=True, required=False)
    keywords_data = KeywordMiniSerializer(source='keywords', many=True, read_only=True)
    inclusions      = serializers.PrimaryKeyRelatedField(queryset=ConfigInclusion.objects.all(), many=True, required=False)
    inclusions_data = InclusionMiniSerializer(source='inclusions', many=True, read_only=True)
    highlights      = serializers.PrimaryKeyRelatedField(queryset=ConfigHighlight.objects.all(), many=True, required=False)
    highlights_data = HighlightMiniSerializer(source='highlights', many=True, read_only=True)
    itinerary_types      = serializers.PrimaryKeyRelatedField(queryset=ConfigItineraryType.objects.all(), many=True, required=False)
    itinerary_types_data = ItineraryTypeMiniSerializer(source='itinerary_types', many=True, read_only=True)
    special_dates        = serializers.PrimaryKeyRelatedField(queryset=ConfigSpecialDate.objects.all(), many=True, required=False)
    special_dates_data   = SpecialDateMiniSerializer(source='special_dates', many=True, read_only=True)
    days          = ItineraryDaySerializer(many=True, required=False)      # gravável (upsert)
    images        = serializers.SerializerMethodField()                    # só galeria (dia nulo)

    def get_images(self, obj):
        # Só as imagens da GALERIA do roteiro (day nulo). As de cada dia vão aninhadas
        # em days[].images. Filtra em Python sobre o prefetch (sem query extra).
        gallery = [im for im in obj.images.all() if im.day_id is None]
        return ItineraryImageSerializer(gallery, many=True, context=self.context).data

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
        # ── Aéreo e Terrestre são mutuamente exclusivos (Barco pode coexistir) ──
        has_voo = attrs.get('has_voo', getattr(self.instance, 'has_voo', False))
        has_ter = attrs.get('has_terrestre', getattr(self.instance, 'has_terrestre', False))
        if has_voo and has_ter:
            raise serializers.ValidationError(
                {'has_terrestre': 'Um roteiro não pode ter transporte Aéreo e Terrestre ao mesmo tempo.'})
        return attrs

    def get_clauses_data(self, obj):
        data = [{'id': c.id, 'name': c.name, 'content': c.content} for c in obj.clauses.all()]
        for cc in (obj.custom_clauses or []):
            if isinstance(cc, dict) and (cc.get('name') or cc.get('content')):
                data.append({'id': None, 'name': cc.get('name') or '', 'content': cc.get('content') or '', 'custom': True})
        return data

    class Meta:
        model  = Itinerary
        fields = ['id', 'name', 'slug', 'start_date', 'end_date', 'nights_override', 'capacity', 'trip_type', 'is_own_product', 'is_featured', 'badge_text', 'badge_color',
                  'has_voo', 'has_barco', 'has_terrestre',
                  'clauses', 'custom_clauses', 'clauses_data',
                  'category', 'category_name', 'continent', 'continent_name', 'continents', 'continents_data',
                  'base_currency',
                  'accommodation_lines',
                  'payment_plan', 'payment_plans',
                  'a_vista_discount_mode', 'a_vista_discount_value', 'a_vista_payment_method',
                  # Aba "Informações do Roteiro" (textos ricos):
                  'info_general', 'info_included', 'info_not_included', 'info_optionals',
                  'info_tips', 'info_documents', 'info_promo_rules', 'info_insurance',
                  'info_values', 'info_extras',
                  'notes', 'map_embed_url',
                  # Vínculo vivo com templates (por campo): FK + toggle.
                  'info_general_template', 'info_general_template_linked',
                  'info_included_template', 'info_included_template_linked',
                  'info_not_included_template', 'info_not_included_template_linked',
                  'info_optionals_template', 'info_optionals_template_linked',
                  'info_tips_template', 'info_tips_template_linked',
                  'info_documents_template', 'info_documents_template_linked',
                  'info_promo_rules_template', 'info_promo_rules_template_linked',
                  'info_insurance_template', 'info_insurance_template_linked',
                  'info_values_template', 'info_values_template_linked',
                  'info_extras_template', 'info_extras_template_linked',
                  'flight_notes', 'flight_notes_template', 'flight_notes_template_linked',
                  'hotel_notes', 'hotel_notes_template', 'hotel_notes_template_linked',
                  'accommodation_notes', 'accommodation_notes_template', 'accommodation_notes_template_linked',
                  'terrestre_notes', 'terrestre_notes_template', 'terrestre_notes_template_linked',
                  'boat_notes', 'boat_notes_template', 'boat_notes_template_linked',
                  # novos:
                  'itinerary_type', 'itinerary_type_name',
                  'maritime_company', 'maritime_company_name',
                  'cities', 'cities_data', 'countries', 'countries_data',
                  'airports', 'airports_data', 'keywords', 'keywords_data',
                  'inclusions', 'inclusions_data',
                  'highlights', 'highlights_data',
                  'itinerary_types', 'itinerary_types_data',
                  'special_dates', 'special_dates_data',
                  'days', 'images',
                  'status', 'is_published', 'has_unpublished_changes', 'published_at',
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
        read_only_fields = ['created_at', 'updated_at', 'is_deleted', 'deleted_at',
                            'has_unpublished_changes', 'published_at']

    # ── Persistência das child tables (padrão rebuild, igual accommodation_lines) ──
    def _save_accommodation_lines(self, itinerary, lines):
        itinerary.accommodation_lines.all().delete()
        # Uma categoria por partida: colapsa duplicatas de (tipo, partida) mantendo
        # a última ocorrência (linhas sem tipo definido passam livres).
        seen = {}       # (type_id, fd_id, td_id) -> posição em cleaned
        cleaned = []
        for line in lines:
            # Descarta partida que não seja deste roteiro (a linha vira "geral").
            fd = line.get('flight_departure')
            td = line.get('terrestre_departure')
            if fd is not None and fd.itinerary_id != itinerary.id:
                line = {**line, 'flight_departure': None}; fd = None
            if td is not None and td.itinerary_id != itinerary.id:
                line = {**line, 'terrestre_departure': None}; td = None
            at = line.get('accommodation_type')
            key = (at.id, getattr(fd, 'id', None), getattr(td, 'id', None)) if at is not None else None
            if key is not None and key in seen:
                cleaned[seen[key]] = line          # mesma categoria/partida → sobrescreve
            else:
                if key is not None:
                    seen[key] = len(cleaned)
                cleaned.append(line)
        for i, line in enumerate(cleaned):
            ItineraryAccommodationLine.objects.create(itinerary=itinerary, order=i, **line)

    def _save_days(self, itinerary, days):
        # UPSERT por id (não rebuild) para preservar cada ItineraryDay e as imagens
        # que apontam para ele (ItineraryImage.day, CASCADE). Duas passadas de
        # day_number (temp → final) evitam colisão da UniqueConstraint ao reordenar.
        with transaction.atomic():
            existing = {d.id: d for d in itinerary.days.all()}
            incoming_ids = {d.get('id') for d in days if d.get('id')}
            for did, obj in existing.items():
                if did not in incoming_ids:
                    obj.delete()   # imagens do dia caem por CASCADE (esperado)
            saved = []
            for i, d in enumerate(days):
                obj = existing.get(d.get('id')) or ItineraryDay(itinerary=itinerary)
                obj.title       = d.get('title', '')
                obj.description = d.get('description', '')
                obj.city        = d.get('city', None)
                obj.order       = d.get('order', i)
                obj.day_number  = TEMP_DAY_BASE + i          # temporário e único
                obj.save()
                saved.append((obj, d['day_number']))
            for obj, real in saved:                          # aplica os números reais
                obj.day_number = real
                obj.save(update_fields=['day_number'])

    def create(self, validated_data):
        accommodation_lines = validated_data.pop('accommodation_lines', [])
        days                = validated_data.pop('days', None)
        itinerary = super().create(validated_data)   # trata cities (M2M), itinerary_type, maritime_company
        self._save_accommodation_lines(itinerary, accommodation_lines)
        if days is not None:
            self._save_days(itinerary, days)
        return itinerary

    # M2M do roteiro que precisam entrar no log (o diff escalar não os pega).
    _M2M_AUDIT = {
        'countries': 'Países', 'cities': 'Cidades', 'continents': 'Continentes',
        'airports': 'Aeroportos', 'keywords': 'Palavras-chave', 'inclusions': 'Inclusos',
        'highlights': 'Destaques', 'itinerary_types': 'Tipos de roteiro', 'special_dates': 'Datas especiais',
    }

    def _audit_snapshot(self, instance):
        """Estado do roteiro pro diff do log: escalares + M2M + filhos (valores,
        dia-a-dia). Sem isso, mudar país/cidade/valores não apareceria no log."""
        from audit.tracking import obj_to_dict
        snap = dict(obj_to_dict(instance))
        for field, label in self._M2M_AUDIT.items():
            try:
                snap[label] = sorted(str(o) for o in getattr(instance, field).all())
            except Exception:
                pass
        try:
            snap['Valores das acomodações'] = [
                [str(l.accommodation_type_id), str(l.value_per_person), str(l.taxes)]
                for l in instance.accommodation_lines.all()
            ]
            snap['Roteiro dia-a-dia'] = [
                [d.day_number, d.title, str(d.city_id or '')] for d in instance.days.all().order_by('order', 'id')
            ]
        except Exception:
            pass
        return snap

    def _log_update(self, instance, old, new):
        changes = {k: {'antes': old.get(k), 'depois': v} for k, v in new.items() if old.get(k) != v}
        if not changes:
            return
        from audit.models import AuditLog
        from audit.tracking import user_display
        from audit.middleware import get_current_user, get_current_ip
        user = get_current_user()
        AuditLog.objects.create(
            user=user, user_display=user_display(user), action='update',
            model_name='Itinerary', model_label='Roteiro',
            object_id=str(instance.pk), object_repr=str(instance)[:500],
            changes=changes, ip_address=get_current_ip(),
        )

    def update(self, instance, validated_data):
        accommodation_lines = validated_data.pop('accommodation_lines', None)
        days                = validated_data.pop('days', None)
        old_snap = self._audit_snapshot(instance)      # antes de mexer
        instance._skip_audit_signal = True             # eu logo o diff completo abaixo
        instance = super().update(instance, validated_data)
        if accommodation_lines is not None:
            self._save_accommodation_lines(instance, accommodation_lines)
        if days is not None:
            self._save_days(instance, days)
        # Salvar a cópia de trabalho de um roteiro publicado = "alterações não
        # publicadas" (o site segue na foto até publicar de novo pela action).
        if instance.is_published and not instance.has_unpublished_changes:
            instance.has_unpublished_changes = True
            instance.save(update_fields=['has_unpublished_changes'])
        self._log_update(instance, old_snap, self._audit_snapshot(instance))
        return instance


class ItineraryListSerializer(serializers.ModelSerializer):
    category_name         = serializers.CharField(source='category.name', read_only=True, default=None)
    continent_name        = serializers.CharField(source='continent.name', read_only=True, default=None)
    # Aditivos (o frontend ignora campos extras) — úteis para novas colunas na listagem.
    itinerary_type_name   = serializers.CharField(source='itinerary_type.name', read_only=True, default=None)
    maritime_company_name = serializers.CharField(source='maritime_company.name', read_only=True, default=None)
    cover                 = serializers.SerializerMethodField()   # miniatura da capa
    # Nome/datas da FOTO publicada — pro seletor de roteiros do contrato mostrar o
    # que a agência realmente vê (alterações não publicadas não aparecem).
    pub_name       = serializers.SerializerMethodField()
    pub_start_date = serializers.SerializerMethodField()
    pub_end_date   = serializers.SerializerMethodField()

    class Meta:
        model  = Itinerary
        fields = ['id', 'name', 'slug', 'start_date', 'end_date', 'trip_type', 'base_currency', 'capacity',
                  'badge_text', 'badge_color',
                  'category_name', 'continent_name',
                  'itinerary_type_name', 'maritime_company_name', 'cover',
                  'status', 'is_published', 'has_unpublished_changes', 'order',
                  'pub_name', 'pub_start_date', 'pub_end_date',
                  'created_at', 'updated_at',
                  'is_deleted', 'deleted_at']

    def _pub(self, obj, key):
        d = obj.published_data if (obj.is_published and obj.published_data) else None
        return d.get(key) if isinstance(d, dict) else None
    def get_pub_name(self, obj):       return self._pub(obj, 'name') or obj.name
    def get_pub_start_date(self, obj): return self._pub(obj, 'start_date') or obj.start_date
    def get_pub_end_date(self, obj):   return self._pub(obj, 'end_date') or obj.end_date

    def get_cover(self, obj):
        # Capa: imagem kind='cover'; senão a 1ª imagem da galeria (day nulo).
        imgs = list(obj.images.all())
        cover = next((i for i in imgs if i.kind == 'cover'), None) \
            or next((i for i in imgs if i.day_id is None), None)
        if not cover or not cover.image:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(cover.image.url) if request else cover.image.url
