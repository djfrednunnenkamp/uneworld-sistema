from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users_api', '0007_grant_granular_to_existing'),
    ]

    operations = [
        migrations.AddField(
            model_name='userpermissions',
            name='dashboard_view_passengers',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='userpermissions',
            name='dashboard_view_lists',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='userpermissions',
            name='dashboard_view_meetings',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='userpermissions',
            name='dashboard_view_enrollments',
            field=models.BooleanField(default=False),
        ),
    ]
