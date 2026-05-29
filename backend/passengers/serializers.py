from rest_framework import serializers
from .models import Passenger


class PassengerListSerializer(serializers.ModelSerializer):
    agency_name = serializers.CharField(source='agency.name', read_only=True, default='')

    class Meta:
        model  = Passenger
        fields = ['id', 'first_name', 'last_name', 'full_name', 'email', 'mobile', 'phone1', 'cpf', 'city', 'state', 'status', 'agency_name']


class PassengerSerializer(serializers.ModelSerializer):
    agency_name = serializers.CharField(source='agency.name', read_only=True, default='')

    class Meta:
        model  = Passenger
        fields = '__all__'
