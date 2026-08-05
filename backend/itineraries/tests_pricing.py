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

    def test_navio_desativado_some_dos_calculos_e_volta(self):
        # Barco desativado (has_barco=False): os custos de navio ficam GUARDADOS no
        # banco, mas somem dos cálculos (sem eixo de cabine). Reativar traz de volta.
        from config_api.models import ConfigShipCabin
        it = Itinerary.objects.create(name='Cruzeiro', base_currency='USD', has_barco=False)
        ItineraryPricingConfig.objects.create(itinerary=it, base_pax=2, margin_mode='percent', margin_percent=100)
        interior, _ = ConfigShipCabin.objects.get_or_create(name='Interior Casal', defaults={'capacity': 2, 'is_couple': True})
        mk = lambda **k: ItineraryCostItem.objects.create(itinerary=it, **k)
        mk(description='Seguro', category='seguro', cost_type='per_person', unit_value=100)          # comum
        mk(description='Cabine interior', category='Transporte marítimo', cost_type='per_person', unit_value=900, ship_cabin=interior)
        mk(description='Serviço de bordo', category='Transporte marítimo', cost_type='per_person', unit_value=50)  # navio sem cabine

        # Barco OFF: nenhuma cabine no eixo; nenhum custo de navio no comum.
        res = pricing.compute(it)
        self.assertFalse(any(r.get('accommodation_kind') == 'cabin' for r in res['table']))
        self.assertEqual(str(res['summary']['common_per_person']), '100.00')  # só o Seguro; navio fora
        self.assertFalse(any('marít' in (i['category'] or '').lower() for i in res['items']))

        # Reativar o barco: os cálculos de navio voltam como estavam (nada foi apagado).
        it.has_barco = True
        it.save(update_fields=['has_barco'])
        self.assertEqual(ItineraryCostItem.objects.filter(itinerary=it).count(), 3)  # itens preservados
        res2 = pricing.compute(it)
        rows = {r['accommodation']: r for r in res2['table']}
        self.assertIn('Interior Casal', rows)
        self.assertEqual(rows['Interior Casal']['accommodation_kind'], 'cabin')
        # comum agora = Seguro 100 + Serviço de bordo 50 = 150; cabine soma +900
        self.assertEqual(str(res2['summary']['common_per_person']), '150.00')
        self.assertEqual(str(rows['Interior Casal']['cost_per_person']), '1050.00')

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

    def test_cambio_manual_do_item_tem_prioridade(self):
        # base USD; item em BRL com câmbio manual (1 BRL = 0,20 USD). 500 BRL × 0,20 = 100 USD.
        it = Itinerary.objects.create(name='Câmbio manual', base_currency='USD')
        ItineraryPricingConfig.objects.create(itinerary=it, base_pax=1, margin_mode='percent', margin_percent=100)
        from .models import ItineraryCurrencyRate
        # cotação travada do roteiro (deve ser IGNORADA quando há câmbio no item)
        ItineraryCurrencyRate.objects.create(itinerary=it, currency='BRL', rate=Decimal('0.99'))
        ItineraryCostItem.objects.create(itinerary=it, description='Item BRL', category='outros',
                                         cost_type='per_person', currency='BRL', unit_value=500,
                                         exchange_rate=Decimal('0.20'))
        res = pricing.compute(it)
        self.assertEqual(str(res['summary']['common_per_person']), '100.00')

    def test_custo_por_capacidade_aplica_a_todas_daquela_capacidade(self):
        # Duplo Casal e Duplo Twin (cap. 2) recebem o mesmo custo lançado por capacidade;
        # Single (cap. 1) não recebe. Eixo vem das accommodation_lines.
        from config_api.models import ConfigAccommodation
        from .models import ItineraryAccommodationLine
        it = Itinerary.objects.create(name='Cap', base_currency='USD')
        ItineraryPricingConfig.objects.create(itinerary=it, base_pax=1, margin_mode='percent', margin_percent=100)
        casal, _ = ConfigAccommodation.objects.get_or_create(name='Duplo Casal', defaults={'capacity': 2})
        twin, _ = ConfigAccommodation.objects.get_or_create(name='Duplo Twin', defaults={'capacity': 2})
        single, _ = ConfigAccommodation.objects.get_or_create(name='Single', defaults={'capacity': 1})
        for a in (casal, twin, single):
            ItineraryAccommodationLine.objects.create(itinerary=it, accommodation_type=a)
        # custo por pessoa lançado para capacidade 2 (todos os duplos)
        ItineraryCostItem.objects.create(itinerary=it, description='Hotel duplo', category='Hospedagem',
                                         cost_type='per_person', accommodation_capacity=2, unit_value=1000)
        res = pricing.compute(it)
        rows = {r['accommodation']: r for r in res['table']}
        self.assertEqual(str(rows['Duplo Casal']['cost_per_person']), '1000.00')
        self.assertEqual(str(rows['Duplo Twin']['cost_per_person']), '1000.00')
        self.assertEqual(str(rows['Single']['cost_per_person']), '0.00')

    def test_fator_zero_nao_quebra(self):
        it = Itinerary.objects.create(name='Fator zero', base_currency='USD')
        ItineraryPricingConfig.objects.create(itinerary=it, base_pax=1, margin_mode='percent', margin_percent=0)
        ItineraryCostItem.objects.create(itinerary=it, description='Item', category='outros',
                                         cost_type='per_person', unit_value=1000)
        res = pricing.compute(it)   # fator 0 → venda = net (sem divisão por zero)
        self.assertEqual(str(res['table'][0]['sale_price']), '1000.00')


class PaymentScheduleValidationTest(TestCase):
    """Cronograma de pagamento do custo: whitelist (data/percentual/nota), faixa 0..100."""
    def _val(self, sched):
        from itineraries.serializers import ItineraryCostItemSerializer
        return ItineraryCostItemSerializer().validate_payment_schedule(sched)

    def test_clean_keeps_only_allowed_keys_and_rounds(self):
        out = self._val([{'due_date': '2027-11-30', 'percent': 30.5, 'note': 'sinal', 'evil': 'x'}])
        self.assertEqual(out, [{'due_date': '2027-11-30', 'percent': 30.5, 'note': 'sinal'}])

    def test_empty_and_none(self):
        self.assertEqual(self._val([]), [])
        self.assertEqual(self._val(None), [])

    def test_rejects_out_of_range_percent(self):
        from rest_framework import serializers as drf
        with self.assertRaises(drf.ValidationError):
            self._val([{'due_date': '2027-01-01', 'percent': 150}])
        with self.assertRaises(drf.ValidationError):
            self._val([{'due_date': '2027-01-01', 'percent': -5}])

    def test_rejects_bad_date(self):
        from rest_framework import serializers as drf
        with self.assertRaises(drf.ValidationError):
            self._val([{'due_date': '31/11/2027', 'percent': 10}])

    def test_allows_empty_date(self):
        out = self._val([{'due_date': '', 'percent': 100}])
        self.assertEqual(out, [{'due_date': '', 'percent': 100.0, 'note': ''}])


class RoadCostTest(TestCase):
    """Custo RODOVIÁRIO (o ônibus). O eixo é marcado pela categoria 'Rodoviário'
    (mesma convenção do aéreo/marítimo); sendo custo do GRUPO, o valor cheio é
    rateado pela quantidade-base."""

    def test_onibus_rateado_pela_base(self):
        it = Itinerary.objects.create(name='Roteiro rodoviário', base_currency='BRL', has_terrestre=True)
        # fator 1,00 (100%) = sem markup: venda = net
        ItineraryPricingConfig.objects.create(itinerary=it, base_pax=20, margin_mode='percent', margin_percent=100)
        ItineraryCostItem.objects.create(itinerary=it, description='Fretamento do ônibus',
                                         category='Rodoviário', cost_type='group',
                                         unit_value=8000, quantity=1, rateio_rule='base')
        res = pricing.compute(it)
        # 8000 ÷ 20 = 400 por pessoa
        self.assertEqual(str(res['summary']['common_per_person']), '400.00')
        self.assertEqual(str(res['table'][0]['sale_price']), '400.00')
