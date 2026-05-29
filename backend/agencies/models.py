from django.db import models


class Agency(models.Model):
    STATUS_CHOICES = [
        ('active',   'Ativa'),
        ('pending',  'Pendente'),
        ('inactive', 'Inativa'),
    ]

    name        = models.CharField('Nome', max_length=200)
    email       = models.EmailField('E-mail', unique=True)
    cnpj        = models.CharField('CNPJ', max_length=20, blank=True)
    phone       = models.CharField('Telefone', max_length=20, blank=True)
    responsible = models.CharField('Responsável', max_length=200, blank=True)
    status      = models.CharField('Status', max_length=10, choices=STATUS_CHOICES, default='active')
    notes       = models.TextField('Observações', blank=True)
    created_at  = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at  = models.DateTimeField('Atualizado em', auto_now=True)

    class Meta:
        verbose_name        = 'Agência'
        verbose_name_plural = 'Agências'
        ordering            = ['name']

    def __str__(self):
        return self.name
