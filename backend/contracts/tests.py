"""Testes do webhook da Autentique (auditoria IDS — A-07).

O webhook não confia no corpo: valida um segredo compartilhado (header
X-Webhook-Secret, com fallback ?secret= por compatibilidade) e reconsulta a API.
Fail-closed em produção quando o segredo não está configurado."""
from django.test import override_settings
from rest_framework.test import APITestCase

LOCMEM_CACHE = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
URL = '/api/contracts/autentique-webhook/'


@override_settings(CACHES=LOCMEM_CACHE, AUTENTIQUE_WEBHOOK_SECRET='topsecret')
class AutentiqueWebhookSecretTest(APITestCase):
    def test_correct_secret_via_header_accepted(self):
        r = self.client.post(URL, {}, format='json', HTTP_X_WEBHOOK_SECRET='topsecret')
        self.assertEqual(r.status_code, 200)

    def test_correct_secret_via_querystring_accepted(self):
        r = self.client.post(URL + '?secret=topsecret', {}, format='json')
        self.assertEqual(r.status_code, 200)

    def test_wrong_secret_rejected(self):
        r = self.client.post(URL + '?secret=errado', {}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_missing_secret_rejected(self):
        r = self.client.post(URL, {}, format='json')
        self.assertEqual(r.status_code, 403)


@override_settings(CACHES=LOCMEM_CACHE, AUTENTIQUE_WEBHOOK_SECRET='', DEBUG=False)
class AutentiqueWebhookNoSecretProdTest(APITestCase):
    def test_no_secret_in_production_is_rejected(self):
        r = self.client.post(URL, {}, format='json')
        self.assertEqual(r.status_code, 403)


@override_settings(CACHES=LOCMEM_CACHE, AUTENTIQUE_WEBHOOK_SECRET='', DEBUG=True)
class AutentiqueWebhookNoSecretDevTest(APITestCase):
    def test_no_secret_in_dev_is_allowed(self):
        r = self.client.post(URL, {}, format='json')
        self.assertEqual(r.status_code, 200)


# ── A-14 — validação de host no download da Autentique ────────────────────────
from unittest import mock
from django.test import SimpleTestCase
from contracts import autentique


class AutentiqueDownloadHostTest(SimpleTestCase):
    def test_host_matcher_rejects_lookalike(self):
        self.assertFalse(autentique._is_autentique_host('https://autentique.com.br.evil.com/f.pdf'))
        self.assertFalse(autentique._is_autentique_host('https://evilautentique.com.br/f.pdf'))
        self.assertTrue(autentique._is_autentique_host('https://autentique.com.br/f.pdf'))
        self.assertTrue(autentique._is_autentique_host('https://api.autentique.com.br/f.pdf'))

    @mock.patch.object(autentique, 'requests')
    def test_no_bearer_sent_to_lookalike_host(self, mreq):
        resp = mock.Mock(status_code=200, content=b'PDF', is_redirect=False,
                         is_permanent_redirect=False)
        resp.raise_for_status.return_value = None
        mreq.get.return_value = resp
        mreq.RequestException = Exception
        autentique.download('https://autentique.com.br.evil.com/f.pdf')
        # Não pode ter mandado Authorization para o host falso.
        headers = mreq.get.call_args.kwargs.get('headers') or {}
        self.assertNotIn('Authorization', headers)

    @override_settings(AUTENTIQUE_API_TOKEN='tok-secreto')
    @mock.patch.object(autentique, 'requests')
    def test_bearer_sent_to_official_host_without_following_redirect(self, mreq):
        resp = mock.Mock(status_code=200, content=b'PDF', is_redirect=False,
                         is_permanent_redirect=False)
        resp.raise_for_status.return_value = None
        mreq.get.return_value = resp
        mreq.RequestException = Exception
        autentique.download('https://api.autentique.com.br/documents/1/signed.pdf')
        kwargs = mreq.get.call_args.kwargs
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer tok-secreto')
        self.assertIs(kwargs['allow_redirects'], False)  # não segue redirect com token


# ── Feature: sugestão de pagamento — flag de alteração na revisão ─────────────
from decimal import Decimal
from django.test import TestCase as DjTestCase
from contracts.models import Contract, ContractInstallment
from contracts.review import build_review_data


class PaymentPlanReviewFlagTest(DjTestCase):
    """A revisão sinaliza quando a sugestão de pagamento aplicada foi alterada."""
    def _contract(self):
        return Contract.objects.create(
            total_brl=Decimal('50000.00'), payment_type='parcelado',
            payment_plan_applied={'has_down_payment': True, 'down_payment_mode': 'percent',
                                  'down_payment_value': 20, 'installments_count': 10,
                                  'payment_method': 'Boleto'})

    def _flags(self, c):
        return {f['code']: f['level'] for f in build_review_data(c)['flags']}

    def test_unfavorable_changes_are_warnings(self):
        c = self._contract()
        # Sugerido: entrada 20% (=10.000) + 10x. Usuário baixou p/ 5.000 + 24x
        # (entrada MENOR e MAIS parcelas = desfavorável → alerta laranja).
        ContractInstallment.objects.create(contract=c, kind='entrada', value_brl=Decimal('5000'), order=0)
        for i in range(24):
            ContractInstallment.objects.create(contract=c, kind='parcela', installment_number=i + 1,
                                               value_brl=Decimal('1875'), order=i + 1)
        f = self._flags(c)
        self.assertEqual(f.get('payment_entrada_down'), 'warn')
        self.assertEqual(f.get('payment_installments_up'), 'warn')

    def test_favorable_changes_are_green(self):
        # Entrada MAIOR (15.000 vs 10.000) e MENOS parcelas (8 vs 10) → verde ('good').
        c = Contract.objects.create(
            total_brl=Decimal('50000.00'), payment_type='parcelado',
            payment_plan_applied={'has_down_payment': True, 'down_payment_mode': 'percent',
                                  'down_payment_value': 20, 'installments_count': 10})
        ContractInstallment.objects.create(contract=c, kind='entrada', value_brl=Decimal('15000'), order=0)
        for i in range(8):
            ContractInstallment.objects.create(contract=c, kind='parcela', installment_number=i + 1,
                                               value_brl=Decimal('4375'), order=i + 1)
        f = self._flags(c)
        self.assertEqual(f.get('payment_entrada_up'), 'good')
        self.assertEqual(f.get('payment_installments_down'), 'good')

    def test_no_flag_when_matches_suggestion(self):
        c = self._contract()
        # Entrada 20% (=10.000) + 10x de 4.000 = 50.000, forma Boleto: bate com a sugestão.
        ContractInstallment.objects.create(contract=c, kind='entrada', value_brl=Decimal('10000'),
                                           payment_method='Boleto', order=0)
        for i in range(10):
            ContractInstallment.objects.create(contract=c, kind='parcela', installment_number=i + 1,
                                               value_brl=Decimal('4000'), payment_method='Boleto', order=i + 1)
        codes = list(self._flags(c).keys())
        self.assertFalse(any(code.startswith('payment_entrada') or code.startswith('payment_installments')
                             for code in codes))

    def test_valor_entrada_mode_lower_is_warning(self):
        # Entrada como VALOR fixo (R$ 10.000). Usuário baixou p/ R$ 3.000 → alerta.
        c = Contract.objects.create(
            total_brl=Decimal('50000.00'), payment_type='parcelado',
            payment_plan_applied={'has_down_payment': True, 'down_payment_mode': 'valor',
                                  'down_payment_value': 10000, 'installments_count': 10})
        ContractInstallment.objects.create(contract=c, kind='entrada', value_brl=Decimal('3000'), order=0)
        for i in range(10):
            ContractInstallment.objects.create(contract=c, kind='parcela', installment_number=i + 1,
                                               value_brl=Decimal('4700'), order=i + 1)
        self.assertEqual(self._flags(c).get('payment_entrada_down'), 'warn')


# ── Escopo por agência (usuário de agência vê só os dados da agência dele) ────
from django.contrib.auth.models import User as DjUser
from rest_framework.test import APITestCase as _APITestCase
from users_api.models import UserPermissions
from users_api.permissions import agency_scope_ids
from agencies.models import Agency, AgencyMember


def _mkuser(username, superuser=False, staff=False, **perms):
    u = DjUser.objects.create_user(username=username, email=f'{username}@x.com', password='pw12345678')
    if superuser:
        u.is_superuser = True; u.is_staff = True; u.save()
    elif staff:
        u.is_staff = True; u.save()
    p, _ = UserPermissions.objects.get_or_create(user=u)
    for k, v in perms.items():
        setattr(p, k, v)
    p.save()
    return u


class AgencyScopeTest(_APITestCase):
    def setUp(self):
        self.agA = Agency.objects.create(name='A', person_type='juridica')
        self.agB = Agency.objects.create(name='B', person_type='juridica')
        self.aguser = _mkuser('aguser', contracts_view=True)   # não-staff → escopado
        AgencyMember.objects.create(agency=self.agA, user=self.aguser)
        self.cA = Contract.objects.create(agency=self.agA, status='ativo', total_brl=100)
        self.cB = Contract.objects.create(agency=self.agB, status='ativo', total_brl=100)

    def _ids(self, r):
        data = r.data.get('results') if isinstance(r.data, dict) else r.data
        return [c['id'] for c in data]

    def test_scope_helper(self):
        self.assertEqual(sorted(agency_scope_ids(self.aguser)), [self.agA.id])
        self.assertIsNone(agency_scope_ids(_mkuser('root', superuser=True)))  # interno → sem escopo

    def test_agency_user_sees_only_own_contracts(self):
        self.client.force_authenticate(self.aguser)
        ids = self._ids(self.client.get('/api/contracts/'))
        self.assertIn(self.cA.id, ids)
        self.assertNotIn(self.cB.id, ids)

    def test_internal_user_sees_all_contracts(self):
        self.client.force_authenticate(_mkuser('root2', superuser=True))
        ids = self._ids(self.client.get('/api/contracts/'))
        self.assertIn(self.cA.id, ids)
        self.assertIn(self.cB.id, ids)

    def test_agency_user_only_sees_own_agency(self):
        self.aguser2 = self.aguser
        self.client.force_authenticate(self.aguser)
        # com agencies_view pra listar agências
        p = self.aguser.permissions; p.agencies_view = True; p.save()
        ids = self._ids(self.client.get('/api/agencies/'))
        self.assertEqual(ids, [self.agA.id])

    def test_agency_user_sees_finalized_stages_but_cannot_advance(self):
        """Usuário de agência acompanha o contrato faturado (só vê o estado), mas
        não pode aprovar a revisão nem faturar (read-only garantido no backend)."""
        # contrato da agência já faturado
        self.cA.stage = 'faturado'; self.cA.save(update_fields=['stage'])
        self.client.force_authenticate(self.aguser)
        # vê o contrato faturado na lista escopada
        ids = self._ids(self.client.get('/api/contracts/'))
        self.assertIn(self.cA.id, ids)
        # mas não consegue faturar nem aprovar (sem contracts_invoice/contracts_review)
        self.assertEqual(self.client.post(f'/api/contracts/{self.cA.id}/invoice/', {}, format='json').status_code, 403)
        self.assertEqual(self.client.post(f'/api/contracts/{self.cA.id}/approve/', {}, format='json').status_code, 403)


class ContractBroadcastSignalTest(DjTestCase):
    """Toda alteração de contrato (inclusive o webhook do Autentique, que salva o
    Contract) deve avisar a tela de Contratos via broadcast('contracts')."""
    def test_save_broadcasts_contracts_scope(self):
        with mock.patch('dashboard.signals._broadcast') as bc:
            c = Contract.objects.create(status='rascunho', total_brl=10)
            self.assertIn(mock.call('contracts'), bc.call_args_list)
            bc.reset_mock()
            c.total_brl = 20
            c.save(update_fields=['total_brl'])
            bc.assert_any_call('contracts')

    def test_delete_broadcasts_contracts_scope(self):
        c = Contract.objects.create(status='rascunho', total_brl=10)
        with mock.patch('dashboard.signals._broadcast') as bc:
            c.delete()
            bc.assert_any_call('contracts')


class ContractCommissionFieldsTest(DjTestCase):
    """A visão geral do contrato mostra a comissão da agência: % + valor em US$/BRL."""
    def test_commission_pct_usd_brl(self):
        from contracts.serializers import ContractSerializer
        from contracts.models import ContractAccommodationLine
        from config_api.models import ConfigAccommodation
        ag = Agency.objects.create(name='Comissionada', person_type='juridica', commission_rate=Decimal('10'))
        acc = ConfigAccommodation.objects.create(name='Duplo')
        c = Contract.objects.create(agency=ag, status='ativo', exchange_rate=Decimal('5'))
        ContractAccommodationLine.objects.create(contract=c, accommodation_type=acc, value_per_person_usd=Decimal('1000'),
                                                 taxes_usd=Decimal('50'), quantity=2, order=0)
        d = ContractSerializer(c).data
        self.assertEqual(Decimal(d['commission_pct']), Decimal('10.00'))
        self.assertEqual(Decimal(d['commission_usd']), Decimal('200.00'))   # 10% de 2000 (taxas fora)
        self.assertEqual(Decimal(d['commission_brl']), Decimal('1000.00'))  # 200 * 5

    def test_no_commission_when_agency_has_no_rate(self):
        from contracts.serializers import ContractSerializer
        ag = Agency.objects.create(name='SemComissao', person_type='juridica')
        c = Contract.objects.create(agency=ag, status='ativo', exchange_rate=Decimal('5'))
        d = ContractSerializer(c).data
        self.assertIsNone(d['commission_pct'])
        self.assertIsNone(d['commission_usd'])
        self.assertIsNone(d['commission_brl'])


class InvoiceRejectTest(_APITestCase):
    """Recusar contrato a partir do faturamento (A faturar → Em edição, com motivo).
    Quem fatura (contracts_invoice) pode recusar; sem motivo é 400."""
    def setUp(self):
        self.ag = Agency.objects.create(name='Ag', person_type='juridica')
        self.invoicer = _mkuser('invoicer', contracts_invoice=True)
        self.c = Contract.objects.create(agency=self.ag, status='ativo', stage='a_faturar', total_brl=100)

    def test_invoicer_can_reject_from_a_faturar(self):
        self.client.force_authenticate(self.invoicer)
        r = self.client.post(f'/api/contracts/{self.c.id}/reject/', {'note': 'faltou documento'}, format='json')
        self.assertEqual(r.status_code, 200, getattr(r, 'data', None))
        self.c.refresh_from_db()
        self.assertEqual(self.c.stage, 'em_edicao')
        self.assertEqual(self.c.review_note, 'faltou documento')

    def test_reject_requires_note(self):
        self.client.force_authenticate(self.invoicer)
        r = self.client.post(f'/api/contracts/{self.c.id}/reject/', {'note': '  '}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_viewer_cannot_reject(self):
        viewer = _mkuser('viewer', contracts_view=True)
        self.client.force_authenticate(viewer)
        r = self.client.post(f'/api/contracts/{self.c.id}/reject/', {'note': 'x'}, format='json')
        self.assertEqual(r.status_code, 403)


# ── Segurança do PDF de assinatura física (QR por página) ─────────────────────
class SigningTokenTest(DjTestCase):
    def test_token_roundtrip_and_tamper(self):
        from contracts.signing import make_token, parse_token
        t = make_token(75, 3, 2, 5)
        self.assertEqual(parse_token(t), {'cid': 75, 'ver': 3, 'page': 2, 'total': 5})
        # adulterar qualquer parte quebra a assinatura
        self.assertIsNone(parse_token(t.replace(':2:', ':4:')))   # troca página
        self.assertIsNone(parse_token(t[:-1] + ('A' if t[-1] != 'A' else 'B')))  # troca assinatura
        self.assertIsNone(parse_token('lixo'))
        self.assertIsNone(parse_token('UNE1:75:3:2:5:'))


class SigningQrEndpointTest(_APITestCase):
    def setUp(self):
        self.ag = Agency.objects.create(name='A', person_type='juridica')
        self.user = _mkuser('u', contracts_edit=True)
        self.c = Contract.objects.create(agency=self.ag, status='ativo', total_brl=100)

    def test_issue_tokens_for_pages(self):
        self.client.force_authenticate(self.user)
        r = self.client.post(f'/api/contracts/{self.c.id}/signing-qr/', {'pages': 3}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['version'], self.c.signing_version)
        self.assertEqual(len(r.data['tokens']), 3)
        from contracts.signing import parse_token
        p = parse_token(r.data['tokens'][1]['token'])
        self.assertEqual(p, {'cid': self.c.id, 'ver': self.c.signing_version, 'page': 2, 'total': 3})

    def test_invalid_page_count(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.post(f'/api/contracts/{self.c.id}/signing-qr/', {'pages': 0}, format='json').status_code, 400)


class SignedPdfVerifyTest(DjTestCase):
    """Gera um PDF com QR reais (como o front faria) e testa a verificação."""
    def setUp(self):
        self.ag = Agency.objects.create(name='A', person_type='juridica')
        self.c = Contract.objects.create(agency=self.ag, status='ativo', total_brl=100)

    def _pdf_with_qrs(self, cid, ver, total, pages=None, order=None):
        import io, qrcode, fitz
        from contracts.signing import make_token
        pages = pages if pages is not None else list(range(1, total + 1))
        if order is not None:
            pages = order
        doc = fitz.open()
        for pnum in pages:
            page = doc.new_page(width=595, height=842)
            tok = make_token(cid, ver, pnum, total)
            buf = io.BytesIO(); qrcode.make(tok).save(buf, format='PNG')
            page.insert_image(fitz.Rect(595 - 90, 842 - 90, 595 - 20, 842 - 20), stream=buf.getvalue())
        data = doc.tobytes(); doc.close()
        return data

    def test_valid_document(self):
        from contracts.qr_verify import verify_signed_pdf
        pdf = self._pdf_with_qrs(self.c.id, self.c.signing_version, 3)
        ok, code, _ = verify_signed_pdf(self.c, pdf)
        self.assertTrue(ok, code)

    def test_stale_version_rejected(self):
        from contracts.qr_verify import verify_signed_pdf
        pdf = self._pdf_with_qrs(self.c.id, self.c.signing_version, 3)   # versão atual
        self.c.signing_version += 1; self.c.save()                       # contrato editado depois
        ok, code, _ = verify_signed_pdf(self.c, pdf)
        self.assertFalse(ok); self.assertEqual(code, 'stale_version')

    def test_other_contract_rejected(self):
        from contracts.qr_verify import verify_signed_pdf
        pdf = self._pdf_with_qrs(self.c.id + 999, self.c.signing_version, 3)
        ok, code, _ = verify_signed_pdf(self.c, pdf)
        self.assertFalse(ok); self.assertEqual(code, 'other_contract')

    def test_missing_page_rejected(self):
        from contracts.qr_verify import verify_signed_pdf
        pdf = self._pdf_with_qrs(self.c.id, self.c.signing_version, 3, pages=[1, 2])  # falta a 3
        ok, code, _ = verify_signed_pdf(self.c, pdf)
        self.assertFalse(ok); self.assertEqual(code, 'missing_pages')

    def test_wrong_order_rejected(self):
        from contracts.qr_verify import verify_signed_pdf
        pdf = self._pdf_with_qrs(self.c.id, self.c.signing_version, 3, order=[1, 3, 2])
        ok, code, _ = verify_signed_pdf(self.c, pdf)
        self.assertFalse(ok); self.assertEqual(code, 'wrong_order')


class UploadSignedOverrideTest(_APITestCase):
    """QR ilegível (scan ruim): oferece confirmar e anexar mesmo assim (marcado
    NÃO verificado). Erro definitivo (outro contrato) NÃO permite override."""
    def setUp(self):
        self.ag = Agency.objects.create(name='A', person_type='juridica')
        self.user = _mkuser('editor', contracts_edit=True)
        self.c = Contract.objects.create(agency=self.ag, status='ativo', stage='enviado', total_brl=100)

    def _pdf_no_qr(self):
        import fitz
        doc = fitz.open(); doc.new_page(width=595, height=842)
        b = doc.tobytes(); doc.close(); return b

    def test_unreadable_qr_offers_override_then_accepts(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        self.client.force_authenticate(self.user)
        pdf = self._pdf_no_qr()
        r = self.client.post(f'/api/contracts/{self.c.id}/upload-signed/',
                             {'file': SimpleUploadedFile('a.pdf', pdf, content_type='application/pdf')}, format='multipart')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get('code'), 'no_qr')
        self.assertTrue(r.data.get('can_override'))
        r2 = self.client.post(f'/api/contracts/{self.c.id}/upload-signed/',
                             {'file': SimpleUploadedFile('a.pdf', pdf, content_type='application/pdf'),
                              'override_unverified': 'true'}, format='multipart')
        self.assertEqual(r2.status_code, 200, r2.data)
        self.c.refresh_from_db()
        self.assertEqual(self.c.stage, 'revisao')
        self.assertEqual((self.c.signed_verification or {}).get('qr_status'), 'unverified')
        from contracts.review import build_review_data
        codes = [f['code'] for f in build_review_data(self.c)['flags']]
        self.assertIn('qr_unverified', codes)

    def test_hard_failure_cannot_override(self):
        import io, fitz, qrcode
        from contracts.signing import make_token
        from django.core.files.uploadedfile import SimpleUploadedFile
        self.client.force_authenticate(self.user)
        doc = fitz.open(); page = doc.new_page(width=595, height=842)
        buf = io.BytesIO(); qrcode.make(make_token(self.c.id + 999, 1, 1, 1)).save(buf, format='PNG')
        page.insert_image(fitz.Rect(595 - 90, 842 - 90, 595 - 20, 842 - 20), stream=buf.getvalue())
        pdf = doc.tobytes(); doc.close()
        r = self.client.post(f'/api/contracts/{self.c.id}/upload-signed/',
                             {'file': SimpleUploadedFile('a.pdf', pdf, content_type='application/pdf'),
                              'override_unverified': 'true'}, format='multipart')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get('code'), 'other_contract')
        self.assertFalse(r.data.get('can_override'))


class OccupiedAccommodationPermissionTest(DjTestCase):
    """Acomodação marcada como OCUPADA/oculta no roteiro (contract_accommodations com
    hidden=True) só pode ser reservada por quem tem contracts_book_occupied — rede de
    segurança no serializer contra chamada direta à API."""
    def _mk(self):
        from itineraries.models import Itinerary, ItineraryPricingConfig
        from config_api.models import ConfigAccommodation
        itin = Itinerary.objects.create(name='R', visibility='public')
        acc = ConfigAccommodation.objects.create(name='Single', capacity=1)
        ItineraryPricingConfig.objects.create(
            itinerary=itin,
            contract_accommodations=[{'type': acc.id, 'capacity': 1, 'label': 'Single',
                                      'source_capacity': 1, 'hidden': True}])
        return itin, acc

    def _payload(self, itin, acc):
        return {'itinerary': itin.id, 'status': 'rascunho',
                'accommodation_lines': [{'accommodation_type': acc.id, 'value_per_person_usd': '100',
                                         'taxes_usd': '0', 'quantity': 1, 'order': 0}]}

    def _req(self, user):
        from rest_framework.test import APIRequestFactory
        r = APIRequestFactory().post('/api/contracts/')
        r.user = user
        return r

    def test_agency_user_without_permission_is_blocked(self):
        from contracts.serializers import ContractSerializer
        itin, acc = self._mk()
        ag = Agency.objects.create(name='Ag', person_type='juridica')
        user = _mkuser('agocc', contracts_edit=True)   # não-staff, escopado; sem book_occupied
        AgencyMember.objects.create(agency=ag, user=user)
        s = ContractSerializer(data=self._payload(itin, acc), context={'request': self._req(user)})
        self.assertFalse(s.is_valid())
        self.assertIn('accommodation_lines', s.errors)

    def test_user_with_permission_can_book_occupied(self):
        from contracts.serializers import ContractSerializer
        itin, acc = self._mk()
        user = _mkuser('occperm', contracts_edit=True, contracts_book_occupied=True)
        s = ContractSerializer(data=self._payload(itin, acc), context={'request': self._req(user)})
        s.is_valid()
        self.assertNotIn('accommodation_lines', s.errors)

    def test_superuser_can_book_occupied(self):
        from contracts.serializers import ContractSerializer
        itin, acc = self._mk()
        user = _mkuser('rootocc', superuser=True)
        s = ContractSerializer(data=self._payload(itin, acc), context={'request': self._req(user)})
        s.is_valid()
        self.assertNotIn('accommodation_lines', s.errors)


class AddendumTest(_APITestCase):
    """Contrato de adendo: nasce como rascunho vinculado ao original, herdando o
    cabeçalho e as pessoas, mas SEM valores/pagamentos."""
    def setUp(self):
        from passengers.models import Passenger
        from contracts.models import ContractGuest
        self.admin = _mkuser('addadmin', superuser=True)
        self.ag = Agency.objects.create(name='AgAdd', person_type='juridica')
        self.pax = Passenger.objects.create(full_name='Fulano de Tal')
        self.parent = Contract.objects.create(agency=self.ag, status='ativo', stage='em_pagamento',
                                              package_name='Pacote X', base_currency='EUR',
                                              exchange_rate=Decimal('6'), total_brl=Decimal('1000'),
                                              reservation_number='000042')
        ContractGuest.objects.create(contract=self.parent, passenger=self.pax, order=0, room_group=1)
        self.client.force_authenticate(self.admin)

    def test_create_addendum(self):
        r = self.client.post(f'/api/contracts/{self.parent.id}/create-addendum/', {}, format='json')
        self.assertEqual(r.status_code, 201)
        d = r.json()
        self.assertNotEqual(d['id'], self.parent.id)
        self.assertEqual(d['parent_contract'], self.parent.id)
        self.assertEqual(d['parent_reservation'], '000042')
        self.assertEqual(d['agency'], self.ag.id)
        self.assertEqual(d['package_name'], 'Pacote X')
        self.assertEqual(d['base_currency'], 'EUR')
        self.assertEqual(d['status'], 'rascunho')
        self.assertEqual(d['stage'], 'em_edicao')
        self.assertEqual(len(d['guests']), 1)                 # pessoas copiadas
        self.assertEqual(d['accommodation_lines'], [])        # valores vazios
        self.assertEqual(d['installments'], [])               # pagamentos vazios

    def test_addendum_appears_in_list_with_parent(self):
        cid = self.client.post(f'/api/contracts/{self.parent.id}/create-addendum/', {}, format='json').json()['id']
        # o rascunho aparece na listagem de rascunhos com o vínculo
        row = next(c for c in self.client.get('/api/contracts/?status=rascunho').json()['results'] if c['id'] == cid)
        self.assertEqual(row['parent_contract'], self.parent.id)
        self.assertEqual(row['parent_reservation'], '000042')
