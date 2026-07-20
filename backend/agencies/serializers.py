from rest_framework import serializers
from .models import Agency


class AgencySerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    logo_original_url = serializers.SerializerMethodField()

    class Meta:
        model  = Agency
        # Lista explícita (A-13) — sem '__all__'. Campos de auditoria/soft-delete
        # são só-leitura (o backend os gerencia); os demais são editáveis pela tela.
        fields = [
            'id', 'agency_type', 'person_type', 'status', 'cnpj', 'cpf',
            'company_name', 'name', 'last_name', 'state_registration',
            'municipal_registration', 'responsible', 'phone', 'mobile', 'email',
            'website', 'commission_rate', 'cep', 'street', 'number', 'complement',
            'neighborhood', 'city', 'state', 'country', 'receives_mail',
            'pix_key_type', 'pix_key', 'use_agency_pix', 'notes', 'logo_url',
            'logo_original_url', 'logo_crop',
            'created_by', 'created_at', 'updated_at', 'is_deleted', 'deleted_at',
        ]
        read_only_fields = ['created_by', 'created_at', 'updated_at', 'is_deleted', 'deleted_at', 'logo_crop']

    def to_internal_value(self, data):
        # O site pode ser informado só com o domínio (ex.: "exemplo.com.br").
        # O URLField exige esquema, então prefixamos https:// quando faltar,
        # evitando o falso "URL inválida" para quem não digita http/https.
        site = data.get('website') if hasattr(data, 'get') else None
        if isinstance(site, str):
            s = site.strip()
            if s and '://' not in s:
                data = data.copy()
                data['website'] = 'https://' + s
        return super().to_internal_value(data)

    def get_logo_url(self, obj):
        return obj.logo.url if obj.logo else None

    def get_logo_original_url(self, obj):
        return obj.logo_original.url if obj.logo_original else None


class AgencyListSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()

    class Meta:
        model  = Agency
        fields = ['id', 'name', 'last_name', 'company_name', 'email', 'cnpj', 'cpf', 'person_type',
                  'phone', 'mobile', 'city', 'status', 'commission_rate', 'logo_url', 'is_deleted', 'deleted_at']

    def get_logo_url(self, obj):
        return obj.logo.url if obj.logo else None
