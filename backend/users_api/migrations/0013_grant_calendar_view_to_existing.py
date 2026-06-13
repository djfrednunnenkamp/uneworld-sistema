from django.db import migrations


def grant_calendar_view_to_existing(apps, schema_editor):
    UserPermissions = apps.get_model('users_api', 'UserPermissions')

    # Preserva o acesso atual ao Calendário (antes liberado junto com "lists_view")
    UserPermissions.objects.filter(lists_view=True).update(calendar_view=True)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('users_api', '0012_userpermissions_calendar_view_and_more'),
    ]

    operations = [
        migrations.RunPython(grant_calendar_view_to_existing, noop),
    ]
