from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('agenda', '0003_calendarpreference_email_flags'),
    ]

    operations = [
        migrations.AddField(
            model_name='calendarpreference',
            name='receive_birthday_emails',
            field=models.BooleanField(default=False, verbose_name='Receber e-mails de aniversários de passageiros'),
        ),
    ]
