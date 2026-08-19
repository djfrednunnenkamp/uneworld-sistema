"""A baixa da parcela deixa de ser um carimbo (recebida sim/não) e passa a ser
uma lista de RECEBIMENTOS. É o que permite o caso real de pagar metade agora e
o resto depois, com o saldo continuando a ser dinheiro a receber.

Cria a tabela, converte as baixas que existirem em um recebimento cada (nenhum
dado se perde) e só então derruba os quatro campos antigos.
"""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def baixas_viram_recebimentos(apps, schema_editor):
    Installment = apps.get_model('contracts', 'ContractInstallment')
    Payment = apps.get_model('contracts', 'ContractInstallmentPayment')
    novos = []
    for inst in Installment.objects.filter(received_at__isnull=False).iterator():
        novos.append(Payment(
            installment_id=inst.id,
            paid_at=inst.received_at,
            # Sem valor informado, a baixa antiga significava "entrou o previsto".
            value_brl=inst.received_value_brl if inst.received_value_brl is not None else (inst.value_brl or 0),
            note=inst.received_note or '',
            created_by_id=inst.received_by_id,
        ))
    Payment.objects.bulk_create(novos, batch_size=500)


def recebimentos_viram_baixas(apps, schema_editor):
    """Volta atrás: o primeiro recebimento de cada parcela vira a baixa antiga."""
    Installment = apps.get_model('contracts', 'ContractInstallment')
    Payment = apps.get_model('contracts', 'ContractInstallmentPayment')
    for pay in Payment.objects.order_by('installment_id', 'paid_at', 'id').iterator():
        Installment.objects.filter(id=pay.installment_id, received_at__isnull=True).update(
            received_at=pay.paid_at, received_value_brl=pay.value_brl,
            received_note=pay.note, received_by_id=pay.created_by_id)


class Migration(migrations.Migration):

    dependencies = [
        ('contracts', '0039_contractinstallment_received_at_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ContractInstallmentPayment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('paid_at', models.DateField(verbose_name='Recebido em')),
                ('value_brl', models.DecimalField(decimal_places=2, max_digits=12, verbose_name='Valor recebido (BRL)')),
                ('note', models.CharField(blank=True, default='', max_length=300, verbose_name='Observação')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='installment_payments_created', to=settings.AUTH_USER_MODEL, verbose_name='Lançado por')),
                ('installment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='payments', to='contracts.contractinstallment')),
            ],
            options={
                'verbose_name': 'Recebimento de parcela',
                'verbose_name_plural': 'Recebimentos de parcela',
                'ordering': ['paid_at', 'id'],
            },
        ),
        migrations.RunPython(baixas_viram_recebimentos, recebimentos_viram_baixas),
        migrations.RemoveField(model_name='contractinstallment', name='received_at'),
        migrations.RemoveField(model_name='contractinstallment', name='received_by'),
        migrations.RemoveField(model_name='contractinstallment', name='received_note'),
        migrations.RemoveField(model_name='contractinstallment', name='received_value_brl'),
    ]
