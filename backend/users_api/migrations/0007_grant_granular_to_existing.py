from django.db import migrations


def grant_granular_to_existing_users(apps, schema_editor):
    UserPermissions = apps.get_model('users_api', 'UserPermissions')

    # Preserva o que cada usuário já podia fazer antes destas permissões existirem.
    UserPermissions.objects.filter(passengers_edit=True).update(
        passengers_upload_docs=True,
    )
    UserPermissions.objects.filter(lists_view=True).update(
        lists_download=True,
    )
    UserPermissions.objects.filter(lists_edit=True).update(
        lists_csv_upload=True,
        lists_passengers_add=True,
        lists_passengers_edit=True,
        lists_passengers_remove=True,
    )
    UserPermissions.objects.filter(lists_view_logs=True).update(
        passengers_view_logs=True,
        agencies_view_logs=True,
    )


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('users_api', '0006_granular_permissions'),
    ]

    operations = [
        migrations.RunPython(grant_granular_to_existing_users, noop),
    ]
