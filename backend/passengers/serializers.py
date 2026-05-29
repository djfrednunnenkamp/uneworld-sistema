from rest_framework import serializers
from .models import Passenger


class PassengerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Passenger
        fields = '__all__'


class PassengerListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Passenger
        fields = ['id', 'full_name', 'email', 'phone', 'city', 'state', 'status', 'photo']
