from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('agenda', '0006_send_hour_last_daily_sent'),
    ]

    operations = [
        migrations.AddField(
            model_name='calendarpreference',
            name='digest_send_hour',
            field=models.IntegerField(default=8, verbose_name='Horário de envio do resumo do calendário'),
        ),
    ]
