from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('trips', '0024_add_connection_ticket_status'),
        ('passengers', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='listenrollment',
            name='selected_passport',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='selected_for_enrollments',
                to='passengers.passengerdocument',
                verbose_name='Passaporte selecionado para a viagem',
            ),
        ),
    ]
