from rest_framework import serializers
from .models import Destination, Trip, Enrollment


class DestinationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Destination
        fields = '__all__'


class TripListSerializer(serializers.ModelSerializer):
    destination_name = serializers.CharField(source='destination.name', read_only=True)
    destination_country = serializers.CharField(source='destination.country', read_only=True)
    enrolled_count = serializers.IntegerField(read_only=True)
    available_spots = serializers.IntegerField(read_only=True)

    class Meta:
        model = Trip
        fields = [
            'id', 'title', 'destination_name', 'destination_country',
            'departure_date', 'return_date', 'max_passengers',
            'price_per_person', 'status', 'enrolled_count', 'available_spots',
        ]


class TripSerializer(serializers.ModelSerializer):
    destination = DestinationSerializer(read_only=True)
    destination_id = serializers.PrimaryKeyRelatedField(
        queryset=Destination.objects.all(), source='destination', write_only=True
    )
    enrolled_count = serializers.IntegerField(read_only=True)
    available_spots = serializers.IntegerField(read_only=True)

    class Meta:
        model = Trip
        fields = '__all__'


class EnrollmentSerializer(serializers.ModelSerializer):
    passenger_name = serializers.CharField(source='passenger.full_name', read_only=True)
    trip_title = serializers.CharField(source='trip.title', read_only=True)

    class Meta:
        model = Enrollment
        fields = '__all__'
