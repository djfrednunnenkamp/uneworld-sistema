from rest_framework import viewsets, status, serializers
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from users_api.permissions import RequirePermission
from trips.models import PassengerList, ListEnrollment
from .models import VoucherList, VoucherTemplate, DEFAULT_VOUCHER_BLOCKS
from . import build


def _sanitize_blocks(blocks):
    """Guarda só o essencial de cada bloco (tipo conhecido + campos)."""
    if not isinstance(blocks, list):
        return []
    allowed = {'title', 'text', 'day_by_day', 'inclusions', 'image'}
    out = []
    for b in blocks[:60]:
        if not isinstance(b, dict) or b.get('type') not in allowed:
            continue
        out.append({k: v for k, v in b.items()
                    if k in ('id', 'type', 'text', 'content', 'heading', 'url')})
    return out


class VoucherViewSet(viewsets.ViewSet):
    """Vouchers das listas de passageiros. `pk` = id da Lista de Passageiros
    (cada lista tem exatamente um voucher). Ver exige voucher_view; editar,
    voucher_edit."""
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        if self.action in ('partial_update', 'update'):
            return [IsAuthenticated(), RequirePermission('voucher_edit')()]
        return [IsAuthenticated(), RequirePermission('voucher_view')()]

    def _list_qs(self):
        return (PassengerList.objects.filter(is_deleted=False)
                .prefetch_related('roteiros', 'voucher').order_by('-start_date', 'name'))

    def list(self, request):
        rows = []
        for pl in self._list_qs():
            voucher = getattr(pl, 'voucher', None)
            pax = ListEnrollment.objects.filter(passenger_list=pl, passenger__isnull=False).count()
            rows.append({
                'id': pl.id,
                'name': pl.name,
                'start_date': pl.start_date,
                'end_date': pl.end_date,
                'status': pl.status,
                'roteiro_name': ', '.join(r.name for r in pl.roteiros.all()) or None,
                'passenger_count': pax,
                'is_custom': bool(voucher and voucher.blocks),
            })
        return Response(rows)

    def retrieve(self, request, pk=None):
        pl = PassengerList.objects.filter(pk=pk, is_deleted=False).first()
        if not pl:
            return Response({'error': 'Lista não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        voucher, _ = VoucherList.objects.get_or_create(passenger_list=pl)
        blocks, is_custom = build.resolve_blocks(voucher)
        return Response({
            'id': pl.id,
            'name': pl.name,
            'start_date': pl.start_date,
            'end_date': pl.end_date,
            'status': pl.status,
            'blocks': blocks,
            'is_custom': is_custom,
            'roteiro': build.roteiro_data(pl, request=request),
            'entries': build.build_entries(pl, request=request),
        })

    def partial_update(self, request, pk=None):
        """Salva os blocos PRÓPRIOS da lista. blocks=null → volta ao template padrão."""
        pl = PassengerList.objects.filter(pk=pk, is_deleted=False).first()
        if not pl:
            return Response({'error': 'Lista não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        voucher, _ = VoucherList.objects.get_or_create(passenger_list=pl)
        raw = request.data.get('blocks', ...)
        if raw is ...:
            return Response({'error': 'Faltou blocks.'}, status=status.HTTP_400_BAD_REQUEST)
        voucher.blocks = None if raw is None else _sanitize_blocks(raw)
        voucher.save(update_fields=['blocks', 'updated_at'])
        return self.retrieve(request, pk=pk)


class VoucherTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = VoucherTemplate
        fields = ['id', 'name', 'blocks', 'is_default', 'created_at']
        read_only_fields = ['created_at']

    def validate_blocks(self, value):
        return _sanitize_blocks(value)


class VoucherTemplateViewSet(viewsets.ModelViewSet):
    """Biblioteca de templates de voucher (Configurações). Um é o padrão (is_default),
    herdado pelas listas novas. Ver exige voucher_view; editar, voucher_edit."""
    serializer_class = VoucherTemplateSerializer
    queryset = VoucherTemplate.objects.all()

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [IsAuthenticated(), RequirePermission('voucher_view')()]
        return [IsAuthenticated(), RequirePermission('voucher_edit')()]

    @action(detail=True, methods=['post'], url_path='set_default')
    def set_default(self, request, pk=None):
        """Marca este como o template PADRÃO (desmarca os outros)."""
        tpl = self.get_object()
        VoucherTemplate.objects.exclude(pk=tpl.pk).update(is_default=False)
        tpl.is_default = True
        tpl.save(update_fields=['is_default'])
        return Response(self.get_serializer(tpl).data)

    def _normalize_default(self, tpl):
        """Garante um único padrão: se este é o padrão, desmarca os outros; se é o
        1º template do sistema, vira padrão automaticamente."""
        is_first = not VoucherTemplate.objects.exclude(pk=tpl.pk).exists()
        if is_first and not tpl.is_default:
            tpl.is_default = True
            tpl.save(update_fields=['is_default'])
        if tpl.is_default:
            VoucherTemplate.objects.exclude(pk=tpl.pk).update(is_default=False)

    def perform_create(self, serializer):
        self._normalize_default(serializer.save())

    def perform_update(self, serializer):
        self._normalize_default(serializer.save())
