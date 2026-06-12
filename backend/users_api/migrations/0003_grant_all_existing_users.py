from django.db import migrations

from users_api.permissions import PERMISSION_FIELDS


def grant_all_to_existing_users(apps, schema_editor):
    User = apps.get_model('auth', 'User')
    UserPermissions = apps.get_model('users_api', 'UserPermissions')

    grants = {field: True for field in PERMISSION_FIELDS}
    for user in User.objects.all():
        UserPermissions.objects.update_or_create(user=user, defaults=grants)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('users_api', '0002_userpermissions'),
    ]

    operations = [
        migrations.RunPython(grant_all_to_existing_users, noop),
    ]
