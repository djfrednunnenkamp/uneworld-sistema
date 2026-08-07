"""Uma reserva, vários contratos: quem já foi não volta a ser oferecido."""
from django.contrib.auth.models import User
from django.test import TestCase

from agencies.models import Agency
from config_api.models import ConfigAccommodation, ConfigShipCabin
from contracts.models import Contract, ContractGuest
from itineraries.models import Itinerary
from passengers.models import Passenger
from reservations.contratados import marcar_contratados
from reservations.models import Reservation, ReservationRoom


class MarcarContratadosTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='op', password='pw12345678')
        self.ag = Agency.objects.create(name='Agência X')
        self.it = Itinerary.objects.create(name='Cancún', base_currency='USD')
        self.duplo = ConfigAccommodation.objects.create(name='Duplo Twin', capacity=2)
        self.cabine = ConfigShipCabin.objects.create(name='Duplo Twin', category='Balcão', capacity=2)
        self.ana = Passenger.objects.create(first_name='Ana', last_name='Lima')
        self.bia = Passenger.objects.create(first_name='Bia', last_name='Melo')
        self.res = Reservation.objects.create(itinerary=self.it, agency=self.ag, pax=2,
                                              original_pax=2, created_by=self.user)

    def quarto(self, guests, kind='terrestre'):
        return ReservationRoom.objects.create(
            reservation=self.res, kind=kind, label='Duplo Twin', capacity=2, quantity=1,
            guests=guests, accommodation=(self.duplo if kind == 'terrestre' else None),
            ship_cabin=(self.cabine if kind == 'navio' else None))

    def contrato(self, passageiros):
        ct = Contract.objects.create(agency=self.ag, itinerary=self.it, source_reservation=self.res)
        for p in passageiros:
            ContractGuest.objects.create(contract=ct, passenger=p)
        return ct

    def gente(self):
        return [g for r in self.res.rooms.all() for g in r.guests]

    def test_marca_pelo_passageiro(self):
        self.quarto([{'name': 'Ana Lima', 'passenger': self.ana.id},
                     {'name': 'Bia Melo', 'passenger': self.bia.id}])
        ct = self.contrato([self.ana])
        self.assertEqual(marcar_contratados(self.res, ct), 1)
        marcados = {g['name']: g.get('contract') for g in self.gente()}
        self.assertEqual(marcados, {'Ana Lima': ct.id, 'Bia Melo': None})

    def test_quem_entrou_sem_nome_consome_um_lugar_guardado(self):
        self.quarto([{'name': 'Agência X - 1', 'passenger': None},
                     {'name': 'Agência X - 2', 'passenger': None}])
        ct = self.contrato([self.ana])          # a Ana virou o lugar 1
        self.assertEqual(marcar_contratados(self.res, ct), 1)
        contratos = [g.get('contract') for g in self.gente()]
        self.assertEqual(contratos, [ct.id, None])

        # O segundo contrato leva o lugar que sobrou — e não o que já foi.
        ct2 = self.contrato([self.bia])
        self.assertEqual(marcar_contratados(self.res, ct2), 1)
        self.assertEqual([g.get('contract') for g in self.gente()], [ct.id, ct2.id])

    def test_navio_marca_o_quarto_e_a_cabine_da_mesma_pessoa(self):
        gente = [{'name': 'Ana Lima', 'passenger': self.ana.id},
                 {'name': 'Agência X - 1', 'passenger': None}]
        self.quarto(list(gente))
        self.quarto([dict(g) for g in gente], kind='navio')
        ct = self.contrato([self.ana, self.bia])   # Ana por id, Bia no lugar guardado
        self.assertEqual(marcar_contratados(self.res, ct), 2)
        self.assertEqual([g.get('contract') for g in self.gente()], [ct.id] * 4)

    def test_os_lugares_que_a_tela_mandou_sao_os_marcados(self):
        """Sem isto, o contrato do SEGUNDO quarto consumia o lugar do primeiro —
        e ao voltar para gerar o próximo contrato a tela mostrava a pessoa errada
        como 'já contratada'."""
        self.quarto([{'name': 'Agência X - 1', 'passenger': None},
                     {'name': 'Agência X - 2', 'passenger': None}])
        ct = self.contrato([self.ana])
        marcar_contratados(self.res, ct, slots=['Agência X - 2'])
        self.assertEqual([g.get('contract') for g in self.gente()], [None, ct.id])

    def test_rodar_de_novo_nao_consome_lugares_a_mais(self):
        self.quarto([{'name': 'Agência X - 1', 'passenger': None},
                     {'name': 'Agência X - 2', 'passenger': None}])
        ct = self.contrato([self.ana])
        marcar_contratados(self.res, ct)
        marcar_contratados(self.res, ct)
        self.assertEqual([g.get('contract') for g in self.gente()], [ct.id, None])

    def test_contrato_que_cresceu_pega_mais_um_lugar(self):
        self.quarto([{'name': 'Agência X - 1', 'passenger': None},
                     {'name': 'Agência X - 2', 'passenger': None}])
        ct = self.contrato([self.ana])
        marcar_contratados(self.res, ct)
        ContractGuest.objects.create(contract=ct, passenger=self.bia)   # editou o contrato
        self.assertEqual(marcar_contratados(self.res, ct), 2)
        self.assertEqual([g.get('contract') for g in self.gente()], [ct.id, ct.id])
