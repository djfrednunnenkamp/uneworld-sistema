from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from users_api.permissions import RequirePermission
from trips.models import PassengerList, ListEnrollment
from config_api.models import SystemSettings
from .models import VoucherList, DEFAULT_VOUCHER_BLOCKS
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
        if self.action in ('partial_update', 'update') or (
                self.action == 'template' and self.request.method in ('PUT', 'PATCH', 'POST')):
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
        settings_obj = SystemSettings.objects.first()
        blocks, is_custom = build.resolve_blocks(voucher, settings_obj)
        return Response({
            'id': pl.id,
            'name': pl.name,
            'start_date': pl.start_date,
            'end_date': pl.end_date,
            'status': pl.status,
            'blocks': blocks,
            'is_custom': is_custom,
            'roteiro': build.roteiro_data(pl),
            'entries': build.build_entries(pl, request=request),
        })

    def partial_update(self, request, pk=None):
        """Salva os blocos PRÓPRIOS da lista. blocks=null → volta ao template global."""
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

    @action(detail=False, methods=['get', 'put'])
    def template(self, request):
        """Template GLOBAL padrão do voucher (Configurações)."""
        settings_obj, _ = SystemSettings.objects.get_or_create(pk=1)
        if request.method == 'GET':
            tpl = settings_obj.voucher_template
            return Response({'blocks': tpl if (isinstance(tpl, list) and tpl) else DEFAULT_VOUCHER_BLOCKS,
                             'is_default': not (isinstance(tpl, list) and tpl)})
        raw = request.data.get('blocks')
        settings_obj.voucher_template = [] if raw is None else _sanitize_blocks(raw)
        settings_obj.save(update_fields=['voucher_template'])
        tpl = settings_obj.voucher_template
        return Response({'blocks': tpl if tpl else DEFAULT_VOUCHER_BLOCKS,
                         'is_default': not tpl})
