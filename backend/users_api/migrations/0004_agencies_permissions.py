from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users_api', '0003_grant_all_existing_users'),
    ]

    operations = [
        migrations.AddField(
            model_name='userpermissions',
            name='agencies_view',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='userpermissions',
            name='agencies_edit',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='userpermissions',
            name='agencies_delete',
            field=models.BooleanField(default=False),
        ),
    ]
