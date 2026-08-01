"""Testes do cadastro de Fornecedores: CRUD, validações, permissões,
importação (BOM/acentos/normalização/dedup/zeros à esquerda), exportação e
auditoria."""
from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from audit.models import AuditLog
from fornecedores import views as _views  # noqa: F401 — importa core.search (registra unaccent no SQLite antes do banco de teste abrir)
from fornecedores.models import Fornecedor
from fornecedores.normalize import validate_cpf, validate_cnpj, normalize_category
from users_api.models import UserPermissions

VALID_CPF = '52998224725'
VALID_CNPJ = '11222333000181'
VALID_CNPJ0 = '04932143000192'   # CNPJ válido começando com zero (zeros à esquerda)
BASE = '/api/fornecedores/'


def _make_user(username, superuser=False, **perms):
    u = User.objects.create_user(username=username, email=f'{username}@x.com', password='pw12345678')
    if superuser:
        u.is_superuser = True; u.is_staff = True; u.save()
    p, _ = UserPermissions.objects.get_or_create(user=u)
    for k, v in perms.items():
        setattr(p, k, v)
    p.save()
    return u


def _csv(rows, header='Nome;Status;Categoria;Abreviatura Cia;Cidade;País;CPF;CNPJ;Razão Social;Rede Fornecedor;Cod', bom=True):
    text = header + '\n' + '\n'.join(rows) + '\n'
    data = text.encode('utf-8')
    if bom:
        data = b'\xef\xbb\xbf' + data
    return data


# ── Normalização (unitário, sem HTTP) ─────────────────────────────────────────
class NormalizeTest(APITestCase):
    def test_cpf_cnpj_validators(self):
        self.assertTrue(validate_cpf(VALID_CPF))
        self.assertFalse(validate_cpf('11111111111'))
        self.assertFalse(validate_cpf('123'))
        self.assertTrue(validate_cnpj(VALID_CNPJ))
        self.assertFalse(validate_cnpj('11111111111111'))

    def test_airline_category_normalization(self):
        for variant in ('Cia Aerea', 'Cia Aérea', 'Cia. Aérea', 'CIA. AEREA', 'companhia aérea'):
            key, matched = normalize_category(variant)
            self.assertEqual(key, 'cia_aerea', variant)
            self.assertTrue(matched)
        self.assertEqual(normalize_category('Hotel')[0], 'hotel')
        # desconhecida → outros, matched=False (gera aviso, não erro)
        key, matched = normalize_category('Coisa Estranha')
        self.assertEqual(key, 'outros')
        self.assertFalse(matched)
        self.assertEqual(normalize_category('')[0], '')


# ── CRUD + validações ─────────────────────────────────────────────────────────
class CrudTest(APITestCase):
    def setUp(self):
        self.creator = _make_user('creator', fornecedores_view=True, fornecedores_create=True, fornecedores_edit=True)
        self.viewer = _make_user('viewer', fornecedores_view=True)
        self.nobody = _make_user('nobody')

    def test_create_supplier_normalized(self):
        self.client.force_authenticate(self.creator)
        r = self.client.post(BASE, {
            'name': '  Hotel Copacabana  ', 'status': 'Ativo', 'category': 'Cia. Aérea',
            'airline_abbr': 'g3', 'city': 'Rio', 'country': 'Brasil',
            'cnpj': '11.222.333/0001-81',
        }, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        o = Fornecedor.objects.get(id=r.data['id'])
        self.assertEqual(o.name, 'Hotel Copacabana')          # trim
        self.assertEqual(o.category, 'cia_aerea')             # normalizado
        self.assertEqual(o.airline_abbr, 'G3')               # maiúsculas
        self.assertEqual(o.cnpj, '11222333000181')           # só dígitos
        self.assertEqual(r.data['cnpj_display'], '11.222.333/0001-81')

    def test_create_requires_permission(self):
        self.client.force_authenticate(self.viewer)          # só view
        r = self.client.post(BASE, {'name': 'X'}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_list_requires_view(self):
        self.client.force_authenticate(self.nobody)
        self.assertEqual(self.client.get(BASE).status_code, 403)

    def test_invalid_cpf_cnpj_rejected(self):
        self.client.force_authenticate(self.creator)
        self.assertEqual(self.client.post(BASE, {'name': 'A', 'cpf': '11111111111'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(BASE, {'name': 'A', 'cnpj': '11111111111111'}, format='json').status_code, 400)

    def test_person_type_unifies_document(self):
        self.client.force_authenticate(self.creator)
        # Física → guarda só CPF (CNPJ é limpo mesmo se enviado)
        r = self.client.post(BASE, {'name': 'Zé', 'person_type': 'fisica', 'cpf': VALID_CPF, 'cnpj': VALID_CNPJ}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        o = Fornecedor.objects.get(id=r.data['id'])
        self.assertEqual(o.cpf, VALID_CPF)
        self.assertEqual(o.cnpj, '')
        # Jurídica → guarda só CNPJ
        r = self.client.post(BASE, {'name': 'Empresa', 'person_type': 'juridica', 'cnpj': VALID_CNPJ, 'cpf': VALID_CPF}, format='json')
        o = Fornecedor.objects.get(id=r.data['id'])
        self.assertEqual(o.cnpj, VALID_CNPJ)
        self.assertEqual(o.cpf, '')

    def test_international_without_documents(self):
        self.client.force_authenticate(self.creator)
        r = self.client.post(BASE, {'name': 'Marriott Intl', 'country': 'Estados Unidos', 'city': 'Miami'}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data['cpf'], '')
        self.assertEqual(r.data['cnpj'], '')

    def test_edit_and_status_permission(self):
        self.client.force_authenticate(self.creator)
        o = Fornecedor.objects.create(name='Edit Me', created_by=self.creator)
        r = self.client.patch(f'{BASE}{o.id}/', {'name': 'Edited'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Fornecedor.objects.get(id=o.id).name, 'Edited')
        # set-status exige fornecedores_status OU edit; creator tem edit → ok
        r = self.client.post(f'{BASE}{o.id}/set-status/', {'status': 'inativo'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Fornecedor.objects.get(id=o.id).status, 'inativo')
        # viewer não pode
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.client.post(f'{BASE}{o.id}/set-status/', {'status': 'ativo'}, format='json').status_code, 403)

    def test_search_filter_pagination(self):
        self.client.force_authenticate(self.creator)
        Fornecedor.objects.create(name='Alpha Turismo', category='hotel', status='ativo', cnpj=VALID_CNPJ)
        Fornecedor.objects.create(name='Beta Receptivo', category='receptivo', status='inativo')
        r = self.client.get(BASE, {'search': 'Alpha'})
        self.assertEqual(r.data['count'], 1)
        self.assertEqual(r.data['results'][0]['name'], 'Alpha Turismo')
        r = self.client.get(BASE, {'search': VALID_CNPJ})       # busca por CNPJ
        self.assertEqual(r.data['count'], 1)
        r = self.client.get(BASE, {'category': 'receptivo'})
        self.assertEqual(r.data['count'], 1)
        r = self.client.get(BASE, {'status': 'ativo'})
        self.assertEqual(r.data['count'], 1)
        self.assertIn('results', r.data)                        # envelope paginado

    def test_soft_delete(self):
        self.client.force_authenticate(_make_user('del', fornecedores_view=True, fornecedores_delete=True))
        o = Fornecedor.objects.create(name='Bye')
        r = self.client.delete(f'{BASE}{o.id}/')
        self.assertEqual(r.status_code, 204)
        self.assertTrue(Fornecedor.objects.get(id=o.id).is_deleted)
        self.assertEqual(self.client.get(BASE).data['count'], 0)         # some da lista
        self.assertEqual(self.client.get(BASE, {'deleted': 1}).data['count'], 1)

    def test_audit_log_on_create(self):
        self.client.force_authenticate(self.creator)
        self.client.post(BASE, {'name': 'Audited Co'}, format='json')
        self.assertTrue(AuditLog.objects.filter(model_name='Fornecedor', action='create').exists())


# ── Importação ────────────────────────────────────────────────────────────────
class ImportTest(APITestCase):
    def setUp(self):
        self.importer = _make_user('imp', fornecedores_view=True, fornecedores_import=True)
        self.editor = _make_user('ed', fornecedores_view=True, fornecedores_edit=True)

    def _analyze(self, data):
        return self.client.post(f'{BASE}import/analyze/', {'file': _file(data)}, format='multipart')

    def test_import_requires_permission(self):
        self.client.force_authenticate(self.editor)   # sem fornecedores_import
        r = self.client.post(f'{BASE}import/analyze/', {'rows': []}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_analyze_classifies_bom_and_accents(self):
        self.client.force_authenticate(self.importer)
        Fornecedor.objects.create(name='Existente SA', cnpj=VALID_CNPJ, city='São Paulo', country='Brasil')
        data = _csv([
            'Açaí Turismo;Ativo;Cia Aérea;JJ;São Paulo;Brasil;;;;;',         # novo, acento
            f'Atualiza;Ativo;Hotel;;;;;{VALID_CNPJ};;;',                     # update por CNPJ
            ';Ativo;Hotel;;;;;;;;',                                          # erro (nome vazio)
            'Fulano;Ativo;Outros;;;;99999999999;;;;',                        # erro (CPF inválido)
        ], bom=True)
        r = self.client.post(f'{BASE}import/analyze/', {'file': _file(data)}, format='multipart')
        self.assertEqual(r.status_code, 200, r.content)
        by_line = {row['line']: row for row in r.data['rows']}
        self.assertEqual(by_line[2]['action'], 'new')
        self.assertEqual(by_line[2]['normalized']['name'], 'Açaí Turismo')   # acento preservado
        self.assertEqual(by_line[2]['normalized']['category'], 'cia_aerea')  # normalizado
        self.assertEqual(by_line[3]['action'], 'update')                     # por CNPJ
        self.assertEqual(by_line[4]['action'], 'error')                      # nome vazio
        self.assertEqual(by_line[5]['action'], 'error')                      # cpf inválido
        self.assertEqual(r.data['summary']['new'], 1)

    def test_apply_upsert_preserves_leading_zeros(self):
        self.client.force_authenticate(self.importer)
        existing = Fornecedor.objects.create(name='Old Name', cnpj=VALID_CNPJ, category='outros')
        data = _csv([
            f'Novo Fornecedor;Ativo;Operadora;;Lisboa;Portugal;;{VALID_CNPJ0};;;',   # CNPJ com zero à esquerda
            f'Nome Novo;Inativo;Hotel;;;;;{VALID_CNPJ};;;',                          # atualiza por CNPJ
        ])
        rows = self.client.post(f'{BASE}import/analyze/', {'file': _file(data)}, format='multipart').data['rows']
        raw = [row['raw'] for row in rows]
        r = self.client.post(f'{BASE}import/apply/', {'rows': raw, 'mode': 'upsert', 'filename': 'f.csv'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data['created'], 1)
        self.assertEqual(r.data['updated'], 1)
        self.assertEqual(Fornecedor.objects.get(cnpj=VALID_CNPJ0).cnpj, VALID_CNPJ0)   # zero à esquerda preservado
        existing.refresh_from_db()
        self.assertEqual(existing.name, 'Nome Novo')            # atualizado por CNPJ
        self.assertEqual(existing.status, 'inativo')
        # auditoria: evento de importação (upload) registrado
        self.assertTrue(AuditLog.objects.filter(model_name='Fornecedor', action='upload').exists())

    def test_apply_create_only_skips_existing(self):
        self.client.force_authenticate(self.importer)
        Fornecedor.objects.create(name='Keep', cnpj=VALID_CNPJ, category='hotel')
        data = _csv([
            f'Fresh;Ativo;Hotel;;;;;{VALID_CNPJ0};;;',
            f'Changed;Ativo;Hotel;;;;;{VALID_CNPJ};;;',
        ])
        rows = self.client.post(f'{BASE}import/analyze/', {'file': _file(data)}, format='multipart').data['rows']
        raw = [row['raw'] for row in rows]
        r = self.client.post(f'{BASE}import/apply/', {'rows': raw, 'mode': 'create'}, format='json')
        self.assertEqual(r.data['created'], 1)
        self.assertEqual(r.data['skipped'], 1)                  # existente não atualizado
        self.assertEqual(Fornecedor.objects.get(cnpj=VALID_CNPJ).name, 'Keep')

    def test_export_then_reimport(self):
        exporter = _make_user('exp', fornecedores_view=True, fornecedores_export=True,
                              fornecedores_import=True)
        self.client.force_authenticate(exporter)
        Fornecedor.objects.create(name='Açaí Café', status='ativo', category='cia_aerea',
                                  airline_abbr='AC', city='Belém', country='Brasil',
                                  cnpj=VALID_CNPJ)
        exp = self.client.get(f'{BASE}export/')
        self.assertEqual(exp.status_code, 200)
        self.assertEqual(exp['Content-Type'], 'text/csv; charset=utf-8')
        content = exp.content                                    # bytes com BOM
        self.assertTrue(content.startswith(b'\xef\xbb\xbf'))
        Fornecedor.objects.all().delete()
        # reimporta o próprio arquivo exportado
        rows = self.client.post(f'{BASE}import/analyze/', {'file': _file(content)}, format='multipart').data['rows']
        raw = [row['raw'] for row in rows]
        r = self.client.post(f'{BASE}import/apply/', {'rows': raw, 'mode': 'upsert'}, format='json')
        self.assertEqual(r.data['created'], 1)
        o = Fornecedor.objects.get(cnpj=VALID_CNPJ)
        self.assertEqual(o.name, 'Açaí Café')                   # acentos intactos
        self.assertEqual(o.cnpj, VALID_CNPJ)                    # dígitos preservados
        self.assertEqual(o.category, 'cia_aerea')

    def test_export_requires_permission(self):
        self.client.force_authenticate(self.editor)             # sem export
        self.assertEqual(self.client.get(f'{BASE}export/').status_code, 403)

    def test_template_download(self):
        self.client.force_authenticate(self.importer)
        r = self.client.get(f'{BASE}template/')
        self.assertEqual(r.status_code, 200)
        self.assertIn('modelo_fornecedores.csv', r['Content-Disposition'])
        self.assertIn(b'EXEMPLO', r.content)


from django.core.files.uploadedfile import SimpleUploadedFile


def _file(data, name='fornecedores.csv'):
    return SimpleUploadedFile(name, data, content_type='text/csv')
