"""Reservar de dentro da lista de passageiros, ponta a ponta (pela API).

O que a tela promete: escolho as pessoas e, para cada uma, posso deixar sem
acomodação, pôr numa acomodação que a lista já tem, ou criar uma nova. Nenhum
desses caminhos pode exigir que o roteiro tenha quarto bloqueado — a lista
organiza quem dorme onde mesmo num roteiro só de cabines.
"""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from agencies.models import Agency, AgencyMember
from itineraries.models import Itinerary
from passengers.models import Passenger
from reservations.models import Reservation
from trips.models import ListEnrollment, PassengerList, Room
from users_api.models import UserPermissions


class ReservarDaListaTest(TestCase):
    def setUp(self):
        self.op = User.objects.create_user(username='op', email='op@x.com', password='pw12345678')
        p = UserPermissions.objects.get_or_create(user=self.op)[0]
        p.reservas_create = True; p.reservas_create_agency = True
        p.reservas_view = True; p.reservas_view_all = True; p.reservas_overbook = True
        # Criar acomodação na lista é `lists_edit` — permissão diferente de
        # adicionar passageiro (`lists_passengers_add`). O front esconde o cartão
        # de "nova acomodação" de quem não a tem, em vez de deixar tomar 403.
        p.lists_edit = True; p.lists_view = True; p.lists_passengers_add = True
        p.save()
        self.ag = Agency.objects.create(name='Agência X')
        self.vend = User.objects.create_user(username='v', email='v@x.com', password='pw12345678')
        AgencyMember.objects.create(agency=self.ag, user=self.vend)
        # Roteiro SEM bloqueio terrestre (só o que a lista organiza).
        self.it = Itinerary.objects.create(name='Cancún', base_currency='USD')
        self.pl = PassengerList.objects.create(name='Cancún · Outubro')
        self.pl.roteiros.add(self.it)
        self.ana = Passenger.objects.create(first_name='Ana', last_name='Lima')
        self.bia = Passenger.objects.create(first_name='Bia', last_name='Melo')
        self.client = APIClient()
        self.client.force_authenticate(self.op)

    def reservar(self, pax, list_guests):
        return self.client.post('/api/reservations/', {
            'itinerary': self.it.id, 'agency': self.ag.id, 'reservation_type': 'sem_pagamento',
            'pax': pax, 'rooms_input': [], 'list_guests': list_guests,
            'responsible_user': self.vend.id,
        }, format='json')

    def linhas(self):
        return list(ListEnrollment.objects.filter(passenger_list=self.pl).order_by('order_in_list'))

    def test_sem_acomodacao_a_pessoa_entra_na_lista(self):
        r = self.reservar(1, [{'name': 'Ana Lima', 'passenger': self.ana.id, 'room': ''}])
        self.assertEqual(r.status_code, 201, r.data)
        linhas = self.linhas()
        self.assertEqual([e.passenger_id for e in linhas], [self.ana.id])
        self.assertEqual(linhas[0].accommodation, '')
        self.assertEqual(linhas[0].origin, 'reserva')
        # O responsável escolhido responde pelo assento.
        self.assertEqual(linhas[0].responsible_user_id, self.vend.id)

    def test_numa_acomodacao_que_a_lista_ja_tem(self):
        Room.objects.create(passenger_list=self.pl, name='Duplo Twin')
        ListEnrollment.objects.create(passenger_list=self.pl, passenger=self.bia, accommodation='Duplo Twin')

        r = self.reservar(1, [{'name': 'Ana Lima', 'passenger': self.ana.id, 'room': 'Duplo Twin'}])
        self.assertEqual(r.status_code, 201, r.data)
        ana = ListEnrollment.objects.get(passenger=self.ana)
        self.assertEqual(ana.accommodation, 'Duplo Twin')       # dorme com quem já estava lá
        self.assertEqual(Room.objects.filter(passenger_list=self.pl).count(), 1)   # sem quarto novo

    def test_acomodacao_criada_na_hora_recebe_a_pessoa(self):
        """A tela cria o Room na lista (POST /rooms/) e só então reserva — é
        assim que a reserva encontra o quarto pelo nome."""
        r = self.client.post(f'/api/trips/lists/{self.pl.id}/rooms/', {'name': 'Suíte 1'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)

        r2 = self.reservar(1, [{'name': 'Ana Lima', 'passenger': self.ana.id, 'room': 'Suíte 1'}])
        self.assertEqual(r2.status_code, 201, r2.data)
        self.assertEqual(ListEnrollment.objects.get(passenger=self.ana).accommodation, 'Suíte 1')

    def test_varias_pessoas_com_destinos_diferentes(self):
        Room.objects.create(passenger_list=self.pl, name='Duplo Twin')
        ListEnrollment.objects.create(passenger_list=self.pl, passenger=self.bia, accommodation='Duplo Twin')
        outra = Passenger.objects.create(first_name='Caio', last_name='Reis')

        r = self.reservar(2, [
            {'name': 'Ana Lima', 'passenger': self.ana.id, 'room': 'Duplo Twin'},
            {'name': 'Caio Reis', 'passenger': outra.id, 'room': ''},
        ])
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(ListEnrollment.objects.get(passenger=self.ana).accommodation, 'Duplo Twin')
        self.assertEqual(ListEnrollment.objects.get(passenger=outra).accommodation, '')

    def test_a_reserva_nao_precisa_de_quarto_bloqueado(self):
        """Roteiro sem bloqueio terrestre nenhum: reservar continua funcionando,
        porque essas pessoas não seguram unidade."""
        r = self.reservar(1, [{'name': 'sem nome', 'passenger': None, 'room': ''}])
        self.assertEqual(r.status_code, 201, r.data)
        res = Reservation.objects.get(pk=r.data['id'])
        self.assertEqual(res.rooms.count(), 0)
        linha = self.linhas()[0]
        self.assertTrue(linha.is_block)          # vaga, não passageiro
        self.assertTrue(linha.is_provisional)    # com nome digitado → provisória

    def test_quarto_montado_do_catalogo_vira_acomodacao_com_nome_completo(self):
        """A tela monta o quarto pelo catálogo (Single + cabine), cria a
        acomodação na lista e manda as pessoas apontando para ela. Nada de
        estoque é consumido: quarto do catálogo é organização, não compra."""
        r = self.client.post(f'/api/trips/lists/{self.pl.id}/rooms/',
                             {'name': 'Balcão Juliet Superior — Single'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)

        r2 = self.reservar(1, [{'name': 'Ana Lima', 'passenger': self.ana.id,
                                'room': 'Balcão Juliet Superior — Single'}])
        self.assertEqual(r2.status_code, 201, r2.data)
        linha = ListEnrollment.objects.get(passenger=self.ana)
        self.assertEqual(linha.accommodation, 'Balcão Juliet Superior — Single')
        self.assertEqual(Reservation.objects.get(pk=r2.data['id']).rooms.count(), 0)
