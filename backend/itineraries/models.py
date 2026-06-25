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
