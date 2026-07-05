"""Integração com o OnlyOffice Document Server (edição de Office no navegador).

O Document Server roda à parte (Docker). O Django só:
  - gera a configuração assinada (JWT) que o editor do navegador consome;
  - recebe o callback do DS quando o documento é salvo, baixando o arquivo
    editado e sobrescrevendo o nosso.

Variáveis de ambiente (core/settings.py):
  ONLYOFFICE_DS_URL       URL pública do Document Server (ex.: http://localhost:8080)
  ONLYOFFICE_JWT_SECRET   segredo compartilhado com o DS (assina/valida os tokens)
  ONLYOFFICE_BACKEND_URL  URL do Django alcançável PELO container do DS
                          (ex.: http://host.docker.internal:8000). O DS usa essa
                          base para baixar o arquivo e chamar o callback.
"""
import base64
import hashlib
import hmac
import json
import os

from django.conf import settings


# ── Mapeamento de extensão → tipo de documento do OnlyOffice ──
_WORD  = {'doc', 'docx', 'docm', 'dot', 'dotx', 'dotm', 'odt', 'ott', 'rtf', 'txt', 'fodt'}
_CELL  = {'xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'xltm', 'ods', 'ots', 'csv', 'fods'}
_SLIDE = {'ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'ppsm', 'pot', 'potx', 'potm', 'odp', 'otp', 'fodp'}
_PDF   = {'pdf'}
# Formatos com edição nativa completa no OnlyOffice (os legados abrem só p/ leitura).
_EDITABLE = {'docx', 'xlsx', 'pptx', 'pdf', 'csv', 'txt', 'odt', 'ods', 'odp', 'rtf'}


def file_ext(name):
    return os.path.splitext(name or '')[1].lower().lstrip('.')


def doc_kind(name):
    """Categoria amigável para o front (ícone/cor): word|excel|powerpoint|pdf|other."""
    ext = file_ext(name)
    if ext in _WORD:  return 'word'
    if ext in _CELL:  return 'excel'
    if ext in _SLIDE: return 'powerpoint'
    if ext in _PDF:   return 'pdf'
    return 'other'


def office_document_type(name):
    """Tipo esperado pelo OnlyOffice: word|cell|slide|pdf (ou None se não suportado)."""
    ext = file_ext(name)
    if ext in _WORD:  return 'word'
    if ext in _CELL:  return 'cell'
    if ext in _SLIDE: return 'slide'
    if ext in _PDF:   return 'pdf'
    return None


def is_editable(name):
    return file_ext(name) in _EDITABLE


def is_configured():
    return bool(getattr(settings, 'ONLYOFFICE_DS_URL', '') and getattr(settings, 'ONLYOFFICE_BACKEND_URL', ''))


# ── JWT HS256 (sem dependência externa) ──
def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def _b64d(seg: str) -> bytes:
    return base64.urlsafe_b64decode(seg + '=' * (-len(seg) % 4))


def jwt_encode(payload: dict, secret: str) -> str:
    header = _b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode())
    body   = _b64(json.dumps(payload, separators=(',', ':')).encode())
    signing = f'{header}.{body}'
    sig = hmac.new(secret.encode(), signing.encode(), hashlib.sha256).digest()
    return f'{signing}.{_b64(sig)}'


def jwt_decode(token: str, secret: str) -> dict:
    header_b64, body_b64, sig_b64 = token.split('.')
    expected = hmac.new(secret.encode(), f'{header_b64}.{body_b64}'.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(_b64d(sig_b64), expected):
        raise ValueError('Assinatura JWT inválida.')
    return json.loads(_b64d(body_b64))


def _backend(path: str) -> str:
    base = settings.ONLYOFFICE_BACKEND_URL.rstrip('/')
    return f'{base}{path}'


def editor_config(document, user):
    """Monta a configuração do editor para um ItineraryDocument. Assina com JWT
    se houver segredo. Levanta ValueError se o formato não for suportado."""
    fname = document.name or (document.file.name if document.file else '')
    dtype = office_document_type(fname)
    if not dtype:
        raise ValueError('Formato de arquivo não suportado pelo editor.')

    ext = file_ext(fname)
    key = f'doc{document.id}v{document.edit_key or "0"}'
    can_edit = is_editable(fname)
    config = {
        'document': {
            'fileType': ext,
            'key': key,
            'title': fname,
            'url': _backend(document.file.url),
            'permissions': {'edit': can_edit, 'download': True, 'print': True},
        },
        'documentType': dtype,
        'editorConfig': {
            'callbackUrl': _backend(f'/api/itineraries/documents/{document.id}/callback/'),
            'mode': 'edit' if can_edit else 'view',
            'lang': 'pt-BR',
            'user': {'id': str(getattr(user, 'id', 'anon')), 'name': getattr(user, 'name', None) or getattr(user, 'email', 'Usuário')},
        },
    }
    secret = getattr(settings, 'ONLYOFFICE_JWT_SECRET', '')
    if secret:
        config['token'] = jwt_encode(config, secret)
    return {
        'api_js': f'{settings.ONLYOFFICE_DS_URL.rstrip("/")}/web-apps/apps/api/documents/api.js',
        'config': config,
    }
