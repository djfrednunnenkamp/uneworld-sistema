"""
Rastreamento automático de mudanças via sinais Django.
Registra qualquer create/update/delete nos modelos listados em TRACKED_MODELS.
"""
import logging
from django.db import transaction
from django.db.models.signals import pre_save, post_save, post_delete
from django.dispatch import receiver
from .middleware import get_current_user, get_current_ip, get_current_source

_log = logging.getLogger('audit')


def _snapshot_actor_avatar(user):
    """Congela a foto atual do autor numa cópia compartilhada (AuditActorAvatar),
    deduplicada pelo caminho do arquivo original. Copia a imagem só na PRIMEIRA vez
    que aquela foto aparece; depois só reaproveita a linha. Retorna a instância (ou
    None se não há foto / falha). Best-effort: nunca derruba a gravação do log."""
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    try:
        perms = getattr(user, 'permissions', None)
        av = getattr(perms, 'avatar', None) if perms else None
        name = getattr(av, 'name', '') if av else ''
        if not name:
            return None
        from .models import AuditActorAvatar
        existing = AuditActorAvatar.objects.filter(source_name=name).first()
        if existing:
            return existing
        import os
        from django.db import IntegrityError
        from django.core.files.base import ContentFile
        av.open('rb')
        try:
            data = av.read()
        finally:
            av.close()
        snap = AuditActorAvatar(source_name=name)
        try:
            snap.image.save(os.path.basename(name), ContentFile(data), save=True)
        except IntegrityError:
            # Corrida: outro log criou a mesma foto ao mesmo tempo — reaproveita.
            return AuditActorAvatar.objects.filter(source_name=name).first()
        return snap
    except Exception:
        _log.exception('Falha ao congelar avatar de auditoria')
        return None


def _safe_create(**kwargs):
    """Grava um AuditLog isolando a escrita num savepoint próprio.

    A auditoria roda DENTRO da transação da operação do usuário (post_save/
    post_delete). Se a gravação do log falhasse, ela abortaria a transação
    inteira e derrubaria a ação real (salvar hotel, custo, etc.). O savepoint
    garante que uma falha de auditoria role atrás só o log — nunca a operação.
    O registro confiável continua no back-end; só deixamos de matar o pedido
    legítimo por causa de um erro de logging."""
    from .models import AuditLog
    # Congela a foto do autor no momento do log (fora do savepoint do log: se falhar,
    # não rola atrás nada; o log ainda é gravado, só sem a foto congelada).
    if 'actor_avatar' not in kwargs:
        kwargs['actor_avatar'] = _snapshot_actor_avatar(kwargs.get('user'))
    try:
        with transaction.atomic():
            AuditLog.objects.create(**kwargs)
    except Exception:
        _log.exception('Falha ao gravar AuditLog (%s %s)',
                       kwargs.get('action'), kwargs.get('model_name'))

# {NomeDoModel: 'Rótulo legível'}
TRACKED_MODELS = {
    'User':               'Usuário',
    'Passenger':          'Passageiro',
    'PassengerDocument':  'Documento',
    'Agency':             'Agência',
    'Fornecedor':         'Fornecedor',
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
    'ConfigShipCabin':      'Tipo de cabine',
    'ConfigFlightClass':    'Classe de voo',
    'ConfigListCategory':   'Categoria de lista',
    'ConfigItineraryCategory': 'Categoria de roteiro',
    'ConfigItineraryType':  'Tipo de roteiro',
    'ConfigMaritimeCompany':'Companhia marítima',
    'ConfigTerrestreCompany':'Empresa terrestre',
    'ConfigCurrency':       'Moeda',
    'ConfigKeyword':        'Palavra-chave',
    'ConfigInclusion':      'Item incluso',
    'ConfigHighlight':      'Destaque',
    'ConfigSpecialDate':    'Data especial',
    'ConfigContinent':      'Continente',
    'ConfigPaymentMethod':  'Forma de pagamento',
    'ConfigPaymentPlan':    'Plano de pagamento',
    'ConfigExchangeRate':   'Câmbio',
    'ConfigExchangeSettings':'Config. de câmbio',
    'ConfigHotelCategory':  'Categoria de hotel',
    'ConfigHotel':          'Hotel (catálogo)',
    'ConfigHotelMedia':     'Mídia de hotel',
    'ConfigBoat':           'Barco (catálogo)',
    'ConfigBoatMedia':      'Mídia de barco',
    'CustomDocFieldOption': 'Opção de campo de documento',
    'CrewRole':             'Equipe técnica',
    'Destination':          'Destino',
    'Airport':              'Aeroporto',
    'Airline':              'Companhia aérea',
    'BusMap':               'Mapa de ônibus',
    'BusMapRow':            'Linha de mapa de ônibus',
    'PermissionProfile':    'Perfil de permissão',
    'UserPermissions':      'Permissões de usuário',
    'OperatingCompany':     'Empresa operadora',
    'OperatingCompanyContact': 'Contato da operadora',
    'TermsAndConditions':   'Termos e condições',
    'SystemSettings':       'Configuração do sistema',
    'AgencyMember':         'Membro de agência',
    'Enrollment':           'Inscrição',
    'Roteiro':              'Roteiro da viagem',
    'Room':                 'Quarto',
    'ListTask':             'Tarefa da lista',
    'Itinerary':                'Roteiro',
    'ItineraryImage':           'Imagem do roteiro',
    'ItineraryDeparture':       'Aeroporto de partida',
    'ItineraryFlight':          'Voo',
    'ItineraryHotel':           'Hotel do roteiro',
    'ItineraryBoat':            'Barco do roteiro',
    'ItineraryTerrestreDeparture': 'Cidade de partida (terrestre)',
    'ItineraryTerrestreLeg':    'Trecho terrestre',
    'ItineraryCostItem':        'Item de custo do roteiro',
    'ItineraryCostPayment':     'Custo real (pagamento)',
    'ItineraryInventoryBlock':  'Bloqueio de disponibilidade',
    'ItineraryCurrencyRate':    'Câmbio travado do roteiro',
    'Contract':                 'Contrato',
    'ContractAccommodationLine':'Acomodação do contrato',
    'ContractGuest':            'Hóspede do contrato',
    'ContractInstallment':      'Parcela do contrato',
    'ContractAdjustment':       'Ajuste do contrato',
    'ContractClause':           'Cláusula de contrato',
    'ItineraryFieldTemplate':   'Template de campo (roteiro)',
    # Modelos de negócio que estavam FORA da whitelist (auditoria zero) — incluídos.
    'Lamina':                   'Lâmina',
    'VoucherTemplate':          'Template de voucher',
    'ConfigSpecialNeed':        'Necessidade especial',
    'ConfigCostCategory':       'Categoria de custo',
    'ConfigFlightSegment':      'Segmento de voo (custo)',
}

# Campos a ignorar no diff. IMPORTANTE: nenhum campo aqui é omitido "às escondidas"
# — cada um é técnico e/ou tem o evento coberto por outro caminho:
#   * file / original_name / file_size / mime_type / preview_url / download_url —
#     metadados físicos do arquivo (caminho/uuid/tamanho). O CICLO DE VIDA do arquivo
#     JÁ é auditado: a CRIAÇÃO de um registro com arquivo vira ação 'upload'
#     (instance_has_file), a exclusão vira 'delete', e downloads são logados à parte
#     (log_event 'download'). Renomear/editar metadados legíveis (doc_type, número,
#     legenda, etc.) NÃO está aqui, então continua aparecendo no diff.
#   * signed_file — arquivo do contrato assinado: a mudança de ETAPA já registra o evento.
#   * password / last_login — sensível/ruído.
SKIP_FIELDS = {
    'password', 'last_login', 'file', 'original_name',
    'file_size', 'mime_type', 'preview_url', 'download_url',
    'signed_file',  # arquivo do contrato assinado — a mudança de etapa já registra o evento
    'updated_at', 'created_at',  # campos meta — sempre mudam, geram ruído
    # Roteiro: campos internos/derivados que não interessam ao log
    'published_data', 'published_at', 'has_unpublished_changes', 'order', 'edit_key',
    'signing_version', 'revision',  # versões internas (contrato / lista) — só ruído
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
    'total_usd': 'Total (USD)', 'total_brl': 'Total (BRL)', 'exchange_rate': 'Câmbio',
    'a_vista_discount_usd': 'Desconto à vista (USD)', 'a_vista_discount_mode': 'Desconto à vista (tipo)',
    'received_down_payment_brl': 'Entrada recebida (BRL)', 'received_installments_brl': 'Parcelas recebidas (BRL)',
    'invoice_number': 'Nº da fatura', 'invoice_date': 'Data da fatura', 'observations': 'Observações',
    'package_name': 'Pacote', 'departure_airport': 'Aeroporto de embarque', 'review_note': 'Nota de revisão',
    'payment_type': 'Forma de pagamento', 'seller': 'Vendedor', 'clauses': 'Cláusulas',
    'room_group': 'Grupo (quarto)', 'accommodation_type': 'Tipo de acomodação',
    'payer_name': 'Pagante', 'payer_document': 'Doc. do pagante',
    # ── Roteiro (Itinerary) e filhos ──
    'slug': 'Slug', 'trip_type': 'Tipo', 'is_own_product': 'Produto próprio',
    'is_featured': 'Destaque', 'has_voo': 'Transporte aéreo', 'has_barco': 'Transporte marítimo',
    'has_terrestre': 'Transporte terrestre', 'continent': 'Continente',
    'itinerary_type': 'Tipo de roteiro', 'maritime_company': 'Companhia marítima',
    'base_currency': 'Moeda base', 'custom_clauses': 'Cláusulas personalizadas',
    'payment_plan': 'Plano de pagamento', 'payment_plans': 'Planos de pagamento',
    'a_vista_discount_mode': 'Desconto à vista (tipo)', 'a_vista_discount_value': 'Desconto à vista (valor)',
    'a_vista_payment_method': 'Forma à vista', 'is_published': 'Publicado',
    'info_general': 'Informações gerais', 'info_included': 'O que está incluso',
    'info_not_included': 'O que não está incluso', 'info_optionals': 'Opcionais',
    'info_tips': 'Dicas', 'info_documents': 'Documentos necessários',
    'info_promo_rules': 'Regras da promoção', 'info_insurance': 'Seguro',
    'info_values': 'Valores (texto)', 'info_extras': 'Extras',
    # Roteiro — hotéis / barcos / voos / imagens / documentos
    'check_in': 'Check-in', 'check_out': 'Check-out', 'address': 'Endereço', 'phone': 'Telefone',
    'config_hotel': 'Hotel (catálogo)', 'config_hotel_linked': 'Vínculo com catálogo',
    'config_boat': 'Barco (catálogo)', 'config_boat_linked': 'Vínculo com catálogo',
    'airline': 'Companhia aérea', 'flight_number': 'Número do voo',
    'origin': 'Origem', 'destination': 'Destino', 'departs_at': 'Saída', 'arrives_at': 'Chegada',
    'service_number': 'Identificação', 'company': 'Empresa', 'departure': 'Partida',
    'caption': 'Legenda', 'kind': 'Tipo', 'image': 'Imagem', 'day': 'Dia',
    'value_per_person': 'Valor por pessoa', 'taxes': 'Taxas', 'url': 'Link',
    'flight_departure': 'Partida (aéreo)', 'terrestre_departure': 'Partida (terrestre)',
}

# Templates de campo do roteiro (vínculo vivo) — rótulos gerados p/ os 10 campos.
for _k, _lbl in {'general': 'Informações gerais', 'included': 'Inclusos', 'not_included': 'Não inclusos',
                 'optionals': 'Opcionais', 'tips': 'Dicas', 'documents': 'Documentos',
                 'promo_rules': 'Regras da promoção', 'insurance': 'Seguro', 'values': 'Valores', 'extras': 'Extras'}.items():
    FIELD_LABELS[f'info_{_k}_template'] = f'Template · {_lbl}'
    FIELD_LABELS[f'info_{_k}_template_linked'] = f'Vínculo do template · {_lbl}'


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


def instance_has_file(instance):
    """True se o modelo tem um FileField/ImageField preenchido — usado para logar
    a CRIAÇÃO desses registros como 'upload' (Enviado) em vez de 'create'."""
    from django.db.models import FileField
    for f in instance._meta.concrete_fields:
        if isinstance(f, FileField):
            try:
                if getattr(instance, f.name, None):
                    return True
            except Exception:
                pass
    return False


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


def resolve_source(user):
    """Origem do evento: 'csv' quando a requisição marcou importação de planilha;
    senão 'user' se há usuário autenticado, ou 'system' (automático)."""
    src = get_current_source()
    if src:
        return src
    return 'user' if getattr(user, 'is_authenticated', False) else 'system'


def log_event(action, *, model_name, model_label, object_id='', object_repr='', changes=None, user=None):
    """Registra um evento de auditoria manual — para mutações que os signals não
    capturam (bulk update/create, M2M .set(), reorders, downloads, actions).
    Reutilizável por qualquer app."""
    from .models import AuditLog
    if user is None:
        user = get_current_user()
    authed = getattr(user, 'is_authenticated', False)
    _safe_create(
        user=user if authed else None,
        user_display=user_display(user) if authed else 'Sistema',
        source=resolve_source(user if authed else None),
        action=action, model_name=model_name, model_label=model_label,
        object_id=str(object_id or ''), object_repr=str(object_repr or '')[:500],
        changes=changes or {}, ip_address=get_current_ip(),
    )


def log_field_propagation(instances, new_values, *, model_name, model_label, action='update'):
    """Loga um update de campos APLICADO EM MASSA (`QuerySet.update`, que burla o
    signal) linha a linha, com diff antes/depois só dos campos que realmente mudaram.
    `instances` = objetos com os valores ANTIGOS (capturados ANTES do update);
    `new_values` = dict {campo: novo_valor}. Nada é logado para linhas sem mudança."""
    for inst in instances:
        changes = {}
        for field, new in new_values.items():
            old = getattr(inst, field, None)
            if old != new:
                changes[FIELD_LABELS.get(field, field)] = {
                    'antes': serialize_value(old), 'depois': serialize_value(new)}
        if changes:
            log_event(action, model_name=model_name, model_label=model_label,
                      object_id=inst.pk, object_repr=str(inst), changes=changes)


def check_tracked_model_collisions():
    """A whitelist é chaveada pelo NOME PURO da classe. Isso é intencional para
    COMPATIBILIDADE: o `model_name` gravado no log e todos os filtros/drills de
    consulta (e o frontend) usam o nome puro, que é ÚNICO hoje. O risco é uma COLISÃO
    FUTURA — dois modelos de apps diferentes com o mesmo nome de classe fariam o
    signal rastrear/rotular o modelo errado, silenciosamente. Este guard roda no
    startup e AVISA (loud) se isso acontecer, para o hazard deixar de ser silencioso.
    Retorna a lista de nomes em colisão (para testes)."""
    from django.apps import apps
    by_name = {}
    for m in apps.get_models():
        by_name.setdefault(m.__name__, []).append(m._meta.label)
    collided = []
    for name in TRACKED_MODELS:
        labels = by_name.get(name, [])
        if len(labels) > 1:
            collided.append(name)
            _log.warning('AUDITORIA: nome de modelo rastreado %r existe em múltiplos apps %s — '
                         'o signal usa o nome PURO e pode rastrear/rotular o modelo errado. '
                         'Desambigue (renomeie a classe ou trate por app_label).', name, labels)
    return collided


def log_bulk_delete(instances, *, model_name, model_label):
    """Loga a exclusão de linhas removidas por `QuerySet.delete()` (fast-path, que NÃO
    dispara `post_delete`). Chame ANTES do delete, com a lista já materializada."""
    for inst in instances:
        try:
            repr_str = str(inst)
        except Exception:
            repr_str = f'{model_name}#{getattr(inst, "pk", "")}'
        log_event('delete', model_name=model_name, model_label=model_label,
                  object_id=getattr(inst, 'pk', ''), object_repr=repr_str, changes={})


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
    # Itinerary/Contract serializers fazem o diff COMPLETO (create e update),
    # incluindo M2M/filhos que o diff escalar não pega, e logam por conta própria
    # — o flag suprime o log parcial do signal (vale para create e update).
    if getattr(instance, '_skip_audit_signal', False):
        return

    # Import aqui para evitar import circular
    from .models import AuditLog

    user = get_current_user()

    if created:
        # Registro com arquivo (imagem/documento/mídia) → é um UPLOAD, não "criação".
        action  = 'upload' if instance_has_file(instance) else 'create'
        changes = obj_to_dict(instance)
        # Referência estruturada do arquivo (nome/tipo/tamanho/chave de storage) —
        # centraliza a captura para todo modelo com FileField rastreado.
        if action == 'upload':
            from .files import capture_instance_file
            m = capture_instance_file(instance)
            if m:
                changes['_file'] = m
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
            # 'revisao' só é alcançado ao concluir a assinatura (digital/física) → 'sign'.
            action = {'enviado': 'send', 'assinado': 'sign', 'revisao': 'sign', 'em_edicao': 'reopen',
                      'a_faturar': 'approve', 'faturado': 'invoice'}.get(instance.stage, 'update')

    try:
        repr_str = str(instance)[:500]
    except Exception:
        repr_str = f'{sender.__name__}#{instance.pk}'
    _safe_create(
        user=user,
        user_display=user_display(user),
        source=resolve_source(user),
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
    changes = obj_to_dict(instance)
    # Guarda os metadados históricos do arquivo excluído — o modal ainda mostra
    # nome/tipo/tamanho e deixa claro que o conteúdo não está mais disponível.
    from .files import capture_instance_file
    m = capture_instance_file(instance)
    if m:
        changes['_file'] = m
    _safe_create(
        user=user,
        user_display=user_display(user),
        source=resolve_source(user),
        action=action,
        model_name=sender.__name__,
        model_label=TRACKED_MODELS[sender.__name__],
        object_id=str(instance.pk),
        object_repr=repr_str,
        changes=changes,
        ip_address=get_current_ip(),
    )
