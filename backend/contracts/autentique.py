"""Integração com a Autentique (assinatura digital) — API GraphQL v2.

O token vem de AUTENTIQUE_API_TOKEN. AUTENTIQUE_SANDBOX (default True) cria
documentos de TESTE — sem valor jurídico e sem consumir créditos —, ideal para
validar o fluxo antes de ligar em produção.

A entrega do pedido de assinatura é por e-mail por padrão (canal universal).
Para usar WhatsApp/SMS, defina AUTENTIQUE_DELIVERY=whatsapp|sms — nesse caso os
signatários precisam de telefone válido e o recurso precisa estar habilitado no
plano da Autentique.
"""
import json
import logging
from urllib.parse import urljoin, urlparse

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

API_URL = 'https://api.autentique.com.br/v2/graphql'
TIMEOUT = 40

# Host OFICIAL da Autentique. Só enviamos o Bearer token para este host (exato ou
# subdomínio .autentique.com.br) — nunca por substring "in url", que aceitaria
# autentique.com.br.evil.com e vazaria o token (A-14).
_AUTENTIQUE_HOST = 'autentique.com.br'


def _is_autentique_host(url):
    host = (urlparse(url).hostname or '').lower()
    return host == _AUTENTIQUE_HOST or host.endswith('.' + _AUTENTIQUE_HOST)


class AutentiqueError(Exception):
    """Erro de configuração ou de resposta da Autentique (mensagem amigável)."""


def is_configured():
    return bool(getattr(settings, 'AUTENTIQUE_API_TOKEN', ''))


def _token():
    token = getattr(settings, 'AUTENTIQUE_API_TOKEN', '')
    if not token:
        raise AutentiqueError('Assinatura digital indisponível: token da Autentique não configurado.')
    return token


# Traduções amigáveis dos erros de validação mais comuns da Autentique.
_VALIDATION_PT = {
    'format_is_invalid':            'formato inválido',
    'required':                     'obrigatório',
    'is_required':                  'obrigatório',
    'is_required_when_none_present': 'informe e-mail ou telefone',
    'email':                        'e-mail inválido',
}
_FIELD_PT = {'email': 'e-mail', 'phone': 'telefone', 'name': 'nome'}


def _format_graphql_errors(errors):
    """Monta uma mensagem legível a partir dos erros GraphQL da Autentique,
    expandindo `extensions.validation` (ex.: signatário 1 — e-mail: formato
    inválido) em vez de devolver só "validation"."""
    parts = []
    for err in errors:
        validation = ((err.get('extensions') or {}).get('validation')) or {}
        for path, problems in validation.items():
            # path ex.: "signers.0.email" -> "signatário 1 (e-mail)"
            who = path
            bits = path.split('.')
            if len(bits) == 3 and bits[0] == 'signers' and bits[1].isdigit():
                field = _FIELD_PT.get(bits[2], bits[2])
                who = f'signatário {int(bits[1]) + 1} ({field})'
            elif len(bits) == 1:
                who = _FIELD_PT.get(bits[0], bits[0])
            # alguns códigos vêm como "codigo:campoA / campoB" — usa só o código.
            reason = ', '.join(_VALIDATION_PT.get(p.split(':')[0], p.split(':')[0]) for p in problems)
            parts.append(f'{who}: {reason}')
        if not validation:
            parts.append(err.get('message', '') or 'erro desconhecido')
    return '; '.join(p for p in parts if p) or 'erro desconhecido'


def _graphql(query, variables, upload=None, token=None):
    """Executa uma operação GraphQL. Quando há arquivo, usa o protocolo
    graphql-multipart-request (operations + map + arquivo). `token` permite
    autenticar como OUTRA conta (ex.: assinar automaticamente pelo CEO)."""
    headers = {'Authorization': f'Bearer {token or _token()}'}
    try:
        if upload is not None:
            filename, content, mime = upload
            data = {
                'operations': json.dumps({'query': query, 'variables': variables}),
                'map': json.dumps({'file': ['variables.file']}),
            }
            files = {'file': (filename, content, mime)}
            resp = requests.post(API_URL, headers=headers, data=data, files=files, timeout=TIMEOUT)
        else:
            headers['Content-Type'] = 'application/json'
            resp = requests.post(API_URL, headers=headers,
                                 json={'query': query, 'variables': variables}, timeout=TIMEOUT)
    except requests.RequestException as e:
        logger.exception('Falha de rede ao falar com a Autentique')
        raise AutentiqueError(f'Falha de comunicação com a Autentique: {e}')

    try:
        body = resp.json()
    except ValueError:
        raise AutentiqueError(f'Resposta inválida da Autentique (HTTP {resp.status_code}).')

    if 'errors' in body and body['errors']:
        raise AutentiqueError(f'Autentique: {_format_graphql_errors(body["errors"])}')
    if resp.status_code >= 400:
        raise AutentiqueError(f'Autentique respondeu HTTP {resp.status_code}.')
    return body.get('data') or {}


# ── Mutations / queries ──────────────────────────────────────────────────────

_CREATE_DOCUMENT = """
mutation CreateDocument($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!, $sandbox: Boolean!) {
  createDocument(sandbox: $sandbox, document: $document, signers: $signers, file: $file) {
    id
    name
    signatures {
      public_id
      email
      action { name }
      link { short_link }
    }
  }
}
"""

_DOCUMENT = """
query Document($id: UUID!) {
  document(id: $id) {
    id
    name
    files { signed original }
    signatures {
      public_id
      email
      viewed { created_at }
      signed { created_at }
      rejected { created_at }
      action { name }
      link { short_link }
    }
  }
}
"""


_DELIVERY_MAP = {
    'whatsapp': 'DELIVERY_METHOD_WHATSAPP',
    'sms':      'DELIVERY_METHOD_SMS',
    'link':     'DELIVERY_METHOD_LINK',
}


def _delivery_method(method=None):
    """Resolve o canal de entrega da Autentique.

    `method` (escolhido POR CONTRATO no envio: 'email'|'whatsapp'|'sms') tem
    prioridade sobre o padrão global AUTENTIQUE_DELIVERY. Retorna a constante da
    Autentique (DELIVERY_METHOD_*) ou None => entrega por e-mail (padrão)."""
    val = (method or getattr(settings, 'AUTENTIQUE_DELIVERY', 'email') or 'email').lower()
    return _DELIVERY_MAP.get(val)  # None => e-mail


def _is_valid_br_mobile(e164):
    """Celular BR em E.164: +55 + DDD (2) + 9 + 8 dígitos = 13 dígitos após o '+'.
    (Fixo tem 8 dígitos no assinante e não começa com 9 — não serve p/ SMS.)"""
    import re
    return bool(re.match(r'^\+55\d{2}9\d{8}$', e164 or ''))


def build_signer(email='', phone='', method=None, sms_verification=False):
    """Monta um signatário no formato da Autentique.

    A Autentique aceita UM canal de entrega por signatário — enviar e-mail e
    telefone juntos dá erro (`only_one_allowed`), e telefone sem `delivery_method`
    também (`is_required_when_present`). Então:
      - entrega por e-mail (padrão):  {action, email}
      - entrega por WhatsApp/SMS:     {action, phone E.164 com +, delivery_method}
    `method` sobrepõe o canal global (escolha por contrato). Retorna None quando
    não há contato compatível com o canal escolhido.

    `sms_verification` (config da operadora): exige AUTENTICAÇÃO por SMS antes de
    assinar (2FA) — acrescenta `security_verifications: [{type: SMS, verify_phone}]`.
    Só pré-preenche `verify_phone` quando é um CELULAR válido; senão omite (a
    Autentique deixa o signatário informar na hora — pré-preencher um fixo/número
    inválido dá `verify_phone: must_be_a_valid_phone_number`)."""
    resolved = _delivery_method(method)  # None => e-mail
    digits = ''.join(c for c in (phone or '') if c.isdigit())
    e164 = ('+' + (digits if digits.startswith('55') else f'55{digits}')) if digits else ''
    if resolved:
        # Entrega por telefone (WhatsApp/SMS): exige telefone válido E.164.
        if not e164:
            return None
        signer = {'action': 'SIGN', 'phone': e164, 'delivery_method': resolved}
    elif email:
        # Entrega por e-mail (padrão).
        signer = {'action': 'SIGN', 'email': email}
    else:
        return None
    if sms_verification:
        ver = {'type': 'SMS'}
        if _is_valid_br_mobile(e164):
            ver['verify_phone'] = e164
        signer['security_verifications'] = [ver]
    return signer


def create_document(name, pdf_bytes, signers):
    """Cria o documento na Autentique e dispara os pedidos de assinatura.
    Retorna o dict `createDocument` (id + signatures com links)."""
    if not signers:
        raise AutentiqueError('Nenhum signatário com contato (e-mail/telefone) para enviar à Autentique.')
    sandbox = bool(getattr(settings, 'AUTENTIQUE_SANDBOX', True))
    variables = {
        'document': {'name': (name or 'Contrato')[:255]},
        'signers': signers,
        'file': None,
        'sandbox': sandbox,
    }
    data = _graphql(_CREATE_DOCUMENT, variables,
                    upload=(f'{(name or "contrato")[:80]}.pdf', pdf_bytes, 'application/pdf'))
    doc = data.get('createDocument')
    if not doc or not doc.get('id'):
        raise AutentiqueError('A Autentique não retornou o documento criado.')
    return doc


def get_document(document_id):
    data = _graphql(_DOCUMENT, {'id': document_id})
    doc = data.get('document')
    if not doc:
        raise AutentiqueError('Documento não encontrado na Autentique.')
    return doc


_SIGN_DOCUMENT = 'mutation SignDocument($id: UUID!) { signDocument(id: $id) }'


def sign_document(document_id, token):
    """Assina o documento AUTOMATICAMENTE pela conta dona do `token` (ex.: o CEO).
    A Autentique assina como o detentor do token, que precisa estar listado como
    signatário do documento (senão retorna `signature_not_found`)."""
    if not document_id or not token:
        raise AutentiqueError('Documento ou token do CEO ausente para a assinatura automática.')
    _graphql(_SIGN_DOCUMENT, {'id': document_id}, token=token)


_DELETE_DOCUMENT = 'mutation DeleteDocument($id: UUID!) { deleteDocument(id: $id) }'


def delete_document(document_id):
    """Apaga o documento na Autentique — usado quando um contrato pendente volta
    para edição, para que ninguém assine uma versão descartada. É idempotente:
    se o documento já não existe, considera concluído (retorna True)."""
    if not document_id:
        return True
    try:
        _graphql(_DELETE_DOCUMENT, {'id': document_id})
    except AutentiqueError as e:
        # documento já inexistente => já estava apagado; trata como sucesso.
        msg = str(e).lower()
        if 'not_found' in msg or 'not found' in msg or 'não encontrado' in msg:
            return True
        raise
    return True


def is_fully_signed(doc):
    """True quando todos os signatários com ação de assinar já assinaram."""
    sigs = [s for s in (doc.get('signatures') or []) if (s.get('action') or {}).get('name') == 'SIGN']
    if not sigs:
        return False
    return all(s.get('signed') for s in sigs)


def signed_file_url(doc):
    return ((doc.get('files') or {}).get('signed')) or None


def _download_no_auth(url):
    """Baixa uma URL SEM enviar o token (armazenamento pré-assinado, S3 etc.).
    Sem credencial, seguir redirects é seguro."""
    if urlparse(url).scheme not in ('http', 'https'):
        raise AutentiqueError('URL de download inválida.')
    try:
        resp = requests.get(url, timeout=TIMEOUT, allow_redirects=True)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise AutentiqueError(f'Falha ao baixar o PDF assinado: {e}')
    return resp.content


def download(url):
    """Baixa o PDF assinado.

    Segurança (A-14): o Bearer token só é enviado quando o host é EXATAMENTE o da
    Autentique (validado por urlparse().hostname, não por substring). Ao enviar o
    token, NÃO seguimos redirects — um 30x para outro host vazaria o token; nesse
    caso seguimos o Location manualmente, já SEM o token (as URLs de storage vêm
    pré-assinadas e não precisam dele)."""
    if urlparse(url).scheme not in ('http', 'https'):
        raise AutentiqueError('URL de download inválida.')

    if not _is_autentique_host(url):
        # Host não-oficial (ex.: S3 pré-assinado) — baixa direto, sem token.
        return _download_no_auth(url)

    try:
        resp = requests.get(
            url, headers={'Authorization': f'Bearer {_token()}'},
            timeout=TIMEOUT, allow_redirects=False,   # nunca seguir redirect com o token
        )
    except requests.RequestException as e:
        raise AutentiqueError(f'Falha ao baixar o PDF assinado da Autentique: {e}')

    if resp.is_redirect or resp.is_permanent_redirect:
        location = resp.headers.get('Location')
        if not location:
            raise AutentiqueError('Redirect sem destino ao baixar o PDF assinado.')
        # Segue o redirect SEM o token (não vaza credencial para o destino).
        return _download_no_auth(urljoin(url, location))

    try:
        resp.raise_for_status()
    except requests.RequestException as e:
        raise AutentiqueError(f'Falha ao baixar o PDF assinado da Autentique: {e}')
    return resp.content
