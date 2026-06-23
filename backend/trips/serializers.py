from rest_framework import serializers
from .models import Destination, Trip, Enrollment, Supplier, ListAdditional, CrewRole, Roteiro, PassengerList, ListEnrollment, Room, ListTask


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


class CrewRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model  = CrewRole
        fields = ['id', 'name']


class RoteiroSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Roteiro
        fields = ['id', 'name']


class RoomSerializer(serializers.ModelSerializer):
    occupant_count = serializers.SerializerMethodField()

    class Meta:
        model  = Room
        fields = ['id', 'name', 'occupant_count', 'same_sex_ack']

    def get_occupant_count(self, obj):
        return ListEnrollment.objects.filter(passenger_list=obj.passenger_list, accommodation=obj.name).count()


class ListTaskSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model  = ListTask
        fields = ['id', 'title', 'due_date', 'done', 'created_by_name', 'created_at']
        read_only_fields = ['created_at']

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None


class AirportBriefSerializer(serializers.Serializer):
    id        = serializers.IntegerField()
    name      = serializers.CharField()
    iata_code = serializers.CharField()
    city      = serializers.CharField()
    country   = serializers.CharField()


class PassengerListSerializer(serializers.ModelSerializer):
    suppliers_data      = SupplierSerializer(source='suppliers',         many=True, read_only=True)
    additionals_data    = ListAdditionalSerializer(source='additionals', many=True, read_only=True)
    roteiros_data       = RoteiroSerializer(source='roteiros',           many=True, read_only=True)
    suppliers           = serializers.PrimaryKeyRelatedField(queryset=Supplier.objects.all(),       many=True, required=False)
    additionals         = serializers.PrimaryKeyRelatedField(queryset=ListAdditional.objects.all(), many=True, required=False)
    roteiros            = serializers.PrimaryKeyRelatedField(queryset=Roteiro.objects.all(),        many=True, required=False)
    enrolled_count      = serializers.IntegerField(read_only=True)
    start_date_br       = serializers.SerializerMethodField()
    end_date_br         = serializers.SerializerMethodField()
    default_airport_data   = serializers.SerializerMethodField()
    departure_country_data = serializers.SerializerMethodField()
    departure_state_data   = serializers.SerializerMethodField()
    departure_city_data    = serializers.SerializerMethodField()
    bus_map_data            = serializers.SerializerMethodField()

    class Meta:
        model  = PassengerList
        fields = [
            'id', 'name', 'list_type', 'category', 'block_capacity',
            'total_accommodations', 'start_date', 'end_date',
            'start_date_br', 'end_date_br',
            'suppliers', 'suppliers_data',
            'additionals', 'additionals_data',
            'roteiros', 'roteiros_data',
            'required_documents',
            'default_airport', 'default_airport_data',
            'departure_country', 'departure_country_data',
            'departure_state',   'departure_state_data',
            'departure_city',    'departure_city_data',
            'bus_map', 'bus_map_data',
            'status', 'notes',
            'enrolled_count', 'notification_emails', 'revision', 'created_at', 'updated_at',
            'is_deleted', 'deleted_at',
        ]

    def get_default_airport_data(self, obj):
        if obj.default_airport_id:
            a = obj.default_airport
            return {'id': a.id, 'name': a.name, 'iata_code': a.iata_code, 'city': a.city, 'country': a.country}
        return None

    def get_departure_country_data(self, obj):
        if obj.departure_country_id:
            c = obj.departure_country
            return {'id': c.id, 'name': c.name}
        return None

    def get_departure_state_data(self, obj):
        if obj.departure_state_id:
            s = obj.departure_state
            return {'id': s.id, 'name': s.name}
        return None

    def get_departure_city_data(self, obj):
        if obj.departure_city_id:
            c = obj.departure_city
            return {'id': c.id, 'name': c.name}
        return None

    def get_bus_map_data(self, obj):
        if obj.bus_map_id:
            return {'id': obj.bus_map_id, 'label': obj.bus_map.label}
        return None

    def get_start_date_br(self, obj):
        if not obj.start_date: return ''
        return obj.start_date.strftime('%d/%m/%Y')

    def get_end_date_br(self, obj):
        if not obj.end_date: return ''
        return obj.end_date.strftime('%d/%m/%Y')


class ListEnrollmentSerializer(serializers.ModelSerializer):
    # Campos do passageiro — retornam None quando is_block=True (passenger=null)
    passenger_name       = serializers.SerializerMethodField()
    passenger_cpf        = serializers.SerializerMethodField()
    passenger_email      = serializers.SerializerMethodField()
    passenger_phone      = serializers.SerializerMethodField()
    passenger_birth_date = serializers.SerializerMethodField()
    passenger_nationality= serializers.SerializerMethodField()
    passenger_gender     = serializers.SerializerMethodField()
    passenger_passport   = serializers.SerializerMethodField()
    passenger_passports  = serializers.SerializerMethodField()
    passenger_rg          = serializers.SerializerMethodField()
    passenger_status      = serializers.SerializerMethodField()
    passenger_is_verified = serializers.SerializerMethodField()

    def _p(self, obj): return obj.passenger  # helper

    def get_passenger_name(self, obj):       return obj.passenger.full_name   if obj.passenger else ''
    def get_passenger_cpf(self, obj):        return obj.passenger.cpf         if obj.passenger else ''
    def get_passenger_email(self, obj):      return obj.passenger.email       if obj.passenger else ''
    def get_passenger_phone(self, obj):      return obj.passenger.phone1      if obj.passenger else ''
    def get_passenger_birth_date(self, obj): return obj.passenger.birth_date  if obj.passenger else None
    def get_passenger_nationality(self, obj):return obj.passenger.nationality if obj.passenger else ''
    def get_passenger_gender(self, obj):     return obj.passenger.gender      if obj.passenger else ''
    def get_passenger_passport(self, obj):   return obj.passenger.passport    if obj.passenger else ''

    def get_passenger_passports(self, obj):
        """Lista de até 2 passaportes lidos dos documentos enviados, com fallback nos campos escalares."""
        p = obj.passenger
        if not p:
            return []
        # Usa o prefetch (passport_docs) quando disponível; caso contrário
        # (ex.: resposta de criação/edição de uma única inscrição), busca direto.
        docs = getattr(p, 'passport_docs', None)
        if docs is None:
            docs = list(
                p.documents
                 .filter(doc_type='passport')
                 .exclude(doc_number='')
                 .order_by('-expiry_date', 'id')[:2]
            )
        else:
            docs = docs[:2]
        if docs:
            codes = self.context.get('country_codes')
            if codes is None:
                from config_api.models import ConfigCountry
                names = {d.issued_by for d in docs if d.issued_by}
                codes = {c.name: c.code for c in ConfigCountry.objects.filter(name__in=names)}
            return [
                {
                    'number': d.doc_number,
                    'country': codes.get(d.issued_by, d.issued_by[:3].upper() if d.issued_by else ''),
                }
                for d in docs
            ]
        # Fallback: campos escalares preenchidos na aba Informações
        pairs = [(p.passport, p.passport_country), (p.passport2, p.passport2_country)]
        return [{'number': num, 'country': country} for num, country in pairs if num]

    def get_passenger_rg(self, obj):          return obj.passenger.rg             if obj.passenger else ''
    def get_passenger_status(self, obj):      return obj.passenger.status         if obj.passenger else ''
    def get_passenger_is_verified(self, obj): return obj.passenger.is_verified    if obj.passenger else False

    passenger_phone2          = serializers.SerializerMethodField()
    passenger_mobile          = serializers.SerializerMethodField()
    passenger_seat_preference = serializers.SerializerMethodField()
    passenger_diet_type       = serializers.SerializerMethodField()
    passenger_passport_issue  = serializers.SerializerMethodField()
    passenger_passport_expiry = serializers.SerializerMethodField()
    passenger_is_guide        = serializers.SerializerMethodField()
    passenger_address         = serializers.SerializerMethodField()

    def get_passenger_phone2(self, obj):          return obj.passenger.phone2          if obj.passenger else ''
    def get_passenger_mobile(self, obj):           return obj.passenger.mobile          if obj.passenger else ''
    def get_passenger_seat_preference(self, obj):  return obj.passenger.seat_preference if obj.passenger else ''
    def get_passenger_diet_type(self, obj):        return obj.passenger.diet_type       if obj.passenger else ''
    def get_passenger_is_guide(self, obj):         return obj.passenger.is_guide        if obj.passenger else False
    def get_passenger_passport_issue(self, obj):
        p = obj.passenger
        if not p: return None
        sd = obj.selected_passport_id and obj.selected_passport
        if sd and sd.issued_date: return str(sd.issued_date)
        return str(p.passport_issue) if p.passport_issue else None
    def get_passenger_passport_expiry(self, obj):
        p = obj.passenger
        if not p: return None
        sd = obj.selected_passport_id and obj.selected_passport
        if sd and sd.expiry_date: return str(sd.expiry_date)
        return str(p.passport_expiry) if p.passport_expiry else None
    def get_passenger_address(self, obj):
        p = obj.passenger
        if not p: return ''
        parts = [p.street]
        if p.number: parts.append(p.number)
        if p.complement: parts.append(p.complement)
        addr = ', '.join(filter(None, parts))
        city_line = ', '.join(filter(None, [p.neighborhood, p.city, p.state, p.cep]))
        return '\n'.join(filter(None, [addr, city_line]))

    additionals_data         = ListAdditionalSerializer(source='additionals', many=True, read_only=True)
    additionals              = serializers.PrimaryKeyRelatedField(queryset=ListAdditional.objects.all(), many=True, required=False)
    crew_roles_data          = CrewRoleSerializer(source='crew_roles', many=True, read_only=True)
    crew_roles               = serializers.PrimaryKeyRelatedField(queryset=CrewRole.objects.all(), many=True, required=False)

    agency_name              = serializers.SerializerMethodField()
    responsible_user_name    = serializers.SerializerMethodField()
    departure_airport_data   = serializers.SerializerMethodField()
    selected_passport_data   = serializers.SerializerMethodField()
    origin_country_data      = serializers.SerializerMethodField()
    origin_state_data        = serializers.SerializerMethodField()
    origin_city_data         = serializers.SerializerMethodField()
    origin_airport_data      = serializers.SerializerMethodField()

    def get_agency_name(self, obj):
        def _name(a):
            if a.person_type == 'fisica':
                return a.company_name or f'{a.name} {a.last_name}'.strip() or ''
            return a.name or a.company_name or ''
        if obj.agency:
            return _name(obj.agency)
        if obj.block_agency:
            return obj.block_agency
        # Sem agência específica nesta inscrição — usa as agências vinculadas
        # ao cadastro do passageiro (Passenger.agencies). Se tiver mais de
        # uma, junta com vírgula.
        if obj.passenger_id:
            names = [_name(a) for a in obj.passenger.agencies.all()]
            return ', '.join(filter(None, names))
        return ''

    def get_responsible_user_name(self, obj):
        if obj.responsible_user:
            name = f'{obj.responsible_user.first_name} {obj.responsible_user.last_name}'.strip()
            return name or obj.responsible_user.email
        return ''

    def get_departure_airport_data(self, obj):
        if obj.departure_airport_id:
            a = obj.departure_airport
            return {'id': a.id, 'name': a.name, 'iata_code': a.iata_code, 'city': a.city, 'country': a.country}
        return None

    def get_origin_country_data(self, obj):
        if obj.origin_country_id:
            c = obj.origin_country
            return {'id': c.id, 'name': c.name}
        return None

    def get_origin_state_data(self, obj):
        if obj.origin_state_id:
            s = obj.origin_state
            return {'id': s.id, 'name': s.name}
        return None

    def get_origin_city_data(self, obj):
        if obj.origin_city_id:
            c = obj.origin_city
            return {'id': c.id, 'name': c.name}
        return None

    def get_origin_airport_data(self, obj):
        if obj.origin_airport_id:
            a = obj.origin_airport
            return {'id': a.id, 'name': a.name, 'iata_code': a.iata_code, 'city': a.city, 'country': a.country}
        return None

    def _doc_to_dict(self, d, auto=False):
        codes = self.context.get('country_codes')
        if codes is None:
            from config_api.models import ConfigCountry
            codes = {c.name: c.code for c in ConfigCountry.objects.filter(name=d.issued_by)} if d.issued_by else {}
        return {
            'id': d.id,
            'doc_type': d.doc_type,
            'doc_number': d.doc_number,
            'issued_date': str(d.issued_date) if d.issued_date else None,
            'expiry_date': str(d.expiry_date) if d.expiry_date else None,
            'issued_by': d.issued_by,
            'country': codes.get(d.issued_by, d.issued_by[:3].upper() if d.issued_by else ''),
            'auto': auto,
        }

    def get_selected_passport_data(self, obj):
        if obj.selected_passport_id:
            return self._doc_to_dict(obj.selected_passport)
        # Nenhum documento escolhido ainda — se o passageiro só tem UM
        # documento útil (passaporte ou RG) cadastrado, sugere ele já
        # preenchido (sem gravar no banco), marcado como "auto" pra exibir
        # um aviso de verificação até alguém confirmar de fato.
        if obj.passenger_id:
            docs = list(obj.passenger.documents.filter(doc_type__in=['passport', 'rg']))
            if len(docs) == 1:
                return self._doc_to_dict(docs[0], auto=True)
        return None

    class Meta:
        model  = ListEnrollment
        fields = [
            'id', 'passenger', 'agency', 'agency_name',
            'responsible_user', 'responsible_user_name',
            'is_block', 'block_agency', 'is_provisional',
            'passenger_name', 'passenger_cpf', 'passenger_email', 'passenger_phone',
            'passenger_birth_date', 'passenger_nationality', 'passenger_gender',
            'passenger_passport', 'passenger_passports', 'passenger_rg', 'passenger_status',
            'passenger_is_verified',
            'passenger_phone2', 'passenger_mobile',
            'passenger_seat_preference', 'passenger_diet_type',
            'passenger_passport_issue', 'passenger_passport_expiry',
            'passenger_is_guide', 'passenger_address',
            'additionals', 'additionals_data',
            'crew_roles', 'crew_roles_data',
            'accommodation', 'seat', 'enrollment_status', 'pending_until', 'pending_reason',
            'departure_airport', 'departure_airport_data',
            'origin_mode',
            'origin_country', 'origin_country_data',
            'origin_state',   'origin_state_data',
            'origin_city',    'origin_city_data',
            'origin_airport', 'origin_airport_data',
            'ticket_status', 'connection_ticket_status',
            'selected_passport', 'selected_passport_data',
            'order_in_list', 'enrolled_at', 'notes',
        ]
        read_only_fields = ['enrolled_at']


