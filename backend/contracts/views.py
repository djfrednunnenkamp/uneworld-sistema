import os
import logging

from rest_framework import viewsets, filters, status as http_status
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from core.pagination import StandardResultsPagination
from core.throttling import WebhookRateThrottle
from core.soft_delete import SoftDeleteViewSetMixin
from users_api.permissions import RequirePermission

from . import autentique
from .models import Contract
from .serializers import ContractListSerializer, ContractSerializer
from core.search import AccentInsensitiveSearchFilter

logger = logging.getLogger(__name__)


def _contract_signers(contract, method=None, sms_verification=False):
    """Signatários do contrato para a Autentique: o cliente (contratante) e a
    agência. Cada um precisa de e-mail (ou telefone, se a entrega for por
    WhatsApp/SMS). `method` é o canal escolhido no envio ('email'|'whatsapp'|
    'sms'); None usa o padrão global. `sms_verification` (config da operadora)
    exige autenticação por SMS antes de assinar (2FA) — aplicada ao cliente e à
    agência, NÃO ao CEO (que assina automaticamente via token e travaria com 2FA).
    Retorna (signers, faltando, metas) — `faltando` lista as partes sem contato
    utilizável (texto p/ o usuário); `metas` traz {role,name,channel,contact} de
    cada signatário na MESMA ordem de `signers` (usado no painel de acompanhamento,
    já que a Autentique não expõe canal/telefone por assinatura)."""
    signers, missing, metas = [], [], []

    # Cliente / contratante (passageiro cadastrado ou pagante manual).
    if contract.contratante_id:
        from .serializers import passenger_phone
        c_email = (contract.contratante.email or '').strip()
        c_phone = passenger_phone(contract.contratante)
        c_name  = contract.contratante.full_name or 'Cliente'
    else:
        c_email = (contract.payer_email or '').strip()
        c_phone = (contract.payer_phone or '').strip()
        c_name  = contract.payer_name or 'Cliente'
    # O CLIENTE usa o canal escolhido no pop-up: telefone p/ WhatsApp/SMS, e-mail
    # p/ e-mail. A mensagem de "faltando" diz qual contato falta.
    client_channel = _DELIVERY_LABEL.get(autentique._delivery_method(method)) or 'email'
    client_needs = 'telefone' if client_channel in ('whatsapp', 'sms') else 'e-mail'
    c_signer = autentique.build_signer(email=c_email, phone=c_phone, method=method, sms_verification=sms_verification)
    if c_signer:
        signers.append(c_signer)
        metas.append({'role': 'Cliente', 'name': c_name, 'channel': client_channel,
                      'contact': c_phone if client_channel in ('whatsapp', 'sms') else c_email})
    else:
        missing.append(f'cliente ({c_name}) — falta {client_needs}')

    # Agência.
    ag = contract.agency
    if ag:
        auto = ag.auto_sign_enabled
        # Com assinatura automática, o signatário usa o E-MAIL DA CONTA AUTENTIQUE
        # da agência (é essa conta que assina via token logo após a criação); sem
        # ela, usa o e-mail de contato normal.
        a_email = ((ag.autentique_email if auto else ag.email) or '').strip()
        a_phone = (ag.mobile or ag.phone or '').strip()
        # A AGÊNCIA assina SEMPRE por e-mail — o canal escolhido no pop-up
        # (WhatsApp/SMS) vale só para o passageiro/cliente. Se auto-assina, NÃO
        # aplica 2FA por SMS nela (a conta assina via token, sem link/código).
        a_signer = autentique.build_signer(email=a_email, phone=a_phone, method='email',
                                           sms_verification=(sms_verification and not auto))
        if a_signer:
            signers.append(a_signer)
            metas.append({'role': 'Agência', 'name': ag.name or ag.company_name, 'channel': 'email', 'contact': a_email})
        else:
            missing.append(f'agência ({ag.name or ag.company_name}) — falta e-mail')

    # CEO (assinatura automática): entra como signatário oficial por e-mail — é a
    # conta dona do token que assina via API logo após a criação do documento.
    from config_api.models import OperatingCompany
    oc = OperatingCompany.get()
    if oc.ceo_auto_sign_enabled:
        signers.append({'action': 'SIGN', 'email': oc.ceo_email.strip()})
        metas.append({'role': 'Operadora (CEO)', 'name': (oc.ceo_name or '').strip() or 'CEO',
                      'channel': 'email', 'contact': oc.ceo_email.strip()})

    return signers, missing, metas


_DELIVERY_LABEL = {
    'DELIVERY_METHOD_WHATSAPP': 'whatsapp',
    'DELIVERY_METHOD_SMS':      'sms',
    'DELIVERY_METHOD_LINK':     'link',
}
_META_KEYS = ('role', 'name', 'channel', 'contact')


def _signer_state(s):
    """Extrai o STATUS de uma assinatura da Autentique — só os campos EXISTENTES
    no tipo Signature (email/link/action/viewed/signed/rejected). Quem é / canal /
    contato NÃO vêm da Autentique (o tipo não expõe phone/delivery_method) — são
    injetados dos nossos metadados (ver _apply_autentique_state)."""
    signed = s.get('signed')
    return {
        'public_id': s.get('public_id'),
        'email':  s.get('email') or None,
        'link':   (s.get('link') or {}).get('short_link'),
        'signed': bool(signed),
        'signed_at': signed.get('created_at') if isinstance(signed, dict) else None,
        'viewed': bool(s.get('viewed')),
        'rejected': bool(s.get('rejected')),
    }


def _apply_autentique_state(contract, doc, save=True, metas=None):
    """Espelha o estado dos signatários da Autentique em autentique_data e, se o
    documento já estiver totalmente assinado, baixa o PDF assinado e move o
    contrato para 'Assinado'. Retorna True se passou para assinado agora.

    `metas` (na CRIAÇÃO): metadados dos signatários (papel/nome/canal/contato) na
    MESMA ordem enviada à Autentique. Na verificação (metas=None) os metadados são
    recuperados do que já foi salvo, casando por `public_id` (chave estável)."""
    from django.utils import timezone
    from django.core.files.base import ContentFile

    # SÓ signatários (action=SIGN). A Autentique inclui a CONTA CRIADORA do
    # documento como participante com action=None — se ela entrasse, viraria um
    # "signatário" fantasma e empurraria os metadados (Cliente/Agência/CEO) uma
    # posição, desalinhando tudo (agência aparecia como "aguardando" mesmo já
    # tendo assinado). Filtrar por SIGN mantém a contagem e o alinhamento certos.
    sigs = [s for s in (doc.get('signatures') or []) if (s.get('action') or {}).get('name') == 'SIGN']
    new = [_signer_state(s) for s in sigs]
    # Injeta quem/canal/contato: na criação, alinhado por ORDEM; na verificação,
    # carrega do estado anterior casando por public_id.
    if metas is not None:
        for st, meta in zip(new, metas):
            st.update({k: meta.get(k) for k in _META_KEYS})
    else:
        prev = {p.get('public_id'): p for p in ((contract.autentique_data or {}).get('signers') or []) if p.get('public_id')}
        for st in new:
            old = prev.get(st.get('public_id')) or {}
            for k in _META_KEYS:
                if old.get(k) is not None:
                    st[k] = old.get(k)
    contract.autentique_data = {'document_id': doc.get('id'), 'signers': new}
    became_signed = False
    fields = ['autentique_data']
    if autentique.is_fully_signed(doc) and contract.stage not in ('revisao', 'aprovado'):
        url = autentique.signed_file_url(doc)
        if url:
            pdf = autentique.download(url)
            fname = f'contrato_{contract.reservation_number or contract.id}_assinado.pdf'
            contract.signed_file.save(fname, ContentFile(pdf), save=False)
            # Assinatura completa → vai direto para a revisão da operadora.
            contract.stage = 'revisao'
            contract.signed_at = timezone.now()
            fields += ['signed_file', 'stage', 'signed_at']
            became_signed = True
    if save:
        contract.save(update_fields=fields)
    return became_signed


def _contract_document_name(contract):
    """Nome bonito do documento enviado à Autentique: roteiro + pagante + reserva.
    Ex.: 'Contrato de viagem – PRIMAVERA NA EUROPA – Frederico Nunnenkam – Reserva 000185'."""
    roteiro = ''
    if contract.itinerary_id and (getattr(contract.itinerary, 'name', '') or '').strip():
        roteiro = contract.itinerary.name.strip()
    elif (getattr(contract, 'package_name', '') or '').strip():
        roteiro = contract.package_name.strip()
    payer = ((contract.contratante.full_name if contract.contratante_id else contract.payer_name) or '').strip()
    num = (contract.reservation_number or '').strip() or f'#{contract.id}'
    parts = ['Contrato de viagem']
    if roteiro:
        parts.append(roteiro)
    if payer:
        parts.append(payer)
    parts.append(f'Reserva {num}')
    return ' – '.join(parts)[:255]


def _log_contract_event(request, contract, action, label, file_field=None):
    """Registra no log de auditoria uma ação sobre o contrato que NÃO passa por
    save() — download do arquivo assinado/PDF e upload do contrato assinado.
    (Criação, edição e mudança de etapa já são capturadas automaticamente pelos
    sinais em audit/tracking.py.) `label` descreve a ação; `file_field` diz qual
    arquivo do contrato o evento aponta (pro preview no log)."""
    from audit.models import AuditLog
    from audit.middleware import get_current_ip
    from audit.tracking import user_display
    user = request.user
    changes = {'Ação': label} if label else {}
    if file_field:
        changes['_file_field'] = file_field   # chave interna: o front esconde as que começam com '_'
        # Referência estruturada do arquivo → sobrevive a remoção e não depende do
        # objeto vivo (visualização pelo histórico de logs).
        ff = getattr(contract, file_field, None)
        if ff:
            import os as _os
            from audit.files import meta_from_fieldfile
            # Nome AMIGÁVEL (não a chave interna b4d2…​.pdf) para exibir no log.
            _who = (str(getattr(contract, 'contratante', '') or '')).strip()
            _num = contract.reservation_number or contract.id
            _ext = _os.path.splitext(ff.name)[1] or '.pdf'
            _kind = 'assinado' if file_field == 'signed_file' else 'comprovante'
            _friendly = f'Contrato {_num}{(" — " + _who) if _who else ""} ({_kind}){_ext}'
            m = meta_from_fieldfile(ff, original_name=_friendly)
            if m:
                changes['_file'] = m
    AuditLog.objects.create(
        user=user, user_display=user_display(user), action=action,
        model_name='Contract', model_label='Contrato',
        object_id=str(contract.pk), object_repr=str(contract)[:500],
        changes=changes, ip_address=get_current_ip(),
    )


def enroll_contract_guests(contract, pl):
    """Inscreve os passageiros do contrato na lista `pl`, criando/reaproveitando
    os quartos conforme as acomodações do contrato (respeitando a capacidade do
    tipo). Quem já está na lista é ignorado. Os passageiros entram com o status
    padrão 'pendente' (a confirmar — o símbolo amarelo na lista).
    Retorna (enrolled, skipped, enrolled_ids)."""
    from collections import defaultdict, Counter
    from django.db import transaction
    from trips.models import ListEnrollment, Room, PassengerList
    from trips.views import _autocheck_guia

    enrolled = skipped = 0
    enrolled_ids = []
    # Atômico + lock da lista: sem isso, dois 'approve'/'enroll' simultâneos na
    # mesma lista leem a MESMA ocupação/ordem (occ, order calculados em Python) e
    # geram order_in_list duplicado e estouro da capacidade do quarto; uma falha no
    # meio deixaria parte dos hóspedes inscritos. O select_for_update serializa.
    with transaction.atomic():
        list(PassengerList.objects.select_for_update().filter(pk=pl.pk))

        by_type = defaultdict(list)
        for g in contract.guests.select_related('passenger', 'accommodation_type').all():
            if g.passenger_id:
                # Hotel agrupa por tipo; cabine de navio (sem tipo) por (rótulo,
                # capacidade) — senão todas caem num "Acomodação" genérico.
                if g.accommodation_type_id:
                    key = ('acc', g.accommodation_type_id)
                elif g.accommodation_label or g.ship_cabin_id:
                    key = ('cab', g.accommodation_label or '', g.capacity)
                else:
                    key = ('none', None)
                by_type[key].append(g)

        existing_rooms = set(pl.rooms.values_list('name', flat=True))
        # Ocupação atual de cada quarto (por nome), p/ reaproveitar vagas.
        occ = Counter(pl.list_enrollments.values_list('accommodation', flat=True))
        last = pl.list_enrollments.order_by('-order_in_list').first()
        order = (last.order_in_list + 1) if last else 0

        def next_room_name(tname):
            if tname not in existing_rooms:
                return tname
            i = 1
            while f'{tname} {i}' in existing_rooms:
                i += 1
            return f'{tname} {i}'

        for _key, gs in by_type.items():
            g0 = gs[0]
            atype = g0.accommodation_type
            if atype:                                   # hotel (aéreo/terrestre)
                cap = max(1, (atype.capacity or 1))
                tname = atype.name
            elif g0.accommodation_label:                # cabine de navio
                cap = max(1, (g0.capacity or 1))
                tname = g0.accommodation_label
            else:
                cap = 1
                tname = 'Acomodação'

            # Só entram quem tem passageiro e ainda não está na lista.
            pending = []
            for g in gs:
                p = g.passenger
                if not p or pl.list_enrollments.filter(passenger=p).exists():
                    skipped += 1
                    continue
                pending.append(g)
            if not pending:
                continue

            # Um quarto pertence a este tipo se o nome é 'Tipo' ou 'Tipo N'.
            def is_of_type(name):
                if name == tname:
                    return True
                if name.startswith(tname + ' '):
                    return name[len(tname) + 1:].isdigit()
                return False

            # Vagas livres nos quartos JÁ existentes deste tipo (bare primeiro).
            type_rooms = sorted((r for r in existing_rooms if is_of_type(r)),
                                key=lambda n: (len(n), n))
            slots = []
            for rname in type_rooms:
                slots.extend([rname] * max(0, cap - occ.get(rname, 0)))

            for g in pending:
                if slots:
                    rname = slots.pop(0)                 # reaproveita quarto existente
                else:
                    rname = next_room_name(tname)        # cria um novo só quando lotou
                    Room.objects.get_or_create(passenger_list=pl, name=rname)
                    existing_rooms.add(rname)
                    slots.extend([rname] * (cap - 1))    # sobram cap-1 vagas nesse novo
                e = ListEnrollment.objects.create(
                    passenger_list=pl, passenger=g.passenger, accommodation=rname,
                    order_in_list=order, departure_airport=pl.default_airport,
                    agency=contract.agency,
                )
                occ[rname] += 1
                order += 1
                _autocheck_guia(e)
                enrolled += 1
                enrolled_ids.append(e.id)
    return enrolled, skipped, enrolled_ids


def _promote_paid_contracts():
    """Move os contratos 'Em pagamento' para 'Pagos' (faturado) DEPOIS que a última
    parcela venceu — ou seja, quando a maior due_date das parcelas já passou.
    Rodado ao listar contratos e pelo comando de management (cron)."""
    from django.db.models import Max
    from django.utils import timezone
    today = timezone.localdate()
    ids = list(Contract.objects.filter(stage='em_pagamento', is_deleted=False)
               .annotate(_last_due=Max('installments__due_date'))
               .filter(_last_due__isnull=False, _last_due__lt=today)
               .values_list('id', flat=True))
    if ids:
        Contract.objects.filter(id__in=ids).update(stage='faturado')
        # O bulk update NÃO dispara o signal que loga as demais transições de etapa
        # (send/sign/approve/invoice). Sem isto, a passagem AUTOMÁTICA "Em pagamento →
        # Pagos" some do histórico. Loga cada contrato promovido (ação 'invoice').
        from audit.tracking import log_event, FIELD_LABELS
        for c in Contract.objects.filter(id__in=ids):
            log_event('invoice', model_name='Contract', model_label='Contrato',
                      object_id=c.id, object_repr=str(c),
                      changes={FIELD_LABELS['stage']: {'antes': 'em_pagamento', 'depois': 'faturado'}})
    return ids


class ContractViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset        = Contract.objects.select_related('agency', 'contratante', 'passenger_list', 'itinerary').prefetch_related(
        'accommodation_lines', 'guests__passenger', 'installments', 'adjustments', 'clauses')
    pagination_class = StandardResultsPagination
    filter_backends = [AccentInsensitiveSearchFilter, filters.OrderingFilter]
    search_fields   = ['reservation_number', 'package_name', 'contratante__full_name',
                       'agency__name', 'agency__company_name']
    ordering_fields = ['created_at', 'contract_date', 'departure_date']

    def get_queryset(self):
        from django.db.models import Q
        from users_api.permissions import agency_scope_ids
        qs = super().get_queryset()
        # Usuário de agência só vê contratos da(s) própria(s) agência(s).
        scope = agency_scope_ids(self.request.user)
        if scope is not None:
            qs = qs.filter(agency_id__in=scope)
        # Rascunhos são PRIVADOS de quem criou — em qualquer ação (listar, abrir,
        # editar, descartar) só o dono enxerga o seu rascunho. Contratos
        # finalizados seguem compartilhados normalmente.
        qs = qs.filter(~Q(status='rascunho') | Q(created_by=self.request.user))
        # Na listagem, rascunhos ficam fora por padrão; ?status=rascunho traz só
        # eles (já restritos ao dono pelo filtro acima).
        if self.action == 'list':
            _promote_paid_contracts()   # 'Em pagamento' → 'Pagos' após vencer a última parcela
            if self.request.query_params.get('status') == 'rascunho':
                qs = qs.filter(status='rascunho')
            else:
                qs = qs.exclude(status='rascunho')
        return qs

    def get_serializer_class(self):
        return ContractListSerializer if self.action == 'list' else ContractSerializer

    def update(self, request, *args, **kwargs):
        # A1 (integridade do documento assinado): o contrato só é editável livremente
        # em 'em_edicao'. Uma vez ENVIADO para assinatura — e mais ainda ASSINADO /
        # em revisão / faturado — um PATCH recalcularia os totais divergindo do PDF
        # já assinado (fraude: adulterar valor após a assinatura/faturamento). Para
        # alterar, o usuário deve REABRIR (reopen/reject), que invalida a assinatura
        # e volta para edição. Bloqueia PUT e PATCH (partial_update chama update()).
        contract = self.get_object()
        if contract.stage != 'em_edicao':
            return Response(
                {'error': 'Este contrato não está em edição. Reabra-o para alterar — '
                          'isso invalida a assinatura e exige nova revisão.'},
                status=http_status.HTTP_409_CONFLICT)
        return super().update(request, *args, **kwargs)

    @action(detail=True, methods=['delete'], url_path='discard')
    def discard(self, request, pk=None):
        """Descarta um RASCUNHO (cancelar contrato novo). Apaga de vez — nunca
        foi um contrato real, então não vai pra lixeira. Só rascunhos."""
        obj = self.get_object()
        if obj.status != 'rascunho':
            return Response({'error': 'Apenas rascunhos podem ser descartados.'},
                            status=http_status.HTTP_400_BAD_REQUEST)
        obj.delete()
        return Response(status=http_status.HTTP_204_NO_CONTENT)

    def get_permissions(self):
        if self.action == 'destroy':
            return [RequirePermission('contracts_delete')()]
        if self.action in ('approve', 'review_data'):
            return [RequirePermission('contracts_review')()]
        if self.action == 'enrollable_lists':
            return [RequirePermission('lists_view', 'lists_edit')()]
        if self.action == 'enroll_in_list':
            return [RequirePermission('lists_edit')()]
        # Recusar pode partir da revisão (quem revisa) OU do faturamento (quem fatura).
        if self.action == 'reject':
            return [RequirePermission('contracts_review', 'contracts_invoice')()]
        if self.action == 'invoice':
            return [RequirePermission('contracts_invoice')()]
        if self.action == 'invoice_data':
            return [RequirePermission('contracts_invoice_view', 'contracts_invoice')()]
        if self.action in ('create', 'update', 'partial_update', 'restore', 'purge', 'discard',
                           'send_for_signature', 'upload_signed', 'upload_receipt', 'reopen', 'check_signature',
                           'create_addendum'):
            return [RequirePermission('contracts_edit')()]
        return [RequirePermission('contracts_view', 'contracts_edit', 'contracts_delete')()]

    @action(detail=True, methods=['post'], url_path='create-addendum')
    def create_addendum(self, request, pk=None):
        """Cria um ADENDO deste contrato: um contrato NOVO (rascunho) que já herda o
        CABEÇALHO (roteiro, pagante, agência, câmbio, saída, etc.) e as PESSOAS do
        original — mas nasce SEM valores nem pagamentos (o usuário preenche só o que
        muda, ex.: upgrade). Fica vinculado ao original (parent_contract) e segue o
        fluxo normal de contrato. Devolve o contrato novo para abrir no editor."""
        from django.db import transaction
        from django.utils import timezone
        from .models import ContractGuest
        parent = self.get_object()   # já respeita o escopo de agência (get_queryset)
        user = request.user
        COPY = [
            'agency_id', 'passenger_list_id', 'itinerary_id',
            'itinerary_flight_departure_id', 'itinerary_terrestre_departure_id',
            'contratante_id', 'payer_type', 'payer_name', 'payer_document',
            'payer_birth_date', 'payer_gender', 'payer_email', 'payer_phone', 'payer_address',
            'package_name', 'departure_date', 'return_date', 'departure_airport', 'observations',
            'base_currency', 'payment_type', 'exchange_rate',
            'round_step', 'round_mode', 'round_currency',
            'signature_type', 'agency_seller_id',
        ]
        with transaction.atomic():
            child = Contract(created_by=user, parent_contract=parent, seller=user,
                             status='rascunho', stage='em_edicao',
                             contract_date=timezone.now().date())
            for f in COPY:
                setattr(child, f, getattr(parent, f))
            child.custom_clauses = list(parent.custom_clauses or [])   # cláusulas herdadas do original
            child._skip_audit_signal = True
            child.save()
            child.clauses.set(parent.clauses.all())                    # mesmas cláusulas (M2M) do contrato de origem
            if not child.reservation_number:
                child.reservation_number = f'{child.id:06d}'
                child.save(update_fields=['reservation_number'])
            # Copia só as PESSOAS (nome/ordem) — SEM quarto/acomodação. Assim a aba
            # Valores do adendo nasce VAZIA (as linhas de acomodação são geradas dos
            # quartos; sem quartos, nada é pré-preenchido). O adendo tem valores
            # próprios (ex.: upgrade), que o usuário monta do zero.
            for g in parent.guests.all():
                ContractGuest.objects.create(contract=child, passenger_id=g.passenger_id, order=g.order)
        return Response(ContractSerializer(child, context={'request': request}).data, status=201)

    @action(detail=False, methods=['post'], url_path='preview')
    def preview(self, request):
        """Gera a representação do contrato a partir do payload SEM persistir —
        usado pra pré-visualizar o PDF com as edições ainda não salvas. Salva e
        desfaz dentro de uma transação, reaproveitando exatamente a mesma lógica
        do serializer (totais, *_data, cláusulas padrão) para que a prévia fique
        idêntica ao documento final."""
        from django.db import transaction
        # Prévia pode rodar com o contrato incompleto (sem contratante/agência) —
        # trata como rascunho só pra afrouxar a validação; não muda a renderização.
        data_in = {**request.data, 'status': 'rascunho'}
        ser = ContractSerializer(data=data_in, context={'request': request})
        ser.is_valid(raise_exception=True)
        data = None
        with transaction.atomic():
            instance = ser.save()
            data = ContractSerializer(instance, context={'request': request}).data
            transaction.set_rollback(True)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='sellers')
    def sellers(self, request):
        """Vendedores selecionáveis (ativos, não excluídos).
        - `?agency=<id>`: Vendedor da AGÊNCIA → TODOS os membros daquela agência
          (sem exigir a tag 'Vendedor'; qualquer usuário da agência pode ser).
        - sem `agency`: Vendedor da OPERADORA → internos (sem vínculo de agência)
          que tenham a tag 'Vendedor'.
        Trocar o vendedor da operadora é gated por contracts_change_seller no
        serializer; o vendedor da agência é validado no serializer."""
        from django.contrib.auth.models import User
        from .serializers import _seller_brief
        qs = (User.objects.filter(is_active=True)
              .exclude(permissions__is_deleted=True))
        agency_id = request.query_params.get('agency')
        if agency_id:
            qs = qs.filter(agency_memberships__agency_id=agency_id).distinct()
        else:
            qs = qs.filter(agency_memberships__isnull=True, permissions__is_seller=True)
        qs = qs.select_related('permissions').order_by('first_name', 'last_name', 'username')
        return Response([_seller_brief(u) for u in qs])

    @action(detail=True, methods=['post'], url_path='send-for-signature',
            parser_classes=[MultiPartParser, FormParser])
    def send_for_signature(self, request, pk=None):
        """Em edição → Enviado para assinatura.

        Física: só muda a etapa (o PDF é impresso e assinado à mão).
        Digital: cria o documento na Autentique com o PDF gerado (enviado pelo
        front em `file`) e dispara os pedidos de assinatura para o cliente e a
        agência. O contrato vira 'Assinado' quando a Autentique avisar (webhook)
        ou na verificação manual."""
        from django.utils import timezone
        contract = self.get_object()

        if contract.signature_type == 'digital':
            if not autentique.is_configured():
                return Response({'error': 'Assinatura digital indisponível: a Autentique não está configurada.'},
                                status=http_status.HTTP_400_BAD_REQUEST)
            pdf = request.FILES.get('file')
            if not pdf:
                return Response({'error': 'PDF do contrato não recebido para a assinatura digital.'},
                                status=http_status.HTTP_400_BAD_REQUEST)
            # Canal de entrega escolhido no envio ('email'|'whatsapp'|'sms').
            method = (request.data.get('delivery_method') or '').strip().lower() or None
            # Autenticação por SMS antes de assinar (2FA) — toggle da operadora.
            from config_api.models import OperatingCompany
            sms_verification = OperatingCompany.get().sms_verification
            signers, missing, metas = _contract_signers(contract, method=method, sms_verification=sms_verification)
            if missing:
                return Response({'error': 'Faltam contatos para a assinatura digital: ' + '; '.join(missing) +
                                          '. Preencha antes de enviar. (A agência assina sempre por e-mail.)'},
                                status=http_status.HTTP_400_BAD_REQUEST)
            name = _contract_document_name(contract)
            try:
                doc = autentique.create_document(name, pdf.read(), signers)
            except autentique.AutentiqueError as e:
                return Response({'error': str(e)}, status=http_status.HTTP_502_BAD_GATEWAY)
            # Assinatura automática do CEO (se configurada): assina como a conta
            # do token dele, logo após a criação. Best-effort — se falhar, o
            # documento segue e o CEO ainda pode assinar pelo link.
            from config_api.models import OperatingCompany
            oc = OperatingCompany.get()
            if oc.ceo_auto_sign_enabled and doc.get('id'):
                try:
                    autentique.sign_document(doc['id'], token=oc.ceo_autentique_token.strip())
                    doc = autentique.get_document(doc['id'])   # reflete a assinatura do CEO
                except autentique.AutentiqueError:
                    logger.warning('Falha na assinatura automática do CEO no doc %s', doc.get('id'))
            # Assinatura automática da AGÊNCIA (se configurada): assina como a conta
            # Autentique da agência (token dela). Best-effort — se falhar, o
            # documento segue e a agência ainda assina pelo link enviado.
            ag = contract.agency
            if ag and ag.auto_sign_enabled and doc.get('id'):
                try:
                    autentique.sign_document(doc['id'], token=(ag.autentique_token or '').strip())
                    doc = autentique.get_document(doc['id'])   # reflete a assinatura da agência
                except autentique.AutentiqueError:
                    logger.warning('Falha na assinatura automática da agência no doc %s', doc.get('id'))
            contract.autentique_document_id = doc.get('id') or ''
            _apply_autentique_state(contract, doc, save=False, metas=metas)
            contract.stage = 'enviado'
            contract.sent_at = timezone.now()
            contract.review_note = ''   # nova rodada de assinatura: limpa o motivo da reprovação
            contract.save(update_fields=['autentique_document_id', 'autentique_data', 'stage', 'sent_at', 'review_note'])
        else:
            contract.stage = 'enviado'
            contract.sent_at = timezone.now()
            contract.review_note = ''
            contract.save(update_fields=['stage', 'sent_at', 'review_note'])
        return Response(ContractSerializer(contract, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='check-signature')
    def check_signature(self, request, pk=None):
        """Consulta a Autentique e atualiza o andamento — botão 'Verificar
        assinatura' e rede de segurança caso o webhook não chegue."""
        contract = self.get_object()
        if not contract.autentique_document_id:
            return Response({'error': 'Este contrato não foi enviado para assinatura digital.'},
                            status=http_status.HTTP_400_BAD_REQUEST)
        try:
            doc = autentique.get_document(contract.autentique_document_id)
        except autentique.AutentiqueError as e:
            return Response({'error': str(e)}, status=http_status.HTTP_502_BAD_GATEWAY)
        _apply_autentique_state(contract, doc)
        return Response(ContractSerializer(contract, context={'request': request}).data)

    @action(detail=True, methods=['get'], url_path='signed-file')
    def signed_file_download(self, request, pk=None):
        """Serve o contrato assinado com autenticação/permissão (em vez de expor a
        URL pública de /media). Inline, para abrir no visualizador do sistema."""
        from django.http import FileResponse, Http404
        contract = self.get_object()
        if not contract.signed_file:
            raise Http404
        ext   = os.path.splitext(contract.signed_file.name)[1]
        fname = f'contrato_{contract.reservation_number or contract.id}_assinado{ext}'
        _log_contract_event(request, contract, 'download',
                            f'Baixou o contrato assinado #{contract.id}', file_field='signed_file')
        resp = FileResponse(contract.signed_file.open('rb'), as_attachment=False, filename=fname)
        # Permite renderizar no iframe da mesma origem (X_FRAME_OPTIONS é DENY por
        # padrão). O middleware não sobrescreve um header já definido.
        resp['X-Frame-Options'] = 'SAMEORIGIN'
        resp['X-Content-Type-Options'] = 'nosniff'
        return resp

    @action(detail=True, methods=['get'], url_path='receipt')
    def receipt_download(self, request, pk=None):
        """Serve o comprovante de pagamento (anexado junto do assinado), inline."""
        from django.http import FileResponse, Http404
        contract = self.get_object()
        if not contract.payment_receipt:
            raise Http404
        ext   = os.path.splitext(contract.payment_receipt.name)[1]
        fname = f'comprovante_{contract.reservation_number or contract.id}{ext}'
        _log_contract_event(request, contract, 'download',
                            f'Baixou o comprovante de pagamento do contrato #{contract.id}', file_field='payment_receipt')
        resp = FileResponse(contract.payment_receipt.open('rb'), as_attachment=False, filename=fname)
        resp['X-Frame-Options'] = 'SAMEORIGIN'
        resp['X-Content-Type-Options'] = 'nosniff'
        return resp

    @action(detail=True, methods=['post'], url_path='upload-receipt', parser_classes=[MultiPartParser, FormParser])
    def upload_receipt(self, request, pk=None):
        """Anexa o COMPROVANTE de pagamento avulso (usado no fluxo DIGITAL, onde não
        há upload do assinado). Opcional. Aceita PDF ou imagem."""
        from django.core.exceptions import ValidationError as DjangoValidationError
        from passengers.validators import validate_document_file
        contract = self.get_object()
        receipt = request.FILES.get('receipt')
        if not receipt:
            return Response({'error': 'Nenhum comprovante enviado.'}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            receipt = validate_document_file(receipt, allowed_exts={'.pdf', '.jpg', '.jpeg', '.png', '.webp'}, allow_images=True)
        except DjangoValidationError as e:
            return Response({'error': 'Comprovante inválido: ' + ' '.join(e.messages)}, status=http_status.HTTP_400_BAD_REQUEST)
        contract.payment_receipt = receipt
        contract.save(update_fields=['payment_receipt'])
        _log_contract_event(request, contract, 'upload',
                            f'Anexou o comprovante de pagamento do contrato #{contract.id}', file_field='payment_receipt')
        return Response(ContractSerializer(contract, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='reopen')
    def reopen(self, request, pk=None):
        """Volta o contrato para 'Em edição'.

        Contrato já assinado não pode voltar (o PDF assinado é final). Se for
        digital e ainda pendente na Autentique, o documento é apagado lá antes —
        assim ninguém assina uma versão que foi descartada para reedição."""
        contract = self.get_object()
        if contract.stage == 'assinado':
            return Response(
                {'error': 'Contrato já assinado não pode voltar para edição.'},
                status=http_status.HTTP_400_BAD_REQUEST)

        update_fields = ['stage']
        if contract.signature_type == 'digital' and contract.autentique_document_id:
            try:
                autentique.delete_document(contract.autentique_document_id)
            except autentique.AutentiqueError as e:
                return Response(
                    {'error': f'Não foi possível cancelar a assinatura na Autentique: {e}. '
                              'Tente novamente.'},
                    status=http_status.HTTP_502_BAD_GATEWAY)
            contract.autentique_document_id = ''
            contract.autentique_data = None
            update_fields += ['autentique_document_id', 'autentique_data']

        contract.stage = 'em_edicao'
        contract.review_note = ''   # reabertura manual não é reprovação
        update_fields.append('review_note')
        contract.save(update_fields=update_fields)
        return Response(ContractSerializer(contract, context={'request': request}).data)

    @action(detail=True, methods=['get'], url_path='review-data')
    def review_data(self, request, pk=None):
        """Detalhamento + alertas da revisão (câmbio manual, valores vs roteiro,
        totais que não batem, desconto, dedução de comissão)."""
        from .review import build_review_data
        contract = self.get_object()
        return Response(build_review_data(contract))

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        """Revisão → A faturar (a operadora conferiu os dados; libera para faturar)."""
        from django.utils import timezone
        contract = self.get_object()
        if contract.stage != 'revisao':
            return Response({'error': 'Só é possível aprovar um contrato em revisão.'},
                            status=http_status.HTTP_400_BAD_REQUEST)
        contract.stage = 'a_faturar'
        contract.reviewed_at = timezone.now()
        contract.reviewed_by = request.user
        contract.review_note = ''
        contract.save(update_fields=['stage', 'reviewed_at', 'reviewed_by', 'review_note'])

        resp = dict(ContractSerializer(contract, context={'request': request}).data)
        # Ao aprovar, já inscreve os passageiros do contrato na lista 1:1 do
        # roteiro (entram pendentes/amarelo). O front abre a lista noutra aba.
        try:
            pl = None
            list_deleted = False
            if contract.itinerary_id:
                it = contract.itinerary
                if getattr(it, 'is_deleted', False):
                    # Roteiro (e sua lista) estão na lixeira → não recria, avisa.
                    list_deleted = True
                else:
                    pl = it.passenger_lists.filter(is_deleted=False).order_by('id').first()
                    # Sem lista ativa mas existe uma na lixeira → foi deletada.
                    # NÃO cria uma nova nem adiciona passageiros — só avisa o front.
                    if pl is None and it.passenger_lists.filter(is_deleted=True).exists():
                        list_deleted = True
            if pl:
                enrolled, _skipped, enrolled_ids = enroll_contract_guests(contract, pl)
                resp.update({'enrolled_list_id': pl.id, 'enrolled_list_name': pl.name,
                             'enrolled': enrolled, 'enrolled_ids': enrolled_ids})
            elif list_deleted:
                resp['list_deleted'] = True
        except Exception:
            logger.exception('Falha ao inscrever passageiros do contrato %s ao aprovar', contract.pk)
        # Como o front deve abrir a lista após aprovar (aba separada / mesma aba /
        # não abrir) — PREFERÊNCIA PESSOAL do usuário (Minha conta › Contratos).
        from agenda.models import CalendarPreference
        pref = CalendarPreference.objects.filter(user=request.user).first()
        resp['open_mode'] = pref.contract_review_open_mode if pref else 'new_tab'
        return Response(resp)

    @action(detail=True, methods=['get'], url_path='enrollable-lists')
    def enrollable_lists(self, request, pk=None):
        """Listas de passageiros para receber os passageiros deste contrato. As
        listas que TÊM o roteiro do contrato vêm primeiro. Inclui a prévia dos
        passageiros do contrato + suas acomodações."""
        from trips.models import PassengerList
        contract = self.get_object()
        it_id = contract.itinerary_id
        lists = []
        for pl in PassengerList.objects.filter(is_deleted=False).prefetch_related('roteiros'):
            has = bool(it_id) and any(r.id == it_id for r in pl.roteiros.all())
            lists.append({
                'id': pl.id, 'name': pl.name,
                'start_date': str(pl.start_date) if pl.start_date else None,
                'end_date': str(pl.end_date) if pl.end_date else None,
                'has_itinerary': has, 'pax_count': pl.list_enrollments.count(),
            })
        lists.sort(key=lambda r: (not r['has_itinerary'], (r['name'] or '').lower()))
        guests = [{
            'passenger_id': g.passenger_id,
            'name': (g.passenger.full_name if g.passenger_id else '') or '—',
            'accommodation': g.accommodation_type.name if g.accommodation_type_id else None,
            'capacity': g.accommodation_type.capacity if g.accommodation_type_id else None,
        } for g in contract.guests.select_related('passenger', 'accommodation_type').all() if g.passenger_id]
        return Response({
            'itinerary_id': it_id,
            'itinerary_name': contract.itinerary.name if it_id else None,
            'passengers': guests, 'lists': lists,
        })

    @action(detail=True, methods=['post'], url_path='enroll-in-list')
    def enroll_in_list(self, request, pk=None):
        """Inscreve os passageiros do contrato na lista escolhida, criando os
        quartos conforme as acomodações do contrato (respeitando a capacidade do
        tipo). Quem já está na lista é ignorado."""
        from trips.models import PassengerList
        contract = self.get_object()
        pl = PassengerList.objects.filter(pk=request.data.get('list_id'), is_deleted=False).first()
        if not pl:
            return Response({'error': 'Lista inválida.'}, status=http_status.HTTP_400_BAD_REQUEST)

        enrolled, skipped, enrolled_ids = enroll_contract_guests(contract, pl)
        return Response({'enrolled': enrolled, 'skipped': skipped, 'list_id': pl.id,
                         'list_name': pl.name, 'enrolled_ids': enrolled_ids})

    @action(detail=True, methods=['get'], url_path='invoice-data')
    def invoice_data(self, request, pk=None):
        """Dados relevantes da fatura (totais, comissão, pagamento, agência,
        pagante e datas) + a fatura já registrada, se houver."""
        from .review import build_review_data
        contract = self.get_object()
        data = build_review_data(contract)
        data['invoice'] = {
            'number': contract.invoice_number or '',
            'date': contract.invoice_date.isoformat() if contract.invoice_date else None,
        }
        return Response(data)

    @action(detail=True, methods=['post'], url_path='invoice')
    def invoice(self, request, pk=None):
        """Verificação do financeiro → Em pagamento. O financeiro confere que está
        tudo certo e libera; a passagem para 'Pagos' (faturado) é AUTOMÁTICA depois
        que a última parcela vence (ver _promote_paid_contracts)."""
        from django.utils import timezone
        contract = self.get_object()
        if contract.stage != 'a_faturar':
            return Response({'error': 'Só é possível verificar um contrato na Verificação do financeiro.'},
                            status=http_status.HTTP_400_BAD_REQUEST)
        contract.stage = 'em_pagamento'
        contract.invoiced_at = timezone.now()   # verificado/liberado para pagamento em
        contract.invoiced_by = request.user
        contract.save(update_fields=['invoiced_at', 'invoiced_by', 'stage'])
        return Response(ContractSerializer(contract, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='reject')
    def reject(self, request, pk=None):
        """Revisão OU A faturar → Em edição (recusado), com motivo, para corrigir.

        A assinatura anterior é descartada (o contrato será reeditado e reenviado
        para assinatura)."""
        from django.utils import timezone
        contract = self.get_object()
        if contract.stage not in ('revisao', 'a_faturar'):
            return Response({'error': 'Só é possível recusar um contrato em revisão ou a faturar.'},
                            status=http_status.HTTP_400_BAD_REQUEST)
        note = (request.data.get('note') or '').strip()
        if not note:
            return Response({'error': 'Informe o motivo da reprovação.'},
                            status=http_status.HTTP_400_BAD_REQUEST)
        contract.stage = 'em_edicao'
        contract.reviewed_at = timezone.now()
        contract.reviewed_by = request.user
        contract.review_note = note
        # A assinatura anterior deixa de valer — apaga o documento na Autentique
        # (recusado = descartado lá também) e limpa para uma nova rodada.
        # Best-effort: se a Autentique falhar, a reprovação segue mesmo assim.
        if contract.signature_type == 'digital' and contract.autentique_document_id:
            try:
                autentique.delete_document(contract.autentique_document_id)
            except autentique.AutentiqueError:
                logger.warning('Falha ao apagar documento Autentique %s na reprovação do contrato %s',
                               contract.autentique_document_id, contract.id)
        contract.signed_file = None
        contract.signed_at = None
        contract.autentique_document_id = ''
        contract.autentique_data = None
        contract.save(update_fields=['stage', 'reviewed_at', 'reviewed_by', 'review_note',
                                     'signed_file', 'signed_at', 'autentique_document_id',
                                     'autentique_data'])
        return Response(ContractSerializer(contract, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='signing-qr')
    def signing_qr(self, request, pk=None):
        """Emite os tokens de segurança (um por página) para o PDF de assinatura
        física. O front gera o PDF, conta as páginas e pede os tokens aqui; cada
        token é assinado no backend e vira um QR no canto da página."""
        from .signing import make_token
        contract = self.get_object()
        try:
            n = int(request.data.get('pages') or 0)
        except (TypeError, ValueError):
            n = 0
        if n < 1 or n > 200:
            return Response({'error': 'Número de páginas inválido.'}, status=http_status.HTTP_400_BAD_REQUEST)
        ver = contract.signing_version
        tokens = [{'page': i, 'total': n, 'token': make_token(contract.id, ver, i, n)} for i in range(1, n + 1)]
        return Response({'version': ver, 'pages': n, 'tokens': tokens})

    @action(detail=True, methods=['post'], url_path='upload-signed', parser_classes=[MultiPartParser, FormParser])
    def upload_signed(self, request, pk=None):
        """Upload do contrato assinado → move para 'Assinado'. Valida o arquivo
        (tamanho, extensão PDF/JPEG/PNG, magic bytes e re-processa imagens) e
        salva com nome seguro (UUID).

        A conferência automática (OCR campo a campo + detecção de assinatura)
        está PAUSADA — o módulo contracts/verify.py continua no repo para ser
        retomado no futuro (provavelmente com IA de visão)."""
        from django.core.exceptions import ValidationError as DjangoValidationError
        from passengers.validators import validate_document_file

        contract = self.get_object()
        f = request.FILES.get('file')
        if not f:
            return Response({'error': 'Envie o arquivo assinado (campo "file").'}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            # Contrato assinado: apenas PDF (nada de imagem).
            f = validate_document_file(f, allowed_exts={'.pdf'}, allow_images=False)
        except DjangoValidationError as e:
            return Response({'error': ' '.join(e.messages)}, status=http_status.HTTP_400_BAD_REQUEST)

        # Comprovante de pagamento — OPCIONAL (o front pergunta se quer enviar sem).
        # Aceita PDF ou imagem (foto/print do comprovante).
        receipt = request.FILES.get('receipt')
        if receipt:
            try:
                receipt = validate_document_file(receipt, allowed_exts={'.pdf', '.jpg', '.jpeg', '.png', '.webp'}, allow_images=True)
            except DjangoValidationError as e:
                return Response({'error': 'Comprovante inválido: ' + ' '.join(e.messages)}, status=http_status.HTTP_400_BAD_REQUEST)

        from django.utils import timezone
        # Segurança do assinado físico: lê os QR de cada página e confere se é este
        # contrato, na versão atual, com todas as páginas na ordem.
        # - Erros DEFINITIVOS (contrato/versão/ordem/faltando) → bloqueia sempre.
        # - QR ILEGÍVEL (scan ruim) → deixa confirmar manualmente (override_unverified):
        #   segue para a revisão, mas marcado como NÃO verificado (aviso na revisão).
        from django.conf import settings as dj_settings
        # verified = passou na conferência automática dos QR.
        verification = {'qr_status': 'verified', 'at': timezone.now().isoformat()}
        SOFT_CODES = {'no_qr', 'unreadable_pages'}
        if getattr(dj_settings, 'CONTRACT_QR_VERIFY', True):
            try:
                f.seek(0); pdf_bytes = f.read(); f.seek(0)
            except Exception:
                pdf_bytes = None
            if pdf_bytes:
                from .qr_verify import verify_signed_pdf
                ok, code, message = verify_signed_pdf(contract, pdf_bytes)
                if not ok:
                    override = str(request.data.get('override_unverified', '')).lower() in ('1', 'true', 'yes', 'on')
                    if code in SOFT_CODES and override:
                        from audit.tracking import user_display
                        verification = {'qr_status': 'unverified', 'reason': code, 'message': message,
                                        'overridden_by': user_display(request.user),
                                        'at': timezone.now().isoformat()}
                    else:
                        # can_override True só nos casos de QR ilegível (o front pergunta).
                        return Response({'error': message, 'code': code, 'can_override': code in SOFT_CODES},
                                        status=http_status.HTTP_400_BAD_REQUEST)

        contract.signed_file = f
        fields = ['signed_file', 'stage', 'signed_at', 'signed_verification']
        if receipt:
            contract.payment_receipt = receipt
            fields.append('payment_receipt')
        # Assinado (física) → vai direto para a revisão da operadora.
        contract.stage = 'revisao'
        contract.signed_at = timezone.now()
        contract.signed_verification = verification
        contract.save(update_fields=fields)
        # A mudança de etapa já é registrada no log pelo sinal em audit/tracking.py.
        return Response(ContractSerializer(contract, context={'request': request}).data)


@api_view(['POST', 'GET'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([WebhookRateThrottle])
def autentique_webhook(request):
    """Endpoint público chamado pela Autentique quando há eventos de assinatura.

    A Autentique não assina o payload de forma padronizada, então não confiamos
    no corpo: protegemos por um SEGREDO compartilhado e, ao ser chamado,
    re-consultamos a API para cada contrato digital ainda pendente e atualizamos
    o estado (baixando o PDF quando todos assinarem). Assim o handler independe
    do formato exato do evento (fonte da verdade = API da Autentique, nunca o corpo).

    O segredo é lido preferencialmente do header HTTP `X-Webhook-Secret`; por
    compatibilidade com a configuração atual (a URL cadastrada na Autentique usa
    query string), o `?secret=` ainda é aceito como fallback. Configure na
    Autentique preferencialmente o header, ou mantenha a URL:
      {BACKEND_URL}/api/contracts/autentique-webhook/?secret=<AUTENTIQUE_WEBHOOK_SECRET>

    FAIL-CLOSED (A-07): em produção (DEBUG=False) sem o segredo configurado, o
    endpoint rejeita tudo — nunca aceitar webhook sem segredo em produção.
    """
    import hmac
    from django.conf import settings
    from dashboard.signals import _broadcast

    secret = getattr(settings, 'AUTENTIQUE_WEBHOOK_SECRET', '') or ''
    if not secret:
        # Sem segredo: só permitido em dev. Em produção é fail-closed.
        if not settings.DEBUG:
            logger.warning('autentique_webhook chamado sem AUTENTIQUE_WEBHOOK_SECRET configurado — rejeitado (produção).')
            return Response({'error': 'Webhook não configurado.'}, status=http_status.HTTP_403_FORBIDDEN)
    else:
        provided = request.headers.get('X-Webhook-Secret') or request.GET.get('secret') or ''
        if not hmac.compare_digest(provided, secret):
            return Response({'error': 'Segredo inválido.'}, status=http_status.HTTP_403_FORBIDDEN)

    pending = Contract.objects.filter(
        signature_type='digital', is_deleted=False,
    ).exclude(autentique_document_id='').exclude(stage__in=['revisao', 'aprovado'])

    changed = 0
    for contract in pending:
        try:
            doc = autentique.get_document(contract.autentique_document_id)
            if _apply_autentique_state(contract, doc):
                changed += 1
        except autentique.AutentiqueError:
            continue  # não derruba o webhook por causa de um documento

    if changed:
        _broadcast('contracts')
    return Response({'ok': True, 'checked': pending.count(), 'signed': changed})
