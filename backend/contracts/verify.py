"""Conferência automática do contrato assinado, no servidor.

Lê o documento enviado (camada de texto do PDF ou, para foto/scan, OCR com
Tesseract) e confere campo a campo contra os dados do contrato: reserva,
contratante, agência, pacote, totais, datas e cláusulas. Devolve um resumo
com cada campo marcado como "confere" ou "não localizado".

Degradação graciosa: se o Tesseract não estiver instalado, PDFs digitais
(com texto) ainda são conferidos; fotos/scans retornam readable=False.
"""
import io
import re
import unicodedata


def _norm(s):
    s = unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode('ascii')
    s = s.lower()
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return s.strip()


def _digits(s):
    return re.sub(r'\D', '', str(s or ''))


def _fmt_date_br(d):
    if not d:
        return ''
    try:
        return d.strftime('%d/%m/%Y')
    except Exception:
        parts = str(d).split('-')
        if len(parts) == 3 and parts[0] and parts[1] and parts[2]:
            return f'{parts[2][:2]}/{parts[1]}/{parts[0]}'
    return ''


# ── Extração de texto ────────────────────────────────────────────────────────

def _ocr_image_bytes(content):
    try:
        import pytesseract
        from PIL import Image
        img = Image.open(io.BytesIO(content))
        return pytesseract.image_to_string(img, lang='por')
    except Exception:
        return ''


def _ocr_pdf_bytes(content):
    try:
        import pytesseract
        from pdf2image import convert_from_bytes
        out = []
        for img in convert_from_bytes(content, dpi=200):
            out.append(pytesseract.image_to_string(img, lang='por'))
        return ' '.join(out)
    except Exception:
        return ''


def extract_text(content, filename='', content_type=''):
    """Devolve (texto, usou_ocr). Best-effort — nunca levanta exceção."""
    name = (filename or '').lower()
    is_pdf = content_type == 'application/pdf' or name.endswith('.pdf')
    if is_pdf:
        text = ''
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            for page in reader.pages:
                text += ' ' + (page.extract_text() or '')
        except Exception:
            text = ''
        if len(_norm(text)) >= 80:
            return text, False            # PDF digital (tem camada de texto)
        return _ocr_pdf_bytes(content), True   # PDF escaneado → OCR
    return _ocr_image_bytes(content), True


# ── Conferência campo a campo ────────────────────────────────────────────────

def build_expected(contract):
    items = []

    def add(label, value, kind='text'):
        if value is not None and str(value).strip():
            items.append({'label': label, 'value': str(value), 'kind': kind})

    add('Reserva nº', contract.reservation_number, 'digits')
    contratante = contract.contratante.full_name if contract.contratante_id else contract.payer_name
    add('Contratante', contratante, 'name')
    add('Agência', contract.agency.name if contract.agency_id else None, 'name')
    add('Pacote', contract.package_name, 'name')
    if contract.total_brl:
        add('Total (BRL)', contract.total_brl, 'digits')
    if contract.total_usd:
        add('Total (USD)', contract.total_usd, 'digits')
    dep = _fmt_date_br(contract.departure_date)
    ret = _fmt_date_br(contract.return_date)
    if dep:
        add('Data de início', dep, 'digits')
    if ret:
        add('Data de término', ret, 'digits')
    for cl in contract.clauses.all():
        add(f'Cláusula: {cl.name}', cl.name, 'name')
    return items


def _matches(text_norm, text_digits, item):
    kind, value = item['kind'], item['value']
    if kind == 'digits':
        d = _digits(value)
        return len(d) >= 3 and d in text_digits
    if kind == 'name':
        tokens = [t for t in _norm(value).split(' ') if len(t) >= 3]
        if not tokens:
            return _norm(value) in text_norm
        hit = sum(1 for t in tokens if t in text_norm)
        return hit / len(tokens) >= 0.6
    return _norm(value) in text_norm


def verify_signed_contract(contract, content, filename='', content_type=''):
    """Confere o documento (bytes) contra os dados do contrato.

    Retorna dict serializável: items[{label, value, ok}], all_ok, ocr, readable.
    """
    text, used_ocr = extract_text(content, filename, content_type)
    text_norm = _norm(text)
    text_digits = _digits(text)
    items = [
        {'label': it['label'], 'value': it['value'], 'ok': _matches(text_norm, text_digits, it)}
        for it in build_expected(contract)
    ]
    return {
        'items': items,
        'all_ok': all(i['ok'] for i in items) if items else True,
        'ocr': used_ocr,
        'readable': len(text_norm) >= 20,
    }
