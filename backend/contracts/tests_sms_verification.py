"""Verificação por SMS ao assinar (2FA na Autentique) + canal de entrega.

- build_signer monta o `security_verifications: [{type: SMS, verify_phone}]` no
  formato documentado da Autentique quando o toggle da operadora está ligado.
- O canal de entrega (email/whatsapp/sms) por contrato sobrepõe o global.
- O toggle `sms_verification` da operadora persiste via /config/operating-company/.
"""
from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APITestCase

from contracts import autentique
from contracts.serializers import passenger_phone
from config_api.models import OperatingCompany
from passengers.models import Passenger


class BuildSignerTest(SimpleTestCase):
    def test_email_default(self):
        self.assertEqual(autentique.build_signer(email='a@b.com', phone='11988887777'),
                         {'action': 'SIGN', 'email': 'a@b.com'})

    def test_whatsapp_channel(self):
        s = autentique.build_signer(email='a@b.com', phone='11988887777', method='whatsapp')
        self.assertEqual(s['delivery_method'], 'DELIVERY_METHOD_WHATSAPP')
        self.assertEqual(s['phone'], '+5511988887777')
        self.assertNotIn('email', s)

    def test_sms_channel(self):
        s = autentique.build_signer(email='', phone='11988887777', method='sms')
        self.assertEqual(s['delivery_method'], 'DELIVERY_METHOD_SMS')

    def test_sms_verification_adds_security(self):
        s = autentique.build_signer(email='a@b.com', phone='11988887777', sms_verification=True)
        self.assertEqual(s['security_verifications'], [{'type': 'SMS', 'verify_phone': '+5511988887777'}])

    def test_sms_verification_without_phone_leaves_number_blank(self):
        s = autentique.build_signer(email='a@b.com', phone='', sms_verification=True)
        self.assertEqual(s['security_verifications'], [{'type': 'SMS'}])

    def test_sms_verification_omits_invalid_mobile(self):
        # Fixo/número inválido NÃO pré-preenche verify_phone (senão a Autentique
        # rejeita com must_be_a_valid_phone_number) — o signatário informa na hora.
        s = autentique.build_signer(email='a@b.com', phone='(51) 3511-0666', method='email', sms_verification=True)
        self.assertEqual(s['security_verifications'], [{'type': 'SMS'}])
        s2 = autentique.build_signer(email='a@b.com', phone='51 99931-1574', method='email', sms_verification=True)
        self.assertEqual(s2['security_verifications'], [{'type': 'SMS', 'verify_phone': '+5551999311574'}])

    def test_sms_verification_off_has_no_security(self):
        s = autentique.build_signer(email='a@b.com', phone='11988887777', sms_verification=False)
        self.assertNotIn('security_verifications', s)


class PassengerPhoneTest(TestCase):
    """Telefone de contato = "Telefone" principal (phone1), não o Celular (mobile).
    Antes lia só `mobile` → "Sem telefone" mesmo com o Telefone preenchido."""

    def test_prefers_phone1(self):
        p = Passenger.objects.create(first_name='Fred', last_name='N',
                                     phone1='+55 (51) 99931-1574', mobile='')
        self.assertEqual(passenger_phone(p), '+55 (51) 99931-1574')

    def test_falls_back_to_mobile_then_phone2(self):
        p = Passenger.objects.create(first_name='X', last_name='Y', phone1='', mobile='11988887777')
        self.assertEqual(passenger_phone(p), '11988887777')
        p2 = Passenger.objects.create(first_name='Z', last_name='W', phone1='', mobile='', phone2='4133332222')
        self.assertEqual(passenger_phone(p2), '4133332222')

    def test_empty_when_no_phone(self):
        p = Passenger.objects.create(first_name='A', last_name='B', phone1='', mobile='', phone2='')
        self.assertEqual(passenger_phone(p), '')


class OperatorSmsToggleTest(APITestCase):
    def setUp(self):
        u = User.objects.create_user('root', 'root@x.com', 'pw12345678')
        u.is_superuser = True; u.is_staff = True; u.save()
        self.client.force_authenticate(u)

    def test_toggle_persists(self):
        r = self.client.patch('/api/config/operating-company/', {'sms_verification': True}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['sms_verification'])
        self.assertTrue(OperatingCompany.get().sms_verification)
        # desliga de volta
        r = self.client.patch('/api/config/operating-company/', {'sms_verification': False}, format='json')
        self.assertFalse(OperatingCompany.get().sms_verification)
