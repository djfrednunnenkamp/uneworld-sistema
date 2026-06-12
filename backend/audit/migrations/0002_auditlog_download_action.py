from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('audit', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='auditlog',
            name='action',
            field=models.CharField(
                choices=[('create', 'Criado'), ('update', 'Atualizado'), ('delete', 'Apagado'), ('download', 'Baixado')],
                db_index=True, max_length=20, verbose_name='Ação',
            ),
        ),
    ]
