from django.db import models

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
    passenger_list = models.OneToOneField('trips.PassengerList', on_delete=models.CASCADE,
                                          related_name='voucher')
    # None = herda o template global; lista = blocos próprios desta lista.
    blocks     = models.JSONField('Blocos do voucher', null=True, blank=True, default=None)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Voucher da lista'
        verbose_name_plural = 'Vouchers das listas'

    def __str__(self):
        return f'Voucher: {self.passenger_list.name}'


class VoucherFlightConfirmation(models.Model):
    """Captura de tela da confirmação do voo, por voucher (passageiro/casal) de uma
    lista. No PDF, vai numa PÁGINA PRÓPRIA ao final do voucher daquele passageiro
    — só a imagem na página. `entry_key` é a chave do voucher (ex.: 'pax:123' ou
    'room:Duplo Casal'), a mesma calculada em build.build_entries."""
    voucher    = models.ForeignKey(VoucherList, on_delete=models.CASCADE, related_name='flight_confirmations')
    entry_key  = models.CharField('Voucher (passageiro/casal)', max_length=200, db_index=True)
    image      = models.ImageField('Confirmação do voo', upload_to='vouchers/flight_confirmations/')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('voucher', 'entry_key')]
        verbose_name = 'Confirmação de voo do voucher'
        verbose_name_plural = 'Confirmações de voo dos vouchers'

    def __str__(self):
        return f'Confirmação voo · {self.voucher.passenger_list.name} · {self.entry_key}'


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
