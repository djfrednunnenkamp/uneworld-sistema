from django.db import migrations


def repoint_existing(apps, schema_editor):
    """
    Roteiros que já ganharam tipos próprios antes deste ajuste têm custos/bloqueios/
    linhas ainda apontando para o tipo GLOBAL. Reponta para o tipo do roteiro.
    """
    ConfigShipCabin = apps.get_model('config_api', 'ConfigShipCabin')
    ConfigAccommodation = apps.get_model('config_api', 'ConfigAccommodation')
    ConfigFlightClass = apps.get_model('config_api', 'ConfigFlightClass')
    CostItem = apps.get_model('itineraries', 'ItineraryCostItem')
    InvBlock = apps.get_model('itineraries', 'ItineraryInventoryBlock')
    AccomLine = apps.get_model('itineraries', 'ItineraryAccommodationLine')

    for s in ConfigShipCabin.objects.filter(itinerary__isnull=False):
        g = ConfigShipCabin.objects.filter(
            itinerary__isnull=True, category=s.category, name=s.name).first()
        if not g or g.pk == s.pk:
            continue
        CostItem.objects.filter(itinerary_id=s.itinerary_id, ship_cabin_id=g.pk).update(ship_cabin_id=s.pk)
        InvBlock.objects.filter(itinerary_id=s.itinerary_id, ship_cabin_id=g.pk).update(ship_cabin_id=s.pk)
        AccomLine.objects.filter(itinerary_id=s.itinerary_id, ship_cabin_id=g.pk).update(ship_cabin_id=s.pk)

    for s in ConfigAccommodation.objects.filter(itinerary__isnull=False):
        g = ConfigAccommodation.objects.filter(itinerary__isnull=True, name=s.name).first()
        if not g or g.pk == s.pk:
            continue
        CostItem.objects.filter(itinerary_id=s.itinerary_id, accommodation_type_id=g.pk).update(accommodation_type_id=s.pk)
        AccomLine.objects.filter(itinerary_id=s.itinerary_id, accommodation_type_id=g.pk).update(accommodation_type_id=s.pk)

    for s in ConfigFlightClass.objects.filter(itinerary__isnull=False):
        g = ConfigFlightClass.objects.filter(itinerary__isnull=True, name=s.name).first()
        if not g or g.pk == s.pk:
            continue
        CostItem.objects.filter(itinerary_id=s.itinerary_id, flight_class_id=g.pk).update(flight_class_id=s.pk)
        InvBlock.objects.filter(itinerary_id=s.itinerary_id, flight_class_id=g.pk).update(flight_class_id=s.pk)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('config_api', '0088_configflightclass_itinerary_and_more'),
        ('itineraries', '0079_itineraryinventoryblock'),
    ]

    operations = [
        migrations.RunPython(repoint_existing, noop),
    ]
