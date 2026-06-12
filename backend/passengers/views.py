import os
import re
from django.http import FileResponse, Http404
from django.db.models import Q
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from core.pagination import StandardResultsPagination
from users_api.permissions import RequirePermission, has_any_perm
from .models import Passenger, PassengerDocument
from .serializers import PassengerSerializer, PassengerListSerializer, PassengerDocumentSerializer

VIEW_PERMS = ('passengers_view_basic', 'passengers_view_full')


class PassengerViewSet(viewsets.ModelViewSet):
    queryset = Passenger.objects.prefetch_related('agencies').all()
    pagination_class = StandardResultsPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['full_name', 'email', 'cpf', 'city']
    ordering_fields = ['full_name', 'created_at', 'city']

    def get_serializer_class(self):
        if self.action == 'list':
            return PassengerListSerializer
        return PassengerSerializer

    def get_permissions(self):
        if self.action == 'destroy':
            return [RequirePermission('passengers_delete')()]
        if self.action in ('create', 'update', 'partial_update'):
            return [RequirePermission('passengers_edit')()]
        if self.action in ('check_cpf', 'active'):
            # Endpoints utilitários de leitura usados durante o fluxo de criação/edição
            return [RequirePermission(*VIEW_PERMS, 'passengers_edit')()]
        if self.action in ('list', 'retrieve', 'agencies'):
            return [RequirePermission(*VIEW_PERMS)()]
        return super().get_permissions()

    @action(detail=False, methods=['get'], url_path='check-cpf')
    def check_cpf(self, request):
        cpf = request.query_params.get('cpf', '').strip()
        if not cpf:
            return Response({'error': 'CPF não informado.'}, status=400)
        digits = re.sub(r'\D', '', cpf)
        passenger = Passenger.objects.filter(
            Q(cpf=cpf) | Q(cpf=digits)
        ).exclude(cpf='').first()
        if passenger:
            name = (passenger.full_name or
                    f"{passenger.first_name} {passenger.last_name}".strip() or
                    'Passageiro')
            return Response({'exists': True, 'id': passenger.id, 'name': name})
        return Response({'exists': False})

    @action(detail=False, methods=['get'])
    def active(self, request):
        qs = self.get_queryset().filter(status='active')
        return Response(PassengerListSerializer(qs, many=True, context={'request': request}).data)

    @action(detail=True, methods=['get'], url_path='agencies')
    def agencies(self, request, pk=None):
        """Retorna as agências vinculadas a este passageiro."""
        passenger = self.get_object()
        data = [{
            'id':           a.id,
            'name':         a.company_name or a.name or f'Agência #{a.pk}',
            'company_name': a.company_name,
            'cnpj':         a.cnpj,
            'cpf':          a.cpf,
            'person_type':  a.person_type,
        } for a in passenger.agencies.all()]
        return Response(data)

    @action(detail=True, methods=['get', 'post'], url_path='documents',
            parser_classes=[MultiPartParser, FormParser])
    def documents(self, request, pk=None):
        if request.method == 'GET':
            if not has_any_perm(request.user, 'passengers_view_full'):
                return Response({'error': 'Sem permissão.'}, status=403)
        elif not has_any_perm(request.user, 'passengers_upload_docs'):
            return Response({'error': 'Sem permissão.'}, status=403)

        passenger = self.get_object()
        if request.method == 'GET':
            docs = passenger.documents.all()
            return Response(PassengerDocumentSerializer(docs, many=True, context={'request': request}).data)

        serializer = PassengerDocumentSerializer(data=request.data, context={'request': request})
        if serializer.is_valid():
            serializer.save(passenger=passenger)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class PassengerDocumentViewSet(viewsets.GenericViewSet):
    queryset = PassengerDocument.objects.all()
    serializer_class = PassengerDocumentSerializer
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        if self.action in ('preview', 'download'):
            return [RequirePermission('passengers_download_docs')()]
        if self.action in ('partial_update', 'destroy'):
            return [RequirePermission('passengers_edit')()]
        return super().get_permissions()

    def partial_update(self, request, pk=None):
        """Atualiza metadados do documento (sem substituir o arquivo)."""
        try:
            doc = PassengerDocument.objects.get(pk=pk)
        except PassengerDocument.DoesNotExist:
            raise Http404
        # Remove o campo file do request para não sobrescrever
        data = {k: v for k, v in request.data.items() if k != 'file'}
        serializer = PassengerDocumentSerializer(doc, data=data, partial=True, context={'request': request})
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=400)

    def destroy(self, request, pk=None):
        try:
            doc = PassengerDocument.objects.get(pk=pk)
        except PassengerDocument.DoesNotExist:
            raise Http404
        # Remove o arquivo físico do disco
        if doc.file and os.path.isfile(doc.file.path):
            os.remove(doc.file.path)
        doc.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get'])
    def preview(self, request, pk=None):
        """Serve o arquivo inline para exibição no navegador (thumbnail/preview)."""
        try:
            doc = PassengerDocument.objects.get(pk=pk)
        except PassengerDocument.DoesNotExist:
            raise Http404
        try:
            file_path = doc.file.path
        except ValueError:
            raise Http404
        if not os.path.isfile(file_path):
            raise Http404
        response = FileResponse(open(file_path, 'rb'))
        if doc.mime_type:
            response['Content-Type'] = doc.mime_type
        return response

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        import re
        try:
            doc = PassengerDocument.objects.get(pk=pk)
        except PassengerDocument.DoesNotExist:
            raise Http404
        try:
            file_path = doc.file.path
        except ValueError:
            raise Http404
        if not os.path.isfile(file_path):
            raise Http404

        # Gera nome formatado: NomePassageiro_TipoDocumento_Data.ext
        ext = os.path.splitext(file_path)[1].lower()

        passenger_name = (
            doc.passenger.full_name or
            f"{doc.passenger.first_name} {doc.passenger.last_name}".strip() or
            'Passageiro'
        )
        # Remove caracteres especiais e espaços
        def slug(s):
            s = s.strip()
            s = re.sub(r'[áàãâä]', 'a', s, flags=re.I)
            s = re.sub(r'[éèêë]',  'e', s, flags=re.I)
            s = re.sub(r'[íìîï]',  'i', s, flags=re.I)
            s = re.sub(r'[óòõôö]', 'o', s, flags=re.I)
            s = re.sub(r'[úùûü]',  'u', s, flags=re.I)
            s = re.sub(r'[ç]',     'c', s, flags=re.I)
            s = re.sub(r'[^a-zA-Z0-9\s_-]', '', s)
            s = re.sub(r'\s+', '_', s)
            return s

        doc_type_map = {
            'passport':    'Passaporte',
            'rg':          'Identidade',
            'cnh':         'CNH',
            'visa':        'Visto',
            'birth_cert':  'Certidao_Nascimento',
            'residence':   'Comprovante_Residencia',
            'other':       'Documento',
        }
        doc_type_label = doc_type_map.get(doc.doc_type, doc.doc_type)

        date_part = (
            str(doc.issued_date) if doc.issued_date else
            str(doc.uploaded_at.date())
        )

        filename = f"{slug(passenger_name)}_{slug(doc_type_label)}_{date_part}{ext}"

        response = FileResponse(
            open(file_path, 'rb'),
            as_attachment=True,
            filename=filename,
        )
        if doc.mime_type:
            response['Content-Type'] = doc.mime_type

        from audit.models import AuditLog
        from audit.middleware import get_current_user, get_current_ip
        from audit.tracking import user_display
        user = get_current_user()
        AuditLog.objects.create(
            user=user,
            user_display=user_display(user),
            action='download',
            model_name='PassengerDocument',
            model_label='Documento',
            object_id=str(doc.pk),
            object_repr=str(doc)[:500],
            ip_address=get_current_ip(),
        )
        return response
