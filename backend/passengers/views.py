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
        # Filtro por agência (?agency=<id>): usado por quem monta uma reserva/
        # contrato PARA uma agência e precisa ver só as pessoas dela. Para o
        # usuário de agência isso já é obrigatório acima; aqui é para a operadora
        # trabalhar dentro do mesmo recorte, por vontade dela.
        ag = self.request.query_params.get('agency')
        if ag:
            qs = qs.filter(agencies__id=ag).distinct()
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
        if self.action in ('create', 'update', 'partial_update', 'discard', 'claim_cpf'):
            return [RequirePermission('passengers_edit')()]
        if self.action == 'merge':
            return [RequirePermission('passengers_edit')(), RequirePermission('passengers_delete')()]
        if self.action in ('check_cpf', 'active'):
            # Endpoints utilitários de leitura usados durante o fluxo de criação/edição
            return [RequirePermission(*VIEW_PERMS, 'passengers_edit')()]
        if self.action in ('guides', 'guide_trips'):
            return [RequirePermission('guides_view')()]
        if self.action in ('list', 'retrieve', 'agencies'):
            # Quem faz contratos também precisa LER/buscar passageiros (seletor de
            # hóspedes do contrato). Sem passengers_view_full os campos sensíveis
            # (CPF, RG, nascimento…) continuam mascarados pelo SensitiveFieldsMixin.
            return [RequirePermission(*VIEW_PERMS, 'contracts_view', 'contracts_edit')()]
        return super().get_permissions()

    @action(detail=True, methods=['get'], url_path='guide-trips')
    def guide_trips(self, request, pk=None):
        """Detalhe de um guia: as viagens que ele faz COMO GUIA (função "Guia"
        marcada na inscrição), com total, total do ano, contagem por ano (para o
        gráfico) e a lista das viagens (clicáveis). Status relativo a hoje."""
        from collections import defaultdict
        from django.utils import timezone
        from trips.models import CrewRole, ListEnrollment
        from core.search import strip_accents

        p = self.get_object()
        today = timezone.localdate()
        guia_ids = {r.id for r in CrewRole.objects.all()
                    if strip_accents(r.name or '').lower() == 'guia'}

        by_year = defaultdict(int)
        trips = []
        enr = (ListEnrollment.objects
               .filter(passenger_id=p.id)
               .exclude(enrollment_status='cancelado')
               .select_related('passenger_list')
               .prefetch_related('crew_roles'))
        for e in enr:
            if not ({r.id for r in e.crew_roles.all()} & guia_ids):
                continue
            l = e.passenger_list
            s, en = l.start_date, l.end_date
            if not s:
                status = 'undated'
            elif s > today:
                status = 'scheduled'
            elif en and en < today:
                status = 'done'
            else:
                status = 'ongoing'
            year = s.year if s else None
            if year:
                by_year[year] += 1
            trips.append({
                'id': l.id,
                'name': l.name or f'Lista #{l.id}',
                'start_date': s.isoformat() if s else None,
                'end_date': en.isoformat() if en else None,
                'status': status,
                'year': year,
            })
        trips.sort(key=lambda t: (t['start_date'] or '0000'), reverse=True)
        return Response({
            'id': p.id,
            'name': p.full_name or f'{p.first_name} {p.last_name}'.strip() or 'Guia',
            'is_guide': p.is_guide,
            'total': len(trips),
            'this_year': by_year.get(today.year, 0),
            'year': today.year,
            'by_year': {str(y): c for y, c in sorted(by_year.items())},
            'trips': trips,
        })

    @action(detail=False, methods=['get'])
    def guides(self, request):
        """Guias e as viagens que cada um faz COMO GUIA — por ANO e por STATUS
        (agendada / em andamento / concluída).

        É considerado guia quem: (a) está marcado como guia no cadastro
        (is_guide), OU (b) tem a função "Guia" (Equipe Técnica) em ALGUMA viagem —
        mesmo sem estar marcado no cadastro. A CONTAGEM é sempre EXPLÍCITA: só
        conta a viagem em que a função "Guia" foi marcada naquela inscrição. Ser
        guia no cadastro NÃO faz as outras viagens contarem — cada viagem só conta
        se você escolheu que ali a pessoa é guia. O ano é o de início da viagem; o
        status é relativo a hoje."""
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
                # Conta SÓ as viagens onde a função "Guia" foi marcada nesta
                # inscrição (Equipe Técnica). Ser guia no cadastro (is_guide) NÃO
                # faz a viagem contar por padrão — só a viagem escolhida conta.
                if not (role_ids & guia_ids):
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

    @staticmethod
    def _passenger_by_cpf_qs(cpf):
        digits = re.sub(r'\D', '', cpf)
        return (Passenger.objects.filter(Q(cpf=cpf) | Q(cpf=digits), is_deleted=False)
                .exclude(cpf='').exclude(status='rascunho'))

    @staticmethod
    def _passenger_brief(p):
        return {'id': p.id, 'name': (p.full_name or
                                     f'{p.first_name} {p.last_name}'.strip() or 'Passageiro')}

    @action(detail=False, methods=['get'], url_path='check-cpf')
    def check_cpf(self, request):
        cpf = request.query_params.get('cpf', '').strip()
        if not cpf:
            return Response({'error': 'CPF não informado.'}, status=400)
        base = self._passenger_by_cpf_qs(cpf)
        # Isolamento por agência (A-01): por padrão, usuário de agência não pode usar
        # o check-cpf como oráculo para descobrir passageiros de OUTRAS agências.
        # `?claim=1` (fluxo "Novo passageiro") abre exceção: revela que o passageiro
        # já existe no sistema para permitir ASSOCIÁ-LO à agência (claim-cpf abaixo).
        from users_api.permissions import agency_scope_ids
        scope = agency_scope_ids(request.user)
        if scope is None:
            p = base.first()
            return Response({'exists': True, 'in_scope': True, **self._passenger_brief(p)}
                            if p else {'exists': False})
        in_p = base.filter(agencies__in=scope).first()
        if in_p:
            return Response({'exists': True, 'in_scope': True, **self._passenger_brief(in_p)})
        if request.query_params.get('claim'):
            out_p = base.first()
            if out_p:
                return Response({'exists': True, 'in_scope': False, 'can_claim': True,
                                 **self._passenger_brief(out_p)})
        return Response({'exists': False})

    @action(detail=False, methods=['post'], url_path='claim-cpf')
    def claim_cpf(self, request):
        """Associa um passageiro JÁ EXISTENTE (por CPF) à(s) agência(s) do usuário —
        para quando a agência vai vender para alguém que já está no banco (cadastrado
        por outra agência/operadora). Depois disso o passageiro entra no escopo da
        agência e o cadastro completo fica acessível. Interno/superusuário não precisa
        associar (já vê tudo)."""
        cpf = request.data.get('cpf', '').strip()
        if not cpf:
            return Response({'error': 'CPF não informado.'}, status=400)
        passenger = self._passenger_by_cpf_qs(cpf).first()
        if not passenger:
            return Response({'error': 'Passageiro não encontrado.'}, status=404)
        from users_api.permissions import agency_scope_ids
        scope = agency_scope_ids(request.user)
        if scope:
            from agencies.models import Agency
            passenger.agencies.add(*Agency.objects.filter(id__in=scope))
        return Response(self._passenger_brief(passenger))

    @action(detail=False, methods=['get'], url_path='check-email')
    def check_email(self, request):
        email = request.query_params.get('email', '').strip()
        if not email:
            return Response({'error': 'E-mail não informado.'}, status=400)
        qs = Passenger.objects.filter(email__iexact=email, is_deleted=False)
        exclude_id = request.query_params.get('exclude')
        if exclude_id:
            qs = qs.exclude(pk=exclude_id)
        passenger = qs.first()
        if not passenger:
            return Response({'exists': False})
        # O e-mail é único globalmente, então precisamos avisar mesmo quando o
        # passageiro é de outra agência. Mas o NOME só é revelado se estiver no
        # escopo do usuário — evita usar o endpoint para enumerar PII cross-tenant
        # (mesma proteção do check-cpf).
        from users_api.permissions import agency_scope_ids
        scope = agency_scope_ids(request.user)
        in_scope = scope is None or passenger.agencies.filter(id__in=scope).exists()
        data = {'exists': True, 'id': passenger.id if in_scope else None}
        if in_scope:
            data['name'] = (passenger.full_name or
                            f'{passenger.first_name} {passenger.last_name}'.strip() or
                            'Passageiro')
        return Response(data)

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

    def get_queryset(self):
        """Isolamento por agência (A-01): usuário de agência só acessa documentos de
        passageiros ligados à(s) própria(s) agência(s). Sem isso, o download por pk
        vazaria PII (passaporte/RG) de passageiros de outras agências (IDOR)."""
        from users_api.permissions import agency_scope_ids
        qs = PassengerDocument.objects.all()
        scope = agency_scope_ids(self.request.user)
        if scope is not None:
            qs = qs.filter(passenger__agencies__in=scope).distinct()
        return qs

    def partial_update(self, request, pk=None):
        """Atualiza metadados do documento (sem substituir o arquivo)."""
        try:
            doc = self.get_queryset().get(pk=pk)
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
            doc = self.get_queryset().get(pk=pk)
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
            doc = self.get_queryset().get(pk=pk)
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
            doc = self.get_queryset().get(pk=pk)
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
        from audit.files import meta_from_fieldfile
        user = get_current_user()
        _m = meta_from_fieldfile(doc.file, original_name=getattr(doc, 'original_name', None) or None,
                                 mime=getattr(doc, 'mime_type', None) or '', size=getattr(doc, 'file_size', None) or None)
        AuditLog.objects.create(
            user=user,
            user_display=user_display(user),
            action='download',
            model_name='PassengerDocument',
            model_label='Documento',
            object_id=str(doc.pk),
            object_repr=str(doc)[:500],
            changes=({'_file': _m} if _m else {}),
            ip_address=get_current_ip(),
        )
        return response
