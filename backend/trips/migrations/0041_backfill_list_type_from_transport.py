from django.db import migrations


def _derive(itin):
    """Mesma regra de trips.services.derive_list_type, replicada para a migração."""
    if getattr(itin, 'has_voo', False):
        return 'aereo'
    if getattr(itin, 'has_terrestre', False):
        return 'terrestre'
    return 'terrestre' if getattr(itin, 'trip_type', None) == 'terrestre' else 'aereo'


def backfill(apps, schema_editor):
    """Recalcula list_type das listas a partir dos toggles de transporte do
    roteiro (corrige listas que ficaram com 'maritimo' ou tipo divergente)."""
    PassengerList = apps.get_model('trips', 'PassengerList')
    for pl in PassengerList.objects.all().prefetch_related('roteiros'):
        itin = pl.roteiros.order_by('id').first()
        if not itin:
            continue
        new_type = _derive(itin)
        if pl.list_type != new_type:
            pl.list_type = new_type
            pl.save(update_fields=['list_type'])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('trips', '0040_passengerlist_default_airports'),
        ('itineraries', '0044_itineraryaccommodationline_flight_departure_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill, noop),
    ]
