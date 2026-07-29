from django.db import models

from core.storages import public_media_storage

# Template PADRÃO do voucher (usado quando a lista não tem blocos próprios e como
# semente do template global em Configurações). Blocos flexíveis: o usuário
# monta/reordena. Tipos: title | text | day_by_day | inclusions | image.
DEFAULT_VOUCHER_BLOCKS = [
    {'id': 'b_title', 'type': 'title', 'text': 'Voucher de Viagem'},
    {'id': 'b_days',  'type': 'day_by_day', 'heading': 'Roteiro dia a dia'},
    {'id': 'b_text',  'type': 'text', 'content': ''},
    {'id': 'b_incl',  'type': 'inclusions', 'heading': 'O que inclui'},
]


class VoucherList(models.Model):
    """O "voucher" de uma Lista de Passageiros. É criado automaticamente junto com a
    lista (signals). Guarda só os blocos PRÓPRIOS desta lista — quando `blocks` é
    None, o voucher usa o template GLOBAL padrão (Configurações). Os vouchers por
    passageiro/casal são calculados na hora (não são gravados)."""
    STATUS_CHOICES = [
        ('em_edicao', 'Em edição'),
        ('publicado', 'Publicado'),
    ]
    passenger_list = models.OneToOneField('trips.PassengerList', on_delete=models.CASCADE,
                                          related_name='voucher')
    # None = herda o template global; lista = blocos próprios desta lista.
    blocks     = models.JSONField('Blocos do voucher', null=True, blank=True, default=None)
    # Etiquetas do KIT: escolha do ENDEREÇO por passageiro, salva por lista.
    # { "<passenger_id>": { "mode": "agency"|"home"|"custom", "custom": "<texto>" } }
    # mode ausente/'agency' = endereço da agência do passageiro (padrão).
    kit_addresses = models.JSONField('Endereços das etiquetas do kit', default=dict, blank=True)
    # Começa "em edição"; o usuário publica manualmente quando estiver pronto.
    status     = models.CharField('Status', max_length=20, choices=STATUS_CHOICES,
                                  default='em_edicao', db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Voucher da lista'
        verbose_name_plural = 'Vouchers das listas'

    def __str__(self):
        return f'Voucher: {self.passenger_list.name}'


class VoucherFlightConfirmation(models.Model):
    """Captura de tela da confirmação do voo, por voucher (passageiro/casal) de uma
    lista. Cada passageiro/casal pode ter VÁRIAS — cada uma vira uma PÁGINA PRÓPRIA
    ao final do voucher daquele passageiro (na ordem `order`). Se `title` estiver
    preenchido, ele entra como cabeçalho no topo da página; senão, só a imagem.
    `entry_key` é a chave do voucher (ex.: 'pax:123' ou 'room:Duplo Casal'), a mesma
    calculada em build.build_entries."""
    voucher    = models.ForeignKey(VoucherList, on_delete=models.CASCADE, related_name='flight_confirmations')
    entry_key  = models.CharField('Voucher (passageiro/casal)', max_length=200, db_index=True)
    image      = models.ImageField('Confirmação do voo', upload_to='vouchers/flight_confirmations/', storage=public_media_storage)
    title      = models.CharField('Título', max_length=200, blank=True, default='')
    order      = models.PositiveIntegerField('Ordem', default=0, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'id']
        verbose_name = 'Confirmação de voo do voucher'
        verbose_name_plural = 'Confirmações de voo dos vouchers'

    def __str__(self):
        return f'Confirmação voo · {self.voucher.passenger_list.name} · {self.entry_key}'


class VoucherDownload(models.Model):
    """Registro de download do voucher de UM passageiro/casal (entry_key) por um
    usuário de AGÊNCIA — para a operadora ver o progresso (X% baixaram), quem
    baixou e quantas vezes. Um registro por (voucher, entry_key, user); `count`
    conta as vezes que aquele usuário baixou; downloaded_at = último download."""
    voucher       = models.ForeignKey(VoucherList, on_delete=models.CASCADE, related_name='downloads')
    entry_key     = models.CharField('Voucher (passageiro/casal)', max_length=200, db_index=True)
    user          = models.ForeignKey('auth.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    count         = models.PositiveIntegerField('Vezes baixado', default=1)
    downloaded_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('voucher', 'entry_key', 'user')]
        ordering = ['-downloaded_at']
        verbose_name = 'Download de voucher'
        verbose_name_plural = 'Downloads de vouchers'

    def __str__(self):
        return f'Download · {self.voucher.passenger_list.name} · {self.entry_key}'


class VoucherTemplate(models.Model):
    """Template REUTILIZÁVEL de voucher (biblioteca em Configurações). Vários, cada
    um com nome. Um é o PADRÃO (is_default) — listas novas herdam ele (VoucherList
    com blocks None cai no template padrão). blocks = mesma estrutura de blocos."""
    name       = models.CharField('Nome do template', max_length=200)
    blocks     = models.JSONField('Blocos', default=list, blank=True)
    is_default = models.BooleanField('Template padrão', default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-is_default', 'name']
        verbose_name = 'Template de voucher'
        verbose_name_plural = 'Templates de voucher'

    def __str__(self):
        return self.name
