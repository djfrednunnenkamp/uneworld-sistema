import csv
import io

from django.db.models import Q
from django.http import HttpResponse
from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.response import Response

from core.pagination import StandardResultsPagination
from core.search import AccentInsensitiveSearchFilter
from core.soft_delete import SoftDeleteViewSetMixin
from users_api.permissions import RequirePermission
from audit.tracking import log_event

from .models import Fornecedor
from .serializers import FornecedorSerializer, FornecedorListSerializer
from .importer import (
    parse_csv_bytes, analyze_rows, apply_rows, ImportError_,
    CANON_COLUMNS, CANON_LABELS,
)
from .normalize import format_cpf, format_cnpj, CATEGORY_LABELS

VIEW_PERMS = ['fornecedores_view', 'fornecedores_edit', 'fornecedores_create']


class FornecedorViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    """CRUD de fornecedores + importação/exportação. Mesmo padrão das agências:
    soft-delete via mixin, paginação StandardResultsPagination, busca
    acento-insensível e ordenação por coluna."""
    queryset = Fornecedor.objects.all()
    pagination_class = StandardResultsPagination
    filter_backends = [AccentInsensitiveSearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'company_name', 'cpf', 'cnpj', 'airline_abbr', 'city']
    ordering_fields = ['name', 'status', 'category', 'city', 'country', 'created_at']
    ordering = ['name']

    def get_serializer_class(self):
        return FornecedorListSerializer if self.action == 'list' else FornecedorSerializer

    def get_permissions(self):
        a = self.action
        if a == 'create':
            return [RequirePermission('fornecedores_create', 'fornecedores_edit')()]
        if a in ('update', 'partial_update'):
            return [RequirePermission('fornecedores_edit')()]
        if a == 'destroy':
            return [RequirePermission('fornecedores_delete')()]
        if a == 'set_status':
            return [RequirePermission('fornecedores_status', 'fornecedores_edit')()]
        if a == 'restore':
            return [RequirePermission('fornecedores_delete')()]
        if a == 'purge':
            return [IsAdminUser()]
        if a in ('import_analyze', 'import_apply'):
            return [RequirePermission('fornecedores_import')()]
        if a == 'export':
            return [RequirePermission('fornecedores_export')()]
        if a == 'template':
            return [RequirePermission('fornecedores_import', *VIEW_PERMS)()]
        if a in ('list', 'retrieve'):
            return [RequirePermission(*VIEW_PERMS)()]
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset().select_related('created_by')
        # Filtros server-side opcionais (a lista principal filtra no front, mas a
        # exportação e chamadas diretas podem restringir por aqui).
        p = self.request.query_params
        if p.get('status'):
            qs = qs.filter(status=p['status'])
        if p.get('category'):
            qs = qs.filter(category=p['category'])
        if p.get('city'):
            qs = qs.filter(city__iexact=p['city'].strip())
        if p.get('country'):
            qs = qs.filter(country__iexact=p['country'].strip())
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    # ── Ativar / inativar (permissão própria) ─────────────────────────────────
    @action(detail=True, methods=['post'], url_path='set-status')
    def set_status(self, request, pk=None):
        obj = self.get_object()
        new_status = (request.data.get('status') or '').strip()
        if new_status not in ('ativo', 'inativo'):
            return Response({'status': 'Status inválido (use ativo|inativo).'}, status=400)
        obj.status = new_status
        obj.save(update_fields=['status', 'updated_at'])   # auditado automaticamente
        return Response(FornecedorSerializer(obj, context={'request': request}).data)

    # ── Importação: análise (sem gravar) ──────────────────────────────────────
    @action(detail=False, methods=['post'], url_path='import/analyze')
    def import_analyze(self, request):
        raw_rows, mapping = self._read_rows(request)
        if raw_rows is None:
            return Response({'error': self._read_error}, status=400)
        results, counts = analyze_rows(raw_rows)
        return Response({'mapping': mapping, 'columns': CANON_COLUMNS,
                         'summary': counts, 'rows': results})

    # ── Importação: aplicação (transacional) ──────────────────────────────────
    @action(detail=False, methods=['post'], url_path='import/apply')
    def import_apply(self, request):
        mode = (request.data.get('mode') or 'upsert').strip()
        if mode not in ('create', 'upsert'):
            mode = 'upsert'
        raw_rows = request.data.get('rows')
        filename = (request.data.get('filename') or '').strip()
        if not isinstance(raw_rows, list) or not raw_rows:
            # também aceita re-upload do arquivo
            raw_rows, _mapping = self._read_rows(request)
            if raw_rows is None:
                return Response({'error': self._read_error}, status=400)
        try:
            summary = apply_rows(raw_rows, mode, request.user)
        except ImportError_ as e:
            return Response({'error': str(e)}, status=400)
        # Log resumido da importação (o campo-a-campo de cada registro já é
        # auditado pelos signals; aqui fica o evento agregado com o arquivo).
        log_event('upload', model_name='Fornecedor', model_label='Fornecedor',
                  object_repr=filename or 'Importação de fornecedores',
                  changes={'importacao': {
                      'arquivo': filename, 'modo': mode,
                      'total': summary['total'], 'criados': summary['created'],
                      'atualizados': summary['updated'], 'ignorados': summary['skipped'],
                      'duplicados': summary['duplicated'], 'erros': summary['errors'],
                  }},
                  user=request.user)
        return Response(summary)

    def _read_rows(self, request):
        """Lê as linhas cruas de um upload (multipart 'file') ou de {rows:[...]}.
        Define self._read_error e retorna None em caso de falha."""
        self._read_error = ''
        f = request.FILES.get('file')
        if f is not None:
            try:
                return parse_csv_bytes(f.read())
            except ImportError_ as e:
                self._read_error = str(e)
                return None, None
        rows = request.data.get('rows')
        if isinstance(rows, list):
            return rows, {}
        self._read_error = 'Envie um arquivo CSV ou a lista de linhas.'
        return None, None

    # ── Exportação CSV (respeita filtros + ordenação) ─────────────────────────
    @action(detail=False, methods=['get'], url_path='export')
    def export(self, request):
        qs = self.filter_queryset(self.get_queryset())   # aplica busca + ordenação
        ids = request.query_params.get('ids')
        if ids:
            id_list = [int(x) for x in ids.split(',') if x.strip().isdigit()]
            qs = qs.filter(id__in=id_list)

        buf = io.StringIO()
        w = csv.writer(buf, delimiter=';')   # ';' para o Excel pt-BR
        w.writerow([label for _f, label in CANON_COLUMNS])
        n = 0
        for o in qs.iterator():
            w.writerow([
                o.name,
                'Ativo' if o.status == 'ativo' else 'Inativo',
                CATEGORY_LABELS.get(o.category, ''),
                o.airline_abbr,
                o.city,
                o.country,
                format_cpf(o.cpf) if o.cpf else '',
                format_cnpj(o.cnpj) if o.cnpj else '',
                o.company_name,
                o.supplier_network,
            ])
            n += 1
        content = buf.getvalue().encode('utf-8-sig')   # BOM → acentos no Excel
        fname = 'fornecedores.csv'
        log_event('download', model_name='Fornecedor', model_label='Fornecedor',
                  object_repr=fname,
                  changes={'exportacao': {'arquivo': fname, 'registros': n,
                                          'filtros': dict(request.query_params)}},
                  user=request.user)
        resp = HttpResponse(content, content_type='text/csv; charset=utf-8')
        resp['Content-Disposition'] = f'attachment; filename="{fname}"'
        resp['X-Content-Type-Options'] = 'nosniff'
        return resp

    # ── Modelo de importação (cabeçalhos + 1 linha de exemplo) ────────────────
    @action(detail=False, methods=['get'], url_path='template')
    def template(self, request):
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=';')
        w.writerow([label for _f, label in CANON_COLUMNS])
        # Linha de EXEMPLO (claramente identificada — remova antes de importar).
        w.writerow([
            'EXEMPLO - Fornecedor Modelo Ltda', 'Ativo', 'Operadora', 'G3',
            'São Paulo', 'Brasil', '', '12.345.678/0001-90',
            'Fornecedor Modelo Ltda', 'Rede Exemplo',
        ])
        content = buf.getvalue().encode('utf-8-sig')
        resp = HttpResponse(content, content_type='text/csv; charset=utf-8')
        resp['Content-Disposition'] = 'attachment; filename="modelo_fornecedores.csv"'
        resp['X-Content-Type-Options'] = 'nosniff'
        return resp
