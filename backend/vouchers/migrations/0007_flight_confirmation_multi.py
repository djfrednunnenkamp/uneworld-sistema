from django.db import migrations, models


class Migration(migrations.Migration):
    """Vários comprovantes de voo por voucher (passageiro/casal): remove o
    unique_together, adiciona título e ordem."""

    dependencies = [
        ('vouchers', '0006_alter_voucherdownload_options_and_more'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='voucherflightconfirmation',
            options={'ordering': ['order', 'id'], 'verbose_name': 'Confirmação de voo do voucher', 'verbose_name_plural': 'Confirmações de voo dos vouchers'},
        ),
        migrations.AlterUniqueTogether(
            name='voucherflightconfirmation',
            unique_together=set(),
        ),
        migrations.AddField(
            model_name='voucherflightconfirmation',
            name='title',
            field=models.CharField(blank=True, default='', max_length=200, verbose_name='Título'),
        ),
        migrations.AddField(
            model_name='voucherflightconfirmation',
            name='order',
            field=models.PositiveIntegerField(db_index=True, default=0, verbose_name='Ordem'),
        ),
    ]
