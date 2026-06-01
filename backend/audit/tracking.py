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
    'Meeting':            'Reunião',
    'CustomDocType':      'Tipo de documento',
    'CustomDocField':     'Campo de documento',
    'ConfigProfession':   'Profissão',
    'ConfigLanguage':     'Idioma',
    'ConfigCountry':      'País',
    'ConfigState':        'Estado',
    'ConfigVaccine':      'Vacina',
    'ConfigGender':       'Gênero',
}

# Campos a ignorar no diff
SKIP_FIELDS = {
    'password', 'last_login', 'file', 'original_name',
    'file_size', 'mime_type', 'preview_url', 'download_url',
}

# Rótulos amigáveis de campos comuns
FIELD_LABELS = {
    'first_name': 'Nome', 'last_name': 'Sobrenome', 'full_name': 'Nome completo',
    'email': 'E-mail', 'username': 'Login', 'is_staff': 'Administrador',
    'is_active': 'Ativo', 'phone1': 'Telefone', 'phone2': 'Contato 2',
    'mobile': 'Celular', 'cpf': 'CPF', 'birth_date': 'Data de nascimento',
    'nationality': 'Nacionalidade', 'gender': 'Gênero', 'profession': 'Profissão',
    'status': 'Status', 'notes': 'Observações', 'street': 'Endereço',
    'city': 'Cidade', 'state': 'Estado', 'country': 'País', 'cep': 'CEP',
    'doc_type': 'Tipo', 'doc_number': 'Número', 'issued_date': 'Emissão',
    'expiry_date': 'Validade', 'issued_by': 'Emissor',
    'label': 'Nome', 'name': 'Nome', 'key': 'Chave', 'order': 'Ordem',
    'is_active': 'Ativo', 'color': 'Cor', 'icon': 'Ícone',
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

    AuditLog.objects.create(
        user=user,
        user_display=user_display(user),
        action=action,
        model_name=sender.__name__,
        model_label=TRACKED_MODELS[sender.__name__],
        object_id=str(instance.pk),
        object_repr=str(instance)[:500],
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

    AuditLog.objects.create(
        user=user,
        user_display=user_display(user),
        action='delete',
        model_name=sender.__name__,
        model_label=TRACKED_MODELS[sender.__name__],
        object_id=str(instance.pk),
        object_repr=str(instance)[:500],
        changes=obj_to_dict(instance),
        ip_address=get_current_ip(),
    )
