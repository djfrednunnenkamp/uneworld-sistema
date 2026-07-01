from django.db import models
from django.contrib.auth.models import User


class Agency(models.Model):
    STATUS_CHOICES = [
        ('active',   'Ativa'),
        ('pending',  'Pendente'),
        ('inactive', 'Inativa'),
        ('rascunho', 'Rascunho'),
    ]
    AGENCY_TYPE_CHOICES = [
        ('agencia',       'Agência'),
        ('representante', 'Representante'),
        ('operadora',     'Operadora'),
        ('parceiro',      'Parceiro'),
        ('outro',         'Outro'),
    ]
    PERSON_TYPE_CHOICES = [
        ('juridica', 'Jurídica'),
        ('fisica',   'Física'),
    ]
    PIX_TYPE_CHOICES = [
        ('',        'Selecione'),
        ('cpf',     'CPF'),
        ('cnpj',    'CNPJ'),
        ('email',   'E-mail'),
        ('telefone','Telefone'),
        ('aleatorio','Chave aleatória'),
    ]

    # Identificação
    agency_type  = models.CharField('Tipo de cadastro', max_length=20, choices=AGENCY_TYPE_CHOICES, default='agencia')
    person_type  = models.CharField('Tipo de pessoa',   max_length=10, choices=PERSON_TYPE_CHOICES, default='juridica')
    status       = models.CharField('Status', max_length=10, choices=STATUS_CHOICES, default='active')

    # Dados da empresa / pessoa
    cnpj                  = models.CharField('CNPJ', max_length=20, blank=True)
    cpf                   = models.CharField('CPF', max_length=20, blank=True)   # pessoa física
    company_name          = models.CharField('Razão social', max_length=200, blank=True)
    name                  = models.CharField('Nome / Nome fantasma', max_length=200, blank=True)
    last_name             = models.CharField('Sobrenome', max_length=200, blank=True)  # pessoa física
    state_registration    = models.CharField('Inscrição estadual',   max_length=50, blank=True)
    municipal_registration= models.CharField('Inscrição municipal',  max_length=50, blank=True)
    responsible           = models.CharField('Responsável', max_length=200, blank=True)

    # Contato
    phone    = models.CharField('Telefone', max_length=20, blank=True)
    mobile   = models.CharField('Celular',  max_length=20, blank=True)
    email    = models.EmailField('E-mail', blank=True)
    website  = models.URLField('Website', max_length=300, blank=True)

    # Financeiro
    commission_rate = models.DecimalField('Comissão %', max_digits=5, decimal_places=2, null=True, blank=True)

    # Endereço
    cep           = models.CharField('CEP',          max_length=10,  blank=True)
    street        = models.CharField('Endereço',     max_length=200, blank=True)
    number        = models.CharField('Número',       max_length=20,  blank=True)
    complement    = models.CharField('Complemento',  max_length=100, blank=True)
    neighborhood  = models.CharField('Bairro',       max_length=100, blank=True)
    city          = models.CharField('Cidade',       max_length=100, blank=True)
    state         = models.CharField('Estado',       max_length=50,  blank=True)
    country       = models.CharField('País',         max_length=100, blank=True, default='Brasil')

    # Preferências
    receives_mail      = models.BooleanField('Receber mala direta impressa', default=False)
    use_andes_banking  = models.BooleanField('Utilizar dados bancários da Andes', default=False)

    # PIX
    pix_key_type = models.CharField('Tipo de chave PIX', max_length=20, choices=PIX_TYPE_CHOICES, blank=True)
    pix_key      = models.CharField('Chave PIX', max_length=200, blank=True)

    # Observações
    notes = models.TextField('Observações', blank=True)

    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='agencies_created', verbose_name='Criado por')
    created_at = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at = models.DateTimeField('Atualizado em', auto_now=True)

    # ── Lixeira (soft-delete) — nunca é removido de fato do banco ──
    is_deleted = models.BooleanField('Excluído', default=False, db_index=True)
    deleted_at = models.DateTimeField('Excluído em', null=True, blank=True)

    class Meta:
        verbose_name        = 'Agência'
        verbose_name_plural = 'Agências'
        ordering            = ['name']

    def save(self, *args, **kwargs):
        # Guarda só o documento do tipo de pessoa atual: ao trocar jurídica ↔ física,
        # o documento antigo (CNPJ/CPF) some — senão ele fica "órfão" ocupando o
        # valor e bloqueia cadastrar outra agência com o mesmo número.
        if self.person_type == 'fisica':
            self.cnpj = ''
        elif self.person_type == 'juridica':
            self.cpf = ''
        super().save(*args, **kwargs)

    def __str__(self):
        return self.company_name or self.name or f'Agência #{self.pk}'


class AgencyMember(models.Model):
    ROLE_CHOICES = [
        ('admin',    'Administrador'),
        ('operator', 'Operador'),
        ('viewer',   'Visualizador'),
    ]
    agency   = models.ForeignKey(Agency, on_delete=models.CASCADE, related_name='members')
    user     = models.ForeignKey(User, on_delete=models.CASCADE, related_name='agency_memberships')
    role     = models.CharField('Função', max_length=20, choices=ROLE_CHOICES, default='operator')
    added_at = models.DateTimeField('Adicionado em', auto_now_add=True)

    class Meta:
        unique_together = [('agency', 'user')]
        verbose_name = 'Membro da agência'

    def __str__(self):
        return f'{self.user.email} → {self.agency}'
