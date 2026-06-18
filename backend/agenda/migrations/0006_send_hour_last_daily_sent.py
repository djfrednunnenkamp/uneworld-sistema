from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('agenda', '0005_emaillog'),
    ]

    operations = [
        migrations.AddField(
            model_name='calendarpreference',
            name='send_hour',
            field=models.IntegerField(default=8, verbose_name='Horário de envio (hora do dia)'),
        ),
        migrations.AddField(
            model_name='calendarpreference',
            name='last_daily_sent',
            field=models.DateField(blank=True, null=True, verbose_name='Último resumo diário enviado em'),
        ),
    ]
