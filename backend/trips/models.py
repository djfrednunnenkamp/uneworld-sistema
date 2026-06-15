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


class CrewRole(models.Model):
    name = models.CharField('Nome', max_length=200)

    class Meta:
        verbose_name        = 'Função da equipe técnica'
        verbose_name_plural = 'Funções da equipe técnica'
        ordering            = ['name']

    def __str__(self): return self.name


class Roteiro(models.Model):
    name = models.CharField('Nome', max_length=300)

    class Meta:
        verbose_name        = 'Roteiro'
        verbose_name_plural = 'Roteiros'
        ordering            = ['name']

    def __str__(self): return self.name


class PassengerList(models.Model):
    TYPE_CHOICES = [
        ('aereo',     'Via Aéreo'),
        ('terrestre', 'Via Terrestre'),
    ]
    STATUS_CHOICES = [
        ('aberta',  'Aberta'),
        ('fechada', 'Fechada'),
    ]
    DOC_CHOICES = ['passaporte', 'rg', 'cnh']

    name                 = models.CharField('Nome', max_length=300)
    list_type            = models.CharField('Tipo', max_length=20, choices=TYPE_CHOICES, default='aereo')
    category             = models.CharField('Categoria', max_length=100, default='Internacional')
    block_capacity       = models.PositiveIntegerField('Capacidade do bloqueio', default=0)
    total_accommodations = models.PositiveIntegerField('Total de acomodações', default=0)
    start_date           = models.DateField('Data de início', null=True, blank=True)
    end_date             = models.DateField('Data de término', null=True, blank=True)
    suppliers            = models.ManyToManyField(Supplier,       blank=True, related_name='passenger_lists', verbose_name='Fornecedores')
    additionals          = models.ManyToManyField(ListAdditional, blank=True, related_name='passenger_lists', verbose_name='Adicionais')
    roteiros             = models.ManyToManyField(Roteiro,        blank=True, related_name='passenger_lists', verbose_name='Roteiros')
    required_documents   = models.JSONField('Documentos requeridos', default=list, blank=True)
    default_airport      = models.ForeignKey('config_api.Airport',       null=True, blank=True, on_delete=models.SET_NULL, related_name='default_lists', verbose_name='Aeroporto de saída padrão')
    departure_country    = models.ForeignKey('config_api.ConfigCountry', null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='País de saída')
    departure_state      = models.ForeignKey('config_api.ConfigState',   null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='Estado de saída')
    departure_city       = models.ForeignKey('config_api.ConfigCity',    null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='Cidade de saída')
    bus_map              = models.ForeignKey('config_api.BusMap',        null=True, blank=True, on_delete=models.SET_NULL, related_name='passenger_lists', verbose_name='Mapa de assentos de ônibus')
    status               = models.CharField('Status', max_length=20, choices=STATUS_CHOICES, default='aberta', db_index=True)
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
    STATUS_CHOICES = [
        ('confirmado', 'Confirmado'),
        ('pendente',   'Pendente'),
        ('reservado',  'Reservado'),
        ('cancelado',  'Cancelado'),
    ]

    passenger_list   = models.ForeignKey(PassengerList, on_delete=models.CASCADE, related_name='list_enrollments', verbose_name='Lista')
    passenger        = models.ForeignKey(Passenger, null=True, blank=True, on_delete=models.CASCADE, related_name='list_enrollments', verbose_name='Passageiro')
    agency           = models.ForeignKey('agencies.Agency', null=True, blank=True, on_delete=models.SET_NULL, related_name='list_enrollments', verbose_name='Agência')
    responsible_user = models.ForeignKey('auth.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='responsible_enrollments', verbose_name='Responsável')
    # Bloqueio de agência (sem passageiro definido)
    is_block         = models.BooleanField('É bloqueio', default=False)
    block_agency     = models.CharField('Agência (bloqueio)', max_length=200, blank=True)
    is_provisional   = models.BooleanField('É provisório', default=False)
    accommodation    = models.CharField('Acomodação', max_length=200, blank=True)
    seat             = models.CharField('Assento', max_length=10, blank=True)
    enrollment_status  = models.CharField('Status', max_length=20, choices=STATUS_CHOICES, default='pendente', db_index=True)
    pending_until      = models.DateField('Pendente até', null=True, blank=True)
    pending_until_created_by = models.ForeignKey('auth.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='Prazo definido por')
    pending_reason     = models.TextField('Motivo da pendência', blank=True)
    departure_airport  = models.ForeignKey('config_api.Airport', null=True, blank=True, on_delete=models.SET_NULL, related_name='enrollments', verbose_name='Aeroporto de saída')
    ORIGIN_MODE_CHOICES = [
        ('bus',   'Ônibus'),
        ('plane', 'Avião'),
    ]
    origin_mode    = models.CharField('Modo de origem', max_length=10, choices=ORIGIN_MODE_CHOICES, blank=True)
    origin_country = models.ForeignKey('config_api.ConfigCountry', null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='País de origem')
    origin_state   = models.ForeignKey('config_api.ConfigState',   null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='Estado de origem')
    origin_city    = models.ForeignKey('config_api.ConfigCity',    null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='Cidade de origem')
    origin_airport = models.ForeignKey('config_api.Airport', null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='Aeroporto de origem')
    TICKET_STATUS = [
        ('nao_emitida',    'Não emitida'),
        ('via_bloqueio',   'Via bloqueio'),
        ('fora_bloqueio',  'Voo individual'),
    ]
    ticket_status            = models.CharField('Status da passagem', max_length=20, choices=TICKET_STATUS, default='nao_emitida')
    connection_ticket_status = models.CharField('Status da passagem de conexão', max_length=20, choices=TICKET_STATUS, default='nao_emitida')
    selected_passport  = models.ForeignKey('passengers.PassengerDocument', null=True, blank=True, on_delete=models.SET_NULL, related_name='selected_for_enrollments', verbose_name='Passaporte selecionado para a viagem')
    additionals        = models.ManyToManyField(ListAdditional, blank=True, related_name='enrollments', verbose_name='Adicionais')
    crew_roles         = models.ManyToManyField(CrewRole,       blank=True, related_name='enrollments', verbose_name='Funções da equipe técnica')
    order_in_list      = models.PositiveIntegerField('Ordem', default=0)
    enrolled_at        = models.DateTimeField('Adicionado em', auto_now_add=True)
    notes              = models.TextField('Observações', blank=True)

    class Meta:
        unique_together     = ['passenger_list', 'passenger']
        verbose_name        = 'Passageiro na lista'
        verbose_name_plural = 'Passageiros na lista'
        ordering            = ['order_in_list', 'enrolled_at']

    def __str__(self): return f'{self.passenger} → {self.passenger_list}'


class Room(models.Model):
    passenger_list = models.ForeignKey(PassengerList, on_delete=models.CASCADE, related_name='rooms', verbose_name='Lista')
    name           = models.CharField('Nome', max_length=200)
    created_at     = models.DateTimeField('Criado em', auto_now_add=True)

    class Meta:
        unique_together     = ['passenger_list', 'name']
        verbose_name        = 'Acomodação'
        verbose_name_plural = 'Acomodações'
        ordering            = ['name']

    def __str__(self): return f'{self.name} ({self.passenger_list})'
