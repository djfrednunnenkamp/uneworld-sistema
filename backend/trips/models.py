from django.db import models
from passengers.models import Passenger


# ── Modelos legados (mantidos para integridade das migrations) ───────────────

class Destination(models.Model):
    name        = models.CharField('Destino', max_length=200)
    country     = models.CharField('País', max_length=100)
    description = models.TextField('Descrição', blank=True)
    image       = models.ImageField('Imagem', upload_to='destinations/', null=True, blank=True)

    class Meta:
        verbose_name        = 'Destino'
        verbose_name_plural = 'Destinos'
        ordering            = ['name']

    def __str__(self):
        return f'{self.name}, {self.country}'


class Trip(models.Model):
    STATUS_CHOICES = [
        ('planning', 'Em planejamento'), ('open', 'Aberta'), ('full', 'Lotada'),
        ('ongoing', 'Em andamento'), ('completed', 'Concluída'), ('cancelled', 'Cancelada'),
    ]
    title            = models.CharField('Título', max_length=200)
    destination      = models.ForeignKey(Destination, on_delete=models.PROTECT, verbose_name='Destino')
    description      = models.TextField('Descrição', blank=True)
    departure_date   = models.DateField('Data de partida')
    return_date      = models.DateField('Data de retorno')
    max_passengers   = models.PositiveIntegerField('Máximo de passageiros')
    price_per_person = models.DecimalField('Preço por pessoa', max_digits=10, decimal_places=2)
    status           = models.CharField('Status', max_length=20, choices=STATUS_CHOICES, default='planning')
    itinerary        = models.TextField('Itinerário', blank=True)
    includes         = models.TextField('O que inclui', blank=True)
    excludes         = models.TextField('O que não inclui', blank=True)
    created_at       = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at       = models.DateTimeField('Atualizado em', auto_now=True)

    class Meta:
        verbose_name        = 'Viagem'
        verbose_name_plural = 'Viagens'
        ordering            = ['-departure_date']

    def __str__(self): return self.title

    @property
    def enrolled_count(self):
        return self.enrollments.filter(status='confirmed').count()


class Enrollment(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pendente'), ('confirmed', 'Confirmado'), ('cancelled', 'Cancelado'),
    ]
    trip        = models.ForeignKey(Trip, on_delete=models.CASCADE, related_name='enrollments')
    passenger   = models.ForeignKey(Passenger, on_delete=models.CASCADE, related_name='enrollments')
    status      = models.CharField('Status', max_length=20, choices=STATUS_CHOICES, default='pending')
    enrolled_at = models.DateTimeField('Inscrito em', auto_now_add=True)
    notes       = models.TextField('Observações', blank=True)

    class Meta:
        verbose_name    = 'Inscrição'
        unique_together = ['trip', 'passenger']

    def __str__(self): return f'{self.passenger} → {self.trip}'


# ── Lista de Passageiros (novo sistema) ─────────────────────────────────────

class Supplier(models.Model):
    name = models.CharField('Nome', max_length=200)

    class Meta:
        verbose_name        = 'Fornecedor'
        verbose_name_plural = 'Fornecedores'
        ordering            = ['name']

    def __str__(self): return self.name


class ListAdditional(models.Model):
    name = models.CharField('Nome', max_length=200)

    class Meta:
        verbose_name        = 'Adicional'
        verbose_name_plural = 'Adicionais'
        ordering            = ['name']

    def __str__(self): return self.name


class PassengerList(models.Model):
    TYPE_CHOICES = [
        ('aereo',    'Via Aéreo'),
        ('onibus',   'Via Ônibus'),
        ('maritimo', 'Via Marítimo'),
    ]
    CATEGORY_CHOICES = [
        ('internacional', 'Internacional'),
        ('nacional',      'Nacional'),
    ]
    STATUS_CHOICES = [
        ('aberta',  'Aberta'),
        ('fechada', 'Fechada'),
    ]
    DOC_CHOICES = [
        ('',           'Nenhum'),
        ('passaporte', 'Passaporte'),
        ('rg',         'RG'),
        ('cnh',        'CNH'),
        ('visto',      'Visto'),
    ]

    name                 = models.CharField('Nome', max_length=300)
    list_type            = models.CharField('Tipo', max_length=20, choices=TYPE_CHOICES, default='aereo')
    category             = models.CharField('Categoria', max_length=20, choices=CATEGORY_CHOICES, default='internacional')
    block_capacity       = models.PositiveIntegerField('Capacidade do bloqueio', default=0)
    total_accommodations = models.PositiveIntegerField('Total de acomodações', default=0)
    start_date           = models.DateField('Data de início', null=True, blank=True)
    end_date             = models.DateField('Data de término', null=True, blank=True)
    suppliers            = models.ManyToManyField(Supplier,       blank=True, related_name='passenger_lists', verbose_name='Fornecedores')
    additionals          = models.ManyToManyField(ListAdditional, blank=True, related_name='passenger_lists', verbose_name='Adicionais')
    required_document    = models.CharField('Documento requerido', max_length=20, choices=DOC_CHOICES, blank=True)
    status               = models.CharField('Status', max_length=20, choices=STATUS_CHOICES, default='aberta')
    notes                = models.TextField('Observações', blank=True)
    created_at           = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at           = models.DateTimeField('Atualizado em', auto_now=True)

    class Meta:
        verbose_name        = 'Lista de Passageiros'
        verbose_name_plural = 'Listas de Passageiros'
        ordering            = ['-created_at']

    def __str__(self): return self.name

    @property
    def enrolled_count(self):
        return self.list_enrollments.count()


class ListEnrollment(models.Model):
    passenger_list = models.ForeignKey(PassengerList, on_delete=models.CASCADE, related_name='list_enrollments', verbose_name='Lista')
    passenger      = models.ForeignKey(Passenger,     on_delete=models.CASCADE, related_name='list_enrollments', verbose_name='Passageiro')
    enrolled_at    = models.DateTimeField('Adicionado em', auto_now_add=True)
    notes          = models.TextField('Observações', blank=True)

    class Meta:
        unique_together     = ['passenger_list', 'passenger']
        verbose_name        = 'Passageiro na lista'
        verbose_name_plural = 'Passageiros na lista'
        ordering            = ['enrolled_at']

    def __str__(self): return f'{self.passenger} → {self.passenger_list}'
