from django.db import migrations


def create_unaccent(apps, schema_editor):
    """Habilita a extensão `unaccent` no PostgreSQL (busca insensível a acento).
    No-op em SQLite/MySQL — SQLite usa uma função registrada em core.search e o
    MySQL já ignora acento pela collation *_ci. Evita importar
    django.contrib.postgres (que exige psycopg2) fora do PostgreSQL."""
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute('CREATE EXTENSION IF NOT EXISTS unaccent')


class Migration(migrations.Migration):

    dependencies = [
        ('passengers', '0023_passenger_created_by_alter_passenger_email_and_more'),
    ]

    operations = [
        migrations.RunPython(create_unaccent, migrations.RunPython.noop),
    ]
