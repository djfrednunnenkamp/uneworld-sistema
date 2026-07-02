from decimal import Decimal, ROUND_HALF_UP, ROUND_CEILING, ROUND_FLOOR

from django.utils import timezone
from rest_framework import serializers

from agencies.models import Agency
from config_api.models import ConfigAccommodation, ConfigExchangeRate, ContractClause
from passengers.models import Passenger
from trips.models import PassengerList

from users_api.permissions import has_any_perm

from .models import (Contract, ContractAccommodationLine, ContractGuest,
                     ContractInstallment, ContractAdjustment)


def _default_exchange_rate(from_currency='USD', to_currency='BRL', payment_type='parcelado'):
    """Taxa padrão das Configurações: à vista usa `rate`, parcelado usa
    `rate_installment` (cada moeda tem os dois valores)."""
    row = ConfigExchangeRate.objects.filter(from_currency=from_currency, to_currency=to_currency).first()
    if not row:
        return None
    return row.rate if payment_type == 'a_vista' else (row.rate_installment or row.rate)


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
        'commission_rate': a.commission_rate,
        # PIX que vai no contrato: o da UneWorld (padrão) ou o da agência
        # (use_agency_pix=True, só se a agência tiver PIX).
        'pix_key_type': a.pix_key_type, 'pix_key': a.pix_key, 'use_agency_pix': a.use_agency_pix,
    }


def _seller_brief(u):
    """Dados do vendedor que aparecem no contrato (nome, e-mail, telefone).
    Telefone vem do perfil (UserPermissions.phone)."""
    if not u:
        return None
    name = (f'{u.first_name} {u.last_name}'.strip()) or u.username or u.email
    phone = ''
    perms = getattr(u, 'permissions', None)
    if perms is not None:
        phone = perms.phone or ''
    return {'id': u.id, 'name': name, 'email': u.email or '', 'phone': phone}


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
        fields = ['id', 'description', 'kind', 'mode', 'value_usd', 'value_brl', 'percent', 'order']


class ContractListSerializer(serializers.ModelSerializer):
    agency_name      = serializers.SerializerMethodField()
    contratante_name = serializers.SerializerMethodField()
    guest_names      = serializers.SerializerMethodField()
    signed_file      = serializers.SerializerMethodField()
    signed_verification = serializers.JSONField(read_only=True)

    class Meta:
        model  = Contract
        fields = ['id', 'reservation_number', 'contract_date', 'agency', 'agency_name',
                  'contratante', 'contratante_name', 'guest_names', 'package_name', 'departure_date',
                  'total_brl', 'total_usd', 'status', 'signature_type', 'stage', 'signed_file', 'signed_verification',
                  'autentique_document_id',
                  'created_at', 'updated_at', 'sent_at', 'signed_at', 'reviewed_at', 'review_note',
                  'invoice_number', 'invoice_date', 'invoiced_at',
                  'is_deleted', 'deleted_at']

    def get_agency_name(self, obj):
        return _agency_brief(obj.agency)['name'] if obj.agency_id else ''

    def get_contratante_name(self, obj):
        return obj.contratante.full_name if obj.contratante_id else obj.payer_name

    def get_guest_names(self, obj):
        return [g.passenger.full_name for g in obj.guests.all() if g.passenger_id and g.passenger.full_name]

    def get_signed_file(self, obj):
        return f'/api/contracts/{obj.id}/signed-file/' if obj.signed_file else None


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
    seller_data         = serializers.SerializerMethodField()

    # Etapa e arquivo assinado mudam só pelas ações (send-for-signature/upload-signed).
    stage         = serializers.CharField(read_only=True)
    # URL autenticada (não a pública de /media) — null quando não há arquivo.
    signed_file   = serializers.SerializerMethodField()
    # Conferência automática do assinado (só leitura; gravada no upload-signed).
    signed_verification = serializers.JSONField(read_only=True)
    # Calculados pelo backend — nunca digitados (ver _recalc_totals).
    total_usd     = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    total_brl     = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    # Comissão BRUTA da agência (o mesmo % embutido nos valores) — % + valor em US$/BRL.
    commission_pct = serializers.SerializerMethodField()
    commission_usd = serializers.SerializerMethodField()
    commission_brl = serializers.SerializerMethodField()
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
                  'seller', 'seller_data',
                  'package_name', 'departure_date', 'return_date', 'departure_airport', 'observations',
                  'base_currency', 'payment_type', 'total_usd', 'total_brl', 'exchange_rate',
                  'commission_pct', 'commission_usd', 'commission_brl',
                  'round_step', 'round_mode', 'round_currency', 'signature_type',
                  'received_down_payment_brl', 'received_installments_brl',
                  'payment_plan_applied',
                  'stage', 'signed_file', 'signed_verification',
                  'reviewed_at', 'review_note', 'invoice_number', 'invoice_date', 'invoiced_at',
                  'autentique_document_id', 'autentique_data',
                  'accommodation_lines', 'guests', 'installments', 'adjustments', 'clauses', 'clauses_data', 'custom_clauses',
                  'status', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']
        read_only_fields = ['autentique_document_id', 'autentique_data', 'reviewed_at', 'review_note',
                            'invoice_number', 'invoice_date', 'invoiced_at']

    def validate_custom_clauses(self, value):
        # Sanitiza o HTML das cláusulas personalizadas antes de salvar (A-12).
        from core.sanitize import sanitize_custom_clauses
        return sanitize_custom_clauses(value)

    def validate(self, attrs):
        # Só exige obrigatórios quando o contrato é EXPLICITAMENTE finalizado
        # (status='ativo' vindo no payload). Autosave/rascunho/prévia — que não
        # mandam status='ativo' — podem ser salvos incompletos.
        if attrs.get('status') != 'ativo':
            return attrs
        # Finalizado: exige agência e contratante (ou dados manuais do pagante).
        agency = attrs.get('agency', getattr(self.instance, 'agency', None))
        if not agency:
            raise serializers.ValidationError({'agency': 'Selecione a agência.'})
        contratante = attrs.get('contratante', getattr(self.instance, 'contratante', None))
        payer_name  = attrs.get('payer_name', getattr(self.instance, 'payer_name', ''))
        if not contratante and not payer_name:
            raise serializers.ValidationError(
                {'contratante': 'Selecione um contratante cadastrado ou preencha os dados manualmente.'})
        return attrs

    def get_agency_data(self, obj):
        return _agency_brief(obj.agency) if obj.agency_id else None

    def _commission_usd(self, obj):
        """Comissão BRUTA da agência: % cadastrado na agência sobre o subtotal por
        pessoa (sem taxas) — o mesmo valor embutido no total (ver _recalc_totals)."""
        rate = obj.agency.commission_rate if obj.agency_id else None
        if not rate:
            return None
        value_subtotal = sum(
            (line.value_per_person_usd or Decimal('0')) * line.quantity
            for line in obj.accommodation_lines.all()
        )
        comm = Decimal(value_subtotal) * (rate / Decimal('100'))
        return comm.quantize(Decimal('0.01')) if comm else None

    def get_commission_pct(self, obj):
        rate = obj.agency.commission_rate if obj.agency_id else None
        return rate or None

    def get_commission_usd(self, obj):
        return self._commission_usd(obj)

    def get_commission_brl(self, obj):
        comm = self._commission_usd(obj)
        if not comm or not obj.exchange_rate:
            return None
        return (comm * obj.exchange_rate).quantize(Decimal('0.01'))

    def get_seller_data(self, obj):
        # Vendedor que aparece no contrato: o escolhido ou, na falta, o criador.
        return _seller_brief(obj.seller or obj.created_by)

    def get_clauses_data(self, obj):
        # Cláusulas cadastradas (M2M) + as personalizadas deste contrato. O PDF e a
        # revisão consomem essa lista única, então as personalizadas aparecem sem
        # nenhuma mudança extra de renderização.
        data = [{'id': c.id, 'name': c.name, 'content': c.content} for c in obj.clauses.all()]
        for cc in (obj.custom_clauses or []):
            if isinstance(cc, dict) and (cc.get('name') or cc.get('content')):
                data.append({'id': None, 'name': cc.get('name') or '', 'content': cc.get('content') or '', 'custom': True})
        return data

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
        return {'id': it.id, 'name': it.name, 'start_date': it.start_date, 'end_date': it.end_date,
                'base_currency': it.base_currency}

    def get_signed_file(self, obj):
        return f'/api/contracts/{obj.id}/signed-file/' if obj.signed_file else None

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
        exchange_rate = contract.exchange_rate or _default_exchange_rate(
            from_currency=contract.base_currency or 'USD', payment_type=contract.payment_type or 'parcelado')
        adjustments = list(contract.adjustments.all())
        # Acréscimo soma; desconto subtrai. Percentual incide sobre o subtotal das
        # acomodações; ajustes em BRL convertem pelo câmbio. A comissão tem
        # tratamento próprio abaixo (não entra aqui).
        adj_total = Decimal('0')
        for a in adjustments:
            if a.kind == 'comissao':
                continue
            amount = a.amount_usd(accom_total, exchange_rate)
            adj_total += amount if a.kind == 'acrescimo' else -amount
        # Comissão da agência: % cadastrado na agência, incide só sobre o
        # valor/pessoa (não sobre as taxas) e fica embutida no total.
        commission = Decimal('0')
        if contract.agency_id and contract.agency.commission_rate:
            value_subtotal = sum(
                line.value_per_person_usd * line.quantity
                for line in contract.accommodation_lines.all()
            )
            commission = Decimal(value_subtotal) * (contract.agency.commission_rate / Decimal('100'))
        # Desconto de comissão: abate da comissão, NUNCA maior que ela. O % é
        # sobre a comissão (100% = comissão inteira); R$/US$ limitados à comissão.
        comm_disc = Decimal('0')
        ca = next((a for a in adjustments if a.kind == 'comissao'), None)
        if ca and commission:
            if ca.mode == 'percentual':
                d = commission * ca.percent / 100
            elif ca.mode == 'valor_brl':
                d = (ca.value_brl / exchange_rate) if exchange_rate else Decimal('0')
            else:
                d = ca.value_usd
            comm_disc = max(Decimal('0'), min(Decimal(d), commission))
        total_usd = accom_total + adj_total + commission - comm_disc
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
        # Sem forma de assinatura informada, herda o padrão global da Operadora.
        if not validated_data.get('signature_type'):
            from config_api.models import OperatingCompany
            validated_data['signature_type'] = OperatingCompany.get().default_signature_type
        # Totais (USD/BRL) são sempre calculados — nunca aceitos do payload.
        validated_data.pop('total_usd', None)
        validated_data.pop('total_brl', None)
        # Contratante e dados manuais (payer_*) são mutuamente exclusivos —
        # escolher um passageiro cadastrado limpa os dados digitados à mão.
        if validated_data.get('contratante'):
            for f in ('payer_type', 'payer_name', 'payer_document', 'payer_birth_date',
                      'payer_gender', 'payer_email', 'payer_phone', 'payer_address'):
                validated_data.pop(f, None)

        user = getattr(request, 'user', None) if request else None
        # Usuário de agência: o contrato é SEMPRE de uma agência dele. Se não
        # escolheu (ou escolheu uma fora do escopo), força para a agência dele.
        from users_api.permissions import agency_scope_ids
        scope = agency_scope_ids(user)
        if scope is not None:
            ag = validated_data.get('agency')
            if not (ag and ag.id in scope):
                from agencies.models import Agency
                validated_data['agency'] = Agency.objects.filter(id__in=scope).first()
        # Vendedor: por padrão é o próprio criador. Só pode ser outro usuário se
        # quem cria tiver a permissão contracts_change_seller — senão é forçado
        # ao criador, mesmo que o payload tente mandar outro.
        requested_seller = validated_data.pop('seller', None)
        if requested_seller and user and has_any_perm(user, 'contracts_change_seller'):
            validated_data['seller'] = requested_seller
        else:
            validated_data['seller'] = user

        # Cláusulas personalizadas só são aceitas de quem tem a permissão.
        if not (user and has_any_perm(user, 'contracts_custom_clauses')):
            validated_data.pop('custom_clauses', None)

        contract = Contract.objects.create(
            created_by=user,
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
        # Usuário de agência não pode mover o contrato para uma agência fora do
        # escopo dele — mantém a agência atual nesse caso.
        from users_api.permissions import agency_scope_ids
        _req = self.context.get('request')
        _scope = agency_scope_ids(getattr(_req, 'user', None) if _req else None)
        if _scope is not None and 'agency' in validated_data:
            ag = validated_data.get('agency')
            if not (ag and ag.id in _scope):
                validated_data.pop('agency', None)
        # Cláusulas personalizadas só podem ser alteradas por quem tem a permissão.
        if 'custom_clauses' in validated_data:
            request = self.context.get('request')
            user = getattr(request, 'user', None) if request else None
            if not (user and has_any_perm(user, 'contracts_custom_clauses')):
                validated_data.pop('custom_clauses', None)
        # Data da contratação e reserva nº são imutáveis após a criação.
        validated_data.pop('contract_date', None)
        validated_data.pop('reservation_number', None)
        validated_data.pop('total_usd', None)
        validated_data.pop('total_brl', None)
        # Vendedor só pode ser alterado por quem tem contracts_change_seller —
        # caso contrário a mudança é ignorada (mantém o que já está no contrato).
        if 'seller' in validated_data:
            request = self.context.get('request')
            user = getattr(request, 'user', None) if request else None
            if not (user and has_any_perm(user, 'contracts_change_seller')):
                validated_data.pop('seller', None)
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
        # Toda edição sobe a versão de assinatura: invalida os PDFs baixados antes
        # (o QR deles carrega a versão antiga) — ver contracts/signing.py.
        instance.signing_version = (instance.signing_version or 1) + 1
        instance.save()
        self._save_children(instance, accommodation_lines, guests, installments, clauses, adjustments)
        self._recalc_totals(instance)
        return instance
