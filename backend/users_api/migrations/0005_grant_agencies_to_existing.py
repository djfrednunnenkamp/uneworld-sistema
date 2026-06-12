from django.db import migrations

AGENCIES_PERMISSION_FIELDS = ['agencies_view', 'agencies_edit', 'agencies_delete']


def grant_agencies_to_existing_users(apps, schema_editor):
    UserPermissions = apps.get_model('users_api', 'UserPermissions')
    grants = {field: True for field in AGENCIES_PERMISSION_FIELDS}
    UserPermissions.objects.update(**grants)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('users_api', '0004_agencies_permissions'),
    ]

    operations = [
        migrations.RunPython(grant_agencies_to_existing_users, noop),
    ]
