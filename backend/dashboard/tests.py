"""Dashboard escopado por agência: o usuário de agência vê só os números dele."""
from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from users_api.models import UserPermissions
from agencies.models import Agency, AgencyMember
from passengers.models import Passenger
from trips.models import PassengerList, ListEnrollment


def _mkuser(username, superuser=False, **perms):
    u = User.objects.create_user(username=username, email=f'{username}@x.com', password='pw12345678')
    if superuser:
        u.is_superuser = True; u.is_staff = True; u.save()
    p, _ = UserPermissions.objects.get_or_create(user=u)
    for k, v in perms.items():
        setattr(p, k, v)
    p.save()
    return u


class DashboardScopeTest(APITestCase):
    def setUp(self):
        self.agA = Agency.objects.create(name='A', person_type='juridica')
        self.agB = Agency.objects.create(name='B', person_type='juridica')
        # passageiros
        self.pA = Passenger.objects.create(full_name='PA', status='active'); self.pA.agencies.add(self.agA)
        self.pB = Passenger.objects.create(full_name='PB', status='active'); self.pB.agencies.add(self.agB)
        # listas + inscrições (uma por agência)
        self.lstA = PassengerList.objects.create(name='LA', status='aberta')
        self.lstB = PassengerList.objects.create(name='LB', status='aberta')
        ListEnrollment.objects.create(passenger_list=self.lstA, passenger=self.pA, agency=self.agA)
        ListEnrollment.objects.create(passenger_list=self.lstB, passenger=self.pB, agency=self.agB)
        # usuário de agência (membro de A, com os cards do dashboard)
        self.aguser = _mkuser('aguser', dashboard_view_passengers=True,
                              dashboard_view_lists=True, dashboard_view_enrollments=True)
        AgencyMember.objects.create(agency=self.agA, user=self.aguser)

    def test_agency_user_sees_only_own_numbers(self):
        self.client.force_authenticate(self.aguser)
        s = self.client.get('/api/dashboard/').data['stats']
        self.assertEqual(s['total_passengers'], 1)   # só pA
        self.assertEqual(s['open_lists'], 1)          # só lstA
        self.assertEqual(s['total_enrollments'], 1)   # só a inscrição da agência A

    def test_internal_user_sees_all(self):
        self.client.force_authenticate(_mkuser('root', superuser=True))
        s = self.client.get('/api/dashboard/').data['stats']
        self.assertEqual(s['total_passengers'], 2)
        self.assertEqual(s['open_lists'], 2)
        self.assertEqual(s['total_enrollments'], 2)
