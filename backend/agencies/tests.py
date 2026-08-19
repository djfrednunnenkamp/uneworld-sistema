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


class AttachableUsersEndpointTest(APITestCase):
    """O picker de anexar usa /attachable-users/ (liberado por agencies_edit),
    sem exigir permissão de gerência de usuários."""
    def setUp(self):
        self.agency = Agency.objects.create(name='Ag', person_type='juridica')
        self.editor = _make_user('ed3', agencies_edit=True)   # NÃO tem users_view
        self.regular = _make_user('reg3')
        self.superu = _make_user('root3', superuser=True)
        from agencies.models import AgencyMember
        AgencyMember.objects.create(agency=self.agency, user=_make_user('memberx'))

    def test_agencies_edit_can_list_without_user_mgmt_perm(self):
        self.client.force_authenticate(self.editor)
        r = self.client.get(f'/api/agencies/{self.agency.id}/attachable-users/')
        self.assertEqual(r.status_code, 200, r.data)
        emails = [u['email'] for u in r.data]
        self.assertIn(self.regular.email, emails)
        self.assertNotIn(self.superu.email, emails)          # superadmin nunca aparece
        self.assertNotIn('memberx@x.com', emails)            # já é membro → fora


class AttachDemotesInternalTest(APITestCase):
    """Anexar (com apply_agency_profile) uma conta interna/super REBAIXA para usuário
    de agência e aplica o perfil padrão. Só um superusuário consegue (A-08)."""
    def setUp(self):
        self.agency = Agency.objects.create(name='Ag', person_type='juridica')
        self.root = _make_user('root8', superuser=True)
        self.leo = _make_user('leo8', superuser=True)   # o "Léo" superadmin
        from config_api.models import PermissionProfile
        PermissionProfile.objects.create(name='Ag', is_agency_default=True,
                                         permissions={'passengers_view_basic': True})

    def test_super_is_demoted_and_gets_agency_profile(self):
        self.client.force_authenticate(self.root)
        r = self.client.post(f'/api/agencies/{self.agency.id}/members/',
                             {'user_id': self.leo.id, 'role': 'operator', 'apply_agency_profile': True}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.leo.refresh_from_db(); self.leo.permissions.refresh_from_db()
        self.assertFalse(self.leo.is_superuser)   # rebaixado
        self.assertFalse(self.leo.is_staff)
        self.assertTrue(self.leo.permissions.passengers_view_basic)  # assumiu o perfil de agência
        self.assertTrue(self.agency.members.filter(user=self.leo).exists())

    def test_does_not_demote_self(self):
        # o próprio superusuário não é rebaixado ao se anexar (evita se trancar fora)
        self.client.force_authenticate(self.root)
        r = self.client.post(f'/api/agencies/{self.agency.id}/members/',
                             {'user_id': self.root.id, 'role': 'operator', 'apply_agency_profile': True}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.root.refresh_from_db()
        self.assertTrue(self.root.is_superuser)   # continua superusuário


class MembersExcludeSoftDeletedTest(APITestCase):
    """Membro excluído (soft-delete) some da lista de membros da agência."""
    def setUp(self):
        self.agency = Agency.objects.create(name='Ag', person_type='juridica')
        self.viewer = _make_user('viewer4', agencies_view=True)
        self.member = _make_user('member4')
        from agencies.models import AgencyMember
        AgencyMember.objects.create(agency=self.agency, user=self.member, role='operator')

    def test_soft_deleted_member_hidden(self):
        self.client.force_authenticate(self.viewer)
        emails = [m['email'] for m in self.client.get(f'/api/agencies/{self.agency.id}/members/').data]
        self.assertIn(self.member.email, emails)
        # soft-delete o usuário
        self.member.permissions.is_deleted = True; self.member.permissions.save()
        emails2 = [m['email'] for m in self.client.get(f'/api/agencies/{self.agency.id}/members/').data]
        self.assertNotIn(self.member.email, emails2)


class PromoterTransferTest(APITestCase):
    """Transferência de agências entre promotores (pop-up na página de Usuários)."""
    def setUp(self):
        self.editor = _make_user('opeditor', agencies_edit=True)
        self.p_out = _make_user('promoter_out', is_promoter=True)
        self.p_in  = _make_user('promoter_in',  is_promoter=True)
        self.not_promoter = _make_user('regular2')
        self.a_rj = Agency.objects.create(name='Ag RJ', person_type='juridica',
                                          promoter=self.p_out, state='RJ', city='Rio de Janeiro')
        self.a_sp = Agency.objects.create(name='Ag SP', person_type='juridica',
                                          promoter=self.p_out, state='SP', city='São Paulo')

    def test_by_promoter_lists_source_agencies(self):
        self.client.force_authenticate(self.editor)
        r = self.client.get('/api/agencies/by-promoter/', {'promoters': str(self.p_out.id)})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data), 2)

    def test_transfer_moves_only_selected_agencies(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post('/api/agencies/transfer-promoter/',
                             {'target_id': self.p_in.id, 'agency_ids': [self.a_rj.id]}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['moved'], 1)
        self.a_rj.refresh_from_db(); self.a_sp.refresh_from_db()
        self.assertEqual(self.a_rj.promoter_id, self.p_in.id)     # movida
        self.assertEqual(self.a_sp.promoter_id, self.p_out.id)    # intacta

    def test_target_must_be_promoter(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post('/api/agencies/transfer-promoter/',
                             {'target_id': self.not_promoter.id, 'agency_ids': [self.a_rj.id]}, format='json')
        self.assertEqual(r.status_code, 400)
        self.a_rj.refresh_from_db()
        self.assertEqual(self.a_rj.promoter_id, self.p_out.id)    # nada mudou

    def test_requires_agencies_edit_permission(self):
        self.client.force_authenticate(self.not_promoter)
        r = self.client.post('/api/agencies/transfer-promoter/',
                             {'target_id': self.p_in.id, 'agency_ids': [self.a_rj.id]}, format='json')
        self.assertEqual(r.status_code, 403)


# ── Importação/Exportação CSV (mesmo fluxo dos fornecedores) ──────────────────
VALID_CNPJ = '11222333000181'


def _import_csv(rows, header=('Nome;Razão Social;Email;CNPJ;CPF;Comissão;Ativo?;'
                              'Cidade;Estado;Promotor;Unidade Categoria'), bom=True):
    text = header + '\n' + '\n'.join(rows) + '\n'
    data = text.encode('utf-8')
    if bom:
        data = b'\xef\xbb\xbf' + data
    return data


class AgencyCsvImportTest(APITestCase):
    def setUp(self):
        self.importer = _make_user('imp', agencies_view=True, agencies_import=True)
        self.viewer = _make_user('vw', agencies_view=True)
        self.promoter = _make_user('luciano', agencies_view=True, is_promoter=True)
        self.promoter.first_name = 'Luciano'; self.promoter.save()

    def _analyze(self, data, name='agencias.csv'):
        from django.core.files.uploadedfile import SimpleUploadedFile
        f = SimpleUploadedFile(name, data, content_type='text/csv')
        return self.client.post('/api/agencies/import/analyze/', {'file': f}, format='multipart')

    def test_import_requires_permission(self):
        self.client.force_authenticate(self.viewer)
        r = self._analyze(_import_csv(['A;A Ltda;a@x.com;;;12%;Sim;POA;RS;;'])) 
        self.assertEqual(r.status_code, 403)

    def test_analyze_infotravel_format(self):
        self.client.force_authenticate(self.importer)
        rows = [
            f'Ag Um;Um Ltda;um@x.com;{VALID_CNPJ};;12%;Sim;Porto Alegre;RS;Luciano - Promotor;AGÊNCIAS',
            'Ag Dois;Dois Ltda;dois@x.com;1,85299E+13;;13%;Sim;Canoas;RS;;Desativado',
            ';;;semnome@x.com;;;Sim;;;;',
        ]
        r = self._analyze(_import_csv(rows))
        self.assertEqual(r.status_code, 200)
        out = {x['line']: x for x in r.data['rows']}
        self.assertEqual(r.data['summary']['total'], 3)
        # linha 2: promotor resolvido, comissão 12, ativa
        n = out[2]['normalized']
        self.assertEqual(out[2]['action'], 'new')
        self.assertEqual(n['cnpj'], VALID_CNPJ)
        self.assertEqual(n['commission_rate'], '12')
        self.assertEqual(n['promoter_id'], self.promoter.id)
        self.assertEqual(n['status'], 'active')
        # linha 3: CNPJ corrompido vira aviso (não erro); Desativado → inativa
        self.assertEqual(out[3]['action'], 'new')
        self.assertEqual(out[3]['normalized']['cnpj'], '')
        self.assertEqual(out[3]['normalized']['status'], 'inactive')
        self.assertTrue(any('notação científica' in w for w in out[3]['warnings']))
        # linha 4: sem nome/razão → erro
        self.assertEqual(out[4]['action'], 'error')

    def test_apply_upsert_updates_by_cnpj(self):
        self.client.force_authenticate(self.importer)
        Agency.objects.create(name='Ag Um', cnpj=VALID_CNPJ, email='old@x.com')
        rows = [f'Ag Um Novo;Um Ltda;novo@x.com;{VALID_CNPJ};;14%;Sim;POA;RS;;']
        data = _import_csv(rows)
        from django.core.files.uploadedfile import SimpleUploadedFile
        f = SimpleUploadedFile('a.csv', data, content_type='text/csv')
        r = self.client.post('/api/agencies/import/apply/', {'file': f, 'mode': 'upsert'},
                             format='multipart')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['updated'], 1)
        self.assertEqual(r.data['created'], 0)
        a = Agency.objects.get(cnpj=VALID_CNPJ)
        self.assertEqual(a.name, 'Ag Um Novo')
        self.assertEqual(a.email, 'novo@x.com')
        self.assertEqual(str(a.commission_rate), '14.00')

    def test_apply_create_skips_existing(self):
        self.client.force_authenticate(self.importer)
        Agency.objects.create(name='Ag Um', cnpj=VALID_CNPJ)
        rows = [f'Ag Um;Um Ltda;;{VALID_CNPJ};;12%;Sim;POA;RS;;',
                'Ag Nova;Nova Ltda;nova@x.com;;;12%;Sim;POA;RS;;']
        data = _import_csv(rows)
        from django.core.files.uploadedfile import SimpleUploadedFile
        f = SimpleUploadedFile('a.csv', data, content_type='text/csv')
        r = self.client.post('/api/agencies/import/apply/', {'file': f, 'mode': 'create'},
                             format='multipart')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['created'], 1)
        self.assertEqual(r.data['skipped'], 1)
        self.assertEqual(Agency.objects.count(), 2)

    def test_export_requires_permission_and_roundtrips(self):
        Agency.objects.create(name='Ag Um', cnpj=VALID_CNPJ, email='um@x.com',
                              city='Porto Alegre', state='RS')
        self.client.force_authenticate(self.importer)   # sem agencies_export
        self.assertEqual(self.client.get('/api/agencies/export/').status_code, 403)
        exporter = _make_user('exp', agencies_view=True, agencies_export=True,
                              agencies_import=True)
        self.client.force_authenticate(exporter)
        r = self.client.get('/api/agencies/export/')
        self.assertEqual(r.status_code, 200)
        text = r.content.decode('utf-8-sig')
        self.assertIn('Nome Fantasia', text.splitlines()[0])
        self.assertIn('Ag Um', text)
        # o export é reimportável pela análise
        r2 = self._analyze(r.content, name='export.csv')
        self.assertEqual(r2.status_code, 200)
        row = r2.data['rows'][0]
        self.assertEqual(row['action'], 'update')       # casa por CNPJ
        self.assertEqual(row['matched_by'], 'CNPJ')     # o motivo vai num campo próprio…
        self.assertEqual(row['warnings'], [])           # …e não polui os avisos da linha

    def test_template_available_to_viewer(self):
        self.client.force_authenticate(self.viewer)
        r = self.client.get('/api/agencies/template/')
        self.assertEqual(r.status_code, 200)
        self.assertIn('Nome Fantasia', r.content.decode('utf-8-sig'))
