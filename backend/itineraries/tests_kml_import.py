"""Testes da importação de destinos por KML/KMZ.

Cobre o serviço puro (`itineraries/services/kml_import_service.build_kml_preview`)
e o endpoint `POST /api/itineraries/{id}/import-kml/preview/` (action
`import_kml_preview` do `ItineraryViewSet`, gateada por `roteiros_edit`).

O serviço trata o arquivo como conteúdo NÃO confiável: valida extensão/tamanho,
descompacta KMZ com proteção contra zip-bomb/path traversal, faz parsing de XML
seguro (defusedxml, bloqueia XXE) e classifica cada marcador. NÃO grava nada —
só devolve uma prévia estruturada.

Regras exercitadas aqui:
  • KML vem em lon,lat,alt — o serviço devolve latitude/longitude SEM inverter.
  • Folder = camada (layer_name); Point pode virar cidade; LineString→'route',
    Polygon→'area' (nunca cidade); palavras-chave (hotel/aeroporto/…) → não-cidade.
  • Casamento com o catálogo (ConfigCity) por nome normalizado/apelido.
"""
import io
import zipfile

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APITestCase

from config_api.models import (ConfigCity, ConfigContinent, ConfigCountry,
                               ConfigState)
from users_api.models import UserPermissions

from .models import Itinerary
from .services.kml_import_service import (ALLOWED_EXTS, KmlImportError,
                                          MAX_KMZ_ENTRIES, MAX_PLACEMARKS,
                                          MAX_UNCOMPRESSED_BYTES,
                                          MAX_UPLOAD_BYTES, build_kml_preview)


# ── Helpers para montar KML/KMZ (retornam bytes) ──────────────────────────────
def kml_doc(inner, doc_name='Meu Mapa', xmlns='http://www.opengis.net/kml/2.2'):
    """Envelopa marcadores/pastas num documento KML completo (bytes)."""
    ns = f' xmlns="{xmlns}"' if xmlns else ''
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<kml{ns}><Document><name>{doc_name}</name>{inner}</Document></kml>'
    ).encode('utf-8')


def folder(name, inner):
    return f'<Folder><name>{name}</name>{inner}</Folder>'


def point(name, coords='116.4074,39.9042', desc=''):
    return (f'<Placemark><name>{name}</name><description>{desc}</description>'
            f'<Point><coordinates>{coords}</coordinates></Point></Placemark>')


def linestring(name, coords='0,0 1,1 2,2'):
    return (f'<Placemark><name>{name}</name>'
            f'<LineString><coordinates>{coords}</coordinates></LineString></Placemark>')


def polygon(name, coords='0,0 1,0 1,1 0,1 0,0'):
    return (f'<Placemark><name>{name}</name><Polygon><outerBoundaryIs><LinearRing>'
            f'<coordinates>{coords}</coordinates>'
            f'</LinearRing></outerBoundaryIs></Polygon></Placemark>')


def make_kmz(kml_bytes, arcname='doc.kml', extra=None):
    """Monta um KMZ (zip em memória) com o KML dentro. `extra` = {arcname: bytes}."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        if kml_bytes is not None:
            z.writestr(arcname, kml_bytes)
        for n, c in (extra or {}).items():
            z.writestr(n, c)
    return buf.getvalue()


def item_by_name(preview, name):
    return next(i for i in preview['items'] if i['name'] == name)


# ── SERVIÇO (sem HTTP) ────────────────────────────────────────────────────────
class KmlServiceTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        # Cadeia de FKs do catálogo: Continente → País → Estado → Cidade.
        cont = ConfigContinent.objects.create(name='Ásia')
        country = ConfigCountry.objects.create(name='China', continent=cont)
        state = ConfigState.objects.create(country=country, name='Beijing')
        cls.beijing = ConfigCity.objects.create(state=state, name='Beijing')  # name_ascii='beijing'

    def test_kml_point_vira_cidade_e_coords_nao_invertidas(self):
        raw = kml_doc(folder('Destinos', point('Beijing', '116.4074,39.9042')))
        prev = build_kml_preview(raw, 'mapa.kml')
        self.assertEqual(prev['placemarks_count'], 1)
        it = prev['items'][0]
        self.assertEqual(it['geometry_type'], 'Point')
        self.assertEqual(it['detected_type'], 'city')
        # KML = lon,lat → latitude=39.9042 e longitude=116.4074 (NÃO invertido).
        self.assertAlmostEqual(it['latitude'], 39.9042, places=4)
        self.assertAlmostEqual(it['longitude'], 116.4074, places=4)
        self.assertEqual(it['layer_name'], 'Destinos')

    def test_kmz_valido_gera_mesma_previa(self):
        raw = kml_doc(folder('Destinos', point('Beijing', '116.4074,39.9042')))
        kmz = make_kmz(raw, arcname='doc.kml')
        prev = build_kml_preview(kmz, 'mapa.kmz')
        self.assertEqual(prev['placemarks_count'], 1)
        it = prev['items'][0]
        self.assertEqual(it['name'], 'Beijing')
        self.assertAlmostEqual(it['latitude'], 39.9042, places=4)
        self.assertAlmostEqual(it['longitude'], 116.4074, places=4)

    def test_namespace_diferente_ainda_parseia(self):
        # Namespace não-padrão: _local() tira o namespace, então continua parseando.
        raw = kml_doc(folder('Destinos', point('Beijing', '116.4074,39.9042')),
                      xmlns='http://example.com/qualquer/coisa')
        prev = build_kml_preview(raw, 'mapa.kml')
        self.assertEqual(prev['placemarks_count'], 1)
        self.assertEqual(prev['items'][0]['name'], 'Beijing')

    def test_sem_namespace_declarado_ainda_parseia(self):
        raw = kml_doc(folder('Destinos', point('Beijing', '116.4074,39.9042')), xmlns='')
        prev = build_kml_preview(raw, 'mapa.kml')
        self.assertEqual(prev['placemarks_count'], 1)

    def test_bytes_aleatorios_nao_xml_levanta_erro(self):
        with self.assertRaises(KmlImportError):
            build_kml_preview(b'isto nao e xml de jeito nenhum %%% \x01\x02', 'mapa.kml')

    def test_arquivo_vazio_code_empty(self):
        with self.assertRaises(KmlImportError) as ctx:
            build_kml_preview(b'', 'mapa.kml')
        self.assertEqual(ctx.exception.code, 'empty')

    def test_kmz_sem_kml_dentro_code_no_kml(self):
        kmz = make_kmz(None, extra={'leiame.txt': b'nada aqui'})
        with self.assertRaises(KmlImportError) as ctx:
            build_kml_preview(kmz, 'mapa.kmz')
        self.assertEqual(ctx.exception.code, 'no_kml')

    def test_kmz_path_traversal_code_unsafe_path(self):
        kmz = make_kmz(None, extra={'../evil.kml': b'<kml></kml>'})
        with self.assertRaises(KmlImportError) as ctx:
            build_kml_preview(kmz, 'mapa.kmz')
        self.assertEqual(ctx.exception.code, 'unsafe_path')

    def test_xxe_doctype_entity_code_unsafe_xml(self):
        raw = (b'<?xml version="1.0"?>\n'
               b'<!DOCTYPE kml [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n'
               b'<kml><Document><Placemark><name>&xxe;</name></Placemark></Document></kml>')
        with self.assertRaises(KmlImportError) as ctx:
            build_kml_preview(raw, 'mapa.kml')
        self.assertEqual(ctx.exception.code, 'unsafe_xml')

    def test_linestring_vira_route_ignorada(self):
        raw = kml_doc(folder('Traçado', linestring('Rota do dia 1')))
        prev = build_kml_preview(raw, 'mapa.kml')
        it = prev['items'][0]
        self.assertEqual(it['geometry_type'], 'LineString')
        self.assertEqual(it['detected_type'], 'route')
        self.assertFalse(it['selected_by_default'])
        self.assertEqual(it['status'], 'ignored')
        self.assertIsNone(it['matched_city'])
        self.assertEqual(prev['possible_cities_count'], 0)

    def test_polygon_vira_area_nao_cidade(self):
        raw = kml_doc(folder('Áreas', polygon('Zona centro')))
        prev = build_kml_preview(raw, 'mapa.kml')
        it = prev['items'][0]
        self.assertEqual(it['geometry_type'], 'Polygon')
        self.assertEqual(it['detected_type'], 'area')
        self.assertFalse(it['selected_by_default'])
        self.assertEqual(it['status'], 'ignored')

    def test_coordenadas_invalidas_nao_quebram(self):
        # Fora de range e texto puro: latitude/longitude devem virar None sem erro.
        raw = kml_doc(folder('Destinos',
                             point('Fora de range', '999,999')
                             + point('Texto', 'abc,def')))
        prev = build_kml_preview(raw, 'mapa.kml')
        for it in prev['items']:
            self.assertIsNone(it['latitude'])
            self.assertIsNone(it['longitude'])

    def test_palavras_chave_poi_nao_viram_cidade(self):
        raw = kml_doc(folder('Pontos',
                             point('Hotel Ritz', '2.35,48.85')
                             + point('Aeroporto de Guarulhos', '-46.47,-23.43')))
        prev = build_kml_preview(raw, 'mapa.kml')
        hotel = item_by_name(prev, 'Hotel Ritz')
        aero = item_by_name(prev, 'Aeroporto de Guarulhos')
        self.assertNotEqual(hotel['detected_type'], 'city')
        self.assertEqual(hotel['detected_type'], 'hotel')
        self.assertNotEqual(aero['detected_type'], 'city')
        self.assertEqual(aero['detected_type'], 'airport')
        self.assertEqual(hotel['status'], 'ignored')
        self.assertEqual(aero['status'], 'ignored')

    def test_sem_nenhum_placemark_code_no_placemarks(self):
        raw = kml_doc('', doc_name='Mapa vazio')
        with self.assertRaises(KmlImportError) as ctx:
            build_kml_preview(raw, 'mapa.kml')
        self.assertEqual(ctx.exception.code, 'no_placemarks')

    def test_cidade_existente_no_banco_status_matched(self):
        raw = kml_doc(folder('Destinos', point('Beijing', '116.4074,39.9042')))
        prev = build_kml_preview(raw, 'mapa.kml')
        it = prev['items'][0]
        self.assertEqual(it['status'], 'matched')
        self.assertIsNotNone(it['matched_city'])
        self.assertEqual(it['matched_city']['id'], self.beijing.id)
        self.assertEqual(it['matched_city']['name'], 'Beijing')
        self.assertEqual(it['matched_city']['country_name'], 'China')
        self.assertEqual(it['matched_city']['country']['name'], 'China')
        self.assertTrue(it['selected_by_default'])
        self.assertEqual(prev['possible_cities_count'], 1)

    def test_cidade_inexistente_status_unmatched(self):
        raw = kml_doc(folder('Destinos', point('Xyzville Inexistente', '10,10')))
        prev = build_kml_preview(raw, 'mapa.kml')
        it = prev['items'][0]
        self.assertEqual(it['detected_type'], 'city')
        self.assertEqual(it['status'], 'unmatched')
        self.assertIsNone(it['matched_city'])
        self.assertFalse(it['selected_by_default'])


# ── ENDPOINT (via self.client) ────────────────────────────────────────────────
def _make_user(username, superuser=False, **perms):
    u = User.objects.create_user(username=username, email=f'{username}@x.com',
                                 password='pw12345678')
    if superuser:
        u.is_superuser = True
        u.is_staff = True
        u.save()
    p, _ = UserPermissions.objects.get_or_create(user=u)
    for k, v in perms.items():
        setattr(p, k, v)
    p.save()
    return u


class KmlEndpointTest(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cont = ConfigContinent.objects.create(name='Ásia')
        country = ConfigCountry.objects.create(name='China', continent=cont)
        state = ConfigState.objects.create(country=country, name='Beijing')
        cls.beijing = ConfigCity.objects.create(state=state, name='Beijing')

    def setUp(self):
        self.it = Itinerary.objects.create(name='Roteiro Ásia', base_currency='USD')
        self.editor = _make_user('editor', roteiros_edit=True)
        self.viewer = _make_user('viewer', roteiros_view=True)  # sem roteiros_edit

    def _url(self, pk=None):
        return f'/api/itineraries/{pk or self.it.id}/import-kml/preview/'

    def _kml_file(self, name='mapa.kml'):
        raw = kml_doc(folder('Destinos', point('Beijing', '116.4074,39.9042')))
        return SimpleUploadedFile(name, raw,
                                  content_type='application/vnd.google-earth.kml+xml')

    def test_usuario_com_roteiros_edit_recebe_200_e_previa(self):
        self.client.force_authenticate(self.editor)
        resp = self.client.post(self._url(), {'file': self._kml_file()}, format='multipart')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['placemarks_count'], 1)
        self.assertEqual(data['items'][0]['name'], 'Beijing')
        self.assertEqual(data['items'][0]['status'], 'matched')

    def test_sem_file_400(self):
        self.client.force_authenticate(self.editor)
        resp = self.client.post(self._url(), {}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('error', resp.json())

    def test_extensao_errada_txt_400(self):
        self.client.force_authenticate(self.editor)
        bad = SimpleUploadedFile('mapa.txt', b'nao importa', content_type='text/plain')
        resp = self.client.post(self._url(), {'file': bad}, format='multipart')
        self.assertEqual(resp.status_code, 400)

    def test_usuario_sem_permissao_403(self):
        self.client.force_authenticate(self.viewer)
        resp = self.client.post(self._url(), {'file': self._kml_file()}, format='multipart')
        self.assertEqual(resp.status_code, 403)

    def test_previa_nao_grava_nada(self):
        self.assertEqual(self.it.cities.count(), 0)
        self.client.force_authenticate(self.editor)
        resp = self.client.post(self._url(), {'file': self._kml_file()}, format='multipart')
        self.assertEqual(resp.status_code, 200)
        self.it.refresh_from_db()
        self.assertEqual(self.it.cities.count(), 0)


class KmlConstantsTest(TestCase):
    def test_constantes_expostas(self):
        self.assertEqual(ALLOWED_EXTS, ('.kml', '.kmz'))
        self.assertGreater(MAX_UPLOAD_BYTES, 0)
        self.assertGreater(MAX_KMZ_ENTRIES, 0)
        self.assertGreater(MAX_UNCOMPRESSED_BYTES, 0)
        self.assertGreater(MAX_PLACEMARKS, 0)
