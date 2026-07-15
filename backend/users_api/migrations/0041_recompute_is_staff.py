from django.db import migrations


def recompute_is_staff(apps, schema_editor):
    """Recalcula is_staff (= "Administrador" na lista de usuários) com a regra
    corrigida: as chaves de log legadas view_audit_log/log_view não contam mais.
    Assim, um usuário sem nenhuma permissão administrativa real — mas que tinha
    log_view/view_audit_log ligado no banco (campo invisível na UI) — deixa de
    aparecer como Administrador e volta a ser Usuário."""
    from users_api.permissions import STAFF_PERMISSION_FIELDS
    User = apps.get_model('auth', 'User')
    UserPermissions = apps.get_model('users_api', 'UserPermissions')

    perms_by_user = {p.user_id: p for p in UserPermissions.objects.all()}
    for user in User.objects.iterator():
        if user.is_superuser:
            should = True
        else:
            p = perms_by_user.get(user.id)
            should = bool(p) and any(getattr(p, f, False) for f in STAFF_PERMISSION_FIELDS)
        if user.is_staff != should:
            user.is_staff = should
            user.save(update_fields=['is_staff'])


def backwards(apps, schema_editor):
    # Recalcular é idempotente; não há o que reverter.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('users_api', '0040_backfill_export_perms'),
    ]

    operations = [
        migrations.RunPython(recompute_is_staff, backwards),
    ]
