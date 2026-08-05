import re
from django.db import transaction
from rest_framework import serializers

from config_api.models import ConfigCity, ConfigCountry, Airport, Airline, ConfigKeyword, ConfigInclusion, ConfigHighlight, ConfigItineraryType, ConfigSpecialDate, ConfigContinent, ConfigHotel, ConfigBoat, ConfigTerrestreCompany
from .models import (Itinerary, ItineraryAccommodationLine, ItineraryDay, ItineraryImage, ItineraryMapPoint,
                     ItineraryFieldTemplate, ItineraryDeparture, ItineraryFlight, ItineraryHotel, ItineraryBoat,
                     ItineraryTerrestreDeparture, ItineraryTerrestreLeg, ItineraryDocument, ItineraryDocumentFolder,
                     ItineraryPricingConfig, ItineraryCostItem, ItineraryCurrencyRate,
                     ItineraryInventoryBlock, ItineraryCostPayment, VideoExport)
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
        fields = ['id', 'accommodation_type', 'accommodation_type_name',
                  'ship_cabin', 'accommodation_label', 'capacity',
                  'value_per_person', 'taxes', 'order',
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
        fields = ['id', 'itinerary', 'folder', 'name', 'file', 'file_url', 'url', 'kind', 'editable', 'is_link', 'owner', 'owner_name', 'created_at']
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
        # SEGURANÇA: aceita qualquer arquivo (fotos, e-mails, Office, PDF, ZIP…),
        # bloqueando só tipos perigosos (executáveis/scripts/HTML/SVG) e o tamanho.
        if has_file:
            from passengers.validators import validate_any_upload_file
            from django.core.exceptions import ValidationError as DjangoValidationError
            try:
                validate_any_upload_file(attrs['file'])
            except DjangoValidationError as e:
                raise serializers.ValidationError({'file': e.messages})
        # SEGURANÇA: link só pode ser http(s) — bloqueia javascript:, data:, file:, etc.
        if has_url:
            u = (attrs.get('url') or '').strip().lower()
            if not (u.startswith('http://') or u.startswith('https://')):
                raise serializers.ValidationError({'url': 'O link precisa começar com http:// ou https://.'})
        # A pasta (se informada) tem que ser do MESMO roteiro.
        folder = attrs.get('folder')
        itin = attrs.get('itinerary') or getattr(self.instance, 'itinerary', None)
        if folder and itin and folder.itinerary_id != itin.id:
            raise serializers.ValidationError({'folder': 'A pasta é de outro roteiro.'})
        return attrs

    def create(self, validated_data):
        f = validated_data.get('file')
        if f is not None and not validated_data.get('name'):
            validated_data['name'] = f.name        # nome amigável = nome original enviado
        elif not validated_data.get('name') and validated_data.get('url'):
            validated_data['name'] = validated_data['url']
        return super().create(validated_data)


class ItineraryDocumentFolderSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ItineraryDocumentFolder
        fields = ['id', 'itinerary', 'parent', 'name', 'owner', 'order', 'created_at']
        extra_kwargs = {'owner': {'read_only': True}, 'name': {'required': True}}

    def validate_name(self, v):
        v = (v or '').strip()
        if not v:
            raise serializers.ValidationError('Informe o nome da pasta.')
        return v

    def validate(self, attrs):
        parent = attrs.get('parent')
        itin = attrs.get('itinerary') or getattr(self.instance, 'itinerary', None)
        if parent and itin and parent.itinerary_id != itin.id:
            raise serializers.ValidationError({'parent': 'A pasta pai é de outro roteiro.'})
        # Impede ciclos: a pasta não pode virar filha dela mesma nem de uma descendente.
        if self.instance and parent:
            p = parent
            while p is not None:
                if p.id == self.instance.id:
                    raise serializers.ValidationError({'parent': 'Não dá para mover uma pasta para dentro dela mesma.'})
                p = p.parent
        return attrs


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
        fields = ['id', 'itinerary', 'airport', 'airport_data', 'expected_pax', 'order']


class TerrestreCompanyMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ConfigTerrestreCompany
        fields = ['id', 'name', 'is_favorite']


class ItineraryTerrestreDepartureSerializer(serializers.ModelSerializer):
    city_data = CityMiniSerializer(source='city', read_only=True)

    class Meta:
        model  = ItineraryTerrestreDeparture
        fields = ['id', 'itinerary', 'city', 'city_data', 'expected_pax', 'order']


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
        for m in obj.media.filter(is_deleted=False):
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
                  'name', 'city', 'check_in', 'check_out', 'address', 'phone', 'website', 'notes', 'order']

    def validate_notes(self, v):
        from core.sanitize import sanitize_html   # HTML rico → anti-XSS (A-12)
        return sanitize_html(v)


class ConfigBoatMiniSerializer(serializers.ModelSerializer):
    """Dados do barco do catálogo exibidos junto do barco reservado."""
    media = serializers.SerializerMethodField()

    class Meta:
        model  = ConfigBoat
        fields = ['id', 'website', 'description', 'media']

    def get_media(self, obj):
        out = []
        for m in obj.media.filter(is_deleted=False):
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
                  'name', 'website', 'check_in', 'check_out', 'notes', 'order']

    def validate_notes(self, v):
        from core.sanitize import sanitize_html   # HTML rico → anti-XSS (A-12)
        return sanitize_html(v)


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
    # Vídeo: URL da versão NORMALIZADA (o player usa esta, nunca o original quebrado),
    # URL da thumbnail (poster do card/modal) e o status/erro do processamento.
    video_url       = serializers.SerializerMethodField()   # MP4 (compat) = playback principal
    webm_url        = serializers.SerializerMethodField()    # WebM/VP9 (fallback Linux sem H.264)
    thumb_url       = serializers.SerializerMethodField()
    download_url    = serializers.SerializerMethodField()    # MP4 (compat)
    download_urls   = serializers.SerializerMethodField()    # {mp4, webm} (compat)
    downloads       = serializers.SerializerMethodField()    # {mp4,webm}{url,filename,available}
    playback_sources = serializers.SerializerMethodField()   # [{url, type, codec}]
    mime_type       = serializers.SerializerMethodField()
    error           = serializers.SerializerMethodField()
    # Progresso real do processamento (barra + ETA na interface).
    processing_elapsed_seconds = serializers.SerializerMethodField()

    class Meta:
        model  = ItineraryImage
        fields = ['id', 'image', 'caption', 'kind', 'order', 'is_video', 'subject_type',
                  'city', 'country', 'continent', 'city_data', 'country_data', 'continent_name',
                  'dominant_color', 'color_bucket', 'created_at', 'itinerary', 'itinerary_name',
                  'status', 'video_url', 'webm_url', 'thumb_url', 'download_url', 'download_urls',
                  'downloads', 'playback_sources', 'mime_type', 'duration', 'width', 'height', 'error',
                  'processing_stage', 'processing_progress', 'estimated_remaining_seconds',
                  'processing_elapsed_seconds', 'processing_heartbeat_at']

    def get_processing_elapsed_seconds(self, obj):
        return obj.processing_elapsed_seconds()

    def _abs(self, url):
        request = self.context.get('request')
        return request.build_absolute_uri(url) if (request and url) else url

    def get_continent_name(self, obj):
        # Continente explícito tem prioridade; senão deriva do país / da cidade.
        cont = getattr(obj, 'continent', None)
        if cont is None:
            c = obj.country or (obj.city.state.country if (obj.city_id and obj.city and obj.city.state_id) else None)
            cont = getattr(c, 'continent', None)
        return getattr(cont, 'name', None)

    def get_is_video(self, obj):
        name = (getattr(obj.image, 'name', '') or '').lower()
        return name.endswith(ItineraryImage.VIDEO_EXTS)

    def get_video_url(self, obj):
        # Só devolve URL de reprodução quando o vídeo está PRONTO (normalizado). Antes
        # disso é None — o front mostra 'processando' e não abre um player quebrado.
        if self.get_is_video(obj) and obj.status == 'ready' and obj.video_normalized:
            return self._abs(obj.video_normalized.url)
        return None

    def get_webm_url(self, obj):
        # Só quando pronto E existe o WebM (VP9). Fallback p/ navegadores/players sem H.264.
        if self.get_is_video(obj) and obj.status == 'ready' and obj.video_normalized_webm:
            return self._abs(obj.video_normalized_webm.url)
        return None

    def get_thumb_url(self, obj):
        if self.get_is_video(obj) and obj.thumbnail:
            return self._abs(obj.thumbnail.url)
        return None

    def get_playback_sources(self, obj):
        """Fontes de reprodução em ORDEM DE PREFERÊNCIA (MP4 primeiro; o player
        reordena por canPlayType). Só inclui a versão que EXISTE e está pronta."""
        if not (self.get_is_video(obj) and obj.status == 'ready'):
            return []
        out = []
        mp4 = self.get_video_url(obj)
        if mp4:                                  # avc1.42e01e = H.264 Constrained Baseline
            out.append({'url': mp4, 'type': 'video/mp4; codecs="avc1.42e01e"', 'codec': 'avc1'})
        webm = self.get_webm_url(obj)
        if webm:                                 # VP8/Vorbis (compat Linux/GStreamer padrão)
            out.append({'url': webm, 'type': 'video/webm; codecs="vp8, vorbis"', 'codec': 'vp8'})
        return out

    def get_download_url(self, obj):
        # Endpoint autenticado de download (attachment, MP4). O front usa via axios
        # (cookie/CSRF, proxy same-origin/CORS) — nunca monta path de storage à mão.
        if obj.pk is None:
            return None
        return self._abs(f'/api/itineraries/gallery/{obj.pk}/download/')

    def get_download_urls(self, obj):
        if obj.pk is None or not self.get_is_video(obj):
            return {}
        d = {'mp4': self._abs(f'/api/itineraries/gallery/{obj.pk}/download/?fmt=mp4')}
        if obj.video_normalized_webm:
            d['webm'] = self._abs(f'/api/itineraries/gallery/{obj.pk}/download/?fmt=webm')
        return d

    def get_downloads(self, obj):
        """Contrato de download por formato: url + filename BONITO (dos metadados) +
        available. O filename real vem do Content-Disposition; aqui é para exibir."""
        if obj.pk is None or not self.get_is_video(obj):
            return {}
        from .gallery_naming import download_filename
        ready = obj.status == 'ready'
        has_mp4 = ready and bool(obj.video_normalized and obj.video_normalized.name)
        has_webm = ready and bool(obj.video_normalized_webm and obj.video_normalized_webm.name)
        # 'recommended': 'auto' → o FRONT decide pelo dispositivo (Linux → webm, senão
        # mp4) e cai na versão válida se a recomendada não existir.
        return {
            'recommended': 'auto',
            'mp4': {'url': self._abs(f'/api/itineraries/gallery/{obj.pk}/download/?fmt=mp4'),
                    'filename': download_filename(obj, '.mp4'), 'available': has_mp4},
            'webm': {'url': self._abs(f'/api/itineraries/gallery/{obj.pk}/download/?fmt=webm'),
                     'filename': download_filename(obj, '.webm'), 'available': has_webm},
        }

    def get_mime_type(self, obj):
        if self.get_is_video(obj):
            return 'video/mp4' if obj.status == 'ready' else None
        return None

    def get_error(self, obj):
        # Mensagem pública só quando falhou (sem stack trace/caminhos internos).
        return obj.error_message if obj.status == 'failed' else ''


class VideoExportSerializer(serializers.ModelSerializer):
    """Estado de UMA exportação avançada (progresso + link quando pronto)."""
    summary        = serializers.SerializerMethodField()
    download_url   = serializers.SerializerMethodField()
    filename       = serializers.SerializerMethodField()
    elapsed_seconds = serializers.SerializerMethodField()
    error_message  = serializers.SerializerMethodField()

    class Meta:
        model  = VideoExport
        fields = ['id', 'video', 'container', 'video_codec', 'audio_codec', 'resolution', 'quality',
                  'status', 'progress', 'stage', 'estimated_remaining_seconds', 'elapsed_seconds',
                  'file_size', 'summary', 'download_url', 'filename', 'error_message',
                  'created_at', 'finished_at', 'expires_at']

    def get_summary(self, obj):
        from .gallery_export_presets import config_summary
        return config_summary(obj.config())

    def get_download_url(self, obj):
        if obj.status != 'ready':
            return None
        request = self.context.get('request')
        url = f'/api/itineraries/gallery/{obj.video_id}/exports/{obj.pk}/download/'
        return request.build_absolute_uri(url) if request else url

    def get_filename(self, obj):
        from .gallery_export_presets import container_ext, config_summary
        from .gallery_naming import download_basename
        base = download_basename(obj.video)
        suffix = config_summary(obj.config()).replace(' · ', ' ').replace('.', '')
        name = f'{base} - {suffix}'[:200]
        return f'{name}{container_ext(obj.config())}'

    def get_elapsed_seconds(self, obj):
        return obj.elapsed_seconds()

    def get_error_message(self, obj):
        return obj.error if obj.status == 'failed' else ''


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

    def validate_title(self, v):
        from core.sanitize import sanitize_html   # título é HTML rico → anti-XSS (A-12)
        return sanitize_html(v)

    def validate_description(self, v):
        from core.sanitize import sanitize_html   # descrição é HTML rico → anti-XSS (A-12)
        return sanitize_html(v)


class ItineraryMapPointSerializer(serializers.ModelSerializer):
    """Ponto do mapa nativo do roteiro (marcador com foto + descrição). Leitura
    aninhada no roteiro (e no published_data); a escrita é por ações imediatas.

    FOTO: hoje é uma `ItineraryImage` ligada ao ponto (`map_point`) — assim ela
    passa pelo MESMO fluxo das outras imagens do sistema (seletor da galeria,
    pop-up de catalogar, lightbox, exclusão). `photo` traz a imagem inteira e
    `image` continua sendo só a URL pra exibir (o `image` antigo, FileField do
    próprio ponto, ainda é aceito como fallback dos pontos criados antes)."""
    image = serializers.SerializerMethodField()
    photo = serializers.SerializerMethodField()

    def _photo(self, obj):
        # `photos` costuma vir do prefetch — ordena em Python pra não gerar query.
        photos = sorted(obj.photos.all(), key=lambda p: (p.order, p.id))
        return photos[0] if photos else None

    def get_photo(self, obj):
        p = self._photo(obj)
        return ItineraryImageSerializer(p, context=self.context).data if p else None

    def get_image(self, obj):
        p = self._photo(obj)
        f = p.image if p else obj.image
        if not f:
            return None
        try:
            return f.url
        except Exception:
            return None

    class Meta:
        model  = ItineraryMapPoint
        fields = ['id', 'title', 'description', 'latitude', 'longitude', 'image', 'photo',
                  'color', 'icon', 'leg_style', 'leg_color', 'leg_icon', 'leg_label', 'order']


class ItinerarySerializer(serializers.ModelSerializer):
    category_name  = serializers.CharField(source='category.name', read_only=True, default=None)
    continent_name = serializers.CharField(source='continent.name', read_only=True, default=None)
    accommodation_lines = ItineraryAccommodationLineSerializer(many=True, required=False)
    clauses_data        = serializers.SerializerMethodField()
    shared_agencies_data = serializers.SerializerMethodField()

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
    map_points    = ItineraryMapPointSerializer(many=True, read_only=True)  # mapa nativo; escrita por actions

    def get_images(self, obj):
        # Só as imagens da GALERIA do roteiro (day nulo). As de cada dia vão aninhadas
        # em days[].images e as dos PONTOS DO MAPA em map_points[].photo — nenhuma
        # das duas entra aqui. Filtra em Python sobre o prefetch (sem query extra).
        gallery = [im for im in obj.images.all() if im.day_id is None and im.map_point_id is None]
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

    def validate_map_embed_url(self, v):
        # O usuário cola o <iframe> do Google My Maps; o front/PDF extraem o `src` e
        # o embutem num iframe. Exige que o src seja do Google Maps — senão um editor
        # poderia apontar para uma página arbitrária (phishing/conteúdo hostil) vista
        # por um revisor de maior privilégio e servida na futura vitrine pública.
        if not v or not v.strip():
            return v
        import re as _re
        from urllib.parse import urlparse
        m = _re.search(r'src=["\']([^"\']+)["\']', v)
        url = (m.group(1) if m else v).strip()
        host = (urlparse(url).hostname or '').lower()
        if urlparse(url).scheme not in ('http', 'https') or not (host == 'google.com' or host.endswith('.google.com')):
            raise serializers.ValidationError('Cole o código de incorporação de um mapa do Google.')
        return v

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
        # ── Sanitiza os campos de HTML rico antes de salvar (A-12, anti-XSS) ──
        # Os textos das abas Informações do Roteiro são digitados em editor rico e
        # depois renderizados via dangerouslySetInnerHTML — precisam ser limpos.
        from core.sanitize import sanitize_html
        for f in ('notes', 'flight_notes', 'hotel_notes', 'accommodation_notes',
                  'terrestre_notes', 'boat_notes',
                  # Campos rich das "Informações do Roteiro" — renderizados CRUS via
                  # innerHTML no PDF do roteiro (generateItineraryHTML) e entram no
                  # published_data da vitrine. Sem sanitizar aqui = stored XSS (A-12).
                  'info_general', 'info_optionals', 'info_tips', 'info_documents',
                  'info_insurance', 'info_promo_rules', 'info_extras', 'info_values',
                  'info_lamina', 'info_included', 'info_not_included',
                  'info_required_docs', 'info_weather', 'info_what_to_bring'):
            if attrs.get(f):
                attrs[f] = sanitize_html(attrs[f])
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
                  'info_values', 'info_extras', 'info_lamina',
                  'info_required_docs', 'info_weather', 'info_what_to_bring',
                  'notes', 'map_embed_url',
                  # Aparência do mapa nativo (estilo + cores do modo ilustrado).
                  'map_style', 'map_land_color', 'map_water_color', 'map_highlight_color',
                  'map_land_color_dark', 'map_water_color_dark', 'map_highlight_color_dark',
                  'map_highlight_opacity', 'map_extra_countries', 'map_state_countries',
                  'map_show_borders', 'map_show_country_names', 'map_show_states', 'map_show_state_names',
                  'map_show_tile_labels',
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
                  'info_lamina_template', 'info_lamina_template_linked',
                  'info_required_docs_template', 'info_required_docs_template_linked',
                  'info_weather_template', 'info_weather_template_linked',
                  'info_what_to_bring_template', 'info_what_to_bring_template_linked',
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
                  'inclusions', 'inclusions_data', 'inclusion_counts',
                  'highlights', 'highlights_data',
                  'itinerary_types', 'itinerary_types_data',
                  'special_dates', 'special_dates_data',
                  'days', 'images', 'map_points',
                  'status', 'is_published', 'has_unpublished_changes', 'published_at',
                  'visibility', 'shared_agencies', 'shared_agencies_data',
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
            sc = line.get('ship_cabin')
            # Identidade: hotel por tipo; cabine por (capacidade, rótulo) do grupo.
            if at is not None:
                ident = ('acc', at.id)
            elif sc is not None or line.get('accommodation_label'):
                ident = ('cab', line.get('capacity'), line.get('accommodation_label') or '')
            else:
                ident = None
            key = (ident, getattr(fd, 'id', None), getattr(td, 'id', None)) if ident is not None else None
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

    def get_shared_agencies_data(self, obj):
        try:
            return [{'id': a.id, 'name': a.name or a.company_name or f'Agência #{a.id}'}
                    for a in obj.shared_agencies.all()]
        except Exception:
            return []

    def _sync_publish_from_visibility(self, instance, validated_data):
        """visibility é a fonte da verdade do acesso; mantém is_published em sincronia
        (public ⇔ is_published) p/ os leitores existentes continuarem funcionando."""
        if 'visibility' not in validated_data:
            return
        want = instance.visibility == 'public'
        if instance.is_published != want:
            instance.is_published = want
            instance.save(update_fields=['is_published'])

    def create(self, validated_data):
        accommodation_lines = validated_data.pop('accommodation_lines', [])
        days                = validated_data.pop('days', None)
        # Atômico: o roteiro, suas linhas de acomodação, o dia-a-dia e a lista de
        # passageiros 1:1 (que o resto do sistema assume existir) formam uma unidade.
        # Uma falha no meio deixaria um roteiro pela metade, sem lista/acomodações.
        with transaction.atomic():
            itinerary = super().create(validated_data)   # trata cities (M2M), itinerary_type, maritime_company
            self._sync_publish_from_visibility(itinerary, validated_data)
            self._save_accommodation_lines(itinerary, accommodation_lines)
            if days is not None:
                self._save_days(itinerary, days)
            # Roteiro não público nasce já com a sua lista de passageiros 1:1.
            from trips.services import sync_passenger_list_for_itinerary
            sync_passenger_list_for_itinerary(itinerary, allow_create=True)
        return itinerary

    # M2M do roteiro que precisam entrar no log (o diff escalar não os pega).
    _M2M_AUDIT = {
        'countries': 'Países', 'cities': 'Cidades', 'continents': 'Continentes',
        'airports': 'Aeroportos', 'keywords': 'Palavras-chave', 'inclusions': 'Inclusos',
        'highlights': 'Destaques', 'itinerary_types': 'Tipos de roteiro', 'special_dates': 'Datas especiais',
        'shared_agencies': 'Agências com acesso',
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
        self._sync_publish_from_visibility(instance, validated_data)
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
        # Datas da lista de passageiros vinculada acompanham as do roteiro.
        from trips.services import sync_passenger_list_for_itinerary
        sync_passenger_list_for_itinerary(instance)
        return instance


class ItineraryListSerializer(serializers.ModelSerializer):
    category_name         = serializers.CharField(source='category.name', read_only=True, default=None)
    continent_name        = serializers.CharField(source='continent.name', read_only=True, default=None)
    # Continentes/países do roteiro para os filtros da lista. Reúne o FK legado
    # `continent`, o M2M `continents`, e os continentes derivados dos países
    # (countries) e das cidades visitadas (cities→state→country). O país carrega
    # o continente pra o filtro de país seguir o de continente selecionado.
    continent_names       = serializers.SerializerMethodField()
    countries_data        = serializers.SerializerMethodField()
    # Aditivos (o frontend ignora campos extras) — úteis para novas colunas na listagem.
    itinerary_type_name   = serializers.CharField(source='itinerary_type.name', read_only=True, default=None)
    maritime_company_name = serializers.CharField(source='maritime_company.name', read_only=True, default=None)
    cover                 = serializers.SerializerMethodField()   # miniatura da capa
    custo_real_done       = serializers.SerializerMethodField()   # financeiro (custo real) concluído
    # Nome/datas da FOTO publicada — pro seletor de roteiros do contrato mostrar o
    # que a agência realmente vê (alterações não publicadas não aparecem).
    pub_name       = serializers.SerializerMethodField()
    pub_start_date = serializers.SerializerMethodField()
    pub_end_date   = serializers.SerializerMethodField()

    class Meta:
        model  = Itinerary
        fields = ['id', 'name', 'slug', 'start_date', 'end_date', 'trip_type', 'base_currency', 'capacity',
                  'badge_text', 'badge_color',
                  'category_name', 'continent_name', 'continent_names', 'countries_data',
                  'itinerary_type_name', 'maritime_company_name', 'cover', 'custo_real_done',
                  'status', 'is_published', 'has_unpublished_changes', 'order', 'is_own_product', 'pinned_position',
                  'visibility', 'shared_agencies_count', 'shared_agencies_data',
                  'pub_name', 'pub_start_date', 'pub_end_date',
                  'created_at', 'updated_at',
                  'is_deleted', 'deleted_at']

    shared_agencies_count = serializers.SerializerMethodField()
    shared_agencies_data  = serializers.SerializerMethodField()

    def _country_continent_pairs(self, obj):
        """(país, continente) de todos os países do roteiro — via M2M `countries` e
        via cidades visitadas (cities→state→country). Usa os prefetches (sem N+1)."""
        seen = {}
        def add(co):
            if co and co.name and co.name not in seen:
                seen[co.name] = co.continent.name if getattr(co, 'continent', None) else None
        for co in obj.countries.all():
            add(co)
        for city in obj.cities.all():
            st = getattr(city, 'state', None)
            add(getattr(st, 'country', None) if st else None)
        return seen

    def get_continent_names(self, obj):
        names = set()
        for c in obj.continents.all():
            if c and c.name:
                names.add(c.name)
        if obj.continent and obj.continent.name:
            names.add(obj.continent.name)
        for cont in self._country_continent_pairs(obj).values():
            if cont:
                names.add(cont)
        return sorted(names)

    def get_countries_data(self, obj):
        return [{'name': n, 'continent': c} for n, c in sorted(self._country_continent_pairs(obj).items())]

    def get_shared_agencies_count(self, obj):
        return len(obj.shared_agencies.all())   # usa o prefetch (sem query extra)

    def get_shared_agencies_data(self, obj):
        return [{'id': a.id, 'name': a.name or a.company_name or f'Agência #{a.id}'}
                for a in obj.shared_agencies.all()]

    def _pub(self, obj, key):
        d = obj.published_data if (obj.is_published and obj.published_data) else None
        return d.get(key) if isinstance(d, dict) else None
    def get_pub_name(self, obj):       return self._pub(obj, 'name') or obj.name
    def get_pub_start_date(self, obj): return self._pub(obj, 'start_date') or obj.start_date
    def get_pub_end_date(self, obj):   return self._pub(obj, 'end_date') or obj.end_date

    def get_custo_real_done(self, obj):
        cfg = getattr(obj, 'pricing', None)
        return bool(cfg.custo_real_done) if cfg else False

    def get_cover(self, obj):
        # Capa: imagem kind='cover'; senão a 1ª imagem da galeria (day nulo). NUNCA um
        # vídeo — a URL de vídeo num <img> vira ícone de imagem quebrada; sem imagem
        # real, retorna None e o front mostra o placeholder padrão.
        imgs = list(obj.images.all())
        cover = next((i for i in imgs if i.kind == 'cover' and not i.is_video), None) \
            or next((i for i in imgs if i.day_id is None and not i.is_video), None)
        if not cover or not cover.image:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(cover.image.url) if request else cover.image.url


# ═══════ Precificação (aba Valores) ═══════
class ItineraryPricingConfigSerializer(serializers.ModelSerializer):
    # Padrão global (config_api.ReservationSettings) para o pop-up pré-preencher os
    # percentuais de reserva quando o roteiro ainda não tem override (campo null).
    reservation_defaults = serializers.SerializerMethodField()

    class Meta:
        model = ItineraryPricingConfig
        fields = ['base_pax', 'min_pax', 'max_pax', 'free_pax', 'free_mode',
                  'rounding_mode', 'rounding_value', 'margin_mode', 'margin_percent',
                  'final_fee_percent', 'min_margin_percent', 'notes', 'price_overrides',
                  'contract_accommodations',
                  'reserva_online_percent', 'pagamento_imediato_percent', 'reserva_operadora_percent',
                  'reservation_deadline_hours', 'reservation_defaults']

    def get_reservation_defaults(self, obj):
        from config_api.models import ReservationSettings
        s = ReservationSettings.get()
        return {
            'reserva_online_percent':     s.reserva_online_percent,
            'pagamento_imediato_percent': s.pagamento_imediato_percent,
            'reserva_operadora_percent':  s.reserva_operadora_percent,
            'reservation_deadline_hours': s.deadline_hours,
        }


class ItineraryCurrencyRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItineraryCurrencyRate
        fields = ['id', 'itinerary', 'currency', 'rate', 'rate_date', 'source', 'locked', 'notes']


class ItineraryCostItemSerializer(serializers.ModelSerializer):
    accommodation_type_name = serializers.CharField(source='accommodation_type.name', read_only=True, default=None)
    ship_cabin_name = serializers.CharField(source='ship_cabin.name', read_only=True, default=None)
    ship_cabin_category = serializers.CharField(source='ship_cabin.category', read_only=True, default=None)
    ship_cabin_capacity = serializers.IntegerField(source='ship_cabin.capacity', read_only=True, default=None)
    flight_segment_name = serializers.CharField(source='flight_segment.name', read_only=True, default=None)
    flight_class_name = serializers.CharField(source='flight_class.name', read_only=True, default=None)

    class Meta:
        model = ItineraryCostItem
        fields = ['id', 'itinerary', 'description', 'category', 'supplier', 'cost_type',
                  'currency', 'unit_value', 'exchange_rate', 'quantity', 'basis', 'occupancy', 'nights',
                  'rateio_rule', 'rateio_qty', 'flight_departure', 'terrestre_departure',
                  'accommodation_type', 'accommodation_type_name', 'accommodation_capacity',
                  'is_fee', 'fee_capacities',
                  'ship_cabin', 'ship_cabin_name', 'ship_cabin_category', 'ship_cabin_capacity',
                  'flight_segment', 'flight_segment_name', 'flight_class', 'flight_class_name',
                  'tax_kind', 'tax_value',
                  'payment_method', 'due_date', 'payment_schedule',
                  'included_in_price', 'is_active', 'order', 'notes']

    def validate_payment_schedule(self, value):
        """Cronograma = lista de {due_date (YYYY-MM-DD | vazio), percent (0..100), note}.
        Ignora qualquer outra chave; falha em valor fora do intervalo/mal-formado."""
        if value in (None, ''):
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError('Cronograma inválido.')
        out = []
        for row in value:
            if not isinstance(row, dict):
                raise serializers.ValidationError('Item do cronograma inválido.')
            try:
                pct = float(row.get('percent') or 0)
            except (TypeError, ValueError):
                raise serializers.ValidationError('Percentual inválido no cronograma.')
            if pct < 0 or pct > 100:
                raise serializers.ValidationError('Percentual do cronograma deve estar entre 0 e 100.')
            due = row.get('due_date') or ''
            if due and not re.match(r'^\d{4}-\d{2}-\d{2}$', str(due)):
                raise serializers.ValidationError('Data do cronograma deve ser YYYY-MM-DD.')
            out.append({'due_date': str(due), 'percent': round(pct, 2), 'note': str(row.get('note') or '')[:200]})
        return out


class ItineraryInventoryBlockSerializer(serializers.ModelSerializer):
    """Bloqueio / disponibilidade (aba Valores › Disponibilidade)."""
    accommodations_data = serializers.SerializerMethodField()
    ship_cabin_name = serializers.CharField(source='ship_cabin.name', read_only=True, default=None)
    ship_cabin_category = serializers.CharField(source='ship_cabin.category', read_only=True, default=None)
    ship_cabin_capacity = serializers.IntegerField(source='ship_cabin.capacity', read_only=True, default=None)
    airline_name = serializers.CharField(source='airline.name', read_only=True, default=None)
    flight_class_name = serializers.CharField(source='flight_class.name', read_only=True, default=None)
    terrestre_company_name = serializers.CharField(source='terrestre_company.name', read_only=True, default=None)

    class Meta:
        model = ItineraryInventoryBlock
        fields = ['id', 'itinerary', 'kind', 'quantity',
                  'terrestre_company', 'terrestre_company_name',
                  'accommodations', 'accommodations_data',
                  'ship_cabin', 'ship_cabin_name', 'ship_cabin_category', 'ship_cabin_capacity',
                  'airline', 'airline_name', 'flight_class', 'flight_class_name',
                  'notes', 'order', 'is_active']

    def get_accommodations_data(self, obj):
        return [{'id': a.id, 'name': a.name, 'capacity': a.capacity} for a in obj.accommodations.all()]


class ItineraryCostPaymentSerializer(serializers.ModelSerializer):
    """Pagamento real de um item de custo (aba Valores › Custo real)."""
    class Meta:
        model = ItineraryCostPayment
        fields = ['id', 'cost_item', 'installment_index', 'paid_on', 'amount', 'currency', 'exchange_rate',
                  'tax_kind', 'tax_value', 'note', 'order']
