"""Testes do motor de precificação (itineraries/pricing.py).

Markup por DIVISÃO: venda = net / fator. Percentual 80 = fator 0,80 = decimal 0,80.
"""
from decimal import Decimal

from django.test import TestCase

from .models import Itinerary, ItineraryPricingConfig, ItineraryCostItem, ItineraryDeparture
from . import pricing


class PricingEngineTest(TestCase):
    def _scenario(self, margin_mode='percent', margin=Decimal('80')):
        it = Itinerary.objects.create(name='Cenário', base_currency='USD', has_voo=True)
        ItineraryPricingConfig.objects.create(itinerary=it, base_pax=15, free_pax=1,
                                              margin_mode=margin_mode, margin_percent=margin)
        cgh = ItineraryDeparture.objects.create(itinerary=it, expected_pax=10, order=0)
        cwb = ItineraryDeparture.objects.create(itinerary=it, expected_pax=5, order=1)
        mk = lambda **k: ItineraryCostItem.objects.create(itinerary=it, **k)
        mk(description='Guia', category='guia', cost_type='group', unit_value=3000)
        mk(description='Ônibus', category='terrestre', cost_type='group', unit_value=4500)
        mk(description='Hotel', category='Hospedagem', cost_type='per_person', unit_value=1000,
           tax_kind='percent', tax_value=12)   # 1000 × 1,12 = 1120
        mk(description='Seguro', category='seguro', cost_type='per_person', unit_value=100)
        mk(description='Passeios', category='passeios', cost_type='per_person', unit_value=250)
        mk(description='Aéreo CGH', category='aereo', cost_type='per_person', unit_value=800, flight_departure=cgh)
        mk(description='Aéreo CWB', category='aereo', cost_type='per_person', unit_value=950, flight_departure=cwb)
        return it, cgh, cwb

    def test_secao25_percentual(self):
        # comum = Guia200+Ônibus300+Hotel1120+Seguro100+Passeios250 = 1970
        # CGH = 1970+800 = 2770 / 0,80 = 3462,50 ; CWB = 2920 / 0,80 = 3650,00
        it, cgh, cwb = self._scenario('percent', Decimal('80'))
        res = pricing.compute(it)
        self.assertEqual(str(res['summary']['common_per_person']), '1970.00')
        rows = {r['departure_id']: r for r in res['table']}
        self.assertEqual(str(rows[cgh.id]['cost_per_person']), '2770.00')
        self.assertEqual(str(rows[cgh.id]['sale_price']), '3462.50')
        self.assertEqual(str(rows[cwb.id]['cost_per_person']), '2920.00')
        self.assertEqual(str(rows[cwb.id]['sale_price']), '3650.00')

    def test_decimal_igual_percentual(self):
        # fator decimal 0,80 dá o mesmo que percentual 80
        it, cgh, cwb = self._scenario('decimal', Decimal('0.80'))
        res = pricing.compute(it)
        r = next(x for x in res['table'] if x['departure_id'] == cgh.id)
        self.assertEqual(str(r['sale_price']), '3462.50')

    def test_hotel_por_quarto_ocupacao(self):
        it = Itinerary.objects.create(name='Hotel quarto', base_currency='USD')
        # fator 1,00 (100%) = sem markup: venda = net
        ItineraryPricingConfig.objects.create(itinerary=it, base_pax=2, margin_mode='percent', margin_percent=100)
        ItineraryCostItem.objects.create(itinerary=it, description='Hotel', category='hospedagem',
                                         cost_type='per_person', basis='per_room_night',
                                         unit_value=200, nights=5, occupancy=2)
        res = pricing.compute(it)
        self.assertEqual(str(res['summary']['common_per_person']), '500.00')
        self.assertEqual(str(res['table'][0]['sale_price']), '500.00')

    def test_navio_por_cabine(self):
        # roteiro marítimo: eixo da tabela = cabines. Cada cabine soma seu custo
        # ao custo comum. Fator 100% (sem markup): venda = net.
        from config_api.models import ConfigShipCabin
        it = Itinerary.objects.create(name='Cruzeiro', base_currency='USD', has_barco=True)
        ItineraryPricingConfig.objects.create(itinerary=it, base_pax=2, margin_mode='percent', margin_percent=100)
        interior, _ = ConfigShipCabin.objects.get_or_create(name='Interior Casal', defaults={'capacity': 2, 'is_couple': True})
        varanda, _ = ConfigShipCabin.objects.get_or_create(name='Varanda Casal', defaults={'capacity': 2, 'is_couple': True})
        mk = lambda **k: ItineraryCostItem.objects.create(itinerary=it, **k)
        mk(description='Seguro', category='seguro', cost_type='per_person', unit_value=100)          # comum
        mk(description='Cabine interior', category='Transporte marítimo', cost_type='per_person', unit_value=900, ship_cabin=interior)
        mk(description='Cabine varanda', category='Transporte marítimo', cost_type='per_person', unit_value=1500, ship_cabin=varanda)
        res = pricing.compute(it)
        rows = {r['accommodation']: r for r in res['table']}
        self.assertEqual(str(res['summary']['common_per_person']), '100.00')
        self.assertEqual(rows['Interior Casal']['accommodation_kind'], 'cabin')
        self.assertEqual(str(rows['Interior Casal']['cost_per_person']), '1000.00')   # 100 + 900
        self.assertEqual(str(rows['Varanda Casal']['sale_price']), '1600.00')          # 100 + 1500

    def test_grupo_rateia_por_pax_no_simulador(self):
        it, cgh, cwb = self._scenario('percent', Decimal('100'))
        sim = {s['pax']: s for s in pricing.simulate(it, [10, 15, 20])}
        self.assertGreater(sim[10]['cost_per_person'], sim[20]['cost_per_person'])

    def test_conversao_moeda(self):
        it = Itinerary.objects.create(name='Câmbio', base_currency='BRL')
        ItineraryPricingConfig.objects.create(itinerary=it, base_pax=1, margin_mode='percent', margin_percent=100)
        from .models import ItineraryCurrencyRate
        ItineraryCurrencyRate.objects.create(itinerary=it, currency='USD', rate=Decimal('5'))
        ItineraryCostItem.objects.create(itinerary=it, description='Item', category='outros',
                                         cost_type='per_person', currency='USD', unit_value=100)
        res = pricing.compute(it)   # 100 USD × 5 = 500 BRL
        self.assertEqual(str(res['summary']['common_per_person']), '500.00')

    def test_fator_zero_nao_quebra(self):
        it = Itinerary.objects.create(name='Fator zero', base_currency='USD')
        ItineraryPricingConfig.objects.create(itinerary=it, base_pax=1, margin_mode='percent', margin_percent=0)
        ItineraryCostItem.objects.create(itinerary=it, description='Item', category='outros',
                                         cost_type='per_person', unit_value=1000)
        res = pricing.compute(it)   # fator 0 → venda = net (sem divisão por zero)
        self.assertEqual(str(res['table'][0]['sale_price']), '1000.00')
