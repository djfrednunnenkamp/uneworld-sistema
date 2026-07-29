"""Etiquetas do KIT: o endpoint monta os dados por passageiro (agência + endereço
+ roteiro/período) e persiste a escolha de endereço por pessoa."""
from datetime import date

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from users_api.models import UserPermissions
from agencies.models import Agency
from passengers.models import Passenger
from trips.models import PassengerList, ListEnrollment


def _su(username):
    u = User.objects.create_user(username=username, email=f'{username}@x.com', password='pw12345678')
    u.is_superuser = True; u.is_staff = True; u.save()
    UserPermissions.objects.get_or_create(user=u)
    return u


class KitLabelsTest(APITestCase):
    def setUp(self):
        self.admin = _su('kitadmin')
        self.ag = Agency.objects.create(name='Ag Viagens', email='ag@x.com', person_type='juridica',
                                        street='Rua A', number='10', city='POA', state='RS', cep='90000-000')
        self.pl = PassengerList.objects.create(name='CHINA', start_date=date(2027, 3, 21), end_date=date(2027, 4, 10))
        self.pax = Passenger.objects.create(full_name='Carla Beatriz', street='Rua Casa', number='5', city='Canoas', state='RS')
        ListEnrollment.objects.create(passenger_list=self.pl, passenger=self.pax, agency=self.ag)
        self.client.force_authenticate(self.admin)
        self.url = f'/api/vouchers/{self.pl.id}/kit-labels/'

    def test_get_builds_data(self):
        d = self.client.get(self.url).json()
        self.assertEqual(d['roteiro_name'], 'CHINA')                 # sem roteiro vinculado, cai no nome da lista
        self.assertEqual(d['period'], '21/03/2027 a 10/04/2027')
        self.assertEqual(len(d['passengers']), 1)
        p = d['passengers'][0]
        self.assertEqual(p['name'], 'Carla Beatriz')
        self.assertEqual(p['agency']['name'], 'Ag Viagens')
        self.assertEqual(p['agency']['email'], 'ag@x.com')
        self.assertTrue(any('Rua A' in ln for ln in p['agency']['address_lines']))
        self.assertTrue(any('Rua Casa' in ln for ln in p['home_address_lines']))
        self.assertEqual(p['mode'], 'agency')                       # padrão

    def test_patch_saves_choice(self):
        custom = {'cep': '90000-000', 'street': 'Rua X', 'number': '9', 'city': 'Canoas', 'state': 'RS'}
        r = self.client.patch(self.url, {'addresses': {str(self.pax.id): {'mode': 'custom', 'custom': custom}}}, format='json')
        self.assertEqual(r.status_code, 200)
        p = self.client.get(self.url).json()['passengers'][0]
        self.assertEqual(p['mode'], 'custom')
        self.assertEqual(p['custom']['street'], 'Rua X')
        self.assertEqual(p['custom']['city'], 'Canoas')
        # mode inválido cai para 'agency'
        self.client.patch(self.url, {'addresses': {str(self.pax.id): {'mode': 'xxx'}}}, format='json')
        self.assertEqual(self.client.get(self.url).json()['passengers'][0]['mode'], 'agency')
