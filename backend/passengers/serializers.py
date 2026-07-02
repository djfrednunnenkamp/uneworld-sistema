from rest_framework import serializers
from agencies.models import Agency
from users_api.permissions import has_any_perm
from .models import Passenger, PassengerDocument
from .validators import validate_document_file


# Campos sensíveis (documentos, contato, endereço, data de nascimento) — só
# aparecem para usuários com a permissão `passengers_view_full`.
SENSITIVE_FIELDS = {
    'cpf', 'rg', 'rg_issue_date', 'rg_issuer',
    'passport', 'passport_country', 'passport_issue', 'passport_expiry',
    'passport2', 'passport2_country',
    'rne', 'rne_expiry', 'rne_issue',
    'birth_date', 'birth_place',
    'email', 'email_emergency1', 'email_emergency2',
    'phone1', 'phone2', 'mobile',
    'cep', 'street', 'number', 'complement', 'neighborhood',
}


class SensitiveFieldsMixin:
    """Remove SENSITIVE_FIELDS da representação para quem não tem passengers_view_full."""

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not has_any_perm(user, 'passengers_view_full'):
            for field in SENSITIVE_FIELDS:
                data.pop(field, None)
        return data


class PassengerListSerializer(SensitiveFieldsMixin, serializers.ModelSerializer):
    agency_names = serializers.SerializerMethodField()

    class Meta:
        model  = Passenger
        fields = ['id', 'first_name', 'last_name', 'full_name', 'email',
                  'mobile', 'phone1', 'cpf', 'birth_date', 'diet_type',
                  'is_foreign', 'nationality', 'gender', 'is_verified',
                  'city', 'state', 'status', 'agency_names',
                  'is_deleted', 'deleted_at']

    def get_agency_names(self, obj):
        names = []
        for a in obj.agencies.all():
            if a.person_type == 'fisica':
                names.append(a.company_name or f'{a.name} {a.last_name}'.strip() or str(a))
            else:
                names.append(a.name or a.company_name or str(a))
        return ', '.join(filter(None, names))


class PassengerSerializer(SensitiveFieldsMixin, serializers.ModelSerializer):
    agencies = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Agency.objects.all(), required=False
    )
    agency_names = serializers.SerializerMethodField()
    # E-mail opcional (rascunho pode não ter). Guardamos '' como None para não
    # colidir no unique (vários NULL são permitidos; vários '' não seriam).
    email = serializers.EmailField(required=False, allow_blank=True, allow_null=True)

    class Meta:
        model  = Passenger
        # Lista explícita (A-13) — sem '__all__'. Auditoria/soft-delete só-leitura.
        fields = [
            'id', 'first_name', 'last_name', 'full_name', 'email',
            'email_emergency1', 'email_emergency2', 'native_language',
            'other_languages', 'birth_date', 'birth_place', 'nationality',
            'other_nationalities', 'gender', 'profession', 'is_foreign',
            'is_verified', 'is_guide', 'cpf', 'rg', 'rg_issue_date', 'rg_issuer',
            'passport', 'passport_country', 'passport_issue', 'passport_expiry',
            'passport2', 'passport2_country', 'rne', 'rne_expiry', 'rne_issue',
            'phone1', 'phone2', 'mobile', 'flight_class', 'seat_preference',
            'seat_position', 'diet_type', 'diet_notes', 'receives_mail', 'cep',
            'street', 'number', 'complement', 'neighborhood', 'city', 'state',
            'country', 'status', 'notes', 'photo', 'agencies', 'agency_names',
            'created_by', 'created_at', 'updated_at', 'is_deleted', 'deleted_at',
        ]
        read_only_fields = ['created_by', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def validate_email(self, value):
        return value or None

    def get_agency_names(self, obj):
        def _name(a):
            if a.person_type == 'fisica':
                return a.company_name or f'{a.name} {a.last_name}'.strip() or str(a)
            return a.name or a.company_name or str(a)
        return [{'id': a.id, 'name': _name(a)} for a in obj.agencies.all()]

    def create(self, validated_data):
        agencies = validated_data.pop('agencies', [])
        passenger = super().create(validated_data)
        passenger.agencies.set(agencies)
        # Usuário de agência: garante que o passageiro criado fique ligado à(s)
        # agência(s) dele — senão ele não conseguiria nem ver o que acabou de criar.
        from users_api.permissions import agency_scope_ids
        req = self.context.get('request')
        scope = agency_scope_ids(getattr(req, 'user', None) if req else None)
        if scope:
            from agencies.models import Agency
            passenger.agencies.add(*Agency.objects.filter(id__in=scope))
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
