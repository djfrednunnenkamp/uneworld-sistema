from django.db import migrations


def populate(apps, schema_editor):
    from config_api.textsearch import normalize_text
    City = apps.get_model('config_api', 'ConfigCity')
    qs = City.objects.all().only('id', 'name', 'name_ascii')
    batch, updated = [], 0
    for c in qs.iterator(chunk_size=5000):
        na = normalize_text(c.name)
        if c.name_ascii != na:
            c.name_ascii = na
            batch.append(c)
        if len(batch) >= 5000:
            City.objects.bulk_update(batch, ['name_ascii'])
            updated += len(batch); batch = []
    if batch:
        City.objects.bulk_update(batch, ['name_ascii'])
        updated += len(batch)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [('config_api', '0068_configcity_name_ascii')]
    operations = [migrations.RunPython(populate, noop)]
