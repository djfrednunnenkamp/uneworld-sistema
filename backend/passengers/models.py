from django.db import models


class Passenger(models.Model):
    DOCUMENT_TYPE_CHOICES = [
        ('cpf', 'CPF'),
        ('passport', 'Passaporte'),
        ('rg', 'RG'),
    ]

    STATUS_CHOICES = [
        ('active', 'Ativo'),
        ('inactive', 'Inativo'),
    ]

    full_name = models.CharField('Nome completo', max_length=200)
    email = models.EmailField('E-mail', unique=True)
    phone = models.CharField('Telefone', max_length=20, blank=True)
    document_type = models.CharField('Tipo de documento', max_length=20, choices=DOCUMENT_TYPE_CHOICES, default='cpf')
    document_number = models.CharField('Número do documento', max_length=50, blank=True)
    birth_date = models.DateField('Data de nascimento', null=True, blank=True)
    nationality = models.CharField('Nacionalidade', max_length=100, default='Brasileira')
    address = models.TextField('Endereço', blank=True)
    city = models.CharField('Cidade', max_length=100, blank=True)
    state = models.CharField('Estado', max_length=2, blank=True)
    zip_code = models.CharField('CEP', max_length=10, blank=True)
    photo = models.ImageField('Foto', upload_to='passengers/', null=True, blank=True)
    status = models.CharField('Status', max_length=10, choices=STATUS_CHOICES, default='active')
    notes = models.TextField('Observações', blank=True)
    created_at = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at = models.DateTimeField('Atualizado em', auto_now=True)

    class Meta:
        verbose_name = 'Passageiro'
        verbose_name_plural = 'Passageiros'
        ordering = ['full_name']

    def __str__(self):
        return self.full_name
