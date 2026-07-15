"""Testes de A-10 (preview/download seguro de documentos) e A-11 (/media/ não
público). Documentos de passageiro contêm dados sensíveis (CPF, RG, passaporte),
então (1) só saem por endpoint autenticado e com permissão e (2) o Content-Type é
derivado dos bytes reais, nunca do mime_type enviado pelo cliente."""
import tempfile

from django.conf import settings
from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.test import override_settings
from rest_framework.test import APITestCase

from users_api.models import UserPermissions
from .models import Passenger, PassengerDocument

PDF_BYTES = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'
MEDIA_TMP = tempfile.mkdtemp(prefix='uneworld-test-media-')


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


@override_settings(MEDIA_ROOT=MEDIA_TMP)
class DocumentDownloadAuthTest(APITestCase):
    """A-10 — download/preview exige autenticação + permissão e usa Content-Type
    seguro (ignora o mime_type do cliente)."""
    def setUp(self):
        self.passenger = Passenger.objects.create(full_name='Fulano', nationality='BRASILEIRA')
        # mime_type malicioso vindo do cliente — não deve ser usado na resposta.
        self.doc = PassengerDocument.objects.create(
            passenger=self.passenger, doc_type='rg', original_name='rg.pdf',
            mime_type='text/html')
        self.doc.file.save('rg.pdf', ContentFile(PDF_BYTES), save=True)
        self.url_dl = f'/api/passengers/documents/{self.doc.id}/download/'
        self.url_pv = f'/api/passengers/documents/{self.doc.id}/preview/'

    def test_unauthenticated_is_blocked(self):
        self.assertIn(self.client.get(self.url_dl).status_code, (401, 403))
        self.assertIn(self.client.get(self.url_pv).status_code, (401, 403))

    def test_authenticated_without_permission_is_blocked(self):
        self.client.force_authenticate(make_user('semperm'))
        self.assertEqual(self.client.get(self.url_dl).status_code, 403)
        self.assertEqual(self.client.get(self.url_pv).status_code, 403)

    def test_download_with_permission_uses_safe_content_type(self):
        self.client.force_authenticate(make_user('baixador', passengers_download_docs=True))
        r = self.client.get(self.url_dl)
        self.assertEqual(r.status_code, 200)
        # Content-Type derivado dos bytes (PDF), NUNCA o text/html do cliente.
        self.assertEqual(r['Content-Type'], 'application/pdf')
        self.assertEqual(r['X-Content-Type-Options'], 'nosniff')
        self.assertIn('attachment', r['Content-Disposition'])

    def test_preview_forces_safe_content_type(self):
        self.client.force_authenticate(make_user('previewer', passengers_download_docs=True))
        r = self.client.get(self.url_pv)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r['Content-Type'], 'application/pdf')
        self.assertEqual(r['X-Content-Type-Options'], 'nosniff')


class MediaNotPublicInProductionTest(APITestCase):
    """A-11 — em produção (DEBUG=False) o Django não expõe /media/."""
    @override_settings(DEBUG=False)
    def test_static_media_disabled_when_debug_false(self):
        from django.conf.urls.static import static
        self.assertEqual(
            static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT), [],
            'com DEBUG=False o Django não deve registrar rota para /media/')
