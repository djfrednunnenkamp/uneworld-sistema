"""Mesclagem reutilizável de registros duplicados (Passageiros, Agências).
O registro "principal" sobrevive com os valores de campo escolhidos pelo
usuário (campo a campo, de qualquer um dos registros envolvidos); os demais
viram referências apontadas pro principal e em seguida vão pra lixeira
(soft-delete) — nunca são removidos de fato do banco."""
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.response import Response


class MergeViewSetMixin:
    # Subclasses definem: [(model, fk_field, dedupe_fields_or_None), ...]
    # dedupe_fields evita violar unique_together ao repontar — se já existir
    # uma linha do model pro vencedor com os mesmos dedupe_fields, a linha do
    # perdedor é descartada (CASCADE) em vez de repontada.
    MERGE_RELATED = []
    # Campos com unique=True no model — precisam ser "liberados" no perdedor
    # antes de o vencedor poder herdar o valor.
    MERGE_UNIQUE_FIELDS = []
    MERGE_LABEL = None

    @action(detail=False, methods=['post'])
    def merge(self, request):
        model = self.queryset.model
        winner_id = request.data.get('winner_id')
        loser_ids = request.data.get('loser_ids') or []
        fields    = request.data.get('fields') or {}

        if not winner_id or not loser_ids:
            return Response({'error': 'winner_id e loser_ids são obrigatórios.'}, status=400)
        try:
            winner_id = int(winner_id)
            loser_ids = [int(x) for x in loser_ids]
        except (TypeError, ValueError):
            return Response({'error': 'IDs inválidos.'}, status=400)
        if winner_id in loser_ids:
            return Response({'error': 'O registro principal não pode estar na lista de mesclados.'}, status=400)

        all_ids = [winner_id, *loser_ids]
        records = {r.pk: r for r in model.objects.filter(pk__in=all_ids)}
        if len(records) != len(set(all_ids)):
            return Response({'error': 'Algum registro não foi encontrado.'}, status=404)

        winner = records[winner_id]
        losers = [records[lid] for lid in loser_ids]

        with transaction.atomic():
            # Lê os valores escolhidos ANTES de qualquer rename abaixo — senão,
            # quando o campo escolhido é único (ex: email) e vem do perdedor,
            # o passo de liberar esse campo no perdedor mudaria o valor em
            # memória antes da gente conseguir copiá-lo pro vencedor.
            field_values = {}
            for field_name, source_id in fields.items():
                source = records.get(int(source_id))
                if source is not None:
                    field_values[field_name] = getattr(source, field_name)

            # Libera campos únicos que o vencedor vai herdar de um perdedor,
            # senão a gravação do vencedor colide com a linha (ainda existente)
            # do próprio perdedor.
            for field in self.MERGE_UNIQUE_FIELDS:
                source_id = fields.get(field)
                if source_id is None:
                    continue
                source_id = int(source_id)
                if source_id == winner_id:
                    continue
                for loser in losers:
                    if loser.pk == source_id:
                        old_value = getattr(loser, field)
                        setattr(loser, field, f'mesclado-{loser.pk}-{old_value}'[:254])
                        loser.save(update_fields=[field])

            for field_name, value in field_values.items():
                setattr(winner, field_name, value)
            winner.save()

            # Garante que cada valor escolhido campo a campo permaneça EXATAMENTE como
            # selecionado, mesmo quando Model.save() deriva algum deles. Ex.: Passenger.save
            # recalcula full_name a partir de first_name/last_name; se o usuário escolheu o
            # full_name de um perdedor mas manteve o nome do vencedor, o save sobrescreveria
            # a escolha. update() grava direto, sem passar pela derivação do save().
            overrides = {f: v for f, v in field_values.items() if getattr(winner, f) != v}
            if overrides:
                model.objects.filter(pk=winner.pk).update(**overrides)
                for f, v in overrides.items():
                    setattr(winner, f, v)

            for rel_model, fk_field, dedupe_fields in self.MERGE_RELATED:
                qs = rel_model.objects.filter(**{f'{fk_field}__in': losers})
                if dedupe_fields:
                    for obj in list(qs):
                        dup_filter = {fk_field: winner, **{f: getattr(obj, f) for f in dedupe_fields}}
                        if rel_model.objects.filter(**dup_filter).exists():
                            obj.delete()
                        else:
                            setattr(obj, fk_field, winner)
                            obj.save(update_fields=[fk_field])
                else:
                    qs.update(**{fk_field: winner})

            for loser in losers:
                loser.is_deleted = True
                loser.deleted_at = timezone.now()
                loser.save(update_fields=['is_deleted', 'deleted_at'])

        from audit.models import AuditLog
        from audit.tracking import user_display
        from audit.middleware import get_current_ip
        AuditLog.objects.create(
            user=request.user, user_display=user_display(request.user), action='merge',
            model_name=model.__name__, model_label=self.MERGE_LABEL or model.__name__,
            object_id=str(winner.pk),
            object_repr=f'Mesclado: {winner} ← {", ".join(str(l) for l in losers)}',
            ip_address=get_current_ip(),
        )

        return Response(self.get_serializer(winner).data)
