from django.db import migrations


def seed(apps, schema_editor):
    from config_api.city_aliases import apply_aliases
    City = apps.get_model('config_api', 'ConfigCity')
    apply_aliases(City)


def noop(apps, schema_editor):
    City = apps.get_model('config_api', 'ConfigCity')
    City.objects.exclude(aliases='').update(aliases='')


class Migration(migrations.Migration):
    dependencies = [('config_api', '0070_configcity_aliases')]
    operations = [migrations.RunPython(seed, noop)]
