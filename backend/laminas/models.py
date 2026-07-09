from django.db import models


class Lamina(models.Model):
    """Uma LÂMINA = um cartaz/flyer de divulgação com vários roteiros em grade
    (capa + título + destinos + datas de cada roteiro). O usuário monta a grade
    (colunas × linhas), escolhe o tema e a ordem dos roteiros, e exporta como
    imagem. Guardamos só a configuração — as imagens/dados vêm dos roteiros na
    hora de renderizar."""
    THEME_CHOICES = [
        ('ocean',    'Oceano'),
        ('sunset',   'Pôr do sol'),
        ('forest',   'Floresta'),
        ('ruby',     'Rubi'),
        ('midnight', 'Meia-noite'),
        ('sand',     'Areia'),
    ]
    name        = models.CharField('Título', max_length=200, blank=True, default='')
    headline    = models.CharField('Chamada', max_length=300, blank=True, default='')
    theme       = models.CharField('Tema', max_length=20, default='ocean')
    pattern     = models.CharField('Estampa do fundo', max_length=20, default='none')
    columns     = models.PositiveSmallIntegerField('Colunas', default=3)
    rows        = models.PositiveSmallIntegerField('Linhas', default=2)   # derivado (auto) no front
    # Ordem dos roteiros na lâmina (lista de ids de Itinerary).
    roteiro_ids = models.JSONField('Roteiros (ordem)', default=list, blank=True)
    # Rodapé com contato: mostra ou não; de quem (operadora ou uma agência).
    footer      = models.BooleanField('Rodapé com contato', default=False)
    source      = models.CharField('Marca/contato', max_length=12, default='operadora')  # operadora | agency
    agency      = models.ForeignKey('agencies.Agency', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    created_by  = models.ForeignKey('auth.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        verbose_name = 'Lâmina'
        verbose_name_plural = 'Lâminas'

    def __str__(self):
        return self.name or f'Lâmina #{self.pk}'

