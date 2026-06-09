from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('config_api', '0013_airline'),
        ('trips', '0018_flightleg_blocked_seats'),
    ]

    operations = [
        migrations.CreateModel(
            name='PassengerFlightLeg',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('direction', models.CharField(choices=[('ida', 'Ida'), ('volta', 'Volta')], default='ida', max_length=10, verbose_name='Direção')),
                ('order', models.PositiveSmallIntegerField(default=0, verbose_name='Ordem')),
                ('flight_number', models.CharField(blank=True, max_length=20, verbose_name='Número do voo')),
                ('airline', models.CharField(blank=True, max_length=100, verbose_name='Companhia aérea')),
                ('departure_date', models.DateField(blank=True, null=True, verbose_name='Data de partida')),
                ('departure_time', models.TimeField(blank=True, null=True, verbose_name='Horário de partida')),
                ('arrival_date', models.DateField(blank=True, null=True, verbose_name='Data de chegada')),
                ('arrival_time', models.TimeField(blank=True, null=True, verbose_name='Horário de chegada')),
                ('enrollment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='passenger_flight_legs', to='trips.listenrollment')),
                ('origin_airport', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='config_api.airport', verbose_name='Aeroporto de origem')),
                ('destination_airport', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='config_api.airport', verbose_name='Aeroporto de destino')),
            ],
            options={
                'verbose_name': 'Trecho individual de voo',
                'verbose_name_plural': 'Trechos individuais de voo',
                'ordering': ['direction', 'order', 'departure_date', 'departure_time'],
            },
        ),
    ]
