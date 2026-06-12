from django.db import migrations


def grant_dashboard_to_existing_users(apps, schema_editor):
    UserPermissions = apps.get_model('users_api', 'UserPermissions')

    # Preserva o comportamento atual: todos que já tinham acesso ao sistema
    # continuam vendo os números da Visão Geral normalmente.
    UserPermissions.objects.all().update(
        dashboard_view_passengers=True,
        dashboard_view_lists=True,
        dashboard_view_meetings=True,
        dashboard_view_enrollments=True,
    )


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('users_api', '0008_dashboard_permissions'),
    ]

    operations = [
        migrations.RunPython(grant_dashboard_to_existing_users, noop),
    ]
