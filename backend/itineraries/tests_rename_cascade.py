"""Renomear o roteiro renomeia a lista de passageiros (e, por tabela, o voucher).

O voucher NÃO guarda nome próprio — ele lê `passenger_list.name` — então o teste
confirma a cadeia inteira: roteiro → lista → voucher.
"""
from datetime import date

from django.test import TestCase

from itineraries.models import Itinerary
from trips.models import PassengerList
from vouchers.models import VoucherList


class RenameCascadeTests(TestCase):
    def setUp(self):
        self.it = Itinerary.objects.create(name='NOME ORIGINAL', start_date=date(2027, 3, 1))
        self.pl = PassengerList.objects.create(name='NOME ORIGINAL')
        self.pl.roteiros.add(self.it)

    def _nomes(self):
        self.pl.refresh_from_db()
        voucher = VoucherList.objects.get(passenger_list=self.pl)
        return self.pl.name, voucher.passenger_list.name

    def test_renomear_roteiro_renomeia_lista_e_voucher(self):
        self.it.name = 'NOME NOVO'
        self.it.save()
        lista, voucher = self._nomes()
        self.assertEqual(lista, 'NOME NOVO')
        self.assertEqual(voucher, 'NOME NOVO')   # o voucher espelha a lista

    def test_renomeia_por_qualquer_caminho_inclusive_update_fields(self):
        self.it.name = 'VIA UPDATE_FIELDS'
        self.it.save(update_fields=['name'])
        self.assertEqual(self._nomes()[0], 'VIA UPDATE_FIELDS')

    def test_salvar_sem_mudar_o_nome_nao_mexe_na_lista(self):
        # A lista pode ter sido renomeada à mão; salvar o roteiro sem trocar o
        # nome não pode desfazer isso.
        self.pl.name = 'NOME MANUAL DA LISTA'
        self.pl.save(update_fields=['name'])
        self.it.start_date = date(2027, 4, 1)
        self.it.save()
        self.assertEqual(self._nomes()[0], 'NOME MANUAL DA LISTA')

    def test_renomeia_todas_as_listas_vinculadas(self):
        outra = PassengerList.objects.create(name='NOME ORIGINAL')
        outra.roteiros.add(self.it)
        self.it.name = 'VALE PRA TODAS'
        self.it.save()
        outra.refresh_from_db()
        self.assertEqual(self._nomes()[0], 'VALE PRA TODAS')
        self.assertEqual(outra.name, 'VALE PRA TODAS')

    def test_lista_de_outro_roteiro_nao_e_afetada(self):
        outro_it = Itinerary.objects.create(name='OUTRO ROTEIRO')
        outra_pl = PassengerList.objects.create(name='LISTA DO OUTRO')
        outra_pl.roteiros.add(outro_it)
        self.it.name = 'SÓ O MEU MUDA'
        self.it.save()
        outra_pl.refresh_from_db()
        self.assertEqual(outra_pl.name, 'LISTA DO OUTRO')

    def test_nome_vazio_nao_apaga_o_nome_da_lista(self):
        self.it.name = ''
        self.it.save()
        self.assertEqual(self._nomes()[0], 'NOME ORIGINAL')
