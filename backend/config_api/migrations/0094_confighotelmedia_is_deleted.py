from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('config_api', '0093_alter_configpaymentplan_options_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='confighotelmedia',
            name='is_deleted',
            field=models.BooleanField(db_index=True, default=False, verbose_name='Excluída'),
        ),
    ]
