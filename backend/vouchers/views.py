from django.utils import timezone
from rest_framework import viewsets, status, serializers
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from users_api.permissions import RequirePermission, agency_scope_ids, has_any_perm
from trips.models import PassengerList, ListEnrollment
from .models import VoucherList, VoucherTemplate, VoucherFlightConfirmation, VoucherDownload, DEFAULT_VOUCHER_BLOCKS
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
    (cada lista tem exatamente um voucher).

    Permissões:
      - voucher_view    → ver a aba e os vouchers (equipe interna);
      - voucher_edit    → editar o layout (template global e por lista);
      - voucher_publish → publicar / voltar para edição;
      - voucher_agency  → dedicada a usuários de AGÊNCIA: veem só vouchers
        PUBLICADOS e só os passageiros da própria agência naquela viagem."""
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        if self.action == 'set_status':
            return [IsAuthenticated(), RequirePermission('voucher_publish')()]
        if self.action == 'flight_confirmation':
            return [IsAuthenticated(), RequirePermission('voucher_flight')()]
        if self.action == 'mark_downloaded':
            return [IsAuthenticated(), RequirePermission('voucher_view', 'voucher_agency')()]
        if self.action in ('partial_update', 'update'):
            return [IsAuthenticated(), RequirePermission('voucher_edit')()]
        return [IsAuthenticated(), RequirePermission('voucher_view', 'voucher_agency')()]

    def _list_qs(self):
        return (PassengerList.objects.filter(is_deleted=False)
                .prefetch_related('roteiros', 'voucher').order_by('-start_date', 'name'))

    def list(self, request):
        scope = agency_scope_ids(request.user)
        qs = self._list_qs()
        if scope is not None:
            # Agência: só vouchers PUBLICADOS de listas onde ela tem passageiros.
            qs = qs.filter(voucher__status='publicado', list_enrollments__agency_id__in=scope).distinct()
            can_past = has_any_perm(request.user, 'voucher_agency_past')
        else:
            can_past = has_any_perm(request.user, 'voucher_past')
        # Sem a permissão de "viagens antigas", só as FUTURAS (não iniciadas).
        if not can_past:
            qs = qs.exclude(start_date__lte=timezone.localdate())
        rows = []
        for pl in qs:
            voucher = getattr(pl, 'voucher', None)
            pax_qs = ListEnrollment.objects.filter(passenger_list=pl, passenger__isnull=False)
            if scope is not None:
                pax_qs = pax_qs.filter(agency_id__in=scope)
            row = {
                'id': pl.id,
                'name': pl.name,
                'start_date': pl.start_date,
                'end_date': pl.end_date,
                'roteiro_name': ', '.join(r.name for r in pl.roteiros.all()) or None,
                'passenger_count': pax_qs.count(),
                'is_custom': bool(voucher and voucher.blocks),
                'status': (voucher.status if voucher else 'em_edicao'),
            }
            # Só a operadora (interno) vê o progresso de download por lista.
            if scope is None:
                entries = build.build_entries(pl, voucher=voucher)
                dl = [e for e in entries if e['downloaded']]
                row['entries_total'] = len(entries)
                row['downloaded_count'] = len(dl)
                row['downloaded_names'] = [', '.join(e['passengers']) for e in dl]
            rows.append(row)
        return Response(rows)

    def retrieve(self, request, pk=None):
        pl = PassengerList.objects.filter(pk=pk, is_deleted=False).first()
        if not pl:
            return Response({'error': 'Lista não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        voucher, _ = VoucherList.objects.get_or_create(passenger_list=pl)
        scope = agency_scope_ids(request.user)
        if scope is not None:
            # Agência só acessa voucher PUBLICADO e onde tem passageiros.
            if voucher.status != 'publicado' or not pl.list_enrollments.filter(agency_id__in=scope).exists():
                return Response({'error': 'Voucher não disponível.'}, status=status.HTTP_404_NOT_FOUND)
            can_past = has_any_perm(request.user, 'voucher_agency_past')
        else:
            can_past = has_any_perm(request.user, 'voucher_past')
        # Sem a permissão de "viagens antigas", viagens já iniciadas ficam bloqueadas.
        if pl.start_date and pl.start_date <= timezone.localdate() and not can_past:
            return Response({'error': 'Voucher não disponível.'}, status=status.HTTP_404_NOT_FOUND)
        blocks, is_custom = build.resolve_blocks(voucher)
        return Response({
            'id': pl.id,
            'name': pl.name,
            'start_date': pl.start_date,
            'end_date': pl.end_date,
            'blocks': blocks,
            'is_custom': is_custom,
            'status': voucher.status,
            'roteiro': build.roteiro_data(pl, request=request),
            'entries': build.build_entries(pl, request=request, voucher=voucher, agency_ids=scope),
        })

    @action(detail=True, methods=['post'], url_path='set_status')
    def set_status(self, request, pk=None):
        """Muda o status do voucher: 'em_edicao' ou 'publicado'."""
        pl = PassengerList.objects.filter(pk=pk, is_deleted=False).first()
        if not pl:
            return Response({'error': 'Lista não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        new_status = (request.data.get('status') or '').strip()
        if new_status not in dict(VoucherList.STATUS_CHOICES):
            return Response({'error': 'Status inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        voucher, _ = VoucherList.objects.get_or_create(passenger_list=pl)
        voucher.status = new_status
        voucher.save(update_fields=['status', 'updated_at'])
        return self.retrieve(request, pk=pk)

    @action(detail=True, methods=['post'], url_path='mark_downloaded')
    def mark_downloaded(self, request, pk=None):
        """Marca o(s) voucher(s) baixado(s) — chamado quando um usuário de AGÊNCIA
        baixa o PDF. Body: entry_key (str) ou entry_keys (lista). Só registra para
        agência (a operadora consome o progresso); interno é no-op."""
        pl = PassengerList.objects.filter(pk=pk, is_deleted=False).first()
        if not pl:
            return Response({'error': 'Lista não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        scope = agency_scope_ids(request.user)
        if scope is None:
            return Response({'ok': True})
        voucher, _ = VoucherList.objects.get_or_create(passenger_list=pl)
        keys = request.data.get('entry_keys')
        if not isinstance(keys, list):
            k = request.data.get('entry_key')
            keys = [k] if k else []
        # Só as entries da própria agência podem ser marcadas.
        valid = {e['key'] for e in build.build_entries(pl, voucher=voucher, agency_ids=scope)}
        for key in keys:
            key = (key or '').strip()
            if key and key in valid:
                VoucherDownload.objects.update_or_create(voucher=voucher, entry_key=key, defaults={'user': request.user})
        return Response({'ok': True})

    @action(detail=True, methods=['post', 'delete'], url_path='flight_confirmation')
    def flight_confirmation(self, request, pk=None):
        """Captura de tela da confirmação do voo de UM voucher (passageiro/casal).
        POST (multipart: entry_key + image) grava/substitui; DELETE (entry_key)
        remove. A imagem vira uma página própria ao final do voucher no PDF."""
        pl = PassengerList.objects.filter(pk=pk, is_deleted=False).first()
        if not pl:
            return Response({'error': 'Lista não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        voucher, _ = VoucherList.objects.get_or_create(passenger_list=pl)
        entry_key = (request.data.get('entry_key') or request.query_params.get('entry_key') or '').strip()
        if not entry_key:
            return Response({'error': 'Faltou entry_key.'}, status=status.HTTP_400_BAD_REQUEST)

        if request.method == 'DELETE':
            VoucherFlightConfirmation.objects.filter(voucher=voucher, entry_key=entry_key).delete()
            return self.retrieve(request, pk=pk)

        image = request.FILES.get('image')
        if not image:
            return Response({'error': 'Faltou a imagem.'}, status=status.HTTP_400_BAD_REQUEST)
        VoucherFlightConfirmation.objects.update_or_create(
            voucher=voucher, entry_key=entry_key, defaults={'image': image})
        return self.retrieve(request, pk=pk)

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
