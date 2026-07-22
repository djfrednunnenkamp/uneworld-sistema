from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('config_api', '0094_confighotelmedia_is_deleted'),
    ]

    operations = [
        migrations.AddField(
            model_name='configboatmedia',
            name='is_deleted',
            field=models.BooleanField(db_index=True, default=False, verbose_name='Excluída'),
        ),
    ]
