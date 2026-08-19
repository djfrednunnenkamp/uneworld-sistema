"""A reserva que passou do prazo cai — e cair é sumir.

As frases do domínio: "venceu, sai do hub", "a vaga volta para o estoque",
"a gente sai da lista de passageiros", "reserva paga não cai" e "o que ainda
está no prazo fica".
"""
from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from agencies.models import Agency
from config_api.models import ConfigAccommodation
from itineraries.models import Itinerary, ItineraryInventoryBlock
from reservations.availability import pools_for
from reservations.enrollment import sincronizar_lista
from reservations.models import Reservation, ReservationRoom
from reservations.views import ReservationViewSet
from trips.models import ListEnrollment, PassengerList


class ExpirarVencidasTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='op', password='pw12345678')
        self.ag = Agency.objects.create(name='Agência X')
        self.it = Itinerary.objects.create(name='Cancún', base_currency='USD')
        self.duplo = ConfigAccommodation.objects.create(name='Duplo Twin', capacity=2)
        self.bloco = ItineraryInventoryBlock.objects.create(itinerary=self.it, kind='terrestre', quantity=10)
        self.bloco.accommodations.set([self.duplo])
        self.pl = PassengerList.objects.create(name='Cancún · Outubro')
        self.pl.roteiros.add(self.it)

    def reserva(self, *, vencida, status='pendente'):
        quando = timezone.now() + timedelta(hours=-2 if vencida else 24)
        res = Reservation.objects.create(itinerary=self.it, agency=self.ag, pax=2, original_pax=2,
                                         status=status, expires_at=quando, created_by=self.user)
        ReservationRoom.objects.create(reservation=res, kind='terrestre', block=self.bloco,
                                       accommodation=self.duplo, label='Duplo Twin', capacity=2,
                                       quantity=1, guests=[{'name': 'X - 1', 'passenger': None},
                                                           {'name': 'X - 2', 'passenger': None}])
        return res

    def test_vencida_some_do_hub(self):
        res = self.reserva(vencida=True)
        self.assertEqual(ReservationViewSet.expirar_vencidas(), 1)
        res.refresh_from_db()
        self.assertEqual(res.status, 'expirada')
        self.assertTrue(res.is_deleted)
        self.assertIsNotNone(res.deleted_at)
        self.assertFalse(Reservation.objects.filter(is_deleted=False).exists())

    def test_a_vaga_volta_para_o_estoque(self):
        self.reserva(vencida=True)
        self.assertEqual(pools_for(self.it)[0]['available'], 9)   # ainda segurando
        ReservationViewSet.expirar_vencidas()
        self.assertEqual(pools_for(self.it)[0]['available'], 10)  # devolveu

    def test_a_gente_dela_sai_da_lista_de_passageiros(self):
        res = self.reserva(vencida=True)
        sincronizar_lista(res)
        self.assertEqual(ListEnrollment.objects.filter(passenger_list=self.pl).count(), 2)
        ReservationViewSet.expirar_vencidas()
        self.assertEqual(ListEnrollment.objects.filter(passenger_list=self.pl).count(), 0)
        self.assertEqual(self.pl.rooms.count(), 0)   # o quarto vazio vai junto

    def test_dentro_do_prazo_fica(self):
        self.reserva(vencida=False)
        self.assertEqual(ReservationViewSet.expirar_vencidas(), 0)
        self.assertEqual(Reservation.objects.filter(is_deleted=False).count(), 1)

    def test_reserva_paga_nao_cai(self):
        """Pagamento imediato não tem prazo para cair — quem pagou, pagou."""
        self.reserva(vencida=True, status='paga')
        self.assertEqual(ReservationViewSet.expirar_vencidas(), 0)

    def test_convertida_nao_cai(self):
        self.reserva(vencida=True, status='convertida')
        self.assertEqual(ReservationViewSet.expirar_vencidas(), 0)

    def test_rodar_de_novo_nao_faz_nada(self):
        self.reserva(vencida=True)
        ReservationViewSet.expirar_vencidas()
        self.assertEqual(ReservationViewSet.expirar_vencidas(), 0)


class CapacidadeDescontaReservasTest(TestCase):
    """A vaga que outra reserva já segura não pode ser oferecida de novo — nem
    pela tela, nem pelo servidor. Antes o hub mostrava 0 e o servidor ainda
    aceitava a cota cheia: um limite que mudava de lugar."""

    def setUp(self):
        from users_api.models import UserPermissions
        self.user = User.objects.create_user(username='op2', password='pw12345678')
        p = UserPermissions.objects.get_or_create(user=self.user)[0]
        p.reservas_create = True; p.reservas_create_agency = True; p.reservas_view = True
        p.save()
        self.ag = Agency.objects.create(name='Agência Y')
        self.it = Itinerary.objects.create(name='Cancún', base_currency='USD')
        # 10 assentos de avião = a capacidade à venda do roteiro.
        ItineraryInventoryBlock.objects.create(itinerary=self.it, kind='aereo', quantity=10)
        # O padrão de fábrica dos percentuais é 0 (nada à venda até a operadora
        # decidir); aqui vale o mesmo que ela usa em produção.
        from config_api.models import ReservationSettings
        rs = ReservationSettings.get()
        rs.reserva_online_percent = 60
        rs.pagamento_imediato_percent = 20
        rs.save()

    def cap(self, rtype='sem_pagamento'):
        return ReservationViewSet._type_capacity(self.it, rtype)

    def test_sem_reserva_a_cota_e_o_percentual_cheio(self):
        # Padrão global: 60% online.
        self.assertEqual(self.cap(), 6)

    def test_reserva_ativa_sai_da_cota(self):
        Reservation.objects.create(itinerary=self.it, agency=self.ag, pax=4,
                                   original_pax=4, status='pendente', created_by=self.user)
        self.assertEqual(self.cap(), 2)          # 6 da cota − 4 já reservados

    def test_reserva_que_caiu_devolve_a_cota(self):
        r = Reservation.objects.create(itinerary=self.it, agency=self.ag, pax=4,
                                       original_pax=4, status='pendente', created_by=self.user)
        r.status = 'cancelada'
        r.save(update_fields=['status'])
        self.assertEqual(self.cap(), 6)
