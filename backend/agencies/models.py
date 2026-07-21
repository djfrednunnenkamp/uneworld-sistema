import uuid
from django.db import models
from django.contrib.auth.models import User

from core.storages import public_media_storage


def agency_logo_path(instance, filename):
    # Sempre .png (o upload é revalidado e re-encodado como PNG no backend).
    return f'agencies/logos/{instance.id or "new"}/{uuid.uuid4().hex}.png'


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

    # PIX
    pix_key_type = models.CharField('Tipo de chave PIX', max_length=20, choices=PIX_TYPE_CHOICES, blank=True)
    pix_key      = models.CharField('Chave PIX', max_length=200, blank=True)
    # No CONTRATO desta agência, qual PIX aparece: o da UneWorld/Operadora (False,
    # padrão) ou o desta agência (True). Só faz sentido ligar se a agência tem PIX.
    use_agency_pix = models.BooleanField('No contrato, usar o PIX desta agência (senão, o da UneWorld)', default=False)

    # Observações
    notes = models.TextField('Observações', blank=True)

    # Logo da agência. Sempre revalidada e re-encodada como PNG no upload (seguro).
    # Não-destrutivo: `logo` = recorte exibido; `logo_original` = imagem completa;
    # `logo_crop` = enquadramento (u,v,du,dv,fw,fh) → dá para reabrir e desfazer.
    logo  = models.ImageField('Logo', upload_to=agency_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_original = models.ImageField('Logo (original)', upload_to=agency_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_crop     = models.JSONField('Recorte da logo', default=dict, blank=True)

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

    @property
    def display_name(self):
        """Nome de exibição da agência — NUNCA vazio. Pessoa física usa razão
        social ou nome+sobrenome; jurídica usa nome/razão social. Cai para
        responsável, e-mail e, por fim, "Agência #id". Usado em qualquer lugar
        que mostra a agência (filtros, badges, login) para não ficar em branco."""
        if self.person_type == 'fisica':
            base = self.company_name or f'{self.name} {self.last_name}'.strip()
        else:
            base = self.name or self.company_name
        return base or self.responsible or self.email or f'Agência #{self.pk}'

    def __str__(self):
        return self.display_name


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
