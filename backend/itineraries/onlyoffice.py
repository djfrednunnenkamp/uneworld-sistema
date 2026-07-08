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


def render_thumbnail(*, file_url, ext, doc_key, title, width=480, height=360):
    """Gera uma MINIATURA (PNG) da primeira página do documento usando o serviço
    de conversão do OnlyOffice (ConvertService.ashx). Devolve os bytes do PNG ou
    None se não for possível (formato não suportado, DS fora do ar, etc.).

    file_url  URL RELATIVA do arquivo no Django (o DS baixa via ONLYOFFICE_BACKEND_URL).
    doc_key   chave única/estável do conteúdo (muda quando o arquivo muda)."""
    import urllib.request
    if not is_configured() or not office_document_type(title or f'x.{ext}'):
        return None
    payload = {
        'async': False,
        'key': doc_key,
        'filetype': ext,
        'outputtype': 'png',
        'title': title or f'arquivo.{ext}',
        'url': _backend(file_url),
        # first: só a 1ª página; aspect 1 = mantém proporção dentro de width×height.
        'thumbnail': {'first': True, 'aspect': 1, 'width': width, 'height': height},
    }
    secret = getattr(settings, 'ONLYOFFICE_JWT_SECRET', '')
    body = dict(payload)
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    if secret:
        body['token'] = jwt_encode(payload, secret)
        headers['Authorization'] = 'Bearer ' + jwt_encode({'payload': payload}, secret)
    endpoint = f'{settings.ONLYOFFICE_DS_URL.rstrip("/")}/ConvertService.ashx'
    try:
        req = urllib.request.Request(endpoint, data=json.dumps(body).encode(), headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode('utf-8', 'replace'))
        out_url = result.get('fileUrl')
        if not out_url:
            return None
        with urllib.request.urlopen(out_url, timeout=30) as r2:
            return r2.read()
    except Exception:
        return None


def build_editor_config(*, doc_key, edit_key, fname, file_url, callback_url, user, user_can_edit, can_comment=False, allow_download=True):
    """Monta a configuração assinada do editor OnlyOffice para QUALQUER documento
    (roteiro, Drive, etc.). Assina com JWT se houver segredo. Levanta ValueError
    se o formato não for suportado.

    doc_key   prefixo único e estável do documento (ex.: 'doc42', 'drive42') — o
              OnlyOffice identifica a sessão de edição por ele + edit_key.
    file_url  URL RELATIVA do arquivo no Django (o DS baixa via ONLYOFFICE_BACKEND_URL).
    callback_url URL RELATIVA que o DS chama ao salvar."""
    dtype = office_document_type(fname)
    if not dtype:
        raise ValueError('Formato de arquivo não suportado pelo editor.')

    ext = file_ext(fname)
    key = f'{doc_key}v{edit_key or "0"}'
    editable_file = is_editable(fname)
    can_edit = editable_file and bool(user_can_edit)
    # "Comentar" = não edita o conteúdo, mas pode inserir comentários. Editar já
    # inclui comentar. Só faz sentido em arquivos editáveis.
    allow_comment = editable_file and bool(user_can_edit or can_comment)
    config = {
        'document': {
            'fileType': ext,
            'key': key,
            'title': fname,
            'url': _backend(file_url),
            # comment/review ligados no nível "revisar" (comentar + controlar
            # alterações). edit=false + mode=edit + comment/review = modo revisão.
            'permissions': {'edit': can_edit, 'comment': allow_comment, 'review': allow_comment,
                            'download': allow_download, 'print': allow_download,
                            'copy': True, 'chat': False},
        },
        'documentType': dtype,
        'editorConfig': {
            'callbackUrl': _backend(callback_url),
            'mode': 'edit' if (can_edit or allow_comment) else 'view',
            'lang': 'pt-BR',
            'user': {'id': str(getattr(user, 'id', 'anon')), 'name': getattr(user, 'name', None) or getattr(user, 'email', 'Usuário')},
            'customization': {'forcesave': True} if allow_download else {'forcesave': True, 'download': False},
        },
    }
    secret = getattr(settings, 'ONLYOFFICE_JWT_SECRET', '')
    if secret:
        config['token'] = jwt_encode(config, secret)
    return {
        'api_js': f'{settings.ONLYOFFICE_DS_URL.rstrip("/")}/web-apps/apps/api/documents/api.js',
        'config': config,
    }


def editor_config(document, user):
    """Config do editor para um ItineraryDocument (documento anexado a roteiro).
    Edita só se o formato é editável E o usuário tem a permissão de editar docs."""
    fname = document.name or (document.file.name if document.file else '')
    from users_api.permissions import has_any_perm
    user_can_edit = bool(getattr(user, 'is_superuser', False) or has_any_perm(user, 'roteiros_docs_edit'))
    return build_editor_config(
        doc_key=f'doc{document.id}', edit_key=document.edit_key, fname=fname,
        file_url=document.file.url, callback_url=f'/api/itineraries/documents/{document.id}/callback/',
        user=user, user_can_edit=user_can_edit,
    )
