from django.db import models
from passengers.models import Passenger


class Destination(models.Model):
    name = models.CharField('Destino', max_length=200)
    country = models.CharField('País', max_length=100)
    description = models.TextField('Descrição', blank=True)
    image = models.ImageField('Imagem', upload_to='destinations/', null=True, blank=True)

    class Meta:
        verbose_name = 'Destino'
        verbose_name_plural = 'Destinos'
        ordering = ['name']

    def __str__(self):
        return f'{self.name}, {self.country}'


class Trip(models.Model):
    STATUS_CHOICES = [
        ('planning', 'Em planejamento'),
        ('open', 'Aberta'),
        ('full', 'Lotada'),
        ('ongoing', 'Em andamento'),
        ('completed', 'Concluída'),
        ('cancelled', 'Cancelada'),
    ]

    title = models.CharField('Título', max_length=200)
    destination = models.ForeignKey(Destination, on_delete=models.PROTECT, verbose_name='Destino')
    description = models.TextField('Descrição', blank=True)
    departure_date = models.DateField('Data de partida')
    return_date = models.DateField('Data de retorno')
    max_passengers = models.PositiveIntegerField('Máximo de passageiros')
    price_per_person = models.DecimalField('Preço por pessoa', max_digits=10, decimal_places=2)
    status = models.CharField('Status', max_length=20, choices=STATUS_CHOICES, default='planning')
    itinerary = models.TextField('Itinerário', blank=True)
    includes = models.TextField('O que inclui', blank=True)
    excludes = models.TextField('O que não inclui', blank=True)
    created_at = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at = models.DateTimeField('Atualizado em', auto_now=True)

    class Meta:
        verbose_name = 'Viagem'
        verbose_name_plural = 'Viagens'
        ordering = ['-departure_date']

    def __str__(self):
        return self.title

    @property
    def enrolled_count(self):
        return self.enrollments.filter(status='confirmed').count()

    @property
    def available_spots(self):
        return self.max_passengers - self.enrolled_count


class Enrollment(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pendente'),
        ('confirmed', 'Confirmado'),
        ('cancelled', 'Cancelado'),
    ]

    trip = models.ForeignKey(Trip, on_delete=models.CASCADE, related_name='enrollments', verbose_name='Viagem')
    passenger = models.ForeignKey(Passenger, on_delete=models.CASCADE, related_name='enrollments', verbose_name='Passageiro')
    status = models.CharField('Status', max_length=20, choices=STATUS_CHOICES, default='pending')
    enrolled_at = models.DateTimeField('Inscrito em', auto_now_add=True)
    notes = models.TextField('Observações', blank=True)

    class Meta:
        verbose_name = 'Inscrição'
        verbose_name_plural = 'Inscrições'
        unique_together = ['trip', 'passenger']

    def __str__(self):
        return f'{self.passenger} → {self.trip}'
