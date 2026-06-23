from django.db import models


class ConfigProfession(models.Model):
    name = models.CharField('Nome', max_length=200, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Profissão'

    def __str__(self):
        return self.name


class ConfigLanguage(models.Model):
    name = models.CharField('Nome', max_length=100, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Idioma'

    def __str__(self):
        return self.name


class ConfigCountry(models.Model):
    name = models.CharField('Nome', max_length=100, unique=True)
    code = models.CharField('Código ISO', max_length=10, blank=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'País'

    def __str__(self):
        return self.name


class ConfigState(models.Model):
    country = models.ForeignKey(ConfigCountry, on_delete=models.CASCADE, related_name='states')
    name    = models.CharField('Nome', max_length=100)
    code    = models.CharField('Código', max_length=20, blank=True)

    class Meta:
        ordering = ['name']
        unique_together = [('country', 'name')]
        verbose_name = 'Estado'

    def __str__(self):
        return f'{self.name} ({self.country.name})'


class ConfigGender(models.Model):
    name = models.CharField('Nome', max_length=100, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Gênero'

    def __str__(self):
        return self.name


class ConfigVaccine(models.Model):
    name = models.CharField('Nome', max_length=200, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Vacina'

    def __str__(self):
        return self.name


class CustomDocType(models.Model):
    """Tipo de documento gerenciável pelo painel."""
    key       = models.SlugField('Chave', max_length=50, unique=True)
    label     = models.CharField('Nome', max_length=100)
    icon      = models.CharField('Ícone (emoji)', max_length=10, default='📄')
    color     = models.CharField('Cor', max_length=20, default='#475569')
    order     = models.PositiveIntegerField('Ordem', default=0)
    is_active = models.BooleanField('Ativo', default=True)

    class Meta:
        ordering = ['order', 'label']
        verbose_name = 'Tipo de documento'

    def __str__(self):
        return self.label


class CustomDocField(models.Model):
    """Campo de um tipo de documento."""
    FIELD_TYPES = [
        ('text',       'Texto livre'),
        ('date',       'Data'),
        ('list',       'Lista suspensa'),
        ('country',    'País / Estado / Cidade'),
        ('language',   'Idioma'),
        ('profession', 'Profissão'),
        ('prof_card',  'Carteira profissional'),
    ]
    doc_type   = models.ForeignKey(CustomDocType, on_delete=models.CASCADE, related_name='fields')
    key        = models.SlugField('Chave', max_length=50)
    label      = models.CharField('Label', max_length=100)
    field_type = models.CharField('Tipo', max_length=20, choices=FIELD_TYPES, default='text')
    required   = models.BooleanField('Obrigatório', default=False)
    order      = models.PositiveIntegerField('Ordem', default=0)
    # Para campo tipo 'country': 'country_only' | 'country_state' | 'country_state_city'
    subtype    = models.CharField('Subtipo', max_length=30, blank=True, default='')

    class Meta:
        ordering = ['order']
        unique_together = [('doc_type', 'key')]
        verbose_name = 'Campo de documento'

    def __str__(self):
        return f'{self.doc_type.label} / {self.label}'


class CustomDocFieldOption(models.Model):
    """Opção de um campo do tipo 'list'."""
    field = models.ForeignKey(CustomDocField, on_delete=models.CASCADE, related_name='options')
    value = models.CharField('Valor', max_length=200)
    order = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order', 'value']
        verbose_name = 'Opção de campo'

    def __str__(self):
        return self.value


class ConfigProfCard(models.Model):
    name = models.CharField('Nome', max_length=200, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Carteira profissional'

    def __str__(self):
        return self.name


class ConfigCity(models.Model):
    state = models.ForeignKey(ConfigState, on_delete=models.CASCADE, related_name='cities')
    name  = models.CharField('Nome', max_length=150)

    class Meta:
        ordering = ['name']
        unique_together = [('state', 'name')]
        verbose_name = 'Cidade'

    def __str__(self):
        return f'{self.name} ({self.state.name})'


class ConfigAccommodation(models.Model):
    name      = models.CharField('Nome', max_length=200, unique=True)
    capacity  = models.PositiveIntegerField('Capacidade (pessoas)', default=1)
    is_couple = models.BooleanField('É para casal', default=False)

    class Meta:
        ordering = ['name']
        verbose_name = 'Tipo de acomodação'
        verbose_name_plural = 'Tipos de acomodação'

    def __str__(self):
        return self.name


class ConfigListCategory(models.Model):
    name = models.CharField('Nome', max_length=100, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Categoria de lista'
        verbose_name_plural = 'Categorias de lista'

    def __str__(self):
        return self.name


class Airline(models.Model):
    name      = models.CharField('Nome', max_length=200, db_index=True)
    iata_code = models.CharField('Código IATA', max_length=10, blank=True, db_index=True)
    country   = models.CharField('País', max_length=200, blank=True)

    class Meta:
        ordering            = ['name']
        verbose_name        = 'Companhia aérea'
        verbose_name_plural = 'Companhias aéreas'

    def __str__(self):
        parts = [self.iata_code, self.name]
        return ' — '.join(p for p in parts if p)


class Airport(models.Model):
    name      = models.CharField('Nome', max_length=200, db_index=True)
    iata_code = models.CharField('Código IATA', max_length=10, blank=True, db_index=True)
    city      = models.CharField('Cidade', max_length=200, blank=True, db_index=True)
    country   = models.CharField('País', max_length=200, blank=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Aeroporto'
        verbose_name_plural = 'Aeroportos'

    def __str__(self):
        parts = [self.iata_code, self.name]
        return ' — '.join(p for p in parts if p)


class BusMap(models.Model):
    """Mapa de assentos de um ônibus, configurável fileira a fileira."""
    DECK_COUNT_CHOICES = [(1, 'Andar único'), (2, 'Dois andares')]

    key        = models.SlugField('Chave', max_length=60, unique=True)
    label      = models.CharField('Nome', max_length=100)
    order      = models.PositiveIntegerField('Ordem', default=0)
    is_active  = models.BooleanField('Ativo', default=True)
    deck_count = models.PositiveSmallIntegerField('Andares do ônibus', choices=DECK_COUNT_CHOICES, default=1)

    class Meta:
        ordering = ['order', 'label']
        verbose_name = 'Mapa de ônibus'
        verbose_name_plural = 'Mapas de ônibus'

    def __str__(self):
        return self.label


class BusMapRow(models.Model):
    """Fileira de assentos de um mapa de ônibus: N à esquerda do corredor, M à direita.
    Quando o mapa tem dois andares (BusMap.deck_count == 2), cada fileira pertence a um deles."""
    DECK_CHOICES = [(1, '1º andar'), (2, '2º andar')]

    bus_map      = models.ForeignKey(BusMap, on_delete=models.CASCADE, related_name='rows')
    deck         = models.PositiveSmallIntegerField('Andar', choices=DECK_CHOICES, default=1)
    order        = models.PositiveIntegerField('Ordem', default=0)
    left_seats   = models.PositiveSmallIntegerField('Assentos à esquerda', default=2)
    right_seats  = models.PositiveSmallIntegerField('Assentos à direita', default=2)
    left_labels  = models.JSONField('Numeração à esquerda', default=list, blank=True)
    right_labels = models.JSONField('Numeração à direita', default=list, blank=True)

    class Meta:
        ordering = ['order', 'id']
        verbose_name = 'Fileira de ônibus'
        verbose_name_plural = 'Fileiras de ônibus'

    def __str__(self):
        return f'{self.bus_map.label} · fileira {self.order + 1}'


class PermissionProfile(models.Model):
    name = models.CharField('Nome', max_length=100, unique=True)
    permissions = models.JSONField('Permissões', default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ── Lixeira (soft-delete) — nunca é removido de fato do banco ──
    is_deleted = models.BooleanField('Excluído', default=False, db_index=True)
    deleted_at = models.DateTimeField('Excluído em', null=True, blank=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Perfil de permissão'

    def __str__(self):
        return self.name


class SystemSettings(models.Model):
    """Singleton de configurações globais do sistema."""
    deadline_notification_emails = models.JSONField('E-mails de notificação de prazos', default=list, blank=True)

    class Meta:
        verbose_name = 'Configurações do sistema'
        verbose_name_plural = 'Configurações do sistema'

    def __str__(self):
        return 'Configurações do sistema'

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
