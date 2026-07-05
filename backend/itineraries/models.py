import os
import uuid
from django.core.validators import MinValueValidator
from django.db import models
from django.utils.text import slugify


def secure_itinerary_image_path(instance, filename):
    """Nome de arquivo seguro (uuid) — descarta o nome enviado pelo cliente,
    evitando path traversal, colisões e vazamento de informação."""
    ext = os.path.splitext(filename)[1].lower()
    return f"itineraries/{uuid.uuid4().hex}{ext}"


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
    # Marca o roteiro como destaque (ex.: aparecer em vitrine/home).
    is_featured    = models.BooleanField('Destaque do roteiro', default=False)
    # Meios de transporte do roteiro — controlam quais abas aparecem no detalhe
    # (Voo/Barco/Terrestre). Independentes: um roteiro pode ter mais de um.
    has_voo        = models.BooleanField('Transporte aéreo (Voo)', default=False)
    has_barco      = models.BooleanField('Transporte marítimo (Barco)', default=False)
    has_terrestre  = models.BooleanField('Transporte terrestre', default=False)
    # Categoria puxa da lista "Categorias de acomodação" (Configurações › Categorias),
    # onde ficam Standard/Luxo/Internacional/Nacional etc.
    category    = models.ForeignKey('config_api.ConfigListCategory', null=True, blank=True,
                                     on_delete=models.SET_NULL, related_name='itineraries', verbose_name='Categoria')
    continent   = models.ForeignKey('config_api.ConfigContinent', null=True, blank=True,
                                     on_delete=models.SET_NULL, related_name='itineraries', verbose_name='Continente')
    # Continentes (multi-seleção). O FK `continent` acima fica por compatibilidade.
    continents  = models.ManyToManyField('config_api.ConfigContinent', blank=True,
                                          related_name='itineraries_multi', verbose_name='Continentes')

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
    # Moeda base: código ISO-4217 (3 letras). Sem `choices` fixo — as opções vêm
    # das moedas cadastradas no Câmbio (Configurações › Câmbio).
    base_currency             = models.CharField('Moeda base', max_length=3, default='EUR')

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

    # Aba "Informações do Roteiro": campos de texto rico (HTML), editados na intranet.
    info_general       = models.TextField('Informações', blank=True, default='')
    info_included      = models.TextField('Incluso no Pacote', blank=True, default='')
    info_not_included  = models.TextField('Não Incluso no Pacote', blank=True, default='')
    info_optionals     = models.TextField('Opcionais', blank=True, default='')
    info_tips          = models.TextField('Dicas de Viagem', blank=True, default='')
    info_documents     = models.TextField('Documentos Necessários', blank=True, default='')
    info_promo_rules   = models.TextField('Regras Promoção', blank=True, default='')
    info_insurance     = models.TextField('Seguros', blank=True, default='')
    info_values        = models.TextField('Informações sobre Valores', blank=True, default='')
    info_extras        = models.TextField('Extras', blank=True, default='')

    # Observações internas do roteiro (lembretes/pendências da equipe — não é
    # conteúdo do roteiro em si).
    notes              = models.TextField('Observações', blank=True, default='')

    # Vínculo vivo com templates (por campo): _template = template de origem;
    # _template_linked = se True, editar o template nas Configurações reaplica o
    # texto aqui. Editar o texto à mão desliga o vínculo (feito no frontend).
    info_general_template           = models.ForeignKey('ItineraryFieldTemplate', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    info_general_template_linked    = models.BooleanField(default=False)
    info_included_template          = models.ForeignKey('ItineraryFieldTemplate', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    info_included_template_linked   = models.BooleanField(default=False)
    info_not_included_template      = models.ForeignKey('ItineraryFieldTemplate', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    info_not_included_template_linked = models.BooleanField(default=False)
    info_optionals_template         = models.ForeignKey('ItineraryFieldTemplate', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    info_optionals_template_linked  = models.BooleanField(default=False)
    info_tips_template              = models.ForeignKey('ItineraryFieldTemplate', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    info_tips_template_linked       = models.BooleanField(default=False)
    info_documents_template         = models.ForeignKey('ItineraryFieldTemplate', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    info_documents_template_linked  = models.BooleanField(default=False)
    info_promo_rules_template       = models.ForeignKey('ItineraryFieldTemplate', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    info_promo_rules_template_linked = models.BooleanField(default=False)
    info_insurance_template         = models.ForeignKey('ItineraryFieldTemplate', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    info_insurance_template_linked  = models.BooleanField(default=False)
    info_values_template            = models.ForeignKey('ItineraryFieldTemplate', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    info_values_template_linked     = models.BooleanField(default=False)
    info_extras_template            = models.ForeignKey('ItineraryFieldTemplate', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    info_extras_template_linked     = models.BooleanField(default=False)

    # Rascunho (autosalvo / não finalizado) vs Ativo. A lista mostra só ativos;
    # rascunhos aparecem num popup à parte. 'Salvar' no detalhe finaliza (ativo).
    STATUS_CHOICES = [('rascunho', 'Rascunho'), ('ativo', 'Ativo')]
    status      = models.CharField('Status', max_length=20, choices=STATUS_CHOICES, default='ativo', db_index=True)
    # Visibilidade pública, independente de rascunho/ativo: só publicado fica visível
    # ao público. Um roteiro finalizado nasce "não publicado" até ser publicado.
    is_published = models.BooleanField('Publicado (visível ao público)', default=False, db_index=True)

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
    # Ponto de partida ao qual este preço pertence (o valor muda conforme a saída).
    # Um dos dois, ou nenhum (lista "geral" quando o roteiro não tem Voo/Terrestre).
    flight_departure    = models.ForeignKey('ItineraryDeparture', null=True, blank=True,
                                             on_delete=models.CASCADE, related_name='accommodation_lines',
                                             verbose_name='Partida (aéreo)')
    terrestre_departure = models.ForeignKey('ItineraryTerrestreDeparture', null=True, blank=True,
                                             on_delete=models.CASCADE, related_name='accommodation_lines',
                                             verbose_name='Partida (terrestre)')
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
    """Imagens do roteiro. `kind` categoriza: galeria (carrossel), capa (pode ter
    várias), lâmina do bloqueio e lâmina do bloqueio promocional. Imagens de um DIA
    do dia-a-dia têm `day` preenchido (kind fica como 'gallery')."""
    KIND_CHOICES = [
        ('gallery',        'Galeria'),
        ('cover',          'Capa'),
        ('blocking',       'Lâmina do Bloqueio'),
        ('blocking_promo', 'Lâmina do Bloqueio Promocional'),
    ]
    itinerary = models.ForeignKey(Itinerary, on_delete=models.CASCADE, related_name='images')
    # Imagem da GALERIA do roteiro (day nulo) OU de um DIA específico do dia-a-dia
    # (day preenchido). Reusa a mesma tabela/upload, sem child table extra.
    day       = models.ForeignKey('ItineraryDay', null=True, blank=True, on_delete=models.CASCADE, related_name='images')
    image     = models.ImageField('Imagem', upload_to=secure_itinerary_image_path)
    caption   = models.CharField('Legenda', max_length=300, blank=True)
    kind      = models.CharField('Tipo', max_length=20, choices=KIND_CHOICES, default='gallery')
    order     = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order']
        verbose_name = 'Imagem do roteiro'
        verbose_name_plural = 'Imagens do roteiro'
        indexes = [
            models.Index(fields=['itinerary', 'order'], name='idx_itinimg_itin_order'),
        ]

    def __str__(self):
        return f'{self.itinerary_id} · img {self.pk}'


class ItineraryFieldTemplate(models.Model):
    """Template reutilizável para os campos de texto da aba 'Informações do
    Roteiro'. Cada template pertence a UM campo. Ao ser editado nas Configurações,
    reaplica o conteúdo aos roteiros vinculados (vínculo vivo ligado)."""
    FIELD_CHOICES = [
        ('general',      'Informações'),
        ('included',     'Incluso no Pacote'),
        ('not_included', 'Não Incluso no Pacote'),
        ('optionals',    'Opcionais'),
        ('tips',         'Dicas de Viagem'),
        ('documents',    'Documentos Necessários'),
        ('promo_rules',  'Regras Promoção'),
        ('insurance',    'Seguros'),
        ('values',       'Informações sobre Valores'),
        ('extras',       'Extras'),
    ]
    # field -> (coluna de conteúdo, coluna do FK, coluna do vínculo) no Itinerary.
    FIELD_COLUMNS = {
        'general':      ('info_general',      'info_general_template',      'info_general_template_linked'),
        'included':     ('info_included',     'info_included_template',     'info_included_template_linked'),
        'not_included': ('info_not_included', 'info_not_included_template', 'info_not_included_template_linked'),
        'optionals':    ('info_optionals',    'info_optionals_template',    'info_optionals_template_linked'),
        'tips':         ('info_tips',         'info_tips_template',         'info_tips_template_linked'),
        'documents':    ('info_documents',    'info_documents_template',    'info_documents_template_linked'),
        'promo_rules':  ('info_promo_rules',  'info_promo_rules_template',  'info_promo_rules_template_linked'),
        'insurance':    ('info_insurance',    'info_insurance_template',    'info_insurance_template_linked'),
        'values':       ('info_values',       'info_values_template',       'info_values_template_linked'),
        'extras':       ('info_extras',       'info_extras_template',       'info_extras_template_linked'),
    }

    field      = models.CharField('Campo', max_length=20, choices=FIELD_CHOICES, db_index=True)
    name       = models.CharField('Nome do template', max_length=200)
    content    = models.TextField('Conteúdo', blank=True, default='')
    order      = models.PositiveIntegerField('Ordem', default=0)
    created_at = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at = models.DateTimeField('Atualizado em', auto_now=True)

    class Meta:
        ordering = ['field', 'order', 'name']
        verbose_name = 'Template de campo do roteiro'
        verbose_name_plural = 'Templates de campos do roteiro'

    def __str__(self):
        return f'{self.get_field_display()} · {self.name}'

    def apply_to_linked(self):
        """Reaplica este conteúdo aos roteiros com vínculo vivo ligado a ele."""
        content_col, fk_col, linked_col = self.FIELD_COLUMNS[self.field]
        Itinerary.objects.filter(**{fk_col: self, linked_col: True}).update(**{content_col: self.content})


class ItineraryDeparture(models.Model):
    """Aeroporto de saída do roteiro (coluna esquerda da aba 'Voo'). Cada roteiro
    aéreo pode ter vários pontos de saída, escolhidos da lista de Aeroportos das
    Configurações."""
    itinerary = models.ForeignKey(Itinerary, on_delete=models.CASCADE, related_name='departures')
    airport   = models.ForeignKey('config_api.Airport', null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='Aeroporto de saída')
    order     = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order', 'id']
        verbose_name = 'Aeroporto de saída do roteiro'
        verbose_name_plural = 'Aeroportos de saída do roteiro'

    def __str__(self):
        return f'{self.itinerary_id} · saída {self.airport_id}'


class ItineraryFlight(models.Model):
    """Voo (trecho) a partir de um aeroporto de saída — coluna direita da aba 'Voo'.
    Vários voos encadeados formam as conexões/pontes."""
    departure     = models.ForeignKey(ItineraryDeparture, on_delete=models.CASCADE, related_name='flights')
    airline       = models.ForeignKey('config_api.Airline', null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='Companhia')
    flight_number = models.CharField('Número do voo', max_length=20, blank=True)
    origin        = models.ForeignKey('config_api.Airport', null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='Origem')
    destination   = models.ForeignKey('config_api.Airport', null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='Destino')
    departs_at    = models.DateTimeField('Saída', null=True, blank=True)
    arrives_at    = models.DateTimeField('Chegada', null=True, blank=True)
    order         = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order', 'id']
        verbose_name = 'Voo do roteiro'
        verbose_name_plural = 'Voos do roteiro'

    def __str__(self):
        return f'{self.departure_id} · voo {self.flight_number or self.pk}'


class ItineraryHotel(models.Model):
    """Hotel reservado do roteiro (aba 'Hotéis')."""
    itinerary = models.ForeignKey(Itinerary, on_delete=models.CASCADE, related_name='hotels')
    # Origem no catálogo global de hotéis (Configurações). Nulo se o hotel foi
    # removido de lá depois; name/city ficam guardados como cópia resiliente.
    config_hotel = models.ForeignKey('config_api.ConfigHotel', null=True, blank=True,
                                     on_delete=models.SET_NULL, related_name='+')
    # Vínculo vivo: se True, editar o hotel nas Configurações reaplica nome/
    # cidade/telefone aqui. Editar esses campos à mão desliga (feito no front).
    config_hotel_linked = models.BooleanField(default=True)
    name      = models.CharField('Nome do hotel', max_length=300)
    city      = models.CharField('Cidade', max_length=200, blank=True)
    check_in  = models.DateField('Check-in', null=True, blank=True)
    check_out = models.DateField('Check-out', null=True, blank=True)
    address   = models.CharField('Endereço', max_length=400, blank=True)
    phone     = models.CharField('Telefone', max_length=40, blank=True)
    notes     = models.TextField('Observações', blank=True, default='')
    order     = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order', 'id']
        verbose_name = 'Hotel do roteiro'
        verbose_name_plural = 'Hotéis do roteiro'

    def __str__(self):
        return self.name


class ItineraryBoat(models.Model):
    """Barco reservado do roteiro (aba 'Barco'). Espelha o hotel, alimentado
    pelo catálogo de Barcos (Configurações)."""
    itinerary = models.ForeignKey(Itinerary, on_delete=models.CASCADE, related_name='boats')
    config_boat = models.ForeignKey('config_api.ConfigBoat', null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name='+')
    # Vínculo vivo: se True, editar o barco nas Configurações reaplica o nome aqui.
    config_boat_linked = models.BooleanField(default=True)
    name      = models.CharField('Nome do barco', max_length=300)
    check_in  = models.DateField('Check-in', null=True, blank=True)
    check_out = models.DateField('Check-out', null=True, blank=True)
    notes     = models.TextField('Observações', blank=True, default='')
    order     = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order', 'id']
        verbose_name = 'Barco do roteiro'
        verbose_name_plural = 'Barcos do roteiro'

    def __str__(self):
        return self.name


class ItineraryTerrestreDeparture(models.Model):
    """Cidade de partida do roteiro (coluna esquerda da aba 'Terrestre').
    Espelha o aeroporto de saída da aba Voo, mas com Cidade."""
    itinerary = models.ForeignKey(Itinerary, on_delete=models.CASCADE, related_name='terrestre_departures')
    city      = models.ForeignKey('config_api.ConfigCity', null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='Cidade de partida')
    order     = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order', 'id']
        verbose_name = 'Cidade de partida (terrestre)'
        verbose_name_plural = 'Cidades de partida (terrestre)'


class ItineraryTerrestreLeg(models.Model):
    """Trecho terrestre a partir de uma cidade de partida (coluna direita).
    Espelha o voo: empresa, identificação, origem→destino (cidades), horários."""
    departure      = models.ForeignKey(ItineraryTerrestreDeparture, on_delete=models.CASCADE, related_name='legs')
    company        = models.ForeignKey('config_api.ConfigTerrestreCompany', null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='Empresa')
    service_number = models.CharField('Identificação', max_length=40, blank=True)
    origin         = models.ForeignKey('config_api.ConfigCity', null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='Origem')
    destination    = models.ForeignKey('config_api.ConfigCity', null=True, blank=True, on_delete=models.SET_NULL, related_name='+', verbose_name='Destino')
    departs_at     = models.DateTimeField('Saída', null=True, blank=True)
    arrives_at     = models.DateTimeField('Chegada', null=True, blank=True)
    order          = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order', 'id']
        verbose_name = 'Trecho terrestre do roteiro'
        verbose_name_plural = 'Trechos terrestres do roteiro'
