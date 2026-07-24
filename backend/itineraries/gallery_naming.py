"""Nome de download BONITO e SEGURO para mídia da Galeria — fonte ÚNICA (backend).

Formato: ``Tipo - Cidade - País - Descrição - ID.ext`` (partes ausentes são
puladas; o ID vai sempre por último para evitar colisões). O nome é calculado
DINAMICAMENTE no download — editar metadados muda o próximo nome sem mover arquivo.

Segurança: remove separadores de path e caracteres de controle, barra ``..``,
colapsa espaços, limita o comprimento e monta um ``Content-Disposition`` conforme
RFC 6266/5987 com ``filename`` (ASCII, fallback) + ``filename*`` (UTF-8, com acentos).
Nunca usa nome vindo do usuário como caminho — o storage usa nomes uuid internos.
"""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import quote

# Proibidos: separadores de path do Windows/Unix + controle (inclui CR/LF → anti
# CRLF injection no header) + DEL.
_FORBIDDEN = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')


def type_label(img) -> str:
    """Rótulo amigável do tipo — reusa os choices do modelo (sem duplicar tradução)."""
    if img.subject_type:
        return dict(img.SUBJECT_CHOICES).get(img.subject_type, img.subject_type)
    if img.kind == 'blocking':
        return 'Lâmina'
    return 'Vídeo' if img.is_video else 'Imagem'


def sanitize_component(s, max_len=80) -> str:
    """Limpa UMA parte do nome (não um path): tira proibidos/controle, `..`,
    colapsa espaços e apara `.`/espaço das pontas. Preserva acentos."""
    if not s:
        return ''
    s = unicodedata.normalize('NFC', str(s))
    s = _FORBIDDEN.sub(' ', s)
    s = s.replace('..', ' ')
    s = re.sub(r'\s+', ' ', s).strip(' .')
    return s[:max_len].strip(' .')


def _geo_parts(img) -> list:
    """[Cidade, País] usando o explícito OU derivando o país da cidade."""
    parts = []
    city = img.city.name if (img.city_id and img.city) else ''
    country = ''
    if img.country_id and img.country:
        country = img.country.name
    elif img.city_id and img.city and img.city.state_id and img.city.state and img.city.state.country_id:
        country = img.city.state.country.name
    if not (city or country) and img.continent_id and img.continent:
        # Só usa continente quando não há cidade nem país (acrescenta info útil).
        parts.append(img.continent.name)
    if city:
        parts.append(city)
    if country:
        parts.append(country)
    return parts


def download_basename(img) -> str:
    """Nome (sem extensão) a partir dos metadados: Tipo - Cidade - País - Descrição - ID."""
    parts = [sanitize_component(type_label(img))]
    parts += [sanitize_component(p) for p in _geo_parts(img)]
    if img.caption:
        parts.append(sanitize_component(img.caption, max_len=100))
    parts = [p for p in parts if p]        # remove vazios/None
    parts.append(str(img.id))              # ID sempre por último (anti-colisão)
    base = ' - '.join(parts)
    base = re.sub(r'(?:\s*-\s*){2,}', ' - ', base)   # sem separadores duplicados
    return base[:200].strip(' .-') or f'midia-{img.id}'


def download_filename(img, ext: str) -> str:
    """Nome completo com extensão real (minúscula)."""
    ext = ext if ext.startswith('.') else '.' + ext
    return f'{download_basename(img)}{ext.lower()}'


def content_disposition(filename: str) -> str:
    """Header `Content-Disposition: attachment` com fallback ASCII + filename* UTF-8
    (RFC 6266/5987). Cobre clientes antigos (filename) e modernos (filename*)."""
    ascii_name = unicodedata.normalize('NFKD', filename).encode('ascii', 'ignore').decode('ascii')
    ascii_name = ascii_name.replace('"', '').replace('\\', '').strip() or 'download'
    # `quote` percent-encoda tudo que não é seguro (impede CRLF/aspas no header).
    return "attachment; filename=\"%s\"; filename*=UTF-8''%s" % (ascii_name, quote(filename))
