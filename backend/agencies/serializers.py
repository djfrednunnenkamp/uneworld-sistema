from rest_framework import serializers
from .models import Agency


class AgencySerializer(serializers.ModelSerializer):
    class Meta:
        model  = Agency
        fields = '__all__'


class AgencyListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Agency
        fields = ['id', 'name', 'last_name', 'company_name', 'email', 'cnpj', 'cpf', 'person_type',
                  'phone', 'mobile', 'city', 'status', 'commission_rate', 'is_deleted', 'deleted_at']
