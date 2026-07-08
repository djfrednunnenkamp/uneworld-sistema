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
