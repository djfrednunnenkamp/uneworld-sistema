import os

from rest_framework import viewsets, filters, status as http_status
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from core.pagination import StandardResultsPagination
from core.soft_delete import SoftDeleteViewSetMixin
from users_api.permissions import RequirePermission

from . import autentique
from .models import Contract
from .serializers import ContractListSerializer, ContractSerializer


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
    if autentique.is_fully_signed(doc) and contract.stage != 'assinado':
        url = autentique.signed_file_url(doc)
        if url:
            pdf = autentique.download(url)
            fname = f'contrato_{contract.reservation_number or contract.id}_assinado.pdf'
            contract.signed_file.save(fname, ContentFile(pdf), save=False)
            contract.stage = 'assinado'
            contract.signed_at = timezone.now()
            fields += ['signed_file', 'stage', 'signed_at']
            became_signed = True
    if save:
        contract.save(update_fields=fields)
    return became_signed


def _log_contract_event(request, contract, action, label):
    """Registra no log de auditoria uma ação sobre o contrato que NÃO passa por
    save() — download do arquivo assinado/PDF e upload do contrato assinado.
    (Criação, edição e mudança de etapa já são capturadas automaticamente pelos
    sinais em audit/tracking.py.) `label` descreve a ação no detalhe do evento."""
    from audit.models import AuditLog
    from audit.middleware import get_current_ip
    from audit.tracking import user_display
    user = request.user
    AuditLog.objects.create(
        user=user, user_display=user_display(user), action=action,
        model_name='Contract', model_label='Contrato',
        object_id=str(contract.pk), object_repr=str(contract)[:500],
        changes={'Ação': label} if label else {}, ip_address=get_current_ip(),
    )


class ContractViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset        = Contract.objects.select_related('agency', 'contratante', 'passenger_list', 'itinerary').prefetch_related(
        'accommodation_lines', 'guests__passenger', 'installments', 'adjustments', 'clauses')
    pagination_class = StandardResultsPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields   = ['reservation_number', 'package_name', 'contratante__full_name',
                       'agency__name', 'agency__company_name']
    ordering_fields = ['created_at', 'contract_date', 'departure_date']

    def get_serializer_class(self):
        return ContractListSerializer if self.action == 'list' else ContractSerializer

    def get_permissions(self):
        if self.action == 'destroy':
            return [RequirePermission('contracts_delete')()]
        if self.action in ('create', 'update', 'partial_update', 'restore', 'purge',
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
        ser = ContractSerializer(data=request.data, context={'request': request})
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
            contract.autentique_document_id = doc.get('id') or ''
            _apply_autentique_state(contract, doc, save=False)
            contract.stage = 'enviado'
            contract.sent_at = timezone.now()
            contract.save(update_fields=['autentique_document_id', 'autentique_data', 'stage', 'sent_at'])
        else:
            contract.stage = 'enviado'
            contract.sent_at = timezone.now()
            contract.save(update_fields=['stage', 'sent_at'])
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
                            f'Baixou o contrato assinado #{contract.id}')
        resp = FileResponse(contract.signed_file.open('rb'), as_attachment=False, filename=fname)
        # Permite renderizar no iframe da mesma origem (X_FRAME_OPTIONS é DENY por
        # padrão). O middleware não sobrescreve um header já definido.
        resp['X-Frame-Options'] = 'SAMEORIGIN'
        return resp

    @action(detail=True, methods=['post'], url_path='reopen')
    def reopen(self, request, pk=None):
        """Volta o contrato para 'Em edição'."""
        contract = self.get_object()
        contract.stage = 'em_edicao'
        contract.save(update_fields=['stage'])
        return Response(ContractSerializer(contract, context={'request': request}).data)

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
            f = validate_document_file(f)
        except DjangoValidationError as e:
            return Response({'error': ' '.join(e.messages)}, status=http_status.HTTP_400_BAD_REQUEST)
        from django.utils import timezone
        contract.signed_file = f
        contract.stage = 'assinado'
        contract.signed_at = timezone.now()
        contract.save(update_fields=['signed_file', 'stage', 'signed_at'])
        _log_contract_event(request, contract, 'upload',
                            'Enviou (upload) o contrato assinado')
        return Response(ContractSerializer(contract, context={'request': request}).data)


@api_view(['POST', 'GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def autentique_webhook(request):
    """Endpoint público chamado pela Autentique quando há eventos de assinatura.

    A Autentique não assina o payload de forma padronizada, então não confiamos
    no corpo: protegemos por um segredo na URL (?secret=) e, ao ser chamado,
    re-consultamos a API para cada contrato digital ainda pendente e atualizamos
    o estado (baixando o PDF quando todos assinarem). Assim o handler independe
    do formato exato do evento.

    Configure na Autentique a URL:
      {BACKEND_URL}/api/contracts/autentique-webhook/?secret=<AUTENTIQUE_WEBHOOK_SECRET>
    """
    from django.conf import settings
    from dashboard.signals import _broadcast

    secret = getattr(settings, 'AUTENTIQUE_WEBHOOK_SECRET', '')
    if secret and request.GET.get('secret') != secret:
        return Response({'error': 'Segredo inválido.'}, status=http_status.HTTP_403_FORBIDDEN)

    pending = Contract.objects.filter(
        signature_type='digital', is_deleted=False,
    ).exclude(autentique_document_id='').exclude(stage='assinado')

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
