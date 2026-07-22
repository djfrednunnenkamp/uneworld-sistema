from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('itineraries', '0082_itineraryhotel_website'),
    ]

    operations = [
        migrations.AddField(
            model_name='itineraryboat',
            name='website',
            field=models.CharField('Site', blank=True, max_length=500),
        ),
    ]
