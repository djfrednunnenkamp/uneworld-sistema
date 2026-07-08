"""Regras de negócio compartilhadas das listas de passageiros."""


def sync_passenger_list_for_itinerary(itinerary, *, allow_create=False):
    """Mantém a lista de passageiros 1:1 do roteiro em dia.

    Cada roteiro NÃO PÚBLICO tem exatamente uma lista de passageiros, criada
    automaticamente e vinculada a ele. As datas da lista são espelho das datas
    do roteiro (o roteiro é a fonte da verdade — a lista não edita as datas).

    - allow_create=True (na criação do roteiro): cria a lista se ainda não
      existir e o roteiro não for público.
    - Sempre: sincroniza as datas da lista já vinculada com as do roteiro.

    Retorna a lista vinculada (ou None quando nada foi feito).
    """
    from .models import PassengerList

    if itinerary is None or getattr(itinerary, 'is_deleted', False):
        return None

    pl = itinerary.passenger_lists.filter(is_deleted=False).order_by('id').first()

    if pl is None:
        # Só cria automaticamente na criação de um roteiro não público.
        if not allow_create or itinerary.is_published:
            return None
        category = itinerary.category.name if itinerary.category_id else 'Internacional'
        pl = PassengerList.objects.create(
            name=itinerary.name or 'Lista de passageiros',
            list_type=itinerary.trip_type or 'aereo',
            category=category,
            start_date=itinerary.start_date,
            end_date=itinerary.end_date,
        )
        pl.roteiros.add(itinerary)
        # Aeroportos base do roteiro (quando houver), p/ a lista já nascer útil.
        airport_ids = list(itinerary.airports.values_list('id', flat=True))
        if airport_ids:
            pl.default_airports.set(airport_ids)
            pl.default_airport_id = airport_ids[0]
            pl.save(update_fields=['default_airport'])
        return pl

    # Já existe → apenas mantém as datas em dia com o roteiro.
    changed = []
    if pl.start_date != itinerary.start_date:
        pl.start_date = itinerary.start_date
        changed.append('start_date')
    if pl.end_date != itinerary.end_date:
        pl.end_date = itinerary.end_date
        changed.append('end_date')
    if changed:
        pl.save(update_fields=changed)
    return pl
