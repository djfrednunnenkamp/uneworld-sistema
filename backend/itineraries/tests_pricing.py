"""Testes do motor de precificação (itineraries/pricing.py)."""
from decimal import Decimal

from django.test import TestCase

from .models import Itinerary, ItineraryPricingConfig, ItineraryCostItem, ItineraryDeparture
from . import pricing


class PricingEngineTest(TestCase):
    def _scenario(self, margin_mode='margin', margin=Decimal('20')):
        it = Itinerary.objects.create(name='Cenário', base_currency='USD', has_voo=True)
        ItineraryPricingConfig.objects.create(itinerary=it, base_pax=15, free_pax=1,
                                              margin_mode=margin_mode, margin_percent=margin)
        cgh = ItineraryDeparture.objects.create(itinerary=it, expected_pax=10, order=0)
        cwb = ItineraryDeparture.objects.create(itinerary=it, expected_pax=5, order=1)
        mk = lambda **k: ItineraryCostItem.objects.create(itinerary=it, **k)
        mk(description='Guia', category='guia', cost_type='group', unit_value=3000)
        mk(description='Ônibus', category='terrestre', cost_type='group', unit_value=4500)
        mk(description='Hotel', category='hospedagem', cost_type='per_person', unit_value=1000,
           tax_percent=12, iof_percent=4, iof_base='with_fees')
        mk(description='Seguro', category='seguro', cost_type='per_person', unit_value=100)
        mk(description='Passeios', category='passeios', cost_type='per_person', unit_value=250)
        mk(description='Aéreo CGH', category='aereo', cost_type='per_person', unit_value=800, flight_departure=cgh)
        mk(description='Aéreo CWB', category='aereo', cost_type='per_person', unit_value=950, flight_departure=cwb)
        return it, cgh, cwb

    def test_secao25_margem(self):
        it, cgh, cwb = self._scenario('margin', Decimal('20'))
        res = pricing.compute(it)
        self.assertEqual(str(res['summary']['common_per_person']), '2014.80')
        rows = {r['departure_id']: r for r in res['table']}
        self.assertEqual(str(rows[cgh.id]['cost_per_person']), '2814.80')
        self.assertEqual(str(rows[cgh.id]['sale_price']), '3518.50')
        self.assertEqual(str(rows[cwb.id]['cost_per_person']), '2964.80')
        self.assertEqual(str(rows[cwb.id]['sale_price']), '3706.00')

    def test_markup(self):
        it, cgh, cwb = self._scenario('markup', Decimal('20'))
        res = pricing.compute(it)
        r = next(x for x in res['table'] if x['departure_id'] == cgh.id)
        self.assertEqual(str(r['sale_price']), '3377.76')   # 2814.80 × 1.2

    def test_hotel_por_quarto_ocupacao(self):
        it = Itinerary.objects.create(name='Hotel quarto', base_currency='USD')
        ItineraryPricingConfig.objects.create(itinerary=it, base_pax=2, margin_mode='markup', margin_percent=0)
        # Quarto duplo USD 200/noite × 5 noites = 1000; ocupação 2 → 500/pax
        ItineraryCostItem.objects.create(itinerary=it, description='Hotel', category='hospedagem',
                                         cost_type='per_person', basis='per_room_night',
                                         unit_value=200, nights=5, occupancy=2)
        res = pricing.compute(it)
        self.assertEqual(str(res['summary']['common_per_person']), '500.00')

    def test_grupo_rateia_por_pax_no_simulador(self):
        it, cgh, cwb = self._scenario('markup', Decimal('0'))
        sim = {s['pax']: s for s in pricing.simulate(it, [10, 15, 20])}
        # custo de grupo (guia+ônibus = 7500) cai por pax: 750, 500, 375
        self.assertGreater(sim[10]['cost_per_person'], sim[20]['cost_per_person'])

    def test_conversao_moeda(self):
        it = Itinerary.objects.create(name='Câmbio', base_currency='BRL')
        ItineraryPricingConfig.objects.create(itinerary=it, base_pax=1, margin_mode='markup', margin_percent=0)
        from .models import ItineraryCurrencyRate
        ItineraryCurrencyRate.objects.create(itinerary=it, currency='USD', rate=Decimal('5'))
        ItineraryCostItem.objects.create(itinerary=it, description='Item', category='outros',
                                         cost_type='per_person', currency='USD', unit_value=100)
        res = pricing.compute(it)   # 100 USD × 5 = 500 BRL
        self.assertEqual(str(res['summary']['common_per_person']), '500.00')

    def test_divisor_zero_nao_quebra(self):
        it = Itinerary.objects.create(name='Div zero', base_currency='USD')
        ItineraryPricingConfig.objects.create(itinerary=it, base_pax=0, margin_mode='markup', margin_percent=0)
        ItineraryCostItem.objects.create(itinerary=it, description='Grupo', category='guia',
                                         cost_type='group', unit_value=1000)
        res = pricing.compute(it)   # não pode levantar / dar NaN
        self.assertIsNotNone(res['summary']['common_per_person'])
