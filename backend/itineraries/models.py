from django.db import models
from django.utils.text import slugify


class Itinerary(models.Model):
    """Roteiro turístico (pacote/itinerário publicável) — distinto da Lista
    de Passageiros (trips.PassengerList): o Roteiro é o "produto" comercial
    (com slug, destinos, países, categoria etc.), enquanto a Lista de
    Passageiros controla a operação de uma viagem específica."""
    TYPE_CHOICES = [
        ('aereo',     'Aéreo'),
        ('terrestre', 'Terrestre'),
    ]

    name        = models.CharField('Nome da viagem', max_length=300)
    slug        = models.SlugField('Slug', max_length=350, unique=True, blank=True)
    start_date  = models.DateField('Data de início', null=True, blank=True)
    end_date    = models.DateField('Data de término', null=True, blank=True)
    trip_type   = models.CharField('Tipo', max_length=20, choices=TYPE_CHOICES, default='aereo')
    category    = models.ForeignKey('config_api.ConfigItineraryCategory', null=True, blank=True,
                                     on_delete=models.SET_NULL, related_name='itineraries', verbose_name='Categoria')
    continent   = models.ForeignKey('config_api.ConfigContinent', null=True, blank=True,
                                     on_delete=models.SET_NULL, related_name='itineraries', verbose_name='Continente')
    countries     = models.ManyToManyField('config_api.ConfigCountry', blank=True, related_name='itineraries', verbose_name='Países')
    destinations  = models.ManyToManyField('config_api.ConfigDestination', blank=True, related_name='itineraries', verbose_name='Destinos e Cidades')

    # ── Conteúdo editorial ──
    cover_title       = models.CharField('Título da capa', max_length=300, blank=True)
    internal_title    = models.TextField('Título interno completo', blank=True)
    subtitle          = models.CharField('Subtítulo', max_length=500, blank=True)
    short_description = models.CharField('Breve descrição', max_length=500, blank=True)
    holiday           = models.ForeignKey('config_api.ConfigHoliday', null=True, blank=True,
                                           on_delete=models.SET_NULL, related_name='itineraries', verbose_name='Feriado')
    is_featured = models.BooleanField('Destaque na home?', default=False)
    is_active   = models.BooleanField('Roteiro ativo?', default=True)
    is_full     = models.BooleanField('Roteiro lotado?', default=False)
    is_listed   = models.BooleanField('Listado no website?', default=True)

    # ── Aviso ──
    NOTICE_COLOR_CHOICES = [
        ('laranja',   'Laranja'),
        ('vermelho',  'Vermelho'),
        ('verde',     'Verde'),
        ('azul',      'Azul'),
        ('cinza',     'Cinza'),
    ]
    has_notice     = models.BooleanField('Aviso', default=False)
    notice_color   = models.CharField('Cor do aviso', max_length=20, choices=NOTICE_COLOR_CHOICES, default='laranja')
    notice_message = models.CharField('Mensagem do aviso', max_length=300, blank=True)

    # ── Datas e financeiro ──
    day_count_correction      = models.IntegerField('Correção contagem de dias', default=0)
    cash_discount_percent     = models.DecimalField('Desconto à vista em %', max_digits=5, decimal_places=2, default=0)
    CURRENCY_CHOICES = [
        ('EUR', 'Euro'),
        ('USD', 'Dólar'),
        ('BRL', 'Real'),
    ]
    base_currency             = models.CharField('Moeda base', max_length=3, choices=CURRENCY_CHOICES, default='EUR')
    additional_spread_percent = models.DecimalField('Spread adicional em %', max_digits=5, decimal_places=2, default=0)

    # ── Conteúdo descritivo (textos longos, com editor rico) ──
    about_destination    = models.TextField('Sobre o destino', blank=True)
    day_by_day            = models.TextField('Dia a dia', blank=True)
    package_includes      = models.TextField('O que inclui no pacote', blank=True)
    package_excludes      = models.TextField('O que não inclui no pacote', blank=True)
    insurance_info        = models.TextField('Adicional de seguro viagem', blank=True)
    pricing_info          = models.TextField('Informações sobre valores', blank=True)
    payment_info          = models.TextField('Forma de pagamento', blank=True)
    terms_info            = models.TextField('Condições gerais para compra do pacote', blank=True)
    hotels_reserved        = models.TextField('Hotéis reservados', blank=True)
    transport_info        = models.TextField('Parte aérea / rodoviária', blank=True)
    documentation_info    = models.TextField('Documentação necessária para a viagem', blank=True)
    extras                = models.TextField('Extras', blank=True)
    # Cláusulas do contrato definidas pelo roteiro — o contrato puxa daqui.
    clauses        = models.ManyToManyField('config_api.ContractClause', blank=True, related_name='itineraries', verbose_name='Cláusulas do contrato')
    custom_clauses = models.JSONField('Cláusulas personalizadas', default=list, blank=True)

    created_at  = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at  = models.DateTimeField('Atualizado em', auto_now=True)

    is_deleted  = models.BooleanField('Excluído', default=False, db_index=True)
    deleted_at  = models.DateTimeField('Excluído em', null=True, blank=True)

    class Meta:
        verbose_name = 'Roteiro'
        verbose_name_plural = 'Roteiros'
        ordering = ['-created_at']

    def __str__(self):
        return self.name

    def _base_slug(self):
        parts = [self.name]
        if self.start_date and self.end_date:
            parts.append(f'{self.start_date.strftime("%d-%m-%Y")}-a-{self.end_date.strftime("%d-%m-%Y")}')
        return slugify('-'.join(parts))

    def save(self, *args, **kwargs):
        if not self.slug:
            base = self._base_slug()
            slug = base
            i = 2
            while Itinerary.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f'{base}-{i}'
                i += 1
            self.slug = slug
        super().save(*args, **kwargs)


class ItineraryServiceLine(models.Model):
    """Linha de "serviços turísticos fornecidos por terceiros" — serviço(s)
    de um fornecedor repassado/intermediado no Roteiro, com o percentual de
    comissão/repasse correspondente."""
    itinerary  = models.ForeignKey(Itinerary, on_delete=models.CASCADE, related_name='service_lines')
    supplier   = models.ForeignKey('trips.Supplier', null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name='+', verbose_name='Fornecedor')
    services   = models.ManyToManyField('config_api.ConfigService', blank=True, related_name='+', verbose_name='Serviços')
    percentage = models.DecimalField('Percentual %', max_digits=5, decimal_places=2, default=0)
    order      = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order']
        verbose_name = 'Linha de serviço'
        verbose_name_plural = 'Linhas de serviço'

    def __str__(self):
        return f'{self.supplier} ({self.percentage}%)'


class ItineraryAccommodationLine(models.Model):
    """Tabela de preços de acomodação do Roteiro — valor por pessoa e taxas de
    cada tipo de acomodação, na moeda base do roteiro. São puxados automaticamente
    para o contrato quando o roteiro é selecionado."""
    itinerary          = models.ForeignKey(Itinerary, on_delete=models.CASCADE, related_name='accommodation_lines')
    accommodation_type = models.ForeignKey('config_api.ConfigAccommodation', null=True, blank=True,
                                            on_delete=models.SET_NULL, related_name='+', verbose_name='Tipo de acomodação')
    value_per_person   = models.DecimalField('Valor por pessoa', max_digits=12, decimal_places=2, default=0)
    taxes              = models.DecimalField('Taxas', max_digits=12, decimal_places=2, default=0)
    order              = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order']
        verbose_name = 'Linha de acomodação'
        verbose_name_plural = 'Linhas de acomodação'

    def __str__(self):
        return f'{self.accommodation_type} ({self.value_per_person})'
