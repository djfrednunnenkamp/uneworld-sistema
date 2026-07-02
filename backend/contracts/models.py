import os
import uuid

from django.conf import settings
from django.db import models


def secure_signed_path(instance, filename):
    """Nome de arquivo seguro (UUID) — descarta o nome original enviado pelo
    usuário, mantendo só a extensão. Evita path traversal e colisões."""
    ext = os.path.splitext(filename)[1].lower()
    return f"contracts/signed/{uuid.uuid4().hex}{ext}"


class Contract(models.Model):
    """Contrato de viagem por adesão — replica a capa do modelo em PDF da UneWorld.
    Os dados da Operadora não ficam aqui: vêm de config_api.OperatingCompany
    (config única) no momento de gerar o PDF."""

    STATUS_CHOICES = [
        ('rascunho',  'Rascunho'),
        ('ativo',     'Ativo'),
        ('cancelado', 'Cancelado'),
    ]

    reservation_number = models.CharField('Reserva nº', max_length=50, blank=True)
    contract_date       = models.DateField('Data desta contratação', null=True, blank=True)

    # null=True permite salvar rascunho (autosave) antes de escolher a agência;
    # ao finalizar (status 'ativo') o serializer exige a agência.
    agency       = models.ForeignKey('agencies.Agency', on_delete=models.PROTECT, null=True, blank=True,
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
    # Moeda base do contrato (em que estão os valores de acomodação/ajustes/total).
    # O total em BRL vem da conversão por exchange_rate. Vinda do roteiro quando há um.
    base_currency             = models.CharField('Moeda base', max_length=3, default='USD')
    PAYMENT_TYPE_CHOICES = [('a_vista', 'À vista'), ('parcelado', 'Parcelado')]
    payment_type              = models.CharField('Forma de pagamento', max_length=10, choices=PAYMENT_TYPE_CHOICES, default='parcelado')
    total_usd                 = models.DecimalField('Soma total (USD)', max_digits=12, decimal_places=2, null=True, blank=True)
    total_brl                 = models.DecimalField('Total em (BRL)', max_digits=12, decimal_places=2, null=True, blank=True)
    exchange_rate             = models.DecimalField('Câmbio', max_digits=10, decimal_places=4, null=True, blank=True)
    received_down_payment_brl = models.DecimalField('Recebido na entrada (BRL)', max_digits=12, decimal_places=2, null=True, blank=True)
    received_installments_brl = models.DecimalField('Recebido a prazo (BRL)', max_digits=12, decimal_places=2, null=True, blank=True)
    # Snapshot da SUGESTÃO de pagamento aplicada (do roteiro): {down_payment_percent,
    # installments_count, payment_method, ...}. Gravado quando o usuário clica em
    # "aplicar sugestão". A revisão compara o que está no contrato com este snapshot
    # e sinaliza o que foi alterado depois (entrada, nº de parcelas, forma). null =
    # nenhuma sugestão foi aplicada.
    payment_plan_applied      = models.JSONField('Sugestão de pagamento aplicada', null=True, blank=True)

    # Arredondamento do total: arredonda o valor da moeda escolhida para o múltiplo
    # de round_step (0 = não arredonda); a outra moeda é derivada pelo câmbio.
    ROUND_CURRENCY_CHOICES = [('brl', 'Real (BRL)'), ('usd', 'Dólar (USD)')]
    ROUND_MODE_CHOICES     = [('nearest', 'Mais próximo'), ('up', 'Pra cima'), ('down', 'Pra baixo')]
    round_step     = models.PositiveIntegerField('Arredondar para múltiplo de', default=0)
    round_mode     = models.CharField('Direção do arredondamento', max_length=8, choices=ROUND_MODE_CHOICES, default='nearest')
    round_currency = models.CharField('Moeda do arredondamento', max_length=3, choices=ROUND_CURRENCY_CHOICES, default='brl')

    clauses = models.ManyToManyField('config_api.ContractClause', blank=True,
                                     related_name='contracts', verbose_name='Cláusulas')

    # Cláusulas escritas à mão só para este contrato (não ficam na lista global de
    # Configurações). Lista de {'name': str, 'content': HTML}.
    custom_clauses = models.JSONField('Cláusulas personalizadas', default=list, blank=True)

    # Forma de assinatura escolhida para este contrato (a assinatura digital em si
    # será implementada depois — por ora é só o modo, exibido no PDF).
    SIGNATURE_CHOICES = [('fisica', 'Física (imprimir e assinar)'), ('digital', 'Digital')]
    signature_type = models.CharField('Forma de assinatura', max_length=10, choices=SIGNATURE_CHOICES, default='fisica')

    # Etapa do ciclo de vida: em edição → enviado para assinatura → (assinado) →
    # em revisão (operadora confere) → aprovado. 'assinado' fica como estado
    # legado; ao completar a assinatura o contrato vai direto para 'revisao'.
    STAGE_CHOICES = [
        ('em_edicao', 'Em edição'),
        ('enviado', 'Enviado para assinatura'),
        ('assinado', 'Assinado'),
        ('revisao', 'Em revisão'),
        ('aprovado', 'Aprovado'),        # legado — hoje aprovar já manda para 'a_faturar'
        ('a_faturar', 'A faturar'),
        ('faturado', 'Faturado'),
    ]
    stage       = models.CharField('Etapa', max_length=12, choices=STAGE_CHOICES, default='em_edicao', db_index=True)
    # Revisão da operadora (após a assinatura completa).
    review_note = models.TextField('Observação/motivo da revisão', blank=True, default='')
    reviewed_at = models.DateTimeField('Revisado em', null=True, blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name='contracts_reviewed', verbose_name='Revisado por')
    # Faturamento (após aprovado → a_faturar → faturado).
    invoice_number = models.CharField('Número da fatura', max_length=60, blank=True, default='')
    invoice_date   = models.DateField('Data da fatura', null=True, blank=True)
    invoiced_at    = models.DateTimeField('Faturado em', null=True, blank=True)
    invoiced_by    = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                       related_name='contracts_invoiced', verbose_name='Faturado por')
    signed_file = models.FileField('Contrato assinado', upload_to=secure_signed_path, null=True, blank=True)
    # Versão de assinatura: sobe a cada edição do contrato. O PDF baixado para
    # assinatura física carrega um QR por página com (contrato, versão, página, total)
    # assinado (HMAC). No upload do assinado escaneado, o backend lê os QR e confere
    # se é este contrato, na versão ATUAL, com todas as páginas na ordem certa.
    signing_version = models.PositiveIntegerField('Versão de assinatura', default=1)
    # Resultado da conferência automática (OCR/leitura) do contrato assinado contra
    # os dados do contrato. Guardado para o aviso de divergências ficar persistente.
    signed_verification = models.JSONField('Conferência do assinado', null=True, blank=True)
    # Momentos das transições de etapa (para a coluna de data por aba).
    sent_at   = models.DateTimeField('Enviado para assinatura em', null=True, blank=True)
    signed_at = models.DateTimeField('Assinado em', null=True, blank=True)

    # Assinatura digital (Autentique): id do documento criado lá e um espelho do
    # estado dos signatários (links, quem já assinou) para exibir o andamento.
    autentique_document_id = models.CharField('ID do documento na Autentique', max_length=64, blank=True, default='')
    autentique_data        = models.JSONField('Dados da Autentique', null=True, blank=True)

    status     = models.CharField('Status', max_length=20, choices=STATUS_CHOICES, default='ativo')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
                                   related_name='contracts_created')
    # Vendedor que aparece no contrato (e-mail/telefone). Por padrão é o próprio
    # criador; só pode ser outro usuário se quem cria tiver contracts_change_seller.
    seller     = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='contracts_as_seller', verbose_name='Vendedor')
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
    KIND_CHOICES = [('acrescimo', 'Acréscimo'), ('desconto', 'Desconto'), ('comissao', 'Comissão')]
    MODE_CHOICES = [('valor', 'Valor (USD)'), ('valor_brl', 'Valor (BRL)'), ('percentual', 'Percentual (%)')]

    contract    = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name='adjustments')
    description = models.CharField('Descrição', max_length=200, blank=True)
    kind        = models.CharField('Tipo', max_length=10, choices=KIND_CHOICES, default='acrescimo')
    mode        = models.CharField('Modo', max_length=12, choices=MODE_CHOICES, default='valor')
    value_usd   = models.DecimalField('Valor (USD)', max_digits=12, decimal_places=2, default=0)
    value_brl   = models.DecimalField('Valor (BRL)', max_digits=12, decimal_places=2, default=0)
    percent     = models.DecimalField('Percentual', max_digits=6, decimal_places=2, default=0)
    order       = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order']

    def amount_usd(self, base_usd, rate=None):
        """Valor absoluto (positivo) deste ajuste em USD, dado o subtotal-base em
        USD e o câmbio (necessário p/ ajustes em BRL)."""
        if self.mode == 'percentual':
            return base_usd * self.percent / 100
        if self.mode == 'valor_brl':
            return (self.value_brl / rate) if rate else 0
        return self.value_usd
