from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('config_api', '0013_airline'),
        ('trips', '0019_passenger_flight_leg'),
    ]

    operations = [
        migrations.CreateModel(
            name='FeederLeg',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('order', models.PositiveSmallIntegerField(default=0, verbose_name='Ordem')),
                ('flight_number', models.CharField(blank=True, max_length=20, verbose_name='Número do voo')),
                ('airline', models.CharField(blank=True, max_length=100, verbose_name='Companhia aérea')),
                ('departure_date', models.DateField(blank=True, null=True, verbose_name='Data de partida')),
                ('departure_time', models.TimeField(blank=True, null=True, verbose_name='Horário de partida')),
                ('arrival_date', models.DateField(blank=True, null=True, verbose_name='Data de chegada')),
                ('arrival_time', models.TimeField(blank=True, null=True, verbose_name='Horário de chegada')),
                ('blocked_seats', models.PositiveSmallIntegerField(blank=True, null=True, verbose_name='Lugares bloqueados')),
                ('passenger_list', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='feeder_legs', to='trips.passengerlist', verbose_name='Lista')),
                ('departure_airport', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='feeder_legs', to='config_api.airport', verbose_name='Aeroporto de embarque do grupo')),
                ('origin_airport', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='config_api.airport', verbose_name='Origem')),
                ('destination_airport', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='config_api.airport', verbose_name='Destino')),
            ],
            options={
                'verbose_name': 'Trecho de acesso',
                'verbose_name_plural': 'Trechos de acesso',
                'ordering': ['departure_airport', 'order', 'departure_date', 'departure_time'],
            },
        ),
    ]
