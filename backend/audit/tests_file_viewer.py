"""Visualização de arquivos pelo histórico de logs.

Cobre a referência estruturada (`_file`), o endpoint de metadados, o de serviço
do conteúdo, os estados (ok/removido/legacy), permissões, e a regra de auditoria
(preview NÃO gera log; download pelo botão gera)."""
from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from rest_framework.test import APITestCase

from users_api.models import UserPermissions
from audit.models import AuditLog
from audit import files as af
from drive.models import DriveNode, DriveNodeVersion


def make_user(username, superuser=False, **perms):
    u = User.objects.create_user(username=username, email=f'{username}@x.com', password='pw12345678')
    if superuser:
        u.is_superuser = True; u.is_staff = True; u.save()
    p, _ = UserPermissions.objects.get_or_create(user=u)
    for k, v in perms.items():
        setattr(p, k, v)
    p.save()
    return u


def make_file_node(owner, name='foto.png', content=b'\x89PNG\r\n\x1a\nDATA', mime='image/png'):
    node = DriveNode(owner=owner, kind='file', name=name, original_name=name, mime_type=mime)
    node.file.save(name, ContentFile(content), save=False)
    node.file_size = len(content)
    node.save()
    return node


# ── Mapa central de formato ─────────────────────────────────────────────────
class KindMappingTest(APITestCase):
    def test_kind_for_by_ext_and_mime(self):
        self.assertEqual(af.kind_for('', 'a.png'), 'image')
        self.assertEqual(af.kind_for('', 'a.mp4'), 'video')
        self.assertEqual(af.kind_for('', 'a.mp3'), 'audio')
        self.assertEqual(af.kind_for('', 'a.pdf'), 'pdf')
        self.assertEqual(af.kind_for('', 'a.json'), 'text')
        self.assertEqual(af.kind_for('', 'a.docx'), 'document')
        self.assertEqual(af.kind_for('', 'a.xlsx'), 'spreadsheet')
        self.assertEqual(af.kind_for('', 'a.zip'), 'archive')
        self.assertEqual(af.kind_for('application/pdf', 'noext'), 'pdf')
        self.assertEqual(af.kind_for('', 'a.bin'), 'other')

    def test_safe_inline_neutralizes_active_content(self):
        self.assertEqual(af.safe_inline_content_type('text/html', 'x.html'), 'text/plain; charset=utf-8')
        self.assertEqual(af.safe_inline_content_type('image/svg+xml', 'x.svg'), 'text/plain; charset=utf-8')
        self.assertEqual(af.safe_inline_content_type('image/png', 'x.png'), 'image/png')


# ── Referência estruturada + resolução ──────────────────────────────────────
class StructuredReferenceTest(APITestCase):
    def setUp(self):
        self.u = make_user('root', superuser=True)
        self.client.force_authenticate(self.u)

    def test_upload_stores_structured_ref(self):
        node = make_file_node(self.u, 'imagem.png')
        af.log_file_event('upload', file=node.file, model_name='DriveNode', model_label='Documento',
                          object_id=node.id, object_repr=node.name, user=self.u,
                          original_name=node.original_name, mime=node.mime_type, size=node.file_size)
        log = AuditLog.objects.filter(model_name='DriveNode', action='upload').latest('id')
        meta = log.changes.get('_file')
        self.assertIsNotNone(meta, 'upload não gravou referência estruturada')
        self.assertEqual(meta['name'], 'imagem.png')
        self.assertEqual(meta['kind'], 'image')
        self.assertTrue(meta['storage_name'])
        self.assertNotIn('http', meta['storage_name'])   # nunca URL

    def test_resolve_serves_exact_stored_file(self):
        node = make_file_node(self.u, 'doc.png', content=b'AAA-CONTENT')
        af.log_file_event('upload', file=node.file, model_name='DriveNode', model_label='Documento',
                          object_id=node.id, object_repr=node.name, user=self.u)
        log = AuditLog.objects.latest('id')
        fh, meta, status = af.resolve_log_file(log)
        self.assertEqual(status, 'ok')
        self.assertEqual(fh.read(), b'AAA-CONTENT')
        fh.close()

    def test_removed_file_keeps_metadata(self):
        node = make_file_node(self.u, 'sumido.png')
        af.log_file_event('upload', file=node.file, model_name='DriveNode', model_label='Documento',
                          object_id=node.id, object_repr=node.name, user=self.u,
                          original_name=node.original_name, mime=node.mime_type, size=node.file_size)
        log = AuditLog.objects.latest('id')
        # Apaga o conteúdo físico, mantendo o log.
        default_storage.delete(log.changes['_file']['storage_name'])
        fh, meta, status = af.resolve_log_file(log)
        self.assertIsNone(fh)
        self.assertEqual(status, 'removed')
        self.assertEqual(meta['name'], 'sumido.png')   # metadados históricos preservados

    def test_version_ref_opens_exact_version(self):
        node = make_file_node(self.u, 'versionado.docx', content=b'V1', mime='application/octet-stream')
        v = DriveNodeVersion(node=node)
        v.file.save('v1.docx', ContentFile(b'VERSION-1-BYTES'), save=False)
        v.file_size = 15; v.save()
        af.log_file_event('update', file=v.file, model_name='DriveNode', model_label='Documento',
                          object_id=node.id, object_repr=node.name, user=self.u, version_id=v.id)
        log = AuditLog.objects.latest('id')
        fh, meta, status = af.resolve_log_file(log)
        self.assertEqual(status, 'ok')
        self.assertEqual(fh.read(), b'VERSION-1-BYTES')   # a versão exata, não a atual
        self.assertEqual(meta.get('version_id'), v.id)
        fh.close()

    def test_legacy_log_without_reference(self):
        log = AuditLog.objects.create(action='download', model_name='CsvExport',
                                      model_label='Exportação CSV', object_id='', object_repr='dados.csv')
        info = af.file_info_for_log(log)
        self.assertFalse(info['available'])
        self.assertEqual(info['status'], 'legacy')
        self.assertIn('antes da implementação', info['message'])


# ── Endpoints (metadados, serviço, permissões, auditoria) ───────────────────
class FileEndpointsTest(APITestCase):
    def setUp(self):
        self.u = make_user('owner', superuser=True)
        self.client.force_authenticate(self.u)
        self.node = make_file_node(self.u, 'relatorio.pdf', content=b'%PDF-1.4 test', mime='application/pdf')
        af.log_file_event('upload', file=self.node.file, model_name='DriveNode', model_label='Documento',
                          object_id=self.node.id, object_repr=self.node.name, user=self.u,
                          original_name=self.node.original_name, mime=self.node.mime_type, size=self.node.file_size)
        self.log = AuditLog.objects.latest('id')

    def test_file_info_endpoint(self):
        r = self.client.get(f'/api/audit/logs/{self.log.id}/file/info/')
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()
        self.assertTrue(d['available'])
        self.assertEqual(d['kind'], 'pdf')
        self.assertEqual(d['name'], 'relatorio.pdf')
        self.assertNotIn('storage_name', d)   # nunca expõe a chave interna

    def test_serve_inline_does_not_log(self):
        before = AuditLog.objects.count()
        r = self.client.get(f'/api/audit/logs/{self.log.id}/file/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(b''.join(r.streaming_content), b'%PDF-1.4 test')
        # Preview inline NÃO pode gerar novo log.
        self.assertEqual(AuditLog.objects.count(), before)

    def test_info_endpoint_does_not_log(self):
        before = AuditLog.objects.count()
        self.client.get(f'/api/audit/logs/{self.log.id}/file/info/')
        self.assertEqual(AuditLog.objects.count(), before)

    def test_download_button_is_audited_once(self):
        before = AuditLog.objects.filter(action='download').count()
        r = self.client.get(f'/api/audit/logs/{self.log.id}/file/?download=1')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(AuditLog.objects.filter(action='download').count(), before + 1)

    def test_serve_removed_returns_status(self):
        default_storage.delete(self.log.changes['_file']['storage_name'])
        r = self.client.get(f'/api/audit/logs/{self.log.id}/file/')
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json().get('status'), 'removed')

    def test_permission_denied_for_other_scope(self):
        # Usuário sem NENHUMA permissão de log só enxerga as próprias ações.
        outsider = make_user('outsider')
        self.client.force_authenticate(outsider)
        r = self.client.get(f'/api/audit/logs/{self.log.id}/file/info/')
        self.assertEqual(r.status_code, 404)   # nem sabe que o log existe (sem IDOR)
        r2 = self.client.get(f'/api/audit/logs/{self.log.id}/file/')
        self.assertEqual(r2.status_code, 404)


class LargeFileTest(APITestCase):
    def setUp(self):
        self.u = make_user('big', superuser=True)
        self.client.force_authenticate(self.u)

    def test_large_flag(self):
        node = make_file_node(self.u, 'grande.mp4', content=b'x', mime='video/mp4')
        # Força um tamanho grande na referência (sem gravar 25MB de verdade).
        af.log_file_event('upload', file=node.file, model_name='DriveNode', model_label='Documento',
                          object_id=node.id, object_repr=node.name, user=self.u,
                          size=af.LARGE_FILE_BYTES + 1, mime='video/mp4', original_name='grande.mp4')
        log = AuditLog.objects.latest('id')
        info = af.file_info_for_log(log)
        self.assertTrue(info['too_large'])
        self.assertEqual(info['kind'], 'video')
