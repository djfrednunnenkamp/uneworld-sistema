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
