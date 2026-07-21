"""Importação de destinos (cidades) a partir de arquivos KML/KMZ do Google My Maps.

Trata o arquivo como CONTEÚDO NÃO CONFIÁVEL:
  • valida extensão e tamanho;
  • descompacta KMZ com proteção contra zip-bomb e path traversal;
  • faz parsing de XML SEGURO (defusedxml — sem XXE / expansão de entidades);
  • classifica cada marcador (cidade vs. hotel/aeroporto/porto/atração/…);
  • casa as prováveis cidades com o catálogo (ConfigCity) por nome normalizado/apelido.

NÃO grava nada — apenas devolve uma PRÉVIA estruturada. A confirmação da importação
é feita no próprio formulário do roteiro (as cidades entram no M2M `cities` e são
salvas junto com o roteiro), então este serviço é puramente de análise/leitura.
"""
import io
import re
import zipfile

from defusedxml.ElementTree import fromstring as _safe_fromstring

# ── Limites de segurança ──────────────────────────────────────────────────────
MAX_UPLOAD_BYTES       = 12 * 1024 * 1024    # 12 MB de upload
MAX_KMZ_ENTRIES        = 200                 # nº máx. de arquivos dentro do KMZ
MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024    # 80 MB descompactados (anti zip-bomb)
MAX_PLACEMARKS         = 5000                # teto de marcadores processados

ALLOWED_EXTS = ('.kml', '.kmz')


class KmlImportError(Exception):
    """Erro de importação com mensagem amigável + código estável para o front."""
    def __init__(self, message, code='invalid'):
        super().__init__(message)
        self.code = code


# ── Classificação (heurística) ────────────────────────────────────────────────
# Palavras que indicam que o marcador NÃO é uma cidade (→ tipo detectado).
NON_CITY_KEYWORDS = {
    'hotel': 'hotel', 'resort': 'hotel', 'pousada': 'hotel', 'hostel': 'hotel', 'inn': 'hotel', 'lodge': 'hotel',
    'airport': 'airport', 'aeroporto': 'airport', 'aeropuerto': 'airport',
    'porto': 'port', 'port': 'port', 'harbour': 'port', 'harbor': 'port', 'pier': 'port', 'terminal': 'port',
    'estacao': 'station', 'station': 'station', 'estacion': 'station', 'gare': 'station', 'rodoviaria': 'station',
    'restaurant': 'restaurant', 'restaurante': 'restaurant', 'cafe': 'restaurant',
    'museu': 'attraction', 'museum': 'attraction', 'museo': 'attraction',
    'parque': 'attraction', 'park': 'attraction',
    'palacio': 'attraction', 'palace': 'attraction', 'palais': 'attraction',
    'templo': 'attraction', 'temple': 'attraction', 'igreja': 'attraction', 'church': 'attraction',
    'catedral': 'attraction', 'cathedral': 'attraction', 'mosteiro': 'attraction', 'monastery': 'attraction',
    'castelo': 'attraction', 'castle': 'attraction', 'fortaleza': 'attraction', 'fort': 'attraction',
    'torre': 'attraction', 'tower': 'attraction', 'ponte': 'attraction', 'bridge': 'attraction',
    'praca': 'attraction', 'plaza': 'attraction', 'square': 'attraction',
    'jardim': 'attraction', 'garden': 'attraction', 'zoo': 'attraction',
    'shopping': 'attraction', 'mall': 'attraction', 'mercado': 'attraction', 'market': 'attraction',
    'ponto de encontro': 'meeting', 'meeting point': 'meeting',
}
# Camadas cujo nome sugere fortemente "cidades/destinos".
CITY_LAYER_HINTS = ('cidade', 'destino', 'city', 'cities', 'destination', 'roteiro', 'itinerar')
# Geometrias que nunca são cidade por padrão.
GEOM_NON_CITY = {'LineString': 'route', 'Polygon': 'area', 'LinearRing': 'area'}

_TAG_RE = re.compile(r'<[^>]+>')


def _normalize(text):
    from config_api.textsearch import normalize_text
    return normalize_text(text)


def _sanitize(text, limit=500):
    """Remove HTML (My Maps escreve descrições em HTML) e normaliza espaços — nada
    de tag/script é preservado, então nunca renderizamos HTML/JS do arquivo."""
    if not text:
        return ''
    t = _TAG_RE.sub(' ', str(text))
    t = re.sub(r'\s+', ' ', t).strip()
    return t[:limit]


def _local(tag):
    """Nome do elemento sem o namespace ({http://…}Placemark → Placemark)."""
    return tag.rsplit('}', 1)[-1] if isinstance(tag, str) else tag


def _child_text(el, tagname):
    for ch in el:
        if _local(ch.tag) == tagname:
            return (ch.text or '').strip()
    return ''


# ── KMZ → bytes do KML ────────────────────────────────────────────────────────
def _kml_from_kmz(raw):
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise KmlImportError('O arquivo enviado não é um KML ou KMZ válido.', 'bad_zip')

    infos = zf.infolist()
    if len(infos) > MAX_KMZ_ENTRIES:
        raise KmlImportError('O arquivo possui uma estrutura inválida ou não suportada.', 'too_many_entries')

    total = 0
    for info in infos:
        parts = info.filename.replace('\\', '/').split('/')
        if info.filename.startswith('/') or '..' in parts:      # path traversal / absoluto
            raise KmlImportError('O arquivo possui uma estrutura inválida ou não suportada.', 'unsafe_path')
        total += info.file_size
        if total > MAX_UNCOMPRESSED_BYTES:                       # anti zip-bomb (tamanho declarado)
            raise KmlImportError('O arquivo ultrapassa o tamanho máximo permitido.', 'too_large')

    kml_names = [i.filename for i in infos if i.filename.lower().endswith('.kml')]
    if not kml_names:
        raise KmlImportError('Não foi possível localizar um arquivo KML dentro do KMZ.', 'no_kml')
    main = next((n for n in kml_names if n.lower().endswith('doc.kml')), kml_names[0])

    with zf.open(main) as fh:
        data = fh.read(MAX_UNCOMPRESSED_BYTES + 1)              # anti zip-bomb (tamanho real)
    if len(data) > MAX_UNCOMPRESSED_BYTES:
        raise KmlImportError('O arquivo ultrapassa o tamanho máximo permitido.', 'too_large')
    return data


def _extract_kml_bytes(raw, filename):
    name = (filename or '').lower()
    if raw[:2] == b'PK':                    # assinatura ZIP — é KMZ (não confia só na extensão)
        return _kml_from_kmz(raw)
    if name.endswith('.kmz'):
        return _kml_from_kmz(raw)
    return raw                              # KML texto puro


# ── Parsing seguro do XML ─────────────────────────────────────────────────────
def _parse_xml(kml_bytes):
    head = kml_bytes[:4096].lower()
    if b'<!doctype' in head or b'<!entity' in head:     # bloqueio explícito de DTD/ENTITY (XXE)
        raise KmlImportError('O arquivo possui uma estrutura inválida ou não suportada.', 'unsafe_xml')
    try:
        return _safe_fromstring(kml_bytes)               # defusedxml: sem XXE / entity expansion
    except KmlImportError:
        raise
    except Exception:
        raise KmlImportError('O arquivo possui uma estrutura inválida ou não suportada.', 'bad_xml')


def _parse_coords(text):
    """KML: 'lon,lat[,alt] lon,lat[,alt] …'. Devolve [(lon, lat), …] já validado."""
    out = []
    for tok in (text or '').replace('\n', ' ').replace('\t', ' ').split():
        parts = tok.split(',')
        if len(parts) >= 2:
            try:
                lon, lat = float(parts[0]), float(parts[1])
            except ValueError:
                continue
            if -180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0:
                out.append((lon, lat))
    return out


def _geometry(placemark_el):
    """1ª geometria do Placemark → (geometry_type, latitude, longitude).
    NÃO inverte lon/lat: no KML vem lon,lat e devolvemos (lat, lon)."""
    for el in placemark_el.iter():
        t = _local(el.tag)
        if t == 'Point':
            c = _coords_of(el)
            return 'Point', (c[0][1] if c else None), (c[0][0] if c else None)
        if t in ('LineString', 'Polygon', 'LinearRing'):
            c = _coords_of(el)
            gt = 'LineString' if t == 'LineString' else 'Polygon'
            return gt, (c[0][1] if c else None), (c[0][0] if c else None)
    return '', None, None


def _coords_of(geom_el):
    for ch in geom_el.iter():
        if _local(ch.tag) == 'coordinates':
            return _parse_coords(ch.text)
    return []


def _extended_data(el):
    data = {}
    for child in el:
        if _local(child.tag) != 'ExtendedData':
            continue
        for d in child:
            if _local(d.tag) == 'Data' and d.get('name'):
                data[d.get('name')] = _sanitize(_child_text(d, 'value'))
    return data


def _placemark(el, layer, order):
    geom_type, lat, lon = _geometry(el)
    return {
        'order': order,
        'name': _sanitize(_child_text(el, 'name'), 200),
        'description': _sanitize(_child_text(el, 'description')),
        'layer_name': layer or 'Sem camada',
        'geometry_type': geom_type,
        'latitude': lat,
        'longitude': lon,
        'extended': _extended_data(el),
    }


def _walk(el, layer, out, layers, counters):
    """Percorre Document/Folder/Placemark preservando a ORDEM do arquivo."""
    for child in el:
        tag = _local(child.tag)
        if tag == 'Document':
            _walk(child, layer, out, layers, counters)
        elif tag == 'Folder':
            nm = _child_text(child, 'name') or layer or 'Sem camada'
            layers.add(nm)
            _walk(child, nm, out, layers, counters)
        elif tag == 'Placemark':
            if len(out) >= MAX_PLACEMARKS:
                counters['truncated'] = True
                return
            out.append(_placemark(child, layer, len(out) + 1))


def classify(pm):
    """(detected_type, confidence, is_probable_city) — só uma SUGESTÃO; o usuário
    sempre revisa. Linhas/polígonos e palavras-chave de POI nunca viram cidade."""
    if pm['geometry_type'] in GEOM_NON_CITY:
        return GEOM_NON_CITY[pm['geometry_type']], 0.9, False
    hay = _normalize(' '.join(filter(None, [pm['name'], pm['description'], pm['layer_name']])))
    layer_norm = _normalize(pm['layer_name'])
    for kw, typ in NON_CITY_KEYWORDS.items():
        if kw in hay:
            return typ, 0.85, False
    if any(h in layer_norm for h in CITY_LAYER_HINTS):
        return 'city', 0.9, True
    if pm['geometry_type'] == 'Point' and pm['name']:
        return 'city', 0.55, True
    return 'unknown', 0.3, False


def _match_city(name, prefer_country_ids=None):
    """Casa um nome com o catálogo (ConfigCity) por nome normalizado/apelido PT.
    Prioriza cidades dos países já ligados ao roteiro. Não cria nada."""
    from django.db.models import Q
    from config_api.models import ConfigCity
    nq = _normalize(name)
    if not nq:
        return None
    base = ConfigCity.objects.select_related('state__country__continent')
    matches = list(base.filter(Q(name_ascii=nq) | Q(aliases__icontains=nq))[:20]) \
        or list(base.filter(name_ascii__startswith=nq)[:20])
    if not matches:
        return None
    prefer = set(prefer_country_ids or [])
    if prefer:
        matches.sort(key=lambda c: 0 if c.state.country_id in prefer else 1)
    c = matches[0]
    country = getattr(c.state, 'country', None)
    continent = getattr(country, 'continent', None) if country else None
    return {
        'id': c.id, 'name': c.name, 'state_name': c.state.name,
        'country_id': getattr(country, 'id', None), 'country_name': getattr(country, 'name', None),
        'continent_id': getattr(continent, 'id', None), 'continent_name': getattr(continent, 'name', None),
        # espelho aninhado (compatível com o formato do enunciado)
        'country': ({'id': country.id, 'name': country.name} if country else None),
    }


def build_kml_preview(raw_bytes, filename, prefer_country_ids=None):
    """Ponto de entrada: bytes do arquivo → dict de prévia. Levanta KmlImportError."""
    if not raw_bytes:
        raise KmlImportError('O arquivo enviado está vazio.', 'empty')

    kml_bytes = _extract_kml_bytes(raw_bytes, filename)
    root = _parse_xml(kml_bytes)

    map_name = ''
    for el in root.iter():
        if _local(el.tag) == 'Document':
            map_name = _child_text(el, 'name')
            break
    if not map_name:
        map_name = _child_text(root, 'name')

    placemarks, layers, counters = [], set(), {'truncated': False}
    _walk(root, '', placemarks, layers, counters)

    if not placemarks:
        raise KmlImportError('Nenhum marcador foi encontrado no arquivo.', 'no_placemarks')

    warnings = []
    if counters['truncated']:
        warnings.append('Alguns marcadores não puderam ser processados: o arquivo excede o limite de marcadores.')

    items, possible = [], 0
    for i, pm in enumerate(placemarks):
        typ, conf, is_city = classify(pm)
        matched, status = None, 'ignored'
        if is_city:
            possible += 1
            matched = _match_city(pm['name'], prefer_country_ids)
            status = 'matched' if matched else 'unmatched'
        items.append({
            'temporary_id': f'item-{i + 1}',
            'order': pm['order'],
            'name': pm['name'],
            'description': pm['description'],
            'layer_name': pm['layer_name'],
            'geometry_type': pm['geometry_type'],
            'latitude': pm['latitude'],
            'longitude': pm['longitude'],
            'detected_type': typ,
            'confidence': round(conf, 2),
            'selected_by_default': bool(is_city and matched),
            'matched_city': matched,
            'status': status,
        })

    return {
        'file_name': filename,
        'map_name': map_name or 'Mapa importado',
        'layers_count': len(layers) or 1,
        'placemarks_count': len(placemarks),
        'possible_cities_count': possible,
        'items': items,
        'warnings': warnings,
    }
