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

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

API_URL = 'https://api.autentique.com.br/v2/graphql'
TIMEOUT = 40


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


def _graphql(query, variables, upload=None):
    """Executa uma operação GraphQL. Quando há arquivo, usa o protocolo
    graphql-multipart-request (operations + map + arquivo)."""
    headers = {'Authorization': f'Bearer {_token()}'}
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


def _delivery_method():
    val = (getattr(settings, 'AUTENTIQUE_DELIVERY', 'email') or 'email').lower()
    return {
        'whatsapp': 'DELIVERY_METHOD_WHATSAPP',
        'sms':      'DELIVERY_METHOD_SMS',
        'link':     'DELIVERY_METHOD_LINK',
    }.get(val)  # None => entrega padrão (e-mail)


def build_signer(email='', phone=''):
    """Monta um signatário no formato da Autentique.

    A Autentique aceita UM canal de entrega por signatário — enviar e-mail e
    telefone juntos dá erro (`only_one_allowed`), e telefone sem `delivery_method`
    também (`is_required_when_present`). Então:
      - entrega por e-mail (padrão):  {action, email}
      - entrega por WhatsApp/SMS:     {action, phone E.164 com +, delivery_method}
    Retorna None quando não há contato compatível com o canal configurado."""
    method = _delivery_method()  # None => e-mail
    digits = ''.join(c for c in (phone or '') if c.isdigit())
    if method:
        # Entrega por telefone (WhatsApp/SMS): exige telefone válido E.164.
        if not digits:
            return None
        e164 = digits if digits.startswith('55') else f'55{digits}'
        return {'action': 'SIGN', 'phone': f'+{e164}', 'delivery_method': method}
    # Entrega por e-mail (padrão).
    if not email:
        return None
    return {'action': 'SIGN', 'email': email}


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


def download(url):
    """Baixa o PDF assinado. As URLs no domínio da Autentique exigem o token;
    URLs de armazenamento (S3 etc.) já vêm pré-assinadas e são baixadas direto."""
    headers = {}
    if 'autentique.com.br' in url:
        headers['Authorization'] = f'Bearer {_token()}'
    try:
        resp = requests.get(url, headers=headers, timeout=TIMEOUT, allow_redirects=True)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise AutentiqueError(f'Falha ao baixar o PDF assinado da Autentique: {e}')
    return resp.content
