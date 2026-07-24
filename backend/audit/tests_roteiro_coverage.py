"""Cobertura de auditoria dos recursos do roteiro (aba Valores + tipos por roteiro).

Antes destas mudanças, mexer em custos, disponibilidade, câmbio travado, cabines e
classes de voo do roteiro NÃO gerava log nenhum — justamente os recursos de API
imediata que alimentam "Alterações pendentes". Agora eles são rastreados por signal,
aparecem no log do roteiro, a config de preço registra diff campo-a-campo, o ZIP da
galeria deixa rastro e uma falha de auditoria nunca derruba a operação real.
"""
from decimal import Decimal
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APITestCase

from users_api.models import UserPermissions
from audit.models import AuditLog
from itineraries.models import (
    Itinerary, ItineraryPricingConfig, ItineraryCostItem,
    ItineraryInventoryBlock, ItineraryCurrencyRate,
)
from config_api.models import ConfigShipCabin, ConfigFlightClass


def make_user(username, superuser=False, **perms):
    u = User.objects.create_user(username=username, email=f'{username}@x.com', password='pw12345678')
    if superuser:
        u.is_superuser = True
        u.is_staff = True
        u.save()
    p, _ = UserPermissions.objects.get_or_create(user=u)
    for k, v in perms.items():
        setattr(p, k, v)
    p.save()
    return u


def _logs(model_name, action=None, object_id=None):
    qs = AuditLog.objects.filter(model_name=model_name)
    if action:
        qs = qs.filter(action=action)
    if object_id is not None:
        qs = qs.filter(object_id=str(object_id))
    return qs


class SignalCoverageTest(TestCase):
    """Cada mutação nos recursos antes silenciosos gera um AuditLog pelo signal."""

    def setUp(self):
        self.it = Itinerary.objects.create(name='Cobertura', base_currency='USD')

    # ── Custos ────────────────────────────────────────────────────────────────
    def test_cost_item_create_update_delete(self):
        c = ItineraryCostItem.objects.create(itinerary=self.it, description='Guia',
                                             category='guia', cost_type='group', unit_value=1000)
        self.assertTrue(_logs('ItineraryCostItem', 'create', c.id).exists())

        c.unit_value = Decimal('1500')
        c.save()
        upd = _logs('ItineraryCostItem', 'update', c.id).first()
        self.assertIsNotNone(upd)
        # O diff carrega antes/depois — não é um marcador genérico.
        self.assertTrue(any(isinstance(v, dict) and 'antes' in v for v in upd.changes.values()),
                        msg=f'update sem diff: {upd.changes}')

        cid = c.id
        c.delete()
        self.assertTrue(_logs('ItineraryCostItem', 'delete', cid).exists())

    # ── Disponibilidade ───────────────────────────────────────────────────────
    def test_inventory_block_create_delete(self):
        b = ItineraryInventoryBlock.objects.create(itinerary=self.it, kind='aereo', quantity=10)
        self.assertTrue(_logs('ItineraryInventoryBlock', 'create', b.id).exists())
        bid = b.id
        b.delete()
        self.assertTrue(_logs('ItineraryInventoryBlock', 'delete', bid).exists())

    # ── Câmbio travado ────────────────────────────────────────────────────────
    def test_currency_rate_create(self):
        r = ItineraryCurrencyRate.objects.create(itinerary=self.it, currency='EUR', rate=Decimal('6.1'))
        self.assertTrue(_logs('ItineraryCurrencyRate', 'create', r.id).exists())

    # ── Cabines e classes por roteiro ─────────────────────────────────────────
    def test_ship_cabin_scoped_create(self):
        cab = ConfigShipCabin.objects.create(itinerary=self.it, name='Janela · Duplo', capacity=2)
        self.assertTrue(_logs('ConfigShipCabin', 'create', cab.id).exists())

    def test_flight_class_scoped_create(self):
        fc = ConfigFlightClass.objects.create(itinerary=self.it, name='Executiva')
        self.assertTrue(_logs('ConfigFlightClass', 'create', fc.id).exists())

    def test_global_cabin_also_audited(self):
        # Cabine do CATÁLOGO (itinerary=None) também é config auditável.
        cab = ConfigShipCabin.objects.create(name='Interna · Single', capacity=1)
        self.assertTrue(_logs('ConfigShipCabin', 'create', cab.id).exists())


class NewlyTrackedModelsTest(TestCase):
    """Modelos de negócio que estavam FORA da whitelist agora geram log (P2)."""

    def test_config_cost_category_tracked(self):
        from config_api.models import ConfigCostCategory
        c = ConfigCostCategory.objects.create(name='ZZ_Cat_Auditoria')
        self.assertTrue(_logs('ConfigCostCategory', 'create', c.id).exists())
        c.name = 'ZZ_Cat_Auditoria_2'
        c.save()
        self.assertTrue(_logs('ConfigCostCategory', 'update', c.id).exists())

    def test_config_flight_segment_tracked(self):
        from config_api.models import ConfigFlightSegment
        s = ConfigFlightSegment.objects.create(name='ZZ_Seg_Auditoria')
        self.assertTrue(_logs('ConfigFlightSegment', 'create', s.id).exists())

    def test_voucher_template_tracked(self):
        from vouchers.models import VoucherTemplate
        t = VoucherTemplate.objects.create(name='Padrão')
        self.assertTrue(_logs('VoucherTemplate', 'create', t.id).exists())


class AuditSafetyTest(TestCase):
    """Uma falha ao gravar o log NUNCA pode derrubar a operação real do usuário."""

    def test_log_failure_does_not_break_save(self):
        it = Itinerary.objects.create(name='Resiliente', base_currency='USD')
        # AuditLog.create explode; o savepoint isolado engole o erro.
        with mock.patch('audit.models.AuditLog.objects.create', side_effect=RuntimeError('boom')):
            c = ItineraryCostItem.objects.create(itinerary=it, description='X',
                                                 category='g', cost_type='group', unit_value=1)
        # O custo persistiu apesar da auditoria ter falhado.
        self.assertTrue(ItineraryCostItem.objects.filter(pk=c.pk).exists())


class PricingConfigDiffTest(APITestCase):
    """PATCH da config de preço registra diff campo-a-campo, não marcador genérico."""

    def setUp(self):
        self.user = make_user('root', superuser=True)
        self.client.force_authenticate(self.user)
        self.it = Itinerary.objects.create(name='Preço', base_currency='USD')
        ItineraryPricingConfig.objects.create(itinerary=self.it, base_pax=15, margin_percent=Decimal('80'))

    def _patch(self, data):
        return self.client.patch(f'/api/itineraries/{self.it.id}/pricing-config/', data, format='json')

    def test_patch_records_field_diff(self):
        r = self._patch({'margin_percent': '75'})
        self.assertEqual(r.status_code, 200)
        log = _logs('Itinerary', 'update', self.it.id).order_by('-id').first()
        self.assertIsNotNone(log)
        self.assertIn('Margem (%)', log.changes)
        self.assertEqual(Decimal(str(log.changes['Margem (%)']['antes'])), Decimal('80'))
        self.assertEqual(Decimal(str(log.changes['Margem (%)']['depois'])), Decimal('75'))

    def test_patch_without_real_change_no_log(self):
        before = _logs('Itinerary', 'update', self.it.id).count()
        r = self._patch({'margin_percent': '80'})   # mesmo valor
        self.assertEqual(r.status_code, 200)
        self.assertEqual(_logs('Itinerary', 'update', self.it.id).count(), before)


class RoteiroLogQueryTest(APITestCase):
    """Os novos recursos aparecem no log filtrado por roteiro (child-lookup)."""

    def setUp(self):
        self.user = make_user('root2', superuser=True)
        self.client.force_authenticate(self.user)
        self.it = Itinerary.objects.create(name='Log', base_currency='USD')

    def test_cost_item_shows_in_route_log(self):
        c = ItineraryCostItem.objects.create(itinerary=self.it, description='Hotel',
                                             category='hosp', cost_type='per_person', unit_value=500)
        r = self.client.get(f'/api/audit/logs/?itinerary_id={self.it.id}')
        self.assertEqual(r.status_code, 200)
        rows = r.json().get('results', r.json())
        found = [x for x in rows if x.get('model_name') == 'ItineraryCostItem'
                 and str(x.get('object_id')) == str(c.id)]
        self.assertTrue(found, msg='item de custo não apareceu no log do roteiro')


class GalleryDownloadAuditTest(APITestCase):
    """O ZIP da galeria deixa rastro (quem baixou, quantos arquivos)."""

    def setUp(self):
        self.user = make_user('root3', superuser=True)
        self.client.force_authenticate(self.user)

    def test_download_logs_event(self):
        before = _logs('ItineraryImage', 'download').count()
        r = self.client.get('/api/itineraries/gallery/download/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(_logs('ItineraryImage', 'download').count(), before + 1)
