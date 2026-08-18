"""Quem responde pela reserva, e por quanto tempo ela segura a vaga.

As duas coisas mudam conforme QUEM reserva: a agência não escolhe nenhuma das
duas (é ela mesma, no prazo do roteiro); a operadora escolhe as duas, porque o
operador que digitou não é quem vai acompanhar a viagem e o prazo é combinado
caso a caso.
"""
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from agencies.models import Agency, AgencyMember
from itineraries.models import Itinerary
from reservations.models import Reservation
from users_api.models import UserPermissions


class BaseResponsavel(TestCase):
    def setUp(self):
        self.ag = Agency.objects.create(name='Agência X')
        self.it = Itinerary.objects.create(name='Cancún', base_currency='USD')

        # Operadora (sem agência) e duas pessoas DA agência.
        self.op = User.objects.create_user(username='op', email='op@x.com', password='pw12345678')
        p = UserPermissions.objects.get_or_create(user=self.op)[0]
        p.reservas_create = True; p.reservas_create_agency = True
        p.reservas_view = True; p.reservas_view_all = True; p.reservas_overbook = True
        p.save()

        self.vendedora = User.objects.create_user(username='vend', email='v@x.com', password='pw12345678',
                                                  first_name='Vera', last_name='Dias')
        AgencyMember.objects.create(agency=self.ag, user=self.vendedora)
        self.outra = User.objects.create_user(username='outra', email='o@y.com', password='pw12345678')

        self.client = APIClient()

    def como_operadora(self):
        self.client.force_authenticate(self.op)

    def como_agencia(self):
        # Ser membro (AgencyMember, no setUp) é o que faz dela "usuária de
        # agência" — é daí que sai o escopo (agency_scope_ids).
        p = UserPermissions.objects.get_or_create(user=self.vendedora)[0]
        p.reservas_create = True; p.reservas_view = True; p.reservas_overbook = True
        p.save()
        self.client.force_authenticate(self.vendedora)

    def reservar(self, **extra):
        return self.client.post('/api/reservations/', {
            'itinerary': self.it.id, 'agency': self.ag.id,
            'reservation_type': 'sem_pagamento', 'pax': 1, **extra,
        }, format='json')


class OperadoraTest(BaseResponsavel):
    def test_escolhe_o_responsavel_da_agencia(self):
        self.como_operadora()
        r = self.reservar(responsible_user=self.vendedora.id)
        self.assertEqual(r.status_code, 201, r.data)
        res = Reservation.objects.get(pk=r.data['id'])
        self.assertEqual(res.responsible_user_id, self.vendedora.id)
        self.assertEqual(res.responsavel, self.vendedora)
        self.assertEqual(r.data['responsible_user_name'], 'Vera Dias')

    def test_nao_aceita_quem_nao_e_da_agencia(self):
        self.como_operadora()
        r = self.reservar(responsible_user=self.outra.id)
        self.assertEqual(r.status_code, 400)
        self.assertIn('responsible_user', r.data)

    def test_sem_prazo_por_padrao(self):
        """Para a operadora o padrão é NÃO vencer: o prazo é combinado caso a
        caso, não a regra de venda do roteiro."""
        self.como_operadora()
        r = self.reservar()
        res = Reservation.objects.get(pk=r.data['id'])
        self.assertIsNone(res.expires_at)
        self.assertIsNone(res.deadline_hours)

    def test_prazo_em_horas(self):
        self.como_operadora()
        r = self.reservar(deadline_hours_input=10)
        res = Reservation.objects.get(pk=r.data['id'])
        self.assertEqual(res.deadline_hours, 10)
        horas = (res.expires_at - timezone.now()).total_seconds() / 3600
        self.assertTrue(9.9 < horas < 10.1, horas)

    def test_prazo_por_data_e_hora(self):
        self.como_operadora()
        quando = timezone.now() + timezone.timedelta(days=3)
        r = self.reservar(expires_at_input=quando.isoformat())
        res = Reservation.objects.get(pk=r.data['id'])
        self.assertAlmostEqual(res.expires_at, quando, delta=timezone.timedelta(seconds=2))
        self.assertIsNone(res.deadline_hours)   # a data manda; horas não se aplica

    def test_a_data_ganha_das_horas(self):
        self.como_operadora()
        quando = timezone.now() + timezone.timedelta(days=2)
        r = self.reservar(deadline_hours_input=10, expires_at_input=quando.isoformat())
        res = Reservation.objects.get(pk=r.data['id'])
        self.assertAlmostEqual(res.expires_at, quando, delta=timezone.timedelta(seconds=2))


class AgenciaTest(BaseResponsavel):
    def test_o_responsavel_e_quem_fez(self):
        self.como_agencia()
        r = self.reservar()
        self.assertEqual(r.status_code, 201, r.data)
        res = Reservation.objects.get(pk=r.data['id'])
        self.assertEqual(res.responsavel, self.vendedora)

    def test_nao_escolhe_responsavel_nem_prazo(self):
        """O que a agência mandar nesses campos é ignorado: o prazo é a regra de
        venda da operadora, e esticá-lo seria segurar a vaga para sempre."""
        self.como_agencia()
        r = self.reservar(responsible_user=self.outra.id, deadline_hours_input=999)
        self.assertEqual(r.status_code, 201, r.data)
        res = Reservation.objects.get(pk=r.data['id'])
        self.assertEqual(res.responsavel, self.vendedora)
        self.assertNotEqual(res.deadline_hours, 999)
        self.assertIsNotNone(res.expires_at)     # o prazo padrão continua valendo
