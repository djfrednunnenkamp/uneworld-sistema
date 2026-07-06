import os
import re
import uuid
from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.core.validators import MinValueValidator
from django.db import models
from django.utils.text import slugify


def secure_itinerary_image_path(instance, filename):
    """Nome de arquivo seguro (uuid) — descarta o nome enviado pelo cliente,
    evitando path traversal, colisões e vazamento de informação."""
    ext = os.path.splitext(filename)[1].lower()
    return f"itineraries/{uuid.uuid4().hex}{ext}"


def secure_itinerary_document_path(instance, filename):
    """Igual ao de imagem, para os documentos anexados (aba Observações)."""
    ext = os.path.splitext(filename)[1].lower()
    return f"itineraries/docs/{uuid.uuid4().hex}{ext}"


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
    # Total de noites: normalmente calculado das datas. Se preenchido aqui (manual),
    # sobrepõe o cálculo — para casos em que o número de noites difere do intervalo.
    nights_override = models.PositiveIntegerField('Noites (manual)', null=True, blank=True)
    # Capacidade total de pessoas do roteiro (nº de lugares no bloqueio aéreo).
    capacity        = models.PositiveIntegerField('Capacidade (pessoas)', null=True, blank=True)
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
    # Observações por aba (bagagem, políticas, etc.) — editadas nas próprias abas
    # (Voo/Hotéis/Valores/Terrestre/Barco), com suporte a template (igual aos campos
    # de Informações do Roteiro).
    flight_notes        = models.TextField('Observações dos Voos', blank=True, default='')
    hotel_notes         = models.TextField('Observações dos Hotéis', blank=True, default='')
    accommodation_notes = models.TextField('Observações dos Valores', blank=True, default='')
    terrestre_notes     = models.TextField('Observações do Terrestre', blank=True, default='')
    boat_notes          = models.TextField('Observações do Barco', blank=True, default='')

    # Observações internas do roteiro (lembretes/pendências da equipe — não é
    # conteúdo do roteiro em si).
    notes              = models.TextField('Observações', blank=True, default='')

    # Mapa do roteiro (Google My Maps): o usuário cola o link/iframe de compartilhar;
    # o site mostra o mapa embutido. Guarda o texto cru (pode ser o <iframe> inteiro
    # ou só a URL) — a URL do src é extraída na exibição.
    map_embed_url      = models.TextField('Mapa (link/embed do Google My Maps)', blank=True, default='')

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
    flight_notes_template           = models.ForeignKey('ItineraryFieldTemplate', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    flight_notes_template_linked    = models.BooleanField(default=False)
    hotel_notes_template            = models.ForeignKey('ItineraryFieldTemplate', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    hotel_notes_template_linked     = models.BooleanField(default=False)
    accommodation_notes_template        = models.ForeignKey('ItineraryFieldTemplate', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    accommodation_notes_template_linked = models.BooleanField(default=False)
    terrestre_notes_template        = models.ForeignKey('ItineraryFieldTemplate', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    terrestre_notes_template_linked = models.BooleanField(default=False)
    boat_notes_template             = models.ForeignKey('ItineraryFieldTemplate', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    boat_notes_template_linked      = models.BooleanField(default=False)

    # Rascunho (autosalvo / não finalizado) vs Ativo. A lista mostra só ativos;
    # rascunhos aparecem num popup à parte. 'Salvar' no detalhe finaliza (ativo).
    STATUS_CHOICES = [('rascunho', 'Rascunho'), ('ativo', 'Ativo')]
    status      = models.CharField('Status', max_length=20, choices=STATUS_CHOICES, default='ativo', db_index=True)
    # Visibilidade pública, independente de rascunho/ativo: só publicado fica visível
    # ao público. Um roteiro finalizado nasce "não publicado" até ser publicado.
    is_published = models.BooleanField('Publicado (visível ao público)', default=False, db_index=True)
    # Versionamento público: ao publicar, tira-se uma FOTO do estado completo do
    # roteiro (published_data) — é ISSO que o site público mostra. Editar e salvar
    # altera só a cópia de trabalho; o site continua na foto até publicar de novo.
    published_data          = models.JSONField('Foto publicada', null=True, blank=True, default=None, encoder=DjangoJSONEncoder)
    published_at            = models.DateTimeField('Publicado em', null=True, blank=True)
    has_unpublished_changes = models.BooleanField('Alterações não publicadas', default=False)

    created_at  = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at  = models.DateTimeField('Atualizado em', auto_now=True)

    is_deleted  = models.BooleanField('Excluído', default=False, db_index=True)
    deleted_at  = models.DateTimeField('Excluído em', null=True, blank=True)
    # Ordem manual (arrastar na listagem) — vai alimentar a ordem do site público.
    order       = models.PositiveIntegerField('Ordem', default=0, db_index=True)

    class Meta:
        verbose_name = 'Roteiro'
        verbose_name_plural = 'Roteiros'
        ordering = ['order', '-created_at']

    def __str__(self):
        return self.name

    @staticmethod
    def _compose_slug(name, start_date, end_date):
        parts = [name or '']
        if start_date and end_date:
            parts.append(f'{start_date.strftime("%d-%m-%Y")}-a-{end_date.strftime("%d-%m-%Y")}')
        return slugify('-'.join(parts))

    def _base_slug(self):
        return self._compose_slug(self.name, self.start_date, self.end_date)

    def save(self, *args, **kwargs):
        # O slug segue o título + as datas AUTOMATICAMENTE — mas só enquanto não
        # for personalizado. Regenera quando: (a) não há slug; ou (b) o nome/datas
        # mudaram, o usuário NÃO enviou um slug diferente, e o slug antigo ainda
        # era o automático (não um slug próprio que o usuário fixou).
        regenerate = not self.slug
        if not regenerate and self.pk:
            old = Itinerary.objects.filter(pk=self.pk).only('name', 'start_date', 'end_date', 'slug').first()
            if old:
                changed = (old.name != self.name
                           or old.start_date != self.start_date
                           or old.end_date != self.end_date)
                user_kept_slug = (self.slug == old.slug)
                old_base = self._compose_slug(old.name, old.start_date, old.end_date)
                old_was_auto = bool(old_base) and (
                    old.slug == old_base or re.fullmatch(rf'{re.escape(old_base)}-\d+', old.slug))
                if changed and user_kept_slug and old_was_auto:
                    regenerate = True
        if regenerate:
            base = self._base_slug()
            if base:
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


class ItineraryDocument(models.Model):
    """Documento anexado a um roteiro (painel lateral da aba Observações): um
    arquivo Office/PDF — editável no navegador via OnlyOffice — ou apenas um
    link externo (abre em nova aba)."""
    itinerary  = models.ForeignKey(Itinerary, on_delete=models.CASCADE, related_name='documents')
    name       = models.CharField('Nome', max_length=255, blank=True)
    file       = models.FileField('Arquivo', upload_to=secure_itinerary_document_path, null=True, blank=True)
    url        = models.URLField('Link externo', max_length=1000, blank=True)
    order      = models.PositiveIntegerField('Ordem', default=0)
    # Muda a cada salvamento vindo do OnlyOffice → invalida o cache do editor.
    edit_key   = models.CharField(max_length=40, blank=True, default='')
    created_at = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at = models.DateTimeField('Atualizado em', auto_now=True)

    class Meta:
        ordering = ['order', 'id']
        verbose_name = 'Documento do roteiro'
        verbose_name_plural = 'Documentos do roteiro'

    def __str__(self):
        return self.name or (self.file.name if self.file else self.url)


class ItineraryDraft(models.Model):
    """Rascunho de AUTOSAVE das edições de um roteiro, POR USUÁRIO. Enquanto o
    usuário edita, as mudanças ficam aqui (não tocam no roteiro real nem na foto
    publicada). Só quando ele clica em Salvar é que vão para o registro. Um
    rascunho por (roteiro, usuário) — dá pra retomar de onde parou ou descartar."""
    itinerary  = models.ForeignKey(Itinerary, on_delete=models.CASCADE, related_name='drafts')
    user       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='itinerary_drafts')
    data       = models.JSONField('Dados do rascunho', default=dict, blank=True, encoder=DjangoJSONEncoder)
    updated_at = models.DateTimeField('Atualizado em', auto_now=True)

    class Meta:
        unique_together = [('itinerary', 'user')]
        verbose_name = 'Rascunho de roteiro'
        verbose_name_plural = 'Rascunhos de roteiro'


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
        # Lâminas do bloqueio: pode ter várias, ordenadas; a primeira (menor
        # `order`) é a padrão que o sistema usa.
        ('blocking',       'Lâmina do Bloqueio'),
    ]
    # itinerary pode ser nulo: imagens do BANCO GERAL (enviadas pela aba Galeria)
    # não pertencem a nenhum roteiro; ficam soltas e reutilizáveis.
    itinerary = models.ForeignKey(Itinerary, null=True, blank=True, on_delete=models.CASCADE, related_name='images')
    # Imagem da GALERIA do roteiro (day nulo) OU de um DIA específico do dia-a-dia
    # (day preenchido). Reusa a mesma tabela/upload, sem child table extra.
    day       = models.ForeignKey('ItineraryDay', null=True, blank=True, on_delete=models.CASCADE, related_name='images')
    # FileField (não ImageField) pra aceitar também VÍDEO na galeria. O tipo é
    # validado na action de upload (imagem: jpg/png; vídeo: mp4/webm/mov/…).
    image     = models.FileField('Arquivo (imagem/vídeo)', upload_to=secure_itinerary_image_path)
    caption   = models.CharField('Legenda', max_length=300, blank=True)
    # Tipo de conteúdo: paisagem (tem lugar), objeto (texto livre) ou lâmina (nada).
    SUBJECT_CHOICES = [
        ('landscape', 'Paisagem'),
        ('object',    'Objeto'),
        ('lamina',    'Lâmina'),
    ]
    subject_type = models.CharField('Tipo de conteúdo', max_length=12, choices=SUBJECT_CHOICES, blank=True, default='')
    # Geolocalização (só faz sentido para 'paisagem'): a cidade define país e
    # continente; ou define-se só o país (continente derivado). Continente NÃO é
    # armazenado — é derivado.
    city      = models.ForeignKey('config_api.ConfigCity', null=True, blank=True,
                                  on_delete=models.SET_NULL, related_name='+', verbose_name='Cidade')
    country   = models.ForeignKey('config_api.ConfigCountry', null=True, blank=True,
                                  on_delete=models.SET_NULL, related_name='+', verbose_name='País')
    kind      = models.CharField('Tipo', max_length=20, choices=KIND_CHOICES, default='gallery')
    order     = models.PositiveIntegerField('Ordem', default=0)
    # Cor dominante (hex) + faixa de cor nomeada, para o filtro por cor na Galeria.
    dominant_color = models.CharField('Cor dominante', max_length=7, blank=True, default='')
    color_bucket   = models.CharField('Faixa de cor', max_length=12, blank=True, default='', db_index=True)
    created_at = models.DateTimeField('Criado em', auto_now_add=True, null=True)

    class Meta:
        ordering = ['order']
        verbose_name = 'Imagem do roteiro'
        verbose_name_plural = 'Imagens do roteiro'
        indexes = [
            models.Index(fields=['itinerary', 'order'], name='idx_itinimg_itin_order'),
        ]

    def __str__(self):
        try:
            rot = self.itinerary.name
        except Exception:
            rot = f'#{self.itinerary_id}'
        return f'Imagem ({self.get_kind_display()}) — {rot}'


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
        ('flights',      'Observações dos Voos'),
        ('hotels',       'Observações dos Hotéis'),
        ('accommodation','Observações dos Valores'),
        ('terrestre',    'Observações do Terrestre'),
        ('boat',         'Observações do Barco'),
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
        'flights':      ('flight_notes',        'flight_notes_template',        'flight_notes_template_linked'),
        'hotels':       ('hotel_notes',         'hotel_notes_template',         'hotel_notes_template_linked'),
        'accommodation':('accommodation_notes', 'accommodation_notes_template', 'accommodation_notes_template_linked'),
        'terrestre':    ('terrestre_notes',     'terrestre_notes_template',     'terrestre_notes_template_linked'),
        'boat':         ('boat_notes',          'boat_notes_template',          'boat_notes_template_linked'),
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
        try:
            rot = self.itinerary.name
        except Exception:
            rot = f'#{self.itinerary_id}'
        ap = self.airport.iata_code if self.airport_id and self.airport else 'aeroporto'
        return f'Partida {ap} — {rot}'


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
        o = self.origin.iata_code if self.origin_id and self.origin else '?'
        d = self.destination.iata_code if self.destination_id and self.destination else '?'
        return f'Voo {self.flight_number or "s/nº"} ({o}→{d})'


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

    def __str__(self):
        return f'Cidade de partida #{self.pk}'


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

    def __str__(self):
        return f'Trecho terrestre {self.service_number or self.pk}'
