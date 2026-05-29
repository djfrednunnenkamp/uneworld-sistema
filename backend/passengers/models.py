from django.db import models


class Passenger(models.Model):
    GENDER_CHOICES = [
        ('M', 'Masculino'),
        ('F', 'Feminino'),
        ('O', 'Outro'),
    ]
    STATUS_CHOICES = [
        ('active',   'Ativo'),
        ('inactive', 'Inativo'),
    ]
    SEAT_CHOICES = [
        ('corredor', 'Corredor'),
        ('janela',   'Janela'),
        ('meio',     'Meio'),
    ]
    STATE_CHOICES = [
        ('AC','AC'),('AL','AL'),('AP','AP'),('AM','AM'),('BA','BA'),('CE','CE'),
        ('DF','DF'),('ES','ES'),('GO','GO'),('MA','MA'),('MT','MT'),('MS','MS'),
        ('MG','MG'),('PA','PA'),('PB','PB'),('PR','PR'),('PE','PE'),('PI','PI'),
        ('RJ','RJ'),('RN','RN'),('RS','RS'),('RO','RO'),('RR','RR'),('SC','SC'),
        ('SP','SP'),('SE','SE'),('TO','TO'),
    ]

    # ── Dados básicos ──────────────────────────────────────────────
    first_name  = models.CharField('Primeiro nome', max_length=100, blank=True)
    last_name   = models.CharField('Sobrenome', max_length=100, blank=True)
    full_name   = models.CharField('Nome completo', max_length=200)
    email       = models.EmailField('E-mail', unique=True)
    birth_date  = models.DateField('Data de nascimento', null=True, blank=True)
    birth_place = models.CharField('Local de nascimento', max_length=200, blank=True)
    nationality = models.CharField('Nacionalidade', max_length=100, default='BRASILEIRA')
    gender      = models.CharField('Gênero', max_length=1, choices=GENDER_CHOICES, blank=True)
    profession  = models.CharField('Profissão', max_length=200, blank=True)
    is_foreign  = models.BooleanField('Estrangeiro', default=False)
    is_verified = models.BooleanField('Cadastro verificado', default=False)
    is_guide    = models.BooleanField('Guia acompanhante', default=False)
    agency      = models.ForeignKey(
        'agencies.Agency', on_delete=models.SET_NULL,
        null=True, blank=True, verbose_name='Agência', related_name='passengers'
    )

    # ── Documentos ─────────────────────────────────────────────────
    cpf              = models.CharField('CPF', max_length=20, blank=True)
    rg               = models.CharField('RG', max_length=30, blank=True)
    rg_issue_date    = models.DateField('Expedição do RG', null=True, blank=True)
    rg_issuer        = models.CharField('Órgão expedidor do RG', max_length=50, blank=True)
    passport         = models.CharField('Passaporte', max_length=50, blank=True)
    passport_issue   = models.DateField('Data de emissão do passaporte', null=True, blank=True)
    passport_expiry  = models.DateField('Validade do passaporte', null=True, blank=True)
    rne              = models.CharField('RNE', max_length=50, blank=True)
    rne_expiry       = models.DateField('Validade do RNE', null=True, blank=True)
    rne_issue        = models.DateField('Data de emissão do RNE', null=True, blank=True)

    # ── Telefones ──────────────────────────────────────────────────
    phone1  = models.CharField('Telefone 1', max_length=30, blank=True)
    phone2  = models.CharField('Telefone 2', max_length=30, blank=True)
    mobile  = models.CharField('Celular', max_length=30, blank=True)

    # ── Preferências ───────────────────────────────────────────────
    seat_preference = models.CharField('Preferência de assento', max_length=20, choices=SEAT_CHOICES, blank=True)
    diet_type       = models.CharField('Tipo de alimentação', max_length=100, blank=True)
    receives_mail   = models.BooleanField('Receber mala direta impressa', default=False)

    # ── Endereço ───────────────────────────────────────────────────
    cep          = models.CharField('CEP', max_length=10, blank=True)
    street       = models.CharField('Endereço', max_length=200, blank=True)
    number       = models.CharField('Número', max_length=20, blank=True)
    complement   = models.CharField('Complemento', max_length=100, blank=True)
    neighborhood = models.CharField('Bairro', max_length=100, blank=True)
    city         = models.CharField('Cidade', max_length=100, blank=True)
    state        = models.CharField('Estado', max_length=2, choices=STATE_CHOICES, blank=True)
    country      = models.CharField('País', max_length=100, default='Brasil')

    # ── Sistema ────────────────────────────────────────────────────
    status     = models.CharField('Status', max_length=10, choices=STATUS_CHOICES, default='active')
    notes      = models.TextField('Observações', blank=True)
    photo      = models.ImageField('Foto', upload_to='passengers/', null=True, blank=True)
    created_at = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at = models.DateTimeField('Atualizado em', auto_now=True)

    class Meta:
        verbose_name        = 'Passageiro'
        verbose_name_plural = 'Passageiros'
        ordering            = ['full_name']

    def save(self, *args, **kwargs):
        if self.first_name or self.last_name:
            self.full_name = f"{self.first_name} {self.last_name}".strip()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.full_name
