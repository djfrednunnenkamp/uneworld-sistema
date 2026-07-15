# Refatora a entrada do modelo de pagamento: de um único % para
# has_down_payment + down_payment_mode (%/R$) + down_payment_value.
# Preserva os dados existentes (copia o antigo down_payment_percent).
from django.db import migrations, models


def copy_percent_forward(apps, schema_editor):
    Plan = apps.get_model('config_api', 'ConfigPaymentPlan')
    for p in Plan.objects.all():
        pct = p.down_payment_percent or 0
        p.down_payment_mode = 'percent'
        p.down_payment_value = pct
        p.has_down_payment = pct > 0
        p.save(update_fields=['down_payment_mode', 'down_payment_value', 'has_down_payment'])


class Migration(migrations.Migration):

    dependencies = [
        ('config_api', '0044_configpaymentplan'),
    ]

    operations = [
        migrations.AddField(
            model_name='configpaymentplan',
            name='down_payment_mode',
            field=models.CharField(choices=[('percent', '% do total'), ('valor', 'Valor em R$')], default='percent', max_length=10, verbose_name='Tipo da entrada'),
        ),
        migrations.AddField(
            model_name='configpaymentplan',
            name='down_payment_value',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12, verbose_name='Entrada (valor ou %)'),
        ),
        migrations.AddField(
            model_name='configpaymentplan',
            name='has_down_payment',
            field=models.BooleanField(default=False, verbose_name='Tem entrada'),
        ),
        migrations.RunPython(copy_percent_forward, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='configpaymentplan',
            name='down_payment_percent',
        ),
    ]
