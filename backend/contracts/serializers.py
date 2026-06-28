from decimal import Decimal, ROUND_HALF_UP, ROUND_CEILING, ROUND_FLOOR

from django.utils import timezone
from rest_framework import serializers

from agencies.models import Agency
from config_api.models import ConfigAccommodation, ConfigExchangeRate, ContractClause
from passengers.models import Passenger
from trips.models import PassengerList

from .models import (Contract, ContractAccommodationLine, ContractGuest,
                     ContractInstallment, ContractAdjustment)


def _default_exchange_rate(from_currency='USD', to_currency='BRL'):
    row = ConfigExchangeRate.objects.filter(from_currency=from_currency, to_currency=to_currency).first()
    return row.rate if row else None


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
        fields = ['id', 'passenger', 'passenger_data', 'accommodation_type', 'accommodation_type_name', 'room_group', 'order']

    def get_passenger_data(self, obj):
        return _passenger_brief(obj.passenger)

    def get_accommodation_type_name(self, obj):
        return obj.accommodation_type.name if obj.accommodation_type_id else None


class ContractInstallmentSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ContractInstallment
        fields = ['id', 'kind', 'installment_number', 'detail', 'due_date', 'value_brl', 'payment_method', 'order']


class ContractAdjustmentSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ContractAdjustment
        fields = ['id', 'description', 'kind', 'mode', 'value_usd', 'percent', 'order']


class ContractListSerializer(serializers.ModelSerializer):
    agency_name      = serializers.SerializerMethodField()
    contratante_name = serializers.SerializerMethodField()

    class Meta:
        model  = Contract
        fields = ['id', 'reservation_number', 'contract_date', 'agency', 'agency_name',
                  'contratante', 'contratante_name', 'package_name', 'departure_date',
                  'total_brl', 'status', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def get_agency_name(self, obj):
        return _agency_brief(obj.agency)['name'] if obj.agency_id else ''

    def get_contratante_name(self, obj):
        return obj.contratante.full_name if obj.contratante_id else obj.payer_name


class ContractSerializer(serializers.ModelSerializer):
    accommodation_lines = ContractAccommodationLineSerializer(many=True, required=False)
    guests              = ContractGuestSerializer(many=True, required=False)
    installments        = ContractInstallmentSerializer(many=True, required=False)
    adjustments         = ContractAdjustmentSerializer(many=True, required=False)
    clauses             = serializers.PrimaryKeyRelatedField(many=True, queryset=ContractClause.objects.all(), required=False)

    agency_data      = serializers.SerializerMethodField()
    contratante_data = serializers.SerializerMethodField()
    passenger_list_data = serializers.SerializerMethodField()
    itinerary_data      = serializers.SerializerMethodField()
    clauses_data        = serializers.SerializerMethodField()

    # Calculados pelo backend — nunca digitados (ver _recalc_totals).
    total_usd     = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    total_brl     = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    # Imutáveis após a criação (ver create()).
    reservation_number = serializers.CharField(read_only=True)
    contract_date       = serializers.DateField(read_only=True)

    class Meta:
        model  = Contract
        fields = ['id', 'reservation_number', 'contract_date', 'agency', 'agency_data',
                  'passenger_list', 'passenger_list_data', 'itinerary', 'itinerary_data',
                  'contratante', 'contratante_data',
                  'payer_type', 'payer_name', 'payer_document', 'payer_birth_date', 'payer_gender',
                  'payer_email', 'payer_phone', 'payer_address',
                  'package_name', 'departure_date', 'return_date', 'departure_airport', 'observations',
                  'total_usd', 'total_brl', 'exchange_rate',
                  'round_step', 'round_mode', 'round_currency',
                  'received_down_payment_brl', 'received_installments_brl',
                  'accommodation_lines', 'guests', 'installments', 'adjustments', 'clauses', 'clauses_data',
                  'status', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']

    def validate(self, attrs):
        contratante = attrs.get('contratante', getattr(self.instance, 'contratante', None))
        payer_name  = attrs.get('payer_name', getattr(self.instance, 'payer_name', ''))
        if not contratante and not payer_name:
            raise serializers.ValidationError(
                {'contratante': 'Selecione um contratante cadastrado ou preencha os dados manualmente.'})
        return attrs

    def get_agency_data(self, obj):
        return _agency_brief(obj.agency) if obj.agency_id else None

    def get_clauses_data(self, obj):
        return [{'id': c.id, 'name': c.name, 'content': c.content} for c in obj.clauses.all()]

    def get_contratante_data(self, obj):
        if obj.contratante_id:
            return _passenger_brief(obj.contratante)
        if obj.payer_name:
            return {
                'id': None, 'full_name': obj.payer_name, 'gender': obj.payer_gender,
                'birth_date': obj.payer_birth_date, 'passport': '', 'cpf': obj.payer_document,
                'mobile': obj.payer_phone, 'email': obj.payer_email, 'address': obj.payer_address,
                'payer_type': obj.payer_type,
            }
        return None

    def get_itinerary_data(self, obj):
        if not obj.itinerary_id:
            return None
        it = obj.itinerary
        return {'id': it.id, 'name': it.name, 'start_date': it.start_date, 'end_date': it.end_date}

    def get_passenger_list_data(self, obj):
        if not obj.passenger_list_id:
            return None
        pl = obj.passenger_list
        return {'id': pl.id, 'name': pl.name, 'start_date': pl.start_date, 'end_date': pl.end_date,
                'airport_name': pl.default_airport.name if pl.default_airport_id else ''}

    def _save_children(self, contract, accommodation_lines, guests, installments, clauses, adjustments=None):
        if adjustments is not None:
            contract.adjustments.all().delete()
            ContractAdjustment.objects.bulk_create([
                ContractAdjustment(contract=contract, order=i, **row)
                for i, row in enumerate(adjustments)
            ])
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

        # As cláusulas marcadas como "padrão" (favoritas) sempre entram no
        # contrato, independente do que foi enviado — o usuário só escolhe as
        # adicionais.
        default_ids = set(ContractClause.objects.filter(is_default=True).values_list('id', flat=True))
        chosen_ids  = set(c.id for c in clauses) if clauses is not None else set()
        contract.clauses.set(default_ids | chosen_ids)

    def _recalc_totals(self, contract):
        """Soma total (USD) vem das linhas de acomodação; câmbio vem da
        configuração de Câmbio quando o contrato não tem um valor próprio;
        total em BRL é derivado dos dois — nada disso é digitado manualmente."""
        accom_total = sum(
            (line.value_per_person_usd + line.taxes_usd) * line.quantity
            for line in contract.accommodation_lines.all()
        )
        # Acréscimos somam, descontos subtraem. Percentual incide sobre o subtotal
        # das acomodações (accom_total).
        adj_total = Decimal('0')
        for a in contract.adjustments.all():
            amount = a.amount_usd(accom_total)
            adj_total += amount if a.kind == 'acrescimo' else -amount
        total_usd = accom_total + adj_total
        exchange_rate = contract.exchange_rate or _default_exchange_rate()
        total_brl = total_usd * exchange_rate if exchange_rate else None

        # Arredondamento opcional: arredonda a moeda escolhida pro múltiplo de
        # round_step e deriva a outra pelo câmbio (mantém total_usd*câmbio = total_brl).
        step = contract.round_step or 0
        if step > 0:
            def _round(v):
                q = Decimal(v) / step
                if contract.round_mode == 'up':     q = q.to_integral_value(rounding=ROUND_CEILING)
                elif contract.round_mode == 'down': q = q.to_integral_value(rounding=ROUND_FLOOR)
                else:                               q = q.to_integral_value(rounding=ROUND_HALF_UP)
                return q * step
            if contract.round_currency == 'usd':
                total_usd = _round(total_usd)
                total_brl = total_usd * exchange_rate if exchange_rate else None
            elif total_brl is not None:
                total_brl = _round(total_brl)
                if exchange_rate:
                    total_usd = (total_brl / exchange_rate).quantize(Decimal('0.01'))

        contract.total_usd     = total_usd
        contract.exchange_rate = exchange_rate
        contract.total_brl     = total_brl
        contract.save(update_fields=['total_usd', 'exchange_rate', 'total_brl'])

    def create(self, validated_data):
        accommodation_lines = validated_data.pop('accommodation_lines', [])
        guests              = validated_data.pop('guests', [])
        installments        = validated_data.pop('installments', [])
        adjustments         = validated_data.pop('adjustments', [])
        clauses              = validated_data.pop('clauses', [])
        request = self.context.get('request')

        # Data da contratação é sempre hoje — não é um campo preenchido pelo usuário.
        validated_data['contract_date'] = timezone.now().date()
        # Totais (USD/BRL) são sempre calculados — nunca aceitos do payload.
        validated_data.pop('total_usd', None)
        validated_data.pop('total_brl', None)
        # Contratante e dados manuais (payer_*) são mutuamente exclusivos —
        # escolher um passageiro cadastrado limpa os dados digitados à mão.
        if validated_data.get('contratante'):
            for f in ('payer_type', 'payer_name', 'payer_document', 'payer_birth_date',
                      'payer_gender', 'payer_email', 'payer_phone', 'payer_address'):
                validated_data.pop(f, None)

        contract = Contract.objects.create(
            created_by=getattr(request, 'user', None) if request else None,
            **validated_data,
        )
        # Reserva nº: sequencial e único — gerado a partir do próprio id, sem
        # precisar de um contador separado nem de digitação manual.
        if not contract.reservation_number:
            contract.reservation_number = f'{contract.id:06d}'
            contract.save(update_fields=['reservation_number'])

        self._save_children(contract, accommodation_lines, guests, installments, clauses, adjustments)
        self._recalc_totals(contract)
        return contract

    def update(self, instance, validated_data):
        accommodation_lines = validated_data.pop('accommodation_lines', None)
        guests              = validated_data.pop('guests', None)
        installments        = validated_data.pop('installments', None)
        adjustments         = validated_data.pop('adjustments', None)
        clauses              = validated_data.pop('clauses', None)
        # Data da contratação e reserva nº são imutáveis após a criação.
        validated_data.pop('contract_date', None)
        validated_data.pop('reservation_number', None)
        validated_data.pop('total_usd', None)
        validated_data.pop('total_brl', None)
        if validated_data.get('contratante'):
            for f in ('payer_type', 'payer_name', 'payer_document', 'payer_birth_date',
                      'payer_gender', 'payer_email', 'payer_phone', 'payer_address'):
                validated_data.pop(f, None)
            instance.payer_type = instance.payer_name = instance.payer_document = ''
            instance.payer_gender = instance.payer_email = instance.payer_phone = instance.payer_address = ''
            instance.payer_birth_date = None
        elif validated_data.get('payer_name'):
            validated_data['contratante'] = None
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        self._save_children(instance, accommodation_lines, guests, installments, clauses, adjustments)
        self._recalc_totals(instance)
        return instance
