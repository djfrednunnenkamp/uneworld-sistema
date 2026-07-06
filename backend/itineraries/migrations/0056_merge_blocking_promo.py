from django.db import migrations, models


def merge_promo_into_blocking(apps, schema_editor):
    """Unifica a 'Lâmina do Bloqueio Promocional' na 'Lâmina do Bloqueio' (agora
    aceita várias). As promo existentes viram 'blocking' e ficam DEPOIS da lâmina
    principal (order + 1000), para não roubarem o posto de padrão (a primeira)."""
    ItineraryImage = apps.get_model('itineraries', 'ItineraryImage')
    for img in ItineraryImage.objects.filter(kind='blocking_promo'):
        img.kind = 'blocking'
        img.order = (img.order or 0) + 1000
        img.save(update_fields=['kind', 'order'])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('itineraries', '0055_itinerary_capacity'),
    ]

    operations = [
        migrations.RunPython(merge_promo_into_blocking, noop),
        migrations.AlterField(
            model_name='itineraryimage',
            name='kind',
            field=models.CharField(
                choices=[
                    ('gallery', 'Galeria'),
                    ('cover', 'Capa'),
                    ('blocking', 'Lâmina do Bloqueio'),
                ],
                default='gallery', max_length=20, verbose_name='Tipo',
            ),
        ),
    ]
