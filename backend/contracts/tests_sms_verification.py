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
from users_api.models import UserPermissions


def make_user(username, superuser=False, **perms):
    u = User.objects.create_user(username=username, email=f'{username}@x.com', password='pw12345678')
    if superuser:
        u.is_superuser = True; u.is_staff = True; u.save()
    p, _ = UserPermissions.objects.get_or_create(user=u)
    for k, v in perms.items():
        setattr(p, k, v)
    p.save()
    return u


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


class AgencyAutoSignTest(TestCase):
    """Assinatura automática da agência: o signatário usa o e-mail da conta
    Autentique (pro token bater) e não leva 2FA por SMS."""

    class _FakeContract:
        contratante_id = None
        payer_email = 'cliente@x.com'
        payer_phone = ''
        payer_name = 'Cliente'
        def __init__(self, agency):
            self.agency = agency

    def test_auto_sign_enabled_property(self):
        from agencies.models import Agency
        full = dict(auto_sign_allowed=True, auto_sign=True, autentique_email='ag@aut.com', autentique_token='tok')
        self.assertTrue(Agency(**full).auto_sign_enabled)
        self.assertFalse(Agency(**{**full, 'auto_sign_allowed': False}).auto_sign_enabled)   # operadora não liberou
        self.assertFalse(Agency(**{**full, 'auto_sign': False}).auto_sign_enabled)           # agência não ativou
        self.assertFalse(Agency(**{**full, 'autentique_email': ''}).auto_sign_enabled)       # sem e-mail
        self.assertFalse(Agency(**{**full, 'autentique_token': ''}).auto_sign_enabled)       # sem token

    def test_signer_uses_autentique_email_and_skips_2fa(self):
        from agencies.models import Agency
        from contracts.views import _contract_signers
        ag = Agency.objects.create(name='Ag X', email='contato@ag.com', person_type='juridica',
                                   auto_sign_allowed=True, auto_sign=True,
                                   autentique_email='conta@autentique.com', autentique_token='tok')
        signers, missing, metas = _contract_signers(self._FakeContract(ag), method='email', sms_verification=True)
        agency_signer = signers[1]   # 0 = cliente, 1 = agência
        self.assertEqual(agency_signer['email'], 'conta@autentique.com')   # e-mail da conta Autentique, não o de contato
        self.assertNotIn('security_verifications', agency_signer)          # auto-assina → sem 2FA
        self.assertEqual(metas[1]['contact'], 'conta@autentique.com')

    def test_signer_uses_contact_email_when_auto_off(self):
        from agencies.models import Agency
        from contracts.views import _contract_signers
        ag = Agency.objects.create(name='Ag Y', email='contato@ag.com', person_type='juridica', auto_sign=False)
        signers, _m, _meta = _contract_signers(self._FakeContract(ag), method='email')
        self.assertEqual(signers[1]['email'], 'contato@ag.com')

    def test_apply_state_ignores_non_sign_creator(self):
        # A Autentique inclui a CONTA CRIADORA como participante action=None. Ela
        # NÃO pode entrar como signatário (senão empurra os metas uma posição e a
        # agência que já assinou aparece como "aguardando").
        from contracts.views import _apply_autentique_state
        class _C:
            autentique_data = None; stage = 'enviado'; reservation_number = 'x'; id = 1
            def save(self, **k): pass
        doc = {'id': 'd', 'signatures': [
            {'public_id': 'creator', 'email': 'api@x.com', 'action': {'name': None}},          # criadora → ignora
            {'public_id': 'p0', 'email': None, 'action': {'name': 'SIGN'}},                     # cliente (whatsapp)
            {'public_id': 'p1', 'email': 'ag@x.com', 'action': {'name': 'SIGN'}, 'signed': {'created_at': 'y'}},   # agência assinou
            {'public_id': 'p2', 'email': 'ceo@x.com', 'action': {'name': 'SIGN'}, 'signed': {'created_at': 'y'}},  # CEO assinou
        ]}
        metas = [{'role': 'Cliente', 'name': 'Cli', 'channel': 'whatsapp', 'contact': '+5551'},
                 {'role': 'Agência', 'name': 'Ag', 'channel': 'email', 'contact': 'ag@x.com'},
                 {'role': 'Operadora (CEO)', 'name': 'CEO', 'channel': 'email', 'contact': 'ceo@x.com'}]
        c = _C(); _apply_autentique_state(c, doc, save=False, metas=metas)
        s = c.autentique_data['signers']
        self.assertEqual(len(s), 3)                                   # sem a criadora
        self.assertEqual(s[0]['role'], 'Cliente'); self.assertFalse(s[0]['signed'])
        self.assertEqual(s[1]['role'], 'Agência'); self.assertTrue(s[1]['signed'])   # agência alinhada e assinada
        self.assertEqual(s[2]['role'], 'Operadora (CEO)'); self.assertTrue(s[2]['signed'])


class AgencyAutentiqueConfigEndpointTest(APITestCase):
    """Endpoint autentique-config: só admin da agência/operadora; token write-only;
    exige que a operadora tenha permitido (auto_sign_allowed)."""

    def setUp(self):
        from agencies.models import Agency
        # auto_sign_allowed=False explícito (o default do model virou True) — o
        # teste "blocked_when_not_allowed" depende de a operadora NÃO ter liberado.
        self.ag = Agency.objects.create(name='Ag', person_type='juridica', email='c@ag.com', auto_sign_allowed=False)
        self.op = make_user('op', superuser=True)   # operadora
        self.nobody = make_user('ze')                # sem vínculo/permite

    def _url(self):
        return f'/api/agencies/{self.ag.id}/autentique-config/'

    def test_blocked_when_not_allowed(self):
        self.client.force_authenticate(self.op)
        r = self.client.patch(self._url(), {'auto_sign': True, 'autentique_email': 'x@y.com', 'autentique_token': 'tok'}, format='json')
        self.assertEqual(r.status_code, 400)   # operadora ainda não liberou

    def test_operator_configures_after_allowed_and_token_is_write_only(self):
        self.ag.auto_sign_allowed = True; self.ag.save()
        self.client.force_authenticate(self.op)
        r = self.client.patch(self._url(), {'auto_sign': True, 'autentique_email': 'conta@aut.com', 'autentique_token': 'segredo'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['has_autentique_token'])
        self.assertNotIn('autentique_token', r.json())   # segredo nunca volta
        self.ag.refresh_from_db()
        self.assertEqual(self.ag.autentique_token, 'segredo')
        self.assertTrue(self.ag.auto_sign_enabled)
        # Token em branco NÃO apaga o atual:
        r2 = self.client.patch(self._url(), {'autentique_email': 'nova@aut.com', 'autentique_token': ''}, format='json')
        self.ag.refresh_from_db()
        self.assertEqual(self.ag.autentique_token, 'segredo')
        self.assertEqual(self.ag.autentique_email, 'nova@aut.com')

    def test_forbidden_for_unrelated_user(self):
        self.ag.auto_sign_allowed = True; self.ag.save()
        self.client.force_authenticate(self.nobody)
        r = self.client.patch(self._url(), {'auto_sign': True}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_agency_admin_can_configure(self):
        from agencies.models import Agency, AgencyMember
        self.ag.auto_sign_allowed = True; self.ag.save()
        admin = make_user('adm-ag')
        AgencyMember.objects.create(agency=self.ag, user=admin, role='admin')
        self.client.force_authenticate(admin)
        r = self.client.patch(self._url(), {'auto_sign': True, 'autentique_email': 'a@a.com', 'autentique_token': 'tk'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.ag.refresh_from_db()
        self.assertEqual(self.ag.autentique_token, 'tk')


class ContractDocumentNameTest(TestCase):
    """Nome do documento na Autentique = roteiro + pagante + reserva."""

    def test_name_with_all_parts(self):
        from contracts.views import _contract_document_name
        class _It: name = 'PRIMAVERA NA EUROPA'
        class _C:
            itinerary_id = 1; itinerary = _It(); package_name = ''
            contratante_id = None; payer_name = 'Frederico N'
            reservation_number = '000185'; id = 9
        self.assertEqual(_contract_document_name(_C()),
                         'Contrato de viagem – PRIMAVERA NA EUROPA – Frederico N – Reserva 000185')

    def test_name_fallbacks(self):
        from contracts.views import _contract_document_name
        class _C:
            itinerary_id = None; package_name = ''
            contratante_id = None; payer_name = ''
            reservation_number = ''; id = 42
        self.assertEqual(_contract_document_name(_C()), 'Contrato de viagem – Reserva #42')


class AgencySelfUpdateEndpointTest(APITestCase):
    """Minha Agência: admin da agência edita o próprio cadastro; comissão/status são
    ignorados (controle da operadora); terceiro sem vínculo leva 403."""

    def setUp(self):
        from agencies.models import Agency, AgencyMember
        from decimal import Decimal
        self.ag = Agency.objects.create(name='Ag', person_type='juridica', email='c@ag.com',
                                        phone='(51) 3000-0000', commission_rate=Decimal('12.00'), status='active')
        self.admin = make_user('adm-ag')
        AgencyMember.objects.create(agency=self.ag, user=self.admin, role='admin')
        self.nobody = make_user('ze')

    def _url(self):
        return f'/api/agencies/{self.ag.id}/self-update/'

    def test_admin_edits_own_data(self):
        self.client.force_authenticate(self.admin)
        r = self.client.patch(self._url(), {'phone': '(51) 99999-1111', 'email': 'novo@ag.com', 'city': 'Porto Alegre'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.ag.refresh_from_db()
        self.assertEqual(self.ag.email, 'novo@ag.com')
        self.assertEqual(self.ag.city, 'Porto Alegre')

    def test_ignores_commission_and_status(self):
        from decimal import Decimal
        self.client.force_authenticate(self.admin)
        r = self.client.patch(self._url(), {'commission_rate': '99', 'status': 'inactive', 'phone': '(51) 98888-2222'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.ag.refresh_from_db()
        self.assertEqual(self.ag.commission_rate, Decimal('12.00'))   # inalterada
        self.assertEqual(self.ag.status, 'active')                    # inalterado
        self.assertEqual(self.ag.phone, '(51) 98888-2222')            # editado

    def test_forbidden_for_unrelated_user(self):
        self.client.force_authenticate(self.nobody)
        r = self.client.patch(self._url(), {'phone': 'x'}, format='json')
        self.assertEqual(r.status_code, 403)


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
