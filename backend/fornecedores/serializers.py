from rest_framework import serializers

from .models import Fornecedor
from .normalize import (
    only_digits, validate_cpf, validate_cnpj, normalize_status,
    normalize_category, normalize_airline_abbr, clean_text,
)


class FornecedorSerializer(serializers.ModelSerializer):
    """CRUD de fornecedor. Campos listados explicitamente (regra do projeto).
    CPF/CNPJ validados só quando preenchidos e guardados só com dígitos."""
    # Declarados como texto livre para as normalizações (validate_*) rodarem
    # ANTES da validação de choice/tamanho do DRF: aceitamos 'Ativo',
    # 'Cia. Aérea', CPF/CNPJ formatados etc. e normalizamos aqui.
    status       = serializers.CharField(required=False, allow_blank=True, max_length=20)
    category     = serializers.CharField(required=False, allow_blank=True, max_length=60)
    airline_abbr = serializers.CharField(required=False, allow_blank=True, max_length=10)
    cpf          = serializers.CharField(required=False, allow_blank=True, max_length=20)
    cnpj         = serializers.CharField(required=False, allow_blank=True, max_length=20)

    category_label   = serializers.ReadOnlyField()
    cpf_display      = serializers.ReadOnlyField()
    cnpj_display     = serializers.ReadOnlyField()
    document_display = serializers.ReadOnlyField()
    created_by_name  = serializers.SerializerMethodField()

    class Meta:
        model = Fornecedor
        fields = [
            'id', 'name', 'status', 'category', 'category_label', 'person_type',
            'airline_abbr', 'city', 'country', 'cpf', 'cnpj', 'cpf_display', 'cnpj_display',
            'document_display', 'company_name', 'supplier_network',
            'notes', 'created_by', 'created_by_name', 'created_at', 'updated_at',
            'is_deleted', 'deleted_at',
        ]
        read_only_fields = ['created_by', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def get_created_by_name(self, obj):
        u = obj.created_by
        if not u:
            return ''
        return (u.get_full_name() or u.get_username() or '').strip()

    # ── Normalizações de campo ────────────────────────────────────────────────
    def validate_name(self, v):
        v = clean_text(v)
        if not v:
            raise serializers.ValidationError('O nome é obrigatório.')
        return v

    def validate_status(self, v):
        return normalize_status(v)

    def validate_category(self, v):
        key, _matched = normalize_category(v)
        return key

    def validate_airline_abbr(self, v):
        return normalize_airline_abbr(v)

    def validate_city(self, v):
        return clean_text(v)

    def validate_country(self, v):
        return clean_text(v)

    def validate_company_name(self, v):
        return clean_text(v)

    def validate_supplier_network(self, v):
        return clean_text(v)

    def validate_cpf(self, v):
        d = only_digits(v)
        if d and not validate_cpf(d):
            raise serializers.ValidationError('CPF inválido.')
        return d

    def validate_cnpj(self, v):
        d = only_digits(v)
        if d and not validate_cnpj(d):
            raise serializers.ValidationError('CNPJ inválido.')
        return d


class FornecedorListSerializer(serializers.ModelSerializer):
    """Versão leve para a listagem (mesma ideia da AgencyListSerializer)."""
    category_label   = serializers.ReadOnlyField()
    cpf_display      = serializers.ReadOnlyField()
    cnpj_display     = serializers.ReadOnlyField()
    document_display = serializers.ReadOnlyField()

    class Meta:
        model = Fornecedor
        fields = [
            'id', 'name', 'status', 'category', 'category_label', 'airline_abbr',
            'city', 'country', 'cpf', 'cnpj', 'cpf_display', 'cnpj_display',
            'document_display', 'company_name', 'supplier_network',
            'is_deleted', 'deleted_at',
        ]
