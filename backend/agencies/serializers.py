from rest_framework import serializers
from .models import Agency


class AgencySerializer(serializers.ModelSerializer):
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
            'pix_key_type', 'pix_key', 'use_uneworld_pix', 'notes',
            'created_by', 'created_at', 'updated_at', 'is_deleted', 'deleted_at',
        ]
        read_only_fields = ['created_by', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']


class AgencyListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Agency
        fields = ['id', 'name', 'last_name', 'company_name', 'email', 'cnpj', 'cpf', 'person_type',
                  'phone', 'mobile', 'city', 'status', 'commission_rate', 'is_deleted', 'deleted_at']
