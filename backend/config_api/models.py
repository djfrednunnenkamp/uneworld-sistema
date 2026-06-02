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


class ConfigCity(models.Model):
    state = models.ForeignKey(ConfigState, on_delete=models.CASCADE, related_name='cities')
    name  = models.CharField('Nome', max_length=150)

    class Meta:
        ordering = ['name']
        unique_together = [('state', 'name')]
        verbose_name = 'Cidade'

    def __str__(self):
        return f'{self.name} ({self.state.name})'
