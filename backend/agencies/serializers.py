from rest_framework import serializers
from .models import Agency


class AgencySerializer(serializers.ModelSerializer):
    class Meta:
        model  = Agency
        fields = '__all__'


class AgencyListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Agency
        fields = ['id', 'name', 'company_name', 'email', 'cnpj', 'phone', 'mobile',
                  'city', 'status', 'commission_rate']
