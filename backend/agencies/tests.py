"""A-13 — serializers com lista explícita de campos e auditoria/soft-delete só
leitura. Alterar is_deleted/created_at direto pelo payload deve ser ignorado."""
from django.test import TestCase

from agencies.models import Agency
from agencies.serializers import AgencySerializer
from trips.models import Destination, Trip
from trips.serializers import TripSerializer


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
