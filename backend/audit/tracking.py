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
}

# Campos a ignorar no diff
SKIP_FIELDS = {
    'password', 'last_login', 'file', 'original_name',
    'file_size', 'mime_type', 'preview_url', 'download_url',
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
    AuditLog.objects.create(
        user=user,
        user_display=user_display(user),
        action='delete',
        model_name=sender.__name__,
        model_label=TRACKED_MODELS[sender.__name__],
        object_id=str(instance.pk),
        object_repr=repr_str,
        changes=obj_to_dict(instance),
        ip_address=get_current_ip(),
    )
