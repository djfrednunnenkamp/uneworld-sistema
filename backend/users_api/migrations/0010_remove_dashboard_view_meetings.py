from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('users_api', '0009_grant_dashboard_to_existing'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='userpermissions',
            name='dashboard_view_meetings',
        ),
    ]
