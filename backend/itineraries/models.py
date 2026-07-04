from django.core.validators import MinValueValidator
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
        ('maritimo',  'Marítimo'),
    ]

    name        = models.CharField('Nome da viagem', max_length=300)
    slug        = models.SlugField('Slug', max_length=350, unique=True, blank=True)
    start_date  = models.DateField('Data de início', null=True, blank=True)
    end_date    = models.DateField('Data de término', null=True, blank=True)
    trip_type   = models.CharField('Tipo', max_length=20, choices=TYPE_CHOICES, default='aereo')
    # Produto próprio da UneWorld (operação própria) vs. de terceiro/parceiro.
    is_own_product = models.BooleanField('Produto próprio da UneWorld', default=True)
    # Categoria puxa da lista "Categorias de acomodação" (Configurações › Categorias),
    # onde ficam Standard/Luxo/Internacional/Nacional etc.
    category    = models.ForeignKey('config_api.ConfigListCategory', null=True, blank=True,
                                     on_delete=models.SET_NULL, related_name='itineraries', verbose_name='Categoria')
    continent   = models.ForeignKey('config_api.ConfigContinent', null=True, blank=True,
                                     on_delete=models.SET_NULL, related_name='itineraries', verbose_name='Continente')

    # ── Classificação (campos migrados do WordPress) ──
    # ADITIVOS: não substituem `trip_type` (choices aereo/terrestre) nem `category`,
    # que continuam existindo e funcionando. `itinerary_type` é a taxonomia extensível
    # por lista; `maritime_company` só se aplica a roteiros marítimos/cruzeiros;
    # `cities` são as cidades visitadas (múltipla seleção).
    itinerary_type   = models.ForeignKey('config_api.ConfigItineraryType', null=True, blank=True,
                                          on_delete=models.SET_NULL, related_name='itineraries',
                                          verbose_name='Tipo de roteiro (lista)')
    maritime_company = models.ForeignKey('config_api.ConfigMaritimeCompany', null=True, blank=True,
                                          on_delete=models.SET_NULL, related_name='itineraries',
                                          verbose_name='Companhia marítima')
    cities           = models.ManyToManyField('config_api.ConfigCity', blank=True,
                                               related_name='itineraries', verbose_name='Cidades')
    countries        = models.ManyToManyField('config_api.ConfigCountry', blank=True,
                                               related_name='itineraries', verbose_name='Países')
    airports         = models.ManyToManyField('config_api.Airport', blank=True,
                                               related_name='itineraries', verbose_name='Aeroportos')
    keywords         = models.ManyToManyField('config_api.ConfigKeyword', blank=True,
                                               related_name='itineraries', verbose_name='Palavras-chave')
    inclusions       = models.ManyToManyField('config_api.ConfigInclusion', blank=True,
                                               related_name='itineraries', verbose_name='Inclusos no pacote')
    highlights       = models.ManyToManyField('config_api.ConfigHighlight', blank=True,
                                               related_name='itineraries', verbose_name='Destaques')
    itinerary_types  = models.ManyToManyField('config_api.ConfigItineraryType', blank=True,
                                               related_name='typed_itineraries', verbose_name='Tipos de roteiro')
    special_dates    = models.ManyToManyField('config_api.ConfigSpecialDate', blank=True,
                                               related_name='itineraries', verbose_name='Datas especiais')

    # ── Financeiro ──
    CURRENCY_CHOICES = [
        ('EUR', 'Euro'),
        ('USD', 'Dólar'),
        ('BRL', 'Real'),
    ]
    base_currency             = models.CharField('Moeda base', max_length=3, choices=CURRENCY_CHOICES, default='EUR')

    # Cláusulas do contrato definidas pelo roteiro — o contrato puxa daqui.
    clauses        = models.ManyToManyField('config_api.ContractClause', blank=True, related_name='itineraries', verbose_name='Cláusulas do contrato')
    custom_clauses = models.JSONField('Cláusulas personalizadas', default=list, blank=True)
    # Sugestão de pagamento (SNAPSHOT/cópia): {name, down_payment_percent,
    # installments_count, payment_method, first_due_days, interval_days}. Vem de um
    # Modelo de pagamento das Configurações ou é criada do zero aqui. O contrato lê
    # daqui para oferecer o botão "aplicar sugestão de pagamento". null = sem sugestão.
    payment_plan   = models.JSONField('Sugestão de pagamento', null=True, blank=True)
    # Lista de modelos de pagamento oferecidos por este roteiro (cada um é um
    # snapshot dos campos do modelo + name). Substitui o payment_plan único; o
    # payment_plan continua preenchido com o 1º da lista para compatibilidade
    # com o contrato (que hoje lê um só). Cada item pode ser exclusivo do roteiro
    # ou ter vindo (cópia) de um Modelo global das Configurações.
    payment_plans  = models.JSONField('Modelos de pagamento do roteiro', default=list, blank=True)

    # Override das Opções de pagamento à vista SÓ para este roteiro. a_vista_discount_value
    # NULL = não configurado → usa o padrão do sistema (SystemSettings). Preenchido = usa este.
    A_VISTA_DISCOUNT_MODE_CHOICES = [('percent', '% do total'), ('valor', 'Valor em R$')]
    a_vista_discount_mode   = models.CharField('Tipo do desconto à vista', max_length=10, choices=A_VISTA_DISCOUNT_MODE_CHOICES, default='percent')
    a_vista_discount_value  = models.DecimalField('Desconto à vista (valor ou %)', max_digits=12, decimal_places=2, null=True, blank=True)
    a_vista_payment_method  = models.CharField('Forma de pagamento à vista', max_length=100, blank=True)

    # Rascunho (autosalvo / não finalizado) vs Ativo. A lista mostra só ativos;
    # rascunhos aparecem num popup à parte. 'Salvar' no detalhe finaliza (ativo).
    STATUS_CHOICES = [('rascunho', 'Rascunho'), ('ativo', 'Ativo')]
    status      = models.CharField('Status', max_length=20, choices=STATUS_CHOICES, default='ativo', db_index=True)

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


class ItineraryDay(models.Model):
    """Roteiro dia-a-dia (estrutura repetível migrada do WordPress). Cada linha é
    um dia do itinerário. Substitui o que no WordPress seria um bloco/JSON repetido,
    por uma child table indexável e consultável."""
    itinerary   = models.ForeignKey(Itinerary, on_delete=models.CASCADE, related_name='days')
    day_number  = models.PositiveIntegerField('Dia nº', validators=[MinValueValidator(1)])
    title       = models.CharField('Título', max_length=300, blank=True)
    description = models.TextField('Descrição', blank=True)
    city        = models.ForeignKey('config_api.ConfigCity', null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name='+', verbose_name='Cidade do dia')
    order       = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order', 'day_number']
        verbose_name = 'Dia do roteiro'
        verbose_name_plural = 'Dias do roteiro'
        constraints = [
            models.UniqueConstraint(fields=['itinerary', 'day_number'], name='uniq_itinerary_day_number'),
        ]
        indexes = [
            models.Index(fields=['itinerary', 'order'], name='idx_itinday_itin_order'),
        ]

    def __str__(self):
        return f'{self.itinerary_id} · Dia {self.day_number}'


class ItineraryImage(models.Model):
    """Galeria de imagens do roteiro (estrutura repetível migrada do WordPress).
    No máximo uma imagem por roteiro pode ser marcada como capa (is_cover)."""
    itinerary = models.ForeignKey(Itinerary, on_delete=models.CASCADE, related_name='images')
    # Imagem da GALERIA do roteiro (day nulo) OU de um DIA específico do dia-a-dia
    # (day preenchido). Reusa a mesma tabela/upload, sem child table extra.
    day       = models.ForeignKey('ItineraryDay', null=True, blank=True, on_delete=models.CASCADE, related_name='images')
    image     = models.ImageField('Imagem', upload_to='itineraries/')
    caption   = models.CharField('Legenda', max_length=300, blank=True)
    is_cover  = models.BooleanField('É a capa', default=False)
    order     = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order']
        verbose_name = 'Imagem do roteiro'
        verbose_name_plural = 'Imagens do roteiro'
        constraints = [
            # Garante no máximo UMA capa por roteiro (parcial: só vale quando is_cover=True).
            models.UniqueConstraint(fields=['itinerary'], condition=models.Q(is_cover=True),
                                    name='uniq_cover_per_itinerary'),
        ]
        indexes = [
            models.Index(fields=['itinerary', 'order'], name='idx_itinimg_itin_order'),
        ]

    def __str__(self):
        return f'{self.itinerary_id} · img {self.pk}'


class ItineraryDocument(models.Model):
    """Documento (PDF) anexado ao roteiro — ex.: programação, condições, folheto."""
    itinerary = models.ForeignKey(Itinerary, on_delete=models.CASCADE, related_name='documents')
    file      = models.FileField('Arquivo', upload_to='itineraries/docs/')
    title     = models.CharField('Título', max_length=300, blank=True)
    order     = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order']
        verbose_name = 'Documento do roteiro'
        verbose_name_plural = 'Documentos do roteiro'
        indexes = [
            models.Index(fields=['itinerary', 'order'], name='idx_itindoc_itin_order'),
        ]

    def __str__(self):
        return self.title or f'{self.itinerary_id} · doc {self.pk}'
