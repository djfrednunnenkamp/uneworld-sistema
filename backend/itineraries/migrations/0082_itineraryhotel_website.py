from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('itineraries', '0081_itineraryimage_continent'),
    ]

    operations = [
        migrations.AddField(
            model_name='itineraryhotel',
            name='website',
            field=models.CharField('Site', blank=True, max_length=300),
        ),
    ]
