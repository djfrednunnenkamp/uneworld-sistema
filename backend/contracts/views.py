import os

from rest_framework import viewsets, filters, status as http_status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response

from core.pagination import StandardResultsPagination
from core.soft_delete import SoftDeleteViewSetMixin
from users_api.permissions import RequirePermission

from .models import Contract
from .serializers import ContractListSerializer, ContractSerializer


class ContractViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset        = Contract.objects.select_related('agency', 'contratante', 'passenger_list', 'itinerary').prefetch_related(
        'accommodation_lines', 'guests', 'installments', 'adjustments', 'clauses')
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
                           'send_for_signature', 'upload_signed', 'reopen'):
            return [RequirePermission('contracts_edit')()]
        return [RequirePermission('contracts_view', 'contracts_edit', 'contracts_delete')()]

    @action(detail=True, methods=['post'], url_path='send-for-signature')
    def send_for_signature(self, request, pk=None):
        """Em edição → Enviado para assinatura (libera o download para imprimir/assinar)."""
        contract = self.get_object()
        contract.stage = 'enviado'
        contract.save(update_fields=['stage'])
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
        salva com nome seguro (UUID)."""
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
        contract.signed_file = f
        contract.stage = 'assinado'
        contract.save(update_fields=['signed_file', 'stage'])
        return Response(ContractSerializer(contract, context={'request': request}).data)
