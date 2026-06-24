from rest_framework import serializers

from agencies.models import Agency
from config_api.models import ConfigAccommodation, ContractClause
from passengers.models import Passenger
from trips.models import PassengerList

from .models import Contract, ContractAccommodationLine, ContractGuest, ContractInstallment


def _passenger_brief(p):
    return {
        'id': p.id, 'full_name': p.full_name, 'gender': p.gender,
        'birth_date': p.birth_date, 'passport': p.passport, 'cpf': p.cpf,
        'mobile': p.mobile, 'email': p.email,
    }


def _agency_brief(a):
    name = a.company_name if a.person_type == 'fisica' and a.company_name else (a.name or a.company_name)
    return {
        'id': a.id, 'name': name or str(a), 'cnpj': a.cnpj, 'phone': a.phone,
        'mobile': a.mobile, 'email': a.email, 'responsible': a.responsible,
        'address': ', '.join(filter(None, [a.street, a.number, a.neighborhood, a.city, a.state])),
    }


class ContractAccommodationLineSerializer(serializers.ModelSerializer):
    accommodation_type_name = serializers.CharField(source='accommodation_type.name', read_only=True)
    total_usd = serializers.SerializerMethodField()

    class Meta:
        model  = ContractAccommodationLine
        fields = ['id', 'accommodation_type', 'accommodation_type_name',
                  'value_per_person_usd', 'taxes_usd', 'quantity', 'order', 'total_usd']

    def get_total_usd(self, obj):
        return (obj.value_per_person_usd + obj.taxes_usd) * obj.quantity


class ContractGuestSerializer(serializers.ModelSerializer):
    passenger_data = serializers.SerializerMethodField()
    accommodation_type_name = serializers.SerializerMethodField()

    class Meta:
        model  = ContractGuest
        fields = ['id', 'passenger', 'passenger_data', 'accommodation_type', 'accommodation_type_name', 'order']

    def get_passenger_data(self, obj):
        return _passenger_brief(obj.passenger)

    def get_accommodation_type_name(self, obj):
        return obj.accommodation_type.name if obj.accommodation_type_id else None


class ContractInstallmentSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ContractInstallment
        fields = ['id', 'kind', 'installment_number', 'detail', 'due_date', 'value_brl', 'order']


class ContractListSerializer(serializers.ModelSerializer):
    agency_name      = serializers.SerializerMethodField()
    contratante_name = serializers.CharField(source='contratante.full_name', read_only=True)

    class Meta:
        model  = Contract
        fields = ['id', 'reservation_number', 'contract_date', 'agency', 'agency_name',
                  'contratante', 'contratante_name', 'package_name', 'departure_date',
                  'total_brl', 'status', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def get_agency_name(self, obj):
        return _agency_brief(obj.agency)['name'] if obj.agency_id else ''


class ContractSerializer(serializers.ModelSerializer):
    accommodation_lines = ContractAccommodationLineSerializer(many=True, required=False)
    guests              = ContractGuestSerializer(many=True, required=False)
    installments        = ContractInstallmentSerializer(many=True, required=False)
    clauses             = serializers.PrimaryKeyRelatedField(many=True, queryset=ContractClause.objects.all(), required=False)

    agency_data      = serializers.SerializerMethodField()
    contratante_data = serializers.SerializerMethodField()
    passenger_list_data = serializers.SerializerMethodField()
    clauses_data        = serializers.SerializerMethodField()

    class Meta:
        model  = Contract
        fields = ['id', 'reservation_number', 'contract_date', 'agency', 'agency_data',
                  'passenger_list', 'passenger_list_data', 'contratante', 'contratante_data',
                  'package_name', 'departure_date', 'departure_airport', 'observations',
                  'total_usd', 'total_brl', 'exchange_rate', 'payment_method',
                  'received_down_payment_brl', 'received_installments_brl',
                  'accommodation_lines', 'guests', 'installments', 'clauses', 'clauses_data',
                  'status', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def get_agency_data(self, obj):
        return _agency_brief(obj.agency) if obj.agency_id else None

    def get_clauses_data(self, obj):
        return [{'id': c.id, 'name': c.name, 'content': c.content} for c in obj.clauses.all()]

    def get_contratante_data(self, obj):
        return _passenger_brief(obj.contratante) if obj.contratante_id else None

    def get_passenger_list_data(self, obj):
        if not obj.passenger_list_id:
            return None
        pl = obj.passenger_list
        return {'id': pl.id, 'name': pl.name, 'start_date': pl.start_date,
                'airport_name': pl.default_airport.name if pl.default_airport_id else ''}

    def _save_children(self, contract, accommodation_lines, guests, installments, clauses):
        if accommodation_lines is not None:
            contract.accommodation_lines.all().delete()
            ContractAccommodationLine.objects.bulk_create([
                ContractAccommodationLine(contract=contract, order=i, **row)
                for i, row in enumerate(accommodation_lines)
            ])
        if guests is not None:
            contract.guests.all().delete()
            ContractGuest.objects.bulk_create([
                ContractGuest(contract=contract, order=i, **row)
                for i, row in enumerate(guests)
            ])
        if installments is not None:
            contract.installments.all().delete()
            ContractInstallment.objects.bulk_create([
                ContractInstallment(contract=contract, order=i, **row)
                for i, row in enumerate(installments)
            ])
        if clauses is not None:
            contract.clauses.set(clauses)

    def create(self, validated_data):
        accommodation_lines = validated_data.pop('accommodation_lines', [])
        guests              = validated_data.pop('guests', [])
        installments        = validated_data.pop('installments', [])
        clauses              = validated_data.pop('clauses', [])
        request = self.context.get('request')
        contract = Contract.objects.create(
            created_by=getattr(request, 'user', None) if request else None,
            **validated_data,
        )
        self._save_children(contract, accommodation_lines, guests, installments, clauses)
        return contract

    def update(self, instance, validated_data):
        accommodation_lines = validated_data.pop('accommodation_lines', None)
        guests              = validated_data.pop('guests', None)
        installments        = validated_data.pop('installments', None)
        clauses              = validated_data.pop('clauses', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        self._save_children(instance, accommodation_lines, guests, installments, clauses)
        return instance
