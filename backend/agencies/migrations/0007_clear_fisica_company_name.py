from django.db import migrations


def clear_fisica_company_name(apps, schema_editor):
    """
    company_name era 'Razão Social' — não se aplica a Pessoa Física.
    Agora esse campo é reutilizado como 'Nome Fantasma' para Física,
    então limpamos valores antigos para não poluir o campo novo.
    """
    Agency = apps.get_model('agencies', 'Agency')
    Agency.objects.filter(person_type='fisica').update(company_name='')


class Migration(migrations.Migration):

    dependencies = [
        ('agencies', '0006_add_agency_member'),
    ]

    operations = [
        migrations.RunPython(clear_fisica_company_name, migrations.RunPython.noop),
    ]
