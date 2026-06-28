from django.conf import settings
from django.db import models


class Contract(models.Model):
    """Contrato de viagem por adesão — replica a capa do modelo em PDF da UneWorld.
    Os dados da Operadora não ficam aqui: vêm de config_api.OperatingCompany
    (config única) no momento de gerar o PDF."""

    STATUS_CHOICES = [
        ('ativo',     'Ativo'),
        ('cancelado', 'Cancelado'),
    ]

    reservation_number = models.CharField('Reserva nº', max_length=50, blank=True)
    contract_date       = models.DateField('Data desta contratação', null=True, blank=True)

    agency       = models.ForeignKey('agencies.Agency', on_delete=models.PROTECT,
                                     related_name='contracts', verbose_name='Agência de viagem')
    passenger_list = models.ForeignKey('trips.PassengerList', on_delete=models.SET_NULL, null=True, blank=True,
                                       related_name='contracts', verbose_name='Lista de passageiros')
    # Roteiro de onde vêm nome do pacote e datas. Substitui a antiga vinculação à
    # Lista de Passageiros neste formulário (passenger_list fica só por
    # compatibilidade com contratos antigos).
    itinerary    = models.ForeignKey('itineraries.Itinerary', on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name='contracts', verbose_name='Roteiro')
    # Contratante pode ser um passageiro já cadastrado OU dados preenchidos à
    # mão (payer_*) quando quem paga não está cadastrado no sistema — inclusive
    # uma empresa (payer_type='juridica'), não necessariamente uma pessoa física.
    contratante  = models.ForeignKey('passengers.Passenger', on_delete=models.PROTECT, null=True, blank=True,
                                     related_name='contracts_as_contratante', verbose_name='Contratante')
    PAYER_TYPE_CHOICES = [('fisica', 'Pessoa física'), ('juridica', 'Pessoa jurídica / Empresa')]
    payer_type     = models.CharField('Tipo', max_length=10, choices=PAYER_TYPE_CHOICES, blank=True)
    payer_name     = models.CharField('Nome completo / Razão social', max_length=200, blank=True)
    payer_document = models.CharField('CPF / CNPJ', max_length=20, blank=True)
    payer_birth_date = models.DateField('Data de nascimento', null=True, blank=True)
    payer_gender   = models.CharField('Sexo', max_length=50, blank=True)
    payer_email    = models.EmailField('E-mail', blank=True)
    payer_phone    = models.CharField('Celular', max_length=20, blank=True)
    payer_address  = models.CharField('Endereço', max_length=300, blank=True)

    # Pacote de viagem — snapshot editável, pré-preenchido a partir da passenger_list ao criar
    package_name     = models.CharField('Nome do pacote', max_length=300, blank=True)
    departure_date    = models.DateField('Data de início da viagem', null=True, blank=True)
    return_date        = models.DateField('Data de término da viagem', null=True, blank=True)
    departure_airport = models.CharField('Aeroporto de embarque', max_length=200, blank=True)
    observations      = models.TextField('Observações', blank=True)

    # Pagamento
    total_usd                 = models.DecimalField('Soma total (USD)', max_digits=12, decimal_places=2, null=True, blank=True)
    total_brl                 = models.DecimalField('Total em (BRL)', max_digits=12, decimal_places=2, null=True, blank=True)
    exchange_rate             = models.DecimalField('Câmbio', max_digits=10, decimal_places=4, null=True, blank=True)
    received_down_payment_brl = models.DecimalField('Recebido na entrada (BRL)', max_digits=12, decimal_places=2, null=True, blank=True)
    received_installments_brl = models.DecimalField('Recebido a prazo (BRL)', max_digits=12, decimal_places=2, null=True, blank=True)

    clauses = models.ManyToManyField('config_api.ContractClause', blank=True,
                                     related_name='contracts', verbose_name='Cláusulas')

    status     = models.CharField('Status', max_length=20, choices=STATUS_CHOICES, default='ativo')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
                                   related_name='contracts_created')
    created_at = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at = models.DateTimeField('Atualizado em', auto_now=True)
    is_deleted = models.BooleanField('Excluído', default=False, db_index=True)
    deleted_at = models.DateTimeField('Excluído em', null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Contrato'
        verbose_name_plural = 'Contratos'

    def __str__(self):
        return f'Contrato #{self.id} — {self.contratante}'


class ContractAccommodationLine(models.Model):
    """Linha da tabela 'Tipos de Acomodação / Valores por Pessoa' da capa."""
    contract            = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name='accommodation_lines')
    accommodation_type  = models.ForeignKey('config_api.ConfigAccommodation', on_delete=models.PROTECT, related_name='+')
    value_per_person_usd = models.DecimalField('Valor por pessoa (USD)', max_digits=10, decimal_places=2, default=0)
    taxes_usd            = models.DecimalField('Taxas (USD)', max_digits=10, decimal_places=2, default=0)
    quantity              = models.PositiveIntegerField('Quantidade', default=1)
    order                 = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order']


class ContractGuest(models.Model):
    """Linha da tabela 'Nome dos passageiros' da capa — hóspede vinculado ao contrato."""
    contract           = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name='guests')
    passenger          = models.ForeignKey('passengers.Passenger', on_delete=models.PROTECT,
                                           related_name='contract_guest_entries')
    accommodation_type = models.ForeignKey('config_api.ConfigAccommodation', on_delete=models.SET_NULL,
                                           null=True, blank=True, related_name='+')
    # Agrupamento de quarto: hóspedes com o mesmo room_group dividem a mesma
    # acomodação (quem fica com quem). Null = ainda sem quarto.
    room_group         = models.PositiveIntegerField('Quarto', null=True, blank=True)
    order              = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order']
        unique_together = ('contract', 'passenger')


class ContractInstallment(models.Model):
    """Linha de parcela — 'Entrada' (kind=entrada, sempre a primeira) ou parcela
    numerada (kind=parcela). A quantidade de parcelas exibidas é controlada pelo
    frontend (0 a 12); não há mais linhas no banco do que o usuário definiu."""
    KIND_CHOICES = [('entrada', 'Entrada'), ('parcela', 'Parcela')]

    contract           = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name='installments')
    kind               = models.CharField('Tipo', max_length=10, choices=KIND_CHOICES, default='parcela')
    installment_number = models.PositiveSmallIntegerField('Número da parcela', null=True, blank=True)
    detail             = models.CharField('Detalhe do pagamento', max_length=300, blank=True)
    due_date           = models.DateField('Para (data)', null=True, blank=True)
    value_brl          = models.DecimalField('Valor (BRL)', max_digits=12, decimal_places=2, null=True, blank=True)
    payment_method     = models.CharField('Forma de pagamento', max_length=100, blank=True)
    order              = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order']


class ContractAdjustment(models.Model):
    """Acréscimo (valor extra) ou desconto aplicado ao total do contrato.
    Pode ser um valor fixo em USD (mode='valor') ou um percentual sobre o
    subtotal das acomodações (mode='percentual'). Acréscimo soma, desconto subtrai."""
    KIND_CHOICES = [('acrescimo', 'Acréscimo'), ('desconto', 'Desconto')]
    MODE_CHOICES = [('valor', 'Valor (USD)'), ('percentual', 'Percentual (%)')]

    contract    = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name='adjustments')
    description = models.CharField('Descrição', max_length=200, blank=True)
    kind        = models.CharField('Tipo', max_length=10, choices=KIND_CHOICES, default='acrescimo')
    mode        = models.CharField('Modo', max_length=12, choices=MODE_CHOICES, default='valor')
    value_usd   = models.DecimalField('Valor (USD)', max_digits=12, decimal_places=2, default=0)
    percent     = models.DecimalField('Percentual', max_digits=6, decimal_places=2, default=0)
    order       = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order']

    def amount_usd(self, base_usd):
        """Valor absoluto (positivo) deste ajuste, dado o subtotal-base em USD."""
        return (base_usd * self.percent / 100) if self.mode == 'percentual' else self.value_usd
