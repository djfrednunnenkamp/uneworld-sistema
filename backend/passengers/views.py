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
from core.soft_delete import SoftDeleteViewSetMixin
from core.merge import MergeViewSetMixin
from users_api.permissions import RequirePermission, has_any_perm
from .models import Passenger, PassengerDocument
from .serializers import PassengerSerializer, PassengerListSerializer, PassengerDocumentSerializer
from core.search import AccentInsensitiveSearchFilter

VIEW_PERMS = ('passengers_view_basic', 'passengers_view_full')

# Content-Type derivado dos BYTES reais do arquivo (magic bytes), nunca do
# mime_type enviado pelo cliente no upload (A-10). Os uploads já são validados por
# passengers.validators (só JPEG/PNG/PDF passam), então esta allowlist cobre todos
# os arquivos legítimos; qualquer outra coisa cai em octet-stream + attachment.
_SAFE_CONTENT_TYPES = {
    b'\xff\xd8\xff':        'image/jpeg',   # JPEG
    b'\x89PNG\r\n\x1a\n':  'image/png',    # PNG
    b'%PDF':                'application/pdf',
}


def _sniff_safe_content_type(file_path):
    """Lê os primeiros bytes e devolve um Content-Type seguro da allowlist, ou
    None se o conteúdo não for um dos tipos previsíveis (nunca renderizar inline)."""
    try:
        with open(file_path, 'rb') as fh:
            header = fh.read(16)
    except OSError:
        return None
    for sig, ctype in _SAFE_CONTENT_TYPES.items():
        if header.startswith(sig):
            return ctype
    return None


class PassengerViewSet(SoftDeleteViewSetMixin, MergeViewSetMixin, viewsets.ModelViewSet):
    queryset = Passenger.objects.prefetch_related('agencies').all()
    pagination_class = StandardResultsPagination
    filter_backends = [AccentInsensitiveSearchFilter, filters.OrderingFilter]
    search_fields = ['full_name', 'email', 'cpf', 'city']
    ordering_fields = ['full_name', 'created_at', 'city']
    MERGE_LABEL = 'Passageiro'
    MERGE_UNIQUE_FIELDS = ['email']

    @property
    def MERGE_RELATED(self):
        from trips.models import Enrollment, ListEnrollment
        return [
            (ListEnrollment, 'passenger', ['passenger_list']),
            (Enrollment,     'passenger', ['trip']),
            (PassengerDocument, 'passenger', None),
        ]

    def get_serializer_class(self):
        if self.action == 'list':
            return PassengerListSerializer
        return PassengerSerializer

    def get_queryset(self):
        from users_api.permissions import agency_scope_ids
        qs = super().get_queryset()   # aplica o filtro de soft-delete (is_deleted)
        # Usuário de agência só vê passageiros ligados à(s) própria(s) agência(s).
        scope = agency_scope_ids(self.request.user)
        if scope is not None:
            qs = qs.filter(agencies__in=scope).distinct()
        # Rascunhos são PRIVADOS de quem criou (listar/abrir/editar/descartar).
        qs = qs.filter(~Q(status='rascunho') | Q(created_by=self.request.user))
        # Na listagem, rascunhos ficam fora por padrão; ?status=rascunho traz só eles.
        if self.action == 'list':
            if self.request.query_params.get('status') == 'rascunho':
                qs = qs.filter(status='rascunho')
            else:
                qs = qs.exclude(status='rascunho')
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def get_permissions(self):
        if self.action == 'destroy':
            return [RequirePermission('passengers_delete')()]
        if self.action in ('create', 'update', 'partial_update', 'discard'):
            return [RequirePermission('passengers_edit')()]
        if self.action == 'merge':
            return [RequirePermission('passengers_edit')(), RequirePermission('passengers_delete')()]
        if self.action in ('check_cpf', 'active'):
            # Endpoints utilitários de leitura usados durante o fluxo de criação/edição
            return [RequirePermission(*VIEW_PERMS, 'passengers_edit')()]
        if self.action in ('list', 'retrieve', 'agencies', 'guides'):
            return [RequirePermission(*VIEW_PERMS)()]
        return super().get_permissions()

    @action(detail=False, methods=['get'])
    def guides(self, request):
        """Guias e as viagens que cada um faz COMO GUIA — por ANO e por STATUS
        (agendada / em andamento / concluída).

        É considerado guia quem: (a) está marcado como guia no cadastro
        (is_guide), OU (b) tem a função "Guia" (Equipe Técnica) em ALGUMA viagem —
        mesmo sem estar marcado no cadastro. Numa viagem, conta "como guia" quando
        a inscrição tem a função "Guia"; para quem é guia de cadastro, também
        conta quando não há função nenhuma (guia por padrão). Ir com OUTRA função
        (ex.: só motorista) não conta. O ano é o de início da viagem; o status é
        relativo a hoje."""
        from collections import defaultdict
        from django.utils import timezone
        from trips.models import CrewRole, ListEnrollment
        from core.search import strip_accents
        from users_api.permissions import agency_scope_ids

        today = timezone.localdate()
        guia_ids = {r.id for r in CrewRole.objects.all()
                    if strip_accents(r.name or '').lower() == 'guia'}

        scope = agency_scope_ids(request.user)

        def in_scope(qs):
            return qs.filter(agencies__in=scope).distinct() if scope is not None else qs

        # (a) guias de cadastro
        is_guide_ids = set(in_scope(
            Passenger.objects.filter(is_guide=True, is_deleted=False)
        ).values_list('id', flat=True))
        # (b) quem teve a função "Guia" em alguma inscrição (não cancelada)
        role_guide_ids = set()
        if guia_ids:
            role_guide_ids = set(in_scope(Passenger.objects.filter(
                is_deleted=False,
                list_enrollments__crew_roles__in=guia_ids,
            ).exclude(list_enrollments__enrollment_status='cancelado')
            ).values_list('id', flat=True))
        all_ids = is_guide_ids | role_guide_ids
        pax_map = {p.id: p for p in Passenger.objects.filter(id__in=all_ids)}

        def blank():
            return {'scheduled': 0, 'ongoing': 0, 'done': 0}
        per_pax = defaultdict(lambda: defaultdict(blank))   # pax -> ano -> status
        no_date = defaultdict(int)
        years = set()
        if all_ids:
            enr = (ListEnrollment.objects
                   .filter(passenger_id__in=all_ids)
                   .exclude(enrollment_status='cancelado')
                   .select_related('passenger_list')
                   .prefetch_related('crew_roles'))
            for e in enr:
                p = pax_map.get(e.passenger_id)
                if not p:
                    continue
                role_ids = {r.id for r in e.crew_roles.all()}
                has_guia = bool(role_ids & guia_ids)
                # Conta se: tem a função "Guia" nesta viagem, OU é guia de cadastro
                # e não tem função nenhuma (guia por padrão).
                if not (has_guia or (p.is_guide and not role_ids)):
                    continue
                s = e.passenger_list.start_date
                en = e.passenger_list.end_date
                if not s:
                    no_date[p.id] += 1
                    continue
                y = s.year
                years.add(y)
                if s > today:
                    bucket = 'scheduled'
                elif en and en < today:
                    bucket = 'done'
                else:
                    bucket = 'ongoing'
                per_pax[p.id][y][bucket] += 1

        result = []
        for p in pax_map.values():
            by_year = per_pax.get(p.id, {})
            total = sum(sum(v.values()) for v in by_year.values()) + no_date.get(p.id, 0)
            result.append({
                'id': p.id,
                'name': p.full_name or f'{p.first_name} {p.last_name}'.strip() or 'Guia',
                'total': total,
                'by_year': {str(y): v for y, v in by_year.items()},
                'no_date': no_date.get(p.id, 0),
            })
        result.sort(key=lambda g: (-g['total'], g['name'].lower()))
        return Response({'years': sorted(years, reverse=True), 'guides': result})

    @action(detail=False, methods=['get'], url_path='check-cpf')
    def check_cpf(self, request):
        cpf = request.query_params.get('cpf', '').strip()
        if not cpf:
            return Response({'error': 'CPF não informado.'}, status=400)
        digits = re.sub(r'\D', '', cpf)
        passenger = Passenger.objects.filter(
            Q(cpf=cpf) | Q(cpf=digits), is_deleted=False
        ).exclude(cpf='').exclude(status='rascunho').first()
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

    @action(detail=True, methods=['delete'], url_path='discard')
    def discard(self, request, pk=None):
        """Descarta um RASCUNHO de passageiro — apaga de vez (nunca foi real)."""
        obj = self.get_object()
        if obj.status != 'rascunho':
            return Response({'error': 'Apenas rascunhos podem ser descartados.'}, status=400)
        obj.delete()
        return Response(status=204)

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
        # Content-Type derivado dos bytes reais (A-10), nunca do mime_type do
        # cliente. Tipo desconhecido → força download (não renderiza inline).
        from audit.tracking import log_event
        log_event('download', model_name='PassengerDocument', model_label='Documento',
                  object_id=doc.id, object_repr=str(doc),
                  changes={'Visualização': {'antes': '—', 'depois': 'documento aberto/preview'}})
        ctype = _sniff_safe_content_type(file_path)
        if ctype is None:
            response = FileResponse(open(file_path, 'rb'), as_attachment=True,
                                    filename=os.path.basename(file_path))
            response['Content-Type'] = 'application/octet-stream'
        else:
            response = FileResponse(open(file_path, 'rb'))
            response['Content-Type'] = ctype
            response['Content-Disposition'] = 'inline'
        response['X-Content-Type-Options'] = 'nosniff'
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
        # Content-Type seguro derivado dos bytes (A-10), nunca do cliente. Como é
        # sempre anexo (as_attachment), octet-stream para o desconhecido é seguro.
        response['Content-Type'] = _sniff_safe_content_type(file_path) or 'application/octet-stream'
        response['X-Content-Type-Options'] = 'nosniff'

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
