from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('trips', '0017_arrival_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='flightleg',
            name='blocked_seats',
            field=models.PositiveSmallIntegerField(blank=True, null=True, verbose_name='Lugares bloqueados'),
        ),
    ]
