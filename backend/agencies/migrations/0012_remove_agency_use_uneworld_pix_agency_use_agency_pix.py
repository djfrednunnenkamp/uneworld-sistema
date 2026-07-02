# Inverte o sentido do toggle de PIX: antes use_uneworld_pix (True = UneWorld),
# agora use_agency_pix (True = agência; padrão False = UneWorld). Preserva o que
# estava configurado invertendo o valor.
from django.db import migrations, models


def invert_pix_flag(apps, schema_editor):
    Agency = apps.get_model('agencies', 'Agency')
    for a in Agency.objects.all():
        a.use_agency_pix = not a.use_uneworld_pix
        a.save(update_fields=['use_agency_pix'])


class Migration(migrations.Migration):

    dependencies = [
        ('agencies', '0011_remove_agency_use_andes_banking'),
    ]

    operations = [
        migrations.AddField(
            model_name='agency',
            name='use_agency_pix',
            field=models.BooleanField(default=False, verbose_name='No contrato, usar o PIX desta agência (senão, o da UneWorld)'),
        ),
        migrations.RunPython(invert_pix_flag, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='agency',
            name='use_uneworld_pix',
        ),
    ]
