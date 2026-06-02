from rest_framework import serializers
from agencies.models import Agency
from .models import Passenger, PassengerDocument
from .validators import validate_document_file


class PassengerListSerializer(serializers.ModelSerializer):
    agency_names = serializers.SerializerMethodField()

    class Meta:
        model  = Passenger
        fields = ['id', 'first_name', 'last_name', 'full_name', 'email',
                  'mobile', 'phone1', 'cpf', 'birth_date', 'diet_type',
                  'is_foreign', 'nationality', 'gender',
                  'city', 'state', 'status', 'agency_names']

    def get_agency_names(self, obj):
        return ', '.join(obj.agencies.values_list('name', flat=True))


class PassengerSerializer(serializers.ModelSerializer):
    agencies = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Agency.objects.all(), required=False
    )
    agency_names = serializers.SerializerMethodField()

    class Meta:
        model  = Passenger
        fields = '__all__'

    def get_agency_names(self, obj):
        return [{'id': a.id, 'name': a.name} for a in obj.agencies.all()]

    def create(self, validated_data):
        agencies = validated_data.pop('agencies', [])
        passenger = super().create(validated_data)
        passenger.agencies.set(agencies)
        return passenger

    def update(self, instance, validated_data):
        agencies = validated_data.pop('agencies', None)
        passenger = super().update(instance, validated_data)
        if agencies is not None:
            passenger.agencies.set(agencies)
        return passenger


class PassengerDocumentSerializer(serializers.ModelSerializer):
    download_url  = serializers.SerializerMethodField()
    preview_url   = serializers.SerializerMethodField()
    doc_type_label = serializers.SerializerMethodField()
    display_name   = serializers.SerializerMethodField()

    class Meta:
        model  = PassengerDocument
        fields = [
            'id', 'doc_type', 'doc_type_label', 'label', 'display_name',
            'doc_number', 'doc_model', 'doc_category',
            'issued_date', 'expiry_date', 'issued_by',
            'file',
            'original_name', 'file_size', 'mime_type', 'notes',
            'uploaded_at', 'download_url', 'preview_url',
        ]
        read_only_fields = ['original_name', 'file_size', 'mime_type', 'uploaded_at']
        extra_kwargs = {'file': {'write_only': True}}  # não expõe o caminho do arquivo na API

    # Mapa de fallback para tipos hardcoded (caso CustomDocType ainda não esteja populado)
    _LABEL_FALLBACK = {
        'passport':   'Passaporte',
        'rg':         'Carteira de Identidade (RG)',
        'cnh':        'Carteira de Motorista (CNH)',
        'visa':       'Visto',
        'birth_cert': 'Certidão de Nascimento',
        'residence':  'Comprovante de Residência',
        'vaccine':    'Vacina',
        'other':      'Outro documento',
    }

    def get_doc_type_label(self, obj):
        from config_api.models import CustomDocType
        try:
            return CustomDocType.objects.get(key=obj.doc_type).label
        except Exception:
            return self._LABEL_FALLBACK.get(obj.doc_type, obj.doc_type)

    def get_download_url(self, obj):
        return f"/api/passengers/documents/{obj.id}/download/"

    def get_preview_url(self, obj):
        if obj.mime_type and obj.mime_type.startswith('image/'):
            return f"/api/passengers/documents/{obj.id}/preview/"
        return None

    def get_display_name(self, obj):
        if obj.label:
            return obj.label
        # Carteira profissional: mostra "OAB — Nº 12345" em vez do tipo genérico
        if obj.doc_type == 'prof_card' and obj.doc_number:
            return f"{obj.doc_number} — {obj.issued_by}" if obj.issued_by else obj.doc_number
        base = self.get_doc_type_label(obj)
        if obj.issued_by:
            return f"{base} — {obj.issued_by}"
        return base

    def validate(self, attrs):
        request = self.context.get('request')
        if request and request.FILES.get('file'):
            f = request.FILES['file']
            validate_document_file(f)
            attrs['original_name'] = f.name
            attrs['file_size']     = f.size
            attrs['mime_type']     = f.content_type or ''
        return attrs
