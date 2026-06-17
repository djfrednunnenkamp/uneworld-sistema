from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('agenda', '0002_calendarpreference_side_panel_enabled_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='calendarpreference',
            name='receive_deadline_emails',
            field=models.BooleanField(default=False, verbose_name='Receber e-mails de prazos de confirmação'),
        ),
        migrations.AddField(
            model_name='calendarpreference',
            name='receive_task_emails',
            field=models.BooleanField(default=False, verbose_name='Receber e-mails de pendências'),
        ),
    ]
