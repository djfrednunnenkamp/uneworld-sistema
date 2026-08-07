"""Da reserva para a lista de passageiros.

As frases que a operadora diria: "reservei, já quero ver essa gente na lista",
"os quartos são os que eu montei", "o lugar sem nome também é um lugar",
"cancelei, sai da lista" e "virou contrato, não quero ninguém em dobro".
"""
from django.contrib.auth.models import User
from django.test import TestCase

from agencies.models import Agency
from config_api.models import ConfigAccommodation, ConfigShipCabin
from itineraries.models import Itinerary
from passengers.models import Passenger
from reservations.models import Reservation, ReservationRoom
from reservations.enrollment import (lista_do_roteiro, remover_da_lista,
                                     sincronizar_lista, soltar_do_contrato)
from reservations.rooms import quartos_da_reserva
from trips.models import ListEnrollment, PassengerList


class BaseReservaLista(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='op', email='op@x.com', password='pw12345678',
                                             first_name='Ana', last_name='Souza')
        self.ag = Agency.objects.create(name='Agência X')
        self.it = Itinerary.objects.create(name='Cancún', base_currency='USD')
        self.duplo = ConfigAccommodation.objects.create(name='Duplo Twin', capacity=2)
        self.cabine = ConfigShipCabin.objects.create(name='Duplo Twin', category='Balcão', capacity=2)
        self.pl = PassengerList.objects.create(name='Cancún · Outubro')
        self.pl.roteiros.add(self.it)
        self.ana = Passenger.objects.create(first_name='Ana', last_name='Lima')
        self.bia = Passenger.objects.create(first_name='Bia', last_name='Melo')

    def reserva(self, pax=2):
        return Reservation.objects.create(itinerary=self.it, agency=self.ag, pax=pax,
                                          original_pax=pax, status='pendente', created_by=self.user)

    def quarto(self, res, guests, kind='terrestre', label='Duplo Twin'):
        return ReservationRoom.objects.create(
            reservation=res, kind=kind, label=label, capacity=2, quantity=1, guests=guests,
            accommodation=(self.duplo if kind == 'terrestre' else None),
            ship_cabin=(self.cabine if kind == 'navio' else None))


class SincronizarTest(BaseReservaLista):
    def test_a_lista_do_roteiro_e_a_primeira_ativa(self):
        self.assertEqual(lista_do_roteiro(self.it), self.pl)
        self.pl.is_deleted = True
        self.pl.save()
        self.assertIsNone(lista_do_roteiro(self.it))

    def test_reserva_entra_na_lista_com_o_quarto_montado(self):
        res = self.reserva()
        self.quarto(res, [{'name': 'Ana Lima', 'passenger': self.ana.id},
                          {'name': 'Bia Melo', 'passenger': self.bia.id}])
        pl, criadas = sincronizar_lista(res)
        self.assertEqual(pl, self.pl)
        self.assertEqual(len(criadas), 2)
        self.assertEqual({e.accommodation for e in criadas}, {'Duplo Twin'})
        self.assertTrue(self.pl.rooms.filter(name='Duplo Twin').exists())
        self.assertEqual({e.enrollment_status for e in criadas}, {'reservado'})
        # O responsável é quem reservou — é ele que recebe o comprovante.
        self.assertEqual({e.responsible_user_id for e in criadas}, {self.user.id})
        self.assertEqual({e.agency_id for e in criadas}, {self.ag.id})

    def test_lugar_sem_nome_vira_bloqueio_da_agencia(self):
        res = self.reserva()
        self.quarto(res, [{'name': 'Ana Lima', 'passenger': self.ana.id},
                          {'name': 'Agência X - 1', 'passenger': None}])
        _pl, criadas = sincronizar_lista(res)
        bloqueios = [e for e in criadas if e.is_block]
        self.assertEqual(len(bloqueios), 1)
        self.assertIsNone(bloqueios[0].passenger_id)
        self.assertEqual(bloqueios[0].block_agency, 'Agência X')
        self.assertEqual(bloqueios[0].accommodation, 'Duplo Twin')

    def test_dois_quartos_do_mesmo_tipo_nao_viram_um_so(self):
        res = self.reserva(pax=4)
        self.quarto(res, [{'name': 'Ana Lima', 'passenger': self.ana.id},
                          {'name': 'Bia Melo', 'passenger': self.bia.id}])
        self.quarto(res, [{'name': 'X - 1', 'passenger': None}, {'name': 'X - 2', 'passenger': None}])
        _pl, criadas = sincronizar_lista(res)
        self.assertEqual(sorted({e.accommodation for e in criadas}), ['Duplo Twin', 'Duplo Twin 2'])
        self.assertEqual(len(criadas), 4)

    def test_navio_quarto_e_cabine_sao_o_mesmo_quarto(self):
        res = self.reserva()
        gente = [{'name': 'Ana Lima', 'passenger': self.ana.id},
                 {'name': 'Bia Melo', 'passenger': self.bia.id}]
        self.quarto(res, gente, kind='navio', label='Balcão')
        self.quarto(res, gente)
        self.assertEqual(len(quartos_da_reserva(res)), 1)
        _pl, criadas = sincronizar_lista(res)
        self.assertEqual(len(criadas), 2)                       # e não 4
        self.assertEqual({e.accommodation for e in criadas}, {'Balcão — Duplo Twin'})

    def test_sincronizar_de_novo_nao_duplica(self):
        res = self.reserva()
        self.quarto(res, [{'name': 'Ana Lima', 'passenger': self.ana.id}])
        sincronizar_lista(res)
        sincronizar_lista(res)
        self.assertEqual(ListEnrollment.objects.filter(passenger_list=self.pl).count(), 1)

    def test_sem_lista_no_roteiro_nao_inventa_uma(self):
        self.pl.delete()
        res = self.reserva()
        self.quarto(res, [{'name': 'Ana Lima', 'passenger': self.ana.id}])
        pl, criadas = sincronizar_lista(res)
        self.assertIsNone(pl)
        self.assertEqual(criadas, [])
        self.assertEqual(PassengerList.objects.count(), 0)

    def test_quem_ja_esta_na_lista_nao_entra_de_novo(self):
        ListEnrollment.objects.create(passenger_list=self.pl, passenger=self.ana, accommodation='Outro')
        res = self.reserva()
        self.quarto(res, [{'name': 'Ana Lima', 'passenger': self.ana.id},
                          {'name': 'Bia Melo', 'passenger': self.bia.id}])
        _pl, criadas = sincronizar_lista(res)
        self.assertEqual([e.passenger_id for e in criadas], [self.bia.id])


class QuandoAReservaCaiTest(BaseReservaLista):
    def test_some_da_lista_o_que_a_reserva_pos(self):
        outro = ListEnrollment.objects.create(passenger_list=self.pl, passenger=self.bia, accommodation='À mão')
        res = self.reserva()
        self.quarto(res, [{'name': 'Ana Lima', 'passenger': self.ana.id},
                          {'name': 'X - 1', 'passenger': None}])
        sincronizar_lista(res)
        self.assertEqual(ListEnrollment.objects.filter(passenger_list=self.pl).count(), 3)
        remover_da_lista(res)
        restantes = list(ListEnrollment.objects.filter(passenger_list=self.pl))
        self.assertEqual([e.id for e in restantes], [outro.id])   # quem entrou à mão fica


class ViraContratoTest(BaseReservaLista):
    def _contrato(self, res, passageiros):
        from contracts.models import Contract, ContractGuest
        ct = Contract.objects.create(agency=self.ag, itinerary=self.it, source_reservation=res)
        for p in passageiros:
            ContractGuest.objects.create(contract=ct, passenger=p, accommodation_type=self.duplo)
        return ct

    def test_o_contrato_assume_quem_ja_esta_e_consome_os_lugares_vazios(self):
        res = self.reserva()
        self.quarto(res, [{'name': 'Ana Lima', 'passenger': self.ana.id},
                          {'name': 'X - 1', 'passenger': None}])
        sincronizar_lista(res)
        ct = self._contrato(res, [self.ana, self.bia])   # o lugar vazio virou a Bia

        consumidos = soltar_do_contrato(ct, self.pl)
        self.assertEqual(consumidos, 1)
        linhas = ListEnrollment.objects.filter(passenger_list=self.pl)
        self.assertEqual(linhas.count(), 1)                     # só a Ana, sem bloqueio sobrando
        ana = linhas.first()
        self.assertEqual(ana.passenger_id, self.ana.id)
        self.assertIsNone(ana.reservation_id)                   # agora responde pelo contrato
        # E cair a reserva depois disso não pode levar a Ana embora.
        remover_da_lista(res)
        self.assertEqual(ListEnrollment.objects.filter(passenger_list=self.pl).count(), 1)

    def test_contrato_sem_reserva_de_origem_nao_e_afetado(self):
        from contracts.models import Contract
        ct = Contract.objects.create(agency=self.ag, itinerary=self.it)
        self.assertEqual(soltar_do_contrato(ct, self.pl), 0)
