from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('agenda', '0007_digest_send_hour'),
    ]

    operations = [
        migrations.AddField(
            model_name='calendarpreference',
            name='time_format',
            field=models.CharField(
                choices=[('24h', '24 horas'), ('12h', '12 horas (AM/PM)')],
                default='24h',
                max_length=3,
                verbose_name='Formato de horário',
            ),
        ),
    ]
