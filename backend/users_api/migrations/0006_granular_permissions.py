from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users_api', '0005_grant_agencies_to_existing'),
    ]

    operations = [
        migrations.AddField(
            model_name='userpermissions',
            name='passengers_upload_docs',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='userpermissions',
            name='passengers_view_logs',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='userpermissions',
            name='lists_download',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='userpermissions',
            name='lists_csv_upload',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='userpermissions',
            name='lists_passengers_add',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='userpermissions',
            name='lists_passengers_edit',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='userpermissions',
            name='lists_passengers_remove',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='userpermissions',
            name='agencies_view_logs',
            field=models.BooleanField(default=False),
        ),
    ]
