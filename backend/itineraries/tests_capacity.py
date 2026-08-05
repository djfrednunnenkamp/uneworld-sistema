"""Capacidade à venda derivada dos BLOQUEIOS (itineraries/capacity.py).

Regra: só bloqueio AÉREO conta assento; terrestre (quartos) e navio (cabines)
contam outra coisa e ficam de fora. Sem bloqueio de assento = sem limite (None),
que é o que libera as reservas."""
from django.test import TestCase

from itineraries.models import Itinerary, ItineraryInventoryBlock
from itineraries.capacity import seats_from_blocks, seats_for_itinerary, seats_published


class SeatsFromBlocksTest(TestCase):
    def test_soma_os_bloqueios_aereos(self):
        # Dois bloqueios aéreos somam (é a regra pedida: 2 bloqueios = 2 lotes).
        self.assertEqual(seats_from_blocks([
            {'kind': 'aereo', 'quantity': 15, 'is_active': True},
            {'kind': 'aereo', 'quantity': 10, 'is_active': True},
        ]), 25)

    def test_ignora_quarto_e_cabine(self):
        # Terrestre = quartos, navio = cabines: 10 duplos são 20 pessoas, não 10.
        self.assertIsNone(seats_from_blocks([
            {'kind': 'terrestre', 'quantity': 12, 'is_active': True},
            {'kind': 'navio', 'quantity': 27, 'is_active': True},
        ]))
        self.assertEqual(seats_from_blocks([
            {'kind': 'terrestre', 'quantity': 12, 'is_active': True},
            {'kind': 'aereo', 'quantity': 8, 'is_active': True},
        ]), 8)

    def test_ignora_inativo_e_zerado(self):
        self.assertEqual(seats_from_blocks([
            {'kind': 'aereo', 'quantity': 20, 'is_active': False},
            {'kind': 'aereo', 'quantity': 0, 'is_active': True},
            {'kind': 'aereo', 'quantity': 6, 'is_active': True},
        ]), 6)

    def test_sem_bloqueio_de_assento_e_sem_limite(self):
        self.assertIsNone(seats_from_blocks([]))
        self.assertIsNone(seats_from_blocks(None))
        self.assertIsNone(seats_from_blocks([{'kind': 'aereo', 'quantity': 0, 'is_active': True}]))

    def test_valor_invalido_nao_derruba(self):
        self.assertEqual(seats_from_blocks([
            {'kind': 'aereo', 'quantity': 'dez', 'is_active': True},
            {'kind': 'aereo', 'quantity': None, 'is_active': True},
            {'kind': 'aereo', 'quantity': 5, 'is_active': True},
        ]), 5)


class SeatsForItineraryTest(TestCase):
    def setUp(self):
        self.it = Itinerary.objects.create(name='Roteiro de teste')

    def _bloco(self, kind, qtd, ativo=True):
        return ItineraryInventoryBlock.objects.create(
            itinerary=self.it, kind=kind, quantity=qtd, is_active=ativo)

    def test_ao_vivo_soma_os_aereos(self):
        self.assertIsNone(seats_for_itinerary(self.it))
        self._bloco('aereo', 15)
        self._bloco('aereo', 10)
        self._bloco('terrestre', 30)
        self.assertEqual(seats_for_itinerary(self.it), 25)

    def test_publicado_usa_a_foto_e_nao_o_vivo(self):
        self._bloco('aereo', 40)                      # mudou depois de publicar
        self.it.published_data = {'pricing_snapshot': {'blocks': [
            {'kind': 'aereo', 'quantity': 12, 'is_active': True},
        ]}}
        self.it.save(update_fields=['published_data'])
        self.assertEqual(seats_for_itinerary(self.it), 40)   # vivo
        self.assertEqual(seats_published(self.it), 12)       # o que vale para as reservas

    def test_sem_foto_publicada_cai_no_vivo(self):
        self._bloco('aereo', 7)
        self.assertEqual(seats_published(self.it), 7)
