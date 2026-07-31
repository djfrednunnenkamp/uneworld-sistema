from rest_framework import serializers
from .models import Agency


class AgencySerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    logo_original_url = serializers.SerializerMethodField()
    display_name = serializers.ReadOnlyField()
    # Só informa SE o token está configurado — o segredo nunca volta pro front (nem
    # pra operadora). O token é gravado só pelo endpoint autentique-config (agência).
    has_autentique_token = serializers.SerializerMethodField()
    promoter_name = serializers.SerializerMethodField()

    def get_has_autentique_token(self, obj):
        return bool((obj.autentique_token or '').strip())

    def get_promoter_name(self, obj):
        u = obj.promoter
        if not u:
            return None
        return f'{u.first_name} {u.last_name}'.strip() or u.username

    class Meta:
        model  = Agency
        # Lista explícita (A-13) — sem '__all__'. Campos de auditoria/soft-delete
        # são só-leitura (o backend os gerencia); os demais são editáveis pela tela.
        fields = [
            'id', 'agency_type', 'person_type', 'status', 'cnpj', 'cpf', 'display_name',
            'company_name', 'name', 'last_name', 'state_registration',
            'municipal_registration', 'responsible', 'phone', 'mobile', 'email',
            'website', 'commission_rate', 'cep', 'street', 'number', 'complement',
            'neighborhood', 'city', 'state', 'country', 'receives_mail',
            'pix_key_type', 'pix_key', 'use_agency_pix',
            'auto_sign_allowed', 'auto_sign', 'autentique_email', 'has_autentique_token',
            'promoter', 'promoter_name',
            'notes', 'logo_url',
            'logo_original_url', 'logo_crop',
            'created_by', 'created_at', 'updated_at', 'is_deleted', 'deleted_at',
        ]
        # auto_sign/e-mail/token são geridos SÓ pelo endpoint autentique-config (admin
        # da agência) — read-only aqui pra a operadora não os alterar pelo form normal.
        # Só auto_sign_allowed (permissão) é editável pela operadora (agencies_edit).
        read_only_fields = ['created_by', 'created_at', 'updated_at', 'is_deleted', 'deleted_at', 'logo_crop',
                            'auto_sign', 'autentique_email']

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
        if not obj.logo:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(obj.logo.url) if request else obj.logo.url

    def get_logo_original_url(self, obj):
        if not obj.logo_original:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(obj.logo_original.url) if request else obj.logo_original.url


class AgencyListSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    # Nome de exibição pronto (nunca vazio) — usado em pickers/listas.
    display_name = serializers.ReadOnlyField()
    promoter_name = serializers.SerializerMethodField()

    class Meta:
        model  = Agency
        fields = ['id', 'name', 'last_name', 'company_name', 'display_name', 'email', 'cnpj', 'cpf', 'person_type',
                  'phone', 'mobile', 'city', 'status', 'commission_rate', 'logo_url',
                  'promoter', 'promoter_name', 'is_deleted', 'deleted_at']

    def get_logo_url(self, obj):
        if not obj.logo:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(obj.logo.url) if request else obj.logo.url

    def get_promoter_name(self, obj):
        u = obj.promoter
        if not u:
            return None
        return f'{u.first_name} {u.last_name}'.strip() or u.username
