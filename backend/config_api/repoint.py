"""
Repontamento de FKs ao personalizar tipos por roteiro.

Quando um roteiro ganha um tipo PRÓPRIO (ConfigAccommodation / ConfigShipCabin /
ConfigFlightClass com `itinerary` setado), as linhas já existentes daquele roteiro
(custos, bloqueios, linhas de acomodação) ainda apontam para a linha GLOBAL de
mesmo nome. Isso faz com que renomear/editar o tipo do roteiro não reflita em
lugar nenhum. Aqui repontamos essas FKs do global correspondente para a linha
própria do roteiro — só nas linhas DAQUELE roteiro; os demais continuam no global.
"""

from itineraries.models import (
    ItineraryCostItem,
    ItineraryInventoryBlock,
    ItineraryAccommodationLine,
)


def _global_match_ship_cabin(scoped):
    from .models import ConfigShipCabin
    return ConfigShipCabin.objects.filter(
        itinerary__isnull=True,
        category=scoped.category,
        name=scoped.name,
    ).first()


def _global_match_accommodation(scoped):
    from .models import ConfigAccommodation
    return ConfigAccommodation.objects.filter(
        itinerary__isnull=True,
        name=scoped.name,
    ).first()


def _global_match_flight_class(scoped):
    from .models import ConfigFlightClass
    return ConfigFlightClass.objects.filter(
        itinerary__isnull=True,
        name=scoped.name,
    ).first()


def repoint_scoped_row(scoped):
    """
    Reponta as FKs do roteiro `scoped.itinerary_id` que ainda apontam para o
    tipo GLOBAL correspondente, direcionando-as para `scoped`.
    Idempotente e à prova de falha (nunca deixa o save quebrar).
    """
    from .models import ConfigShipCabin, ConfigAccommodation, ConfigFlightClass

    itin_id = getattr(scoped, 'itinerary_id', None)
    if not itin_id:
        return  # linha global — nada a repontar

    try:
        if isinstance(scoped, ConfigShipCabin):
            g = _global_match_ship_cabin(scoped)
            if not g or g.pk == scoped.pk:
                return
            ItineraryCostItem.objects.filter(
                itinerary_id=itin_id, ship_cabin_id=g.pk).update(ship_cabin_id=scoped.pk)
            ItineraryInventoryBlock.objects.filter(
                itinerary_id=itin_id, ship_cabin_id=g.pk).update(ship_cabin_id=scoped.pk)
            ItineraryAccommodationLine.objects.filter(
                itinerary_id=itin_id, ship_cabin_id=g.pk).update(ship_cabin_id=scoped.pk)

        elif isinstance(scoped, ConfigAccommodation):
            g = _global_match_accommodation(scoped)
            if not g or g.pk == scoped.pk:
                return
            ItineraryCostItem.objects.filter(
                itinerary_id=itin_id, accommodation_type_id=g.pk).update(accommodation_type_id=scoped.pk)
            ItineraryAccommodationLine.objects.filter(
                itinerary_id=itin_id, accommodation_type_id=g.pk).update(accommodation_type_id=scoped.pk)

        elif isinstance(scoped, ConfigFlightClass):
            g = _global_match_flight_class(scoped)
            if not g or g.pk == scoped.pk:
                return
            ItineraryCostItem.objects.filter(
                itinerary_id=itin_id, flight_class_id=g.pk).update(flight_class_id=scoped.pk)
            ItineraryInventoryBlock.objects.filter(
                itinerary_id=itin_id, flight_class_id=g.pk).update(flight_class_id=scoped.pk)
    except Exception:
        # Repontamento é um "melhor esforço"; nunca deve derrubar o save do tipo.
        pass
