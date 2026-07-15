"""Soft-delete reutilizável: nenhum registro de áreas com este mixin é
removido do banco. "Excluir" só marca is_deleted/deleted_at — o item vai
pra aba "Excluídos" da área, de onde só um superusuário pode restaurar ou
remover de vez (purge)."""
from collections import Counter

from django.conf import settings
from django.db.models import ProtectedError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import status


class SoftDeleteViewSetMixin:
    def get_queryset(self):
        qs = super().get_queryset()
        show_deleted = self.request.query_params.get('deleted') in ('1', 'true', 'True')
        return qs.filter(is_deleted=show_deleted)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save(update_fields=['is_deleted', 'deleted_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        if not request.user.is_superuser:
            return Response({'error': 'Apenas superusuário pode restaurar.'}, status=403)
        model = self.queryset.model
        # Só faz sentido restaurar algo que está na lixeira.
        instance = get_object_or_404(model, pk=pk, is_deleted=True)
        instance.is_deleted = False
        instance.deleted_at = None
        instance.save(update_fields=['is_deleted', 'deleted_at'])
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=['delete'], url_path='purge')
    def purge(self, request, pk=None):
        if not request.user.is_superuser:
            return Response({'error': 'Apenas superusuário pode excluir definitivamente.'}, status=403)
        # Exclusão definitiva é destrutiva e irreversível — só liberada quando
        # explicitamente habilitada no .env (ALLOW_HARD_DELETE), ex.: fase de teste.
        if not getattr(settings, 'ALLOW_HARD_DELETE', False):
            return Response({'error': 'Exclusão definitiva está desabilitada (ALLOW_HARD_DELETE).'}, status=403)
        model = self.queryset.model
        # Purge é o passo final da lixeira: exige que o item já esteja excluído.
        instance = get_object_or_404(model, pk=pk, is_deleted=True)
        try:
            instance.delete()
        except ProtectedError as e:
            # Está amarrado a outros registros (on_delete=PROTECT) — ex.: agência
            # ainda usada em contratos. Mensagem amigável em vez de erro 500.
            by_model = Counter(type(obj) for obj in e.protected_objects)
            partes = [
                f'{n} {(m._meta.verbose_name if n == 1 else m._meta.verbose_name_plural)}'
                for m, n in by_model.items()
            ]
            return Response(
                {'error': 'Não é possível excluir definitivamente: ainda está em uso em '
                          + ', '.join(partes) + '. Remova ou ajuste esses registros antes.'},
                status=status.HTTP_409_CONFLICT)
        return Response(status=status.HTTP_204_NO_CONTENT)
