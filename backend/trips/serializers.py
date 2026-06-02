from rest_framework import serializers
from .models import Destination, Trip, Enrollment, Supplier, ListAdditional, PassengerList, ListEnrollment


class DestinationSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Destination
        fields = '__all__'


class TripListSerializer(serializers.ModelSerializer):
    destination_name    = serializers.CharField(source='destination.name', read_only=True)
    destination_country = serializers.CharField(source='destination.country', read_only=True)
    enrolled_count      = serializers.IntegerField(read_only=True)

    class Meta:
        model  = Trip
        fields = ['id', 'title', 'destination_name', 'destination_country',
                  'departure_date', 'return_date', 'max_passengers',
                  'price_per_person', 'status', 'enrolled_count']


class TripSerializer(serializers.ModelSerializer):
    destination    = DestinationSerializer(read_only=True)
    destination_id = serializers.PrimaryKeyRelatedField(
        queryset=Destination.objects.all(), source='destination', write_only=True)
    enrolled_count = serializers.IntegerField(read_only=True)

    class Meta:
        model  = Trip
        fields = '__all__'


class EnrollmentSerializer(serializers.ModelSerializer):
    passenger_name = serializers.CharField(source='passenger.full_name', read_only=True)
    trip_title     = serializers.CharField(source='trip.title', read_only=True)

    class Meta:
        model  = Enrollment
        fields = '__all__'


# ── Lista de Passageiros ─────────────────────────────────────────────────────

class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Supplier
        fields = ['id', 'name']


class ListAdditionalSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ListAdditional
        fields = ['id', 'name']


class PassengerListSerializer(serializers.ModelSerializer):
    suppliers_data   = SupplierSerializer(source='suppliers',   many=True, read_only=True)
    additionals_data = ListAdditionalSerializer(source='additionals', many=True, read_only=True)
    suppliers        = serializers.PrimaryKeyRelatedField(queryset=Supplier.objects.all(), many=True, required=False)
    additionals      = serializers.PrimaryKeyRelatedField(queryset=ListAdditional.objects.all(), many=True, required=False)
    enrolled_count   = serializers.IntegerField(read_only=True)
    start_date_br    = serializers.SerializerMethodField()
    end_date_br      = serializers.SerializerMethodField()

    class Meta:
        model  = PassengerList
        fields = [
            'id', 'name', 'list_type', 'category', 'block_capacity',
            'total_accommodations', 'start_date', 'end_date',
            'start_date_br', 'end_date_br',
            'suppliers', 'suppliers_data',
            'additionals', 'additionals_data',
            'required_document', 'status', 'notes',
            'enrolled_count', 'created_at', 'updated_at',
        ]

    def get_start_date_br(self, obj):
        if not obj.start_date: return ''
        return obj.start_date.strftime('%d/%m/%Y')

    def get_end_date_br(self, obj):
        if not obj.end_date: return ''
        return obj.end_date.strftime('%d/%m/%Y')


class ListEnrollmentSerializer(serializers.ModelSerializer):
    passenger_name = serializers.CharField(source='passenger.full_name', read_only=True)
    passenger_cpf  = serializers.CharField(source='passenger.cpf', read_only=True)
    passenger_email= serializers.CharField(source='passenger.email', read_only=True)
    passenger_phone= serializers.CharField(source='passenger.phone1', read_only=True)

    class Meta:
        model  = ListEnrollment
        fields = ['id', 'passenger', 'passenger_name', 'passenger_cpf',
                  'passenger_email', 'passenger_phone', 'enrolled_at', 'notes']
        read_only_fields = ['enrolled_at']
