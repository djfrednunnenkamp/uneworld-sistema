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


def _contract_signers(contract):
    """Signatários do contrato para a Autentique: o cliente (contratante) e a
    agência. Cada um precisa de e-mail (ou telefone, se a entrega for por
    WhatsApp/SMS). Retorna (signers, faltando) — `faltando` lista, em texto, as
    partes sem contato utilizável, para avisar o usuário."""
    signers, missing = [], []

    # Cliente / contratante (passageiro cadastrado ou pagante manual).
    if contract.contratante_id:
        c_email = (contract.contratante.email or '').strip()
        c_phone = (contract.contratante.mobile or '').strip()
        c_name  = contract.contratante.full_name or 'Cliente'
    else:
        c_email = (contract.payer_email or '').strip()
        c_phone = (contract.payer_phone or '').strip()
        c_name  = contract.payer_name or 'Cliente'
    c_signer = autentique.build_signer(email=c_email, phone=c_phone)
    if c_signer:
        signers.append(c_signer)
    else:
        missing.append(f'cliente ({c_name})')

    # Agência.
    ag = contract.agency
    if ag:
        a_email = (ag.email or '').strip()
        a_phone = (ag.mobile or ag.phone or '').strip()
        a_signer = autentique.build_signer(email=a_email, phone=a_phone)
        if a_signer:
            signers.append(a_signer)
        else:
            missing.append(f'agência ({ag.name or ag.company_name})')

    # CEO (assinatura automática): entra como signatário oficial por e-mail — é a
    # conta dona do token que assina via API logo após a criação do documento.
    from config_api.models import OperatingCompany
    oc = OperatingCompany.get()
    if oc.ceo_auto_sign_enabled:
        signers.append({'action': 'SIGN', 'email': oc.ceo_email.strip()})

    return signers, missing


def _apply_autentique_state(contract, doc, save=True):
    """Espelha o estado dos signatários da Autentique em autentique_data e, se o
    documento já estiver totalmente assinado, baixa o PDF assinado e move o
    contrato para 'Assinado'. Retorna True se passou para assinado agora."""
    from django.utils import timezone
    from django.core.files.base import ContentFile

    sigs = doc.get('signatures') or []
    contract.autentique_data = {
        'document_id': doc.get('id'),
        'signers': [
            {
                'email': s.get('email'),
                'link': (s.get('link') or {}).get('short_link'),
                'signed': bool(s.get('signed')),
                'viewed': bool(s.get('viewed')),
                'rejected': bool(s.get('rejected')),
            }
            for s in sigs
        ],
    }
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
    from trips.models import ListEnrollment, Room
    from trips.views import _autocheck_guia

    by_type = defaultdict(list)
    for g in contract.guests.select_related('passenger', 'accommodation_type').all():
        if g.passenger_id:
            by_type[g.accommodation_type_id].append(g)

    existing_rooms = set(pl.rooms.values_list('name', flat=True))
    # Ocupação atual de cada quarto (por nome), p/ reaproveitar vagas.
    occ = Counter(pl.list_enrollments.values_list('accommodation', flat=True))
    last = pl.list_enrollments.order_by('-order_in_list').first()
    order = (last.order_in_list + 1) if last else 0
    enrolled = skipped = 0
    enrolled_ids = []

    def next_room_name(tname):
        if tname not in existing_rooms:
            return tname
        i = 1
        while f'{tname} {i}' in existing_rooms:
            i += 1
        return f'{tname} {i}'

    for _tid, gs in by_type.items():
        atype = gs[0].accommodation_type
        cap = max(1, (atype.capacity if atype else 1) or 1)
        tname = atype.name if atype else 'Acomodação'

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
            if self.request.query_params.get('status') == 'rascunho':
                qs = qs.filter(status='rascunho')
            else:
                qs = qs.exclude(status='rascunho')
        return qs

    def get_serializer_class(self):
        return ContractListSerializer if self.action == 'list' else ContractSerializer

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
                           'send_for_signature', 'upload_signed', 'reopen', 'check_signature'):
            return [RequirePermission('contracts_edit')()]
        return [RequirePermission('contracts_view', 'contracts_edit', 'contracts_delete')()]

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
        """Usuários selecionáveis como vendedor do contrato (ativos, não excluídos).
        Disponível para qualquer um que acesse contratos; trocar o vendedor de
        fato é gated por contracts_change_seller no serializer."""
        from django.contrib.auth.models import User
        from .serializers import _seller_brief
        users = (User.objects.filter(is_active=True)
                 .exclude(permissions__is_deleted=True)
                 .select_related('permissions')
                 .order_by('first_name', 'last_name', 'username'))
        return Response([_seller_brief(u) for u in users])

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
            signers, missing = _contract_signers(contract)
            if missing:
                contato = 'telefone' if autentique._delivery_method() else 'e-mail'
                return Response({'error': f'Sem {contato} para: ' + ', '.join(missing) +
                                          f'. Preencha o {contato} antes de enviar para assinatura digital.'},
                                status=http_status.HTTP_400_BAD_REQUEST)
            name = f'Contrato {contract.reservation_number}'.strip() if contract.reservation_number else f'Contrato #{contract.id}'
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
            contract.autentique_document_id = doc.get('id') or ''
            _apply_autentique_state(contract, doc, save=False)
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
                    if pl is None:
                        if it.passenger_lists.filter(is_deleted=True).exists():
                            # A lista do roteiro está na lixeira → não recria, avisa.
                            list_deleted = True
                        else:
                            # Nunca teve lista (roteiro antigo) → cria e usa.
                            from trips.services import sync_passenger_list_for_itinerary
                            pl = sync_passenger_list_for_itinerary(it, allow_create=True, ignore_published=True)
            if pl:
                enrolled, _skipped, enrolled_ids = enroll_contract_guests(contract, pl)
                resp.update({'enrolled_list_id': pl.id, 'enrolled_list_name': pl.name,
                             'enrolled': enrolled, 'enrolled_ids': enrolled_ids})
            elif list_deleted:
                resp['list_deleted'] = True
        except Exception:
            logger.exception('Falha ao inscrever passageiros do contrato %s ao aprovar', contract.pk)
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
        """A faturar → Faturado. Registra número e data da fatura."""
        from django.utils import timezone
        from datetime import date as _date
        contract = self.get_object()
        if contract.stage not in ('a_faturar', 'faturado'):
            return Response({'error': 'Só é possível faturar um contrato que está "A faturar".'},
                            status=http_status.HTTP_400_BAD_REQUEST)
        number = (request.data.get('invoice_number') or '').strip()
        if not number:
            return Response({'error': 'Informe o número da fatura.'}, status=http_status.HTTP_400_BAD_REQUEST)
        raw_date = (request.data.get('invoice_date') or '').strip()
        inv_date = None
        if raw_date:
            try:
                inv_date = _date.fromisoformat(raw_date)
            except ValueError:
                return Response({'error': 'Data da fatura inválida.'}, status=http_status.HTTP_400_BAD_REQUEST)
        contract.invoice_number = number
        contract.invoice_date = inv_date
        contract.invoiced_at = timezone.now()
        contract.invoiced_by = request.user
        contract.stage = 'faturado'
        contract.save(update_fields=['invoice_number', 'invoice_date', 'invoiced_at', 'invoiced_by', 'stage'])
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
        # A assinatura anterior deixa de valer — limpa para uma nova rodada.
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

        # Comprovante de pagamento — OBRIGATÓRIO, anexado junto do assinado. Aceita
        # PDF ou imagem (foto/print do comprovante).
        receipt = request.FILES.get('receipt')
        if not receipt:
            return Response({'error': 'Anexe o comprovante de pagamento (campo "receipt").'}, status=http_status.HTTP_400_BAD_REQUEST)
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
        contract.payment_receipt = receipt
        # Assinado (física) → vai direto para a revisão da operadora.
        contract.stage = 'revisao'
        contract.signed_at = timezone.now()
        contract.signed_verification = verification
        contract.save(update_fields=['signed_file', 'payment_receipt', 'stage', 'signed_at', 'signed_verification'])
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
