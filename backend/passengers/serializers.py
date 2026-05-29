from rest_framework import serializers
from agencies.models import Agency
from .models import Passenger


class PassengerListSerializer(serializers.ModelSerializer):
    agency_names = serializers.SerializerMethodField()

    class Meta:
        model  = Passenger
        fields = ['id', 'first_name', 'last_name', 'full_name', 'email',
                  'mobile', 'phone1', 'cpf', 'city', 'state', 'status', 'agency_names']

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
