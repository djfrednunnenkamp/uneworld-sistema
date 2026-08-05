"""Sinais do Roteiro — hoje só a propagação do NOME.

Renomear um roteiro renomeia a(s) Lista(s) de Passageiros vinculada(s): o roteiro
é a fonte da verdade do nome (a lista nasce dele e não edita esse campo). E como
o Voucher não guarda nome próprio — ele lê `passenger_list.name` — renomear a
lista já renomeia o voucher junto, sem precisar tocar em nada lá.

Isto vive num SIGNAL (e não só no serializer do roteiro) de propósito: assim a
regra vale para qualquer caminho que mude o nome — API, admin, comando de
gestão, importação, script — e não só pela tela de "Informações básicas".
"""
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver


@receiver(pre_save, sender='itineraries.Itinerary')
def _remember_old_name(sender, instance, update_fields=None, **kwargs):
    """Guarda o nome que está no banco para o post_save saber se mudou.

    Salvamentos que declaram `update_fields` sem o nome (o caso comum e frequente:
    marcar pendência, publicar) nem chegam a consultar o banco."""
    instance._old_name = None
    if not instance.pk or (update_fields is not None and 'name' not in update_fields):
        return
    instance._old_name = (
        sender.objects.filter(pk=instance.pk).values_list('name', flat=True).first()
    )


@receiver(post_save, sender='itineraries.Itinerary')
def rename_linked_passenger_lists(sender, instance, created, **kwargs):
    """Nome novo no roteiro → mesmo nome na(s) lista(s) vinculada(s)."""
    if created or getattr(instance, 'is_deleted', False):
        return
    old = getattr(instance, '_old_name', None)
    novo = (instance.name or '').strip()
    if not novo or old is None or old == novo:
        return
    # Renomeia TODAS as listas vinculadas (o normal é uma só, mas um roteiro pode
    # ter mais de uma). Salva uma a uma para a auditoria registrar cada mudança.
    for pl in instance.passenger_lists.filter(is_deleted=False).exclude(name=novo):
        pl.name = novo
        pl.save(update_fields=['name'])
