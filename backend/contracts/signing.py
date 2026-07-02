"""Token de segurança do PDF de assinatura física.

Cada página do PDF baixado para assinatura carrega um QR com um token curto e
ASSINADO (HMAC-SHA256 com a SECRET_KEY) que amarra: contrato, versão de
assinatura, número da página e total de páginas. Como é assinado, não dá para
forjar; como inclui a versão, editar o contrato (que sobe a versão) invalida os
PDFs baixados antes. A verificação (no upload do assinado escaneado) é 100% no
backend — ver contracts/qr_verify.py.

Formato: ``UNE1:<cid>:<ver>:<page>:<total>:<sig>``  (só ASCII, curto p/ o QR).
"""
import base64
import hashlib
import hmac

from django.conf import settings

_PREFIX = 'UNE1'
_SIG_LEN = 16          # 16 chars base32 ≈ 80 bits — sobra para evitar forja


def _secret():
    return (getattr(settings, 'SECRET_KEY', '') or '').encode()


def _sig(cid, ver, page, total):
    msg = f'{cid}:{ver}:{page}:{total}'.encode()
    digest = hmac.new(_secret(), msg, hashlib.sha256).digest()
    return base64.b32encode(digest).decode().rstrip('=')[:_SIG_LEN]


def make_token(cid, ver, page, total):
    """Gera o token assinado para uma página. Determinístico: mesmo contrato/
    versão/página/total → mesmo token (dois downloads iguais batem)."""
    return f'{_PREFIX}:{int(cid)}:{int(ver)}:{int(page)}:{int(total)}:{_sig(cid, ver, page, total)}'


def parse_token(token):
    """Valida a assinatura e devolve {cid, ver, page, total}; ou None se o token
    for inválido/adulterado/de formato desconhecido."""
    if not token or not isinstance(token, str):
        return None
    parts = token.strip().split(':')
    if len(parts) != 6 or parts[0] != _PREFIX:
        return None
    try:
        cid, ver, page, total = (int(parts[1]), int(parts[2]), int(parts[3]), int(parts[4]))
    except ValueError:
        return None
    if not hmac.compare_digest(parts[5], _sig(cid, ver, page, total)):
        return None
    return {'cid': cid, 'ver': ver, 'page': page, 'total': total}
