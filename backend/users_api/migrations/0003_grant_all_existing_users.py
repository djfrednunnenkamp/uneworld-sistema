from django.db import migrations

# Snapshot dos campos existentes no momento desta migração (não importar
# PERMISSION_FIELDS ao vivo: o modelo histórico aqui não tem campos
# adicionados por migrações posteriores).
PERMISSION_FIELDS_AT_THIS_POINT = [
    'passengers_view_basic',
    'passengers_view_full',
    'passengers_edit',
    'passengers_delete',
    'passengers_download_docs',
    'lists_view',
    'lists_edit',
    'lists_delete',
    'lists_view_logs',
    'manage_users',
    'manage_settings',
    'view_audit_log',
]


def grant_all_to_existing_users(apps, schema_editor):
    User = apps.get_model('auth', 'User')
    UserPermissions = apps.get_model('users_api', 'UserPermissions')

    grants = {field: True for field in PERMISSION_FIELDS_AT_THIS_POINT}
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
