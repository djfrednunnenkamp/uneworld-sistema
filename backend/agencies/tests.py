"""A-13 — serializers com lista explícita de campos e auditoria/soft-delete só
leitura. Alterar is_deleted/created_at direto pelo payload deve ser ignorado.
A-08 — cadastro de membro de agência não anexa conta privilegiada por user_id."""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APITestCase

from agencies.models import Agency
from agencies.serializers import AgencySerializer
from trips.models import Destination, Trip
from trips.serializers import TripSerializer
from users_api.models import UserPermissions


def _make_user(username, superuser=False, staff=False, **perms):
    u = User.objects.create_user(username=username, email=f'{username}@x.com', password='pw12345678')
    if superuser:
        u.is_superuser = True; u.is_staff = True; u.save()
    elif staff:
        u.is_staff = True; u.save()
    p, _ = UserPermissions.objects.get_or_create(user=u)
    for k, v in perms.items():
        setattr(p, k, v)
    p.save()
    return u


class AgencyMemberAddTest(APITestCase):
    """A-08 — quem tem só agencies_edit não pode anexar conta staff/superuser."""
    def setUp(self):
        self.agency = Agency.objects.create(name='Ag', person_type='juridica')
        self.editor = _make_user('editor', agencies_edit=True)
        self.regular = _make_user('regular')
        self.privileged = _make_user('adminacct', staff=True)

    def _post(self, target):
        return self.client.post(f'/api/agencies/{self.agency.id}/members/',
                                {'user_id': target.id, 'role': 'operator'}, format='json')

    def test_editor_cannot_attach_staff_account(self):
        self.client.force_authenticate(self.editor)
        self.assertEqual(self._post(self.privileged).status_code, 403)
        self.assertFalse(self.agency.members.filter(user=self.privileged).exists())

    def test_editor_can_attach_regular_user(self):
        self.client.force_authenticate(self.editor)
        self.assertEqual(self._post(self.regular).status_code, 201)

    def test_superuser_can_attach_staff_account(self):
        self.client.force_authenticate(_make_user('root', superuser=True))
        self.assertEqual(self._post(self.privileged).status_code, 201)


class SerializerReadOnlyFieldsTest(TestCase):
    def test_agency_no_wildcard_and_audit_read_only(self):
        # Não usa '__all__'.
        self.assertNotEqual(AgencySerializer.Meta.fields, '__all__')
        self.assertIn('is_deleted', AgencySerializer.Meta.read_only_fields)

        a = Agency.objects.create(name='Ag', person_type='juridica')
        ser = AgencySerializer(a, data={'name': 'Novo', 'is_deleted': True}, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        a.refresh_from_db()
        self.assertEqual(a.name, 'Novo')       # campo editável mudou
        self.assertFalse(a.is_deleted)          # campo read_only foi ignorado

    def test_trip_created_at_read_only(self):
        self.assertNotEqual(TripSerializer.Meta.fields, '__all__')
        dest = Destination.objects.create(name='Paris', country='França')
        trip = Trip.objects.create(
            title='T1', destination=dest, departure_date='2027-01-01',
            return_date='2027-01-10', price_per_person='1000.00', max_passengers=30)
        original = trip.created_at
        ser = TripSerializer(trip, data={'created_at': '2000-01-01T00:00:00Z'}, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        trip.refresh_from_db()
        self.assertEqual(trip.created_at, original)  # read_only: não muda


class AttachAppliesAgencyProfileTest(APITestCase):
    """Anexar usuário existente com apply_agency_profile assume o perfil padrão de agência."""
    def setUp(self):
        self.agency = Agency.objects.create(name='Ag', person_type='juridica')
        self.editor = _make_user('editor2', agencies_edit=True)
        self.target = _make_user('target2')   # usuário comum, sem permissões
        from config_api.models import PermissionProfile
        PermissionProfile.objects.create(name='Agência', is_agency_default=True,
                                         permissions={'passengers_view_basic': True})

    def test_apply_agency_profile_on_attach(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post(f'/api/agencies/{self.agency.id}/members/',
                             {'user_id': self.target.id, 'role': 'operator', 'apply_agency_profile': True}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.target.permissions.refresh_from_db()
        self.assertTrue(self.target.permissions.passengers_view_basic)   # assumiu o perfil de agência
