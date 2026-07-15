from django.db import migrations


def forwards(apps, schema_editor):
    """Retrocompat: antes, 'Ver roteiros' já abria o detalhe e 'Criar/Editar' criava.
    Agora abrir é 'roteiros_open' e criar é 'roteiros_create' — concede aos que já
    tinham o acesso equivalente, nas contas e nos perfis de permissão."""
    UserPermissions = apps.get_model('users_api', 'UserPermissions')
    for up in UserPermissions.objects.all():
        changed = False
        if up.roteiros_view and not up.roteiros_open:
            up.roteiros_open = True; changed = True
        if up.roteiros_edit and not up.roteiros_create:
            up.roteiros_create = True; changed = True
        if changed:
            up.save(update_fields=['roteiros_open', 'roteiros_create'])

    PermissionProfile = apps.get_model('config_api', 'PermissionProfile')
    for prof in PermissionProfile.objects.all():
        perms = prof.permissions if isinstance(prof.permissions, dict) else {}
        changed = False
        if perms.get('roteiros_view') and not perms.get('roteiros_open'):
            perms['roteiros_open'] = True; changed = True
        if perms.get('roteiros_edit') and not perms.get('roteiros_create'):
            perms['roteiros_create'] = True; changed = True
        if changed:
            prof.permissions = perms
            prof.save(update_fields=['permissions'])


def backwards(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ('users_api', '0067_userpermissions_roteiros_create_and_more'),
        ('config_api', '0075_systemsettings_color_primary_and_more'),
    ]
    operations = [migrations.RunPython(forwards, backwards)]
