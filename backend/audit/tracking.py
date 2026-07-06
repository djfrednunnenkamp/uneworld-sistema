"""
Rastreamento automático de mudanças via sinais Django.
Registra qualquer create/update/delete nos modelos listados em TRACKED_MODELS.
"""
from django.db.models.signals import pre_save, post_save, post_delete
from django.dispatch import receiver
from .middleware import get_current_user, get_current_ip

# {NomeDoModel: 'Rótulo legível'}
TRACKED_MODELS = {
    'User':               'Usuário',
    'Passenger':          'Passageiro',
    'PassengerDocument':  'Documento',
    'Agency':             'Agência',
    'Trip':               'Viagem',
    'PassengerList':      'Lista de Passageiros',
    'ListEnrollment':     'Passageiro na lista',
    'Supplier':           'Fornecedor',
    'ListAdditional':     'Adicional',
    'CustomDocType':      'Tipo de documento',
    'CustomDocField':     'Campo de documento',
    'ConfigProfession':     'Profissão',
    'ConfigLanguage':       'Idioma',
    'ConfigCountry':        'País',
    'ConfigState':          'Estado',
    'ConfigCity':           'Cidade',
    'ConfigVaccine':        'Vacina',
    'ConfigGender':         'Gênero',
    'ConfigProfCard':       'Carteira profissional',
    'ConfigAccommodation':  'Tipo de acomodação',
    'ConfigListCategory':   'Categoria de lista',
    'CrewRole':             'Equipe técnica',
    'Destination':          'Destino',
    'Airport':              'Aeroporto',
    'Airline':              'Companhia aérea',
    'BusMap':               'Mapa de ônibus',
    'PermissionProfile':    'Perfil de permissão',
    'Itinerary':                'Roteiro',
    'Contract':                 'Contrato',
    'ContractAccommodationLine':'Acomodação do contrato',
    'ContractGuest':            'Hóspede do contrato',
    'ContractInstallment':      'Parcela do contrato',
    'ContractAdjustment':       'Ajuste do contrato',
}

# Campos a ignorar no diff
SKIP_FIELDS = {
    'password', 'last_login', 'file', 'original_name',
    'file_size', 'mime_type', 'preview_url', 'download_url',
    'signed_file',  # arquivo do contrato assinado — a mudança de etapa já registra o evento
    'updated_at', 'created_at',  # campos meta — sempre mudam, geram ruído
}

# Rótulos amigáveis de campos comuns
FIELD_LABELS = {
    # Usuário / Passageiro
    'first_name': 'Nome', 'last_name': 'Sobrenome', 'full_name': 'Nome completo',
    'email': 'E-mail', 'username': 'Login', 'is_staff': 'Administrador',
    'is_active': 'Ativo', 'phone1': 'Telefone', 'phone2': 'Contato 2',
    'mobile': 'Celular', 'cpf': 'CPF', 'birth_date': 'Data de nascimento',
    'nationality': 'Nacionalidade', 'gender': 'Gênero', 'profession': 'Profissão',
    'status': 'Status', 'notes': 'Observações', 'street': 'Endereço',
    'city': 'Cidade', 'state': 'Estado', 'country': 'País', 'cep': 'CEP',
    'is_foreign': 'Estrangeiro', 'is_guide': 'Guia', 'is_verified': 'Verificado',
    'diet_type': 'Alimentação', 'diet_notes': 'Obs. alimentação',
    'passport': 'Passaporte', 'passport_expiry': 'Validade do passaporte',
    'passport_issue': 'Emissão do passaporte',
    'rg': 'RG', 'rg_issue_date': 'Emissão do RG', 'rg_issuer': 'Órgão emissor',
    'rne': 'RNE', 'rne_expiry': 'Validade do RNE',
    'seat_preference': 'Preferência de assento', 'seat_position': 'Posição no assento',
    'flight_class': 'Classe do voo',
    # Documento
    'doc_type': 'Tipo', 'doc_number': 'Número', 'issued_date': 'Emissão',
    'expiry_date': 'Validade', 'issued_by': 'Emissor',
    # Genérico
    'label': 'Nome', 'name': 'Nome', 'key': 'Chave', 'order': 'Ordem',
    'color': 'Cor', 'icon': 'Ícone', 'capacity': 'Capacidade',
    'is_couple': 'É casal',
    # ListEnrollment — inscrição na lista de passageiros
    'passenger': 'Passageiro', 'passenger_list': 'Lista',
    'agency': 'Agência', 'responsible_user': 'Responsável',
    'accommodation': 'Acomodação',
    'enrollment_status': 'Status na lista',
    'pending_until': 'Pendente até', 'pending_reason': 'Motivo da pendência',
    'is_block': 'É bloqueio', 'block_agency': 'Agência (bloqueio)',
    'block_quantity': 'Vagas (bloqueio)',
    'order_in_list': 'Ordem na lista',
    # PassengerList — lista / viagem
    'list_type': 'Tipo de lista', 'category': 'Categoria',
    'block_capacity': 'Capacidade de bloqueio',
    'total_accommodations': 'Total de acomodações',
    'start_date': 'Data de início', 'end_date': 'Data de término',
    'required_documents': 'Documentos requeridos',
    # Contrato
    'stage': 'Etapa', 'sent_at': 'Enviado em', 'signed_at': 'Assinado em',
    'reservation_number': 'Nº da reserva', 'package_name': 'Pacote',
    'contratante': 'Contratante', 'contract_date': 'Data do contrato',
    'departure_date': 'Data de embarque', 'return_date': 'Data de retorno',
    'signature_type': 'Tipo de assinatura', 'total_value': 'Valor total',
    'passenger_list': 'Lista', 'itinerary': 'Roteiro', 'created_by': 'Criado por',
}


def serialize_value(value):
    if value is None:
        return None
    if hasattr(value, 'pk'):
        return str(value)
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    if isinstance(value, bool):
        return 'Sim' if value else 'Não'
    return str(value)


def obj_to_dict(instance):
    result = {}
    for field in instance._meta.get_fields():
        if not hasattr(field, 'column'):
            continue
        name = field.name
        if name in SKIP_FIELDS:
            continue
        try:
            value = getattr(instance, name)
            result[FIELD_LABELS.get(name, name)] = serialize_value(value)
        except Exception:
            pass
    return result


def user_display(user):
    if not user:
        return 'Sistema'
    name = f'{user.first_name} {user.last_name}'.strip()
    return name or user.email or user.username


# ── Captura estado antes do save ────────────────────────────────────────────

@receiver(pre_save)
def capture_pre_save(sender, instance, **kwargs):
    if sender.__name__ not in TRACKED_MODELS:
        return
    if not instance.pk:
        instance._audit_old = None
        return
    try:
        instance._audit_old = obj_to_dict(sender.objects.get(pk=instance.pk))
    except sender.DoesNotExist:
        instance._audit_old = None


# ── Loga após save ───────────────────────────────────────────────────────────

@receiver(post_save)
def log_save(sender, instance, created, **kwargs):
    if sender.__name__ not in TRACKED_MODELS:
        return

    # Import aqui para evitar import circular
    from .models import AuditLog

    user = get_current_user()

    if created:
        action  = 'create'
        changes = obj_to_dict(instance)
    else:
        old = getattr(instance, '_audit_old', None) or {}
        new = obj_to_dict(instance)
        changes = {
            k: {'antes': old.get(k), 'depois': v}
            for k, v in new.items()
            if old.get(k) != v
        }
        action = 'update'
        if not changes:
            return  # Nada mudou
        # Soft-delete (lixeira) e restauração passam por save(), não por
        # delete() — sem isso, apareceriam no log como "Atualizado" em vez
        # de "Apagado"/"Restaurado", que é o que reflete a ação real.
        if 'is_deleted' in changes:
            # changes já vem serializado ('Sim'/'Não'), por isso lemos o valor
            # bruto direto da instância em vez do dict de changes.
            action = 'delete' if instance.is_deleted else 'restore'
        # Transições de etapa do contrato ganham ação própria no log, para deixar
        # explícito quando ele foi ENVIADO para assinatura e quando foi ASSINADO/
        # recebido — vale para física, digital e o retorno da Autentique (webhook).
        elif sender.__name__ == 'Contract' and FIELD_LABELS['stage'] in changes:
            action = {'enviado': 'send', 'assinado': 'sign', 'em_edicao': 'reopen'}.get(instance.stage, 'update')

    try:
        repr_str = str(instance)[:500]
    except Exception:
        repr_str = f'{sender.__name__}#{instance.pk}'
    AuditLog.objects.create(
        user=user,
        user_display=user_display(user),
        action=action,
        model_name=sender.__name__,
        model_label=TRACKED_MODELS[sender.__name__],
        object_id=str(instance.pk),
        object_repr=repr_str,
        changes=changes,
        ip_address=get_current_ip(),
    )


# ── Loga após delete ─────────────────────────────────────────────────────────

@receiver(post_delete)
def log_delete(sender, instance, **kwargs):
    if sender.__name__ not in TRACKED_MODELS:
        return

    from .models import AuditLog

    user = get_current_user()

    try:
        repr_str = str(instance)[:500]
    except Exception:
        repr_str = f'{sender.__name__}#{instance.pk}'
    # Modelos com lixeira (is_deleted) só chegam aqui de verdade através da
    # ação "purge" (exclusão definitiva) — destroy() normal vira save(), não
    # delete(). Pra esses, marca como "purge" em vez de "delete" no log.
    action = 'purge' if hasattr(instance, 'is_deleted') else 'delete'
    AuditLog.objects.create(
        user=user,
        user_display=user_display(user),
        action=action,
        model_name=sender.__name__,
        model_label=TRACKED_MODELS[sender.__name__],
        object_id=str(instance.pk),
        object_repr=repr_str,
        changes=obj_to_dict(instance),
        ip_address=get_current_ip(),
    )
