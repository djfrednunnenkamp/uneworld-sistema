"""Leitura e verificação dos QR de segurança do PDF assinado (escaneado).

No upload do contrato assinado, o backend rasteriza cada página do PDF (PyMuPDF),
lê os QR (OpenCV) e confere, com os tokens de contracts/signing.py, se o arquivo
é DESTE contrato, na versão ATUAL, com TODAS as páginas presentes e na ORDEM
certa. Tudo no backend — o front não decide nada disso.
"""
from .signing import parse_token

# Códigos de erro (o front pode mapear para mensagens, mas a mensagem já vem pronta).
OK = 'ok'


def _decode_page(pix, cv2, np):
    """Decodifica os QR de uma página rasterizada (pixmap PyMuPDF)."""
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n >= 3:
        gray = cv2.cvtColor(arr[:, :, :3], cv2.COLOR_RGB2GRAY)
    else:
        gray = arr.reshape(pix.height, pix.width)
    det = cv2.QRCodeDetector()
    out = []
    try:
        ok, decoded, _pts, _ = det.detectAndDecodeMulti(gray)
        if ok and decoded:
            out = [d for d in decoded if d]
    except Exception:
        out = []
    if not out:                                   # fallback: um único QR na página
        try:
            d, _pts, _ = det.detectAndDecode(gray)
            if d:
                out = [d]
        except Exception:
            pass
    return out


def read_pdf_page_tokens(pdf_bytes, dpi=300):
    """Para cada página do PDF, devolve a lista de tokens VÁLIDOS encontrados.
    Retorna lista-de-listas (índice = página física, 0-based)."""
    import fitz  # PyMuPDF
    import cv2
    import numpy as np

    doc = fitz.open(stream=pdf_bytes, filetype='pdf')
    pages = []
    try:
        for page in doc:
            pix = page.get_pixmap(dpi=dpi)
            raw = _decode_page(pix, cv2, np)
            toks = [parse_token(r) for r in raw]
            pages.append([t for t in toks if t])
    finally:
        doc.close()
    return pages


def verify_signed_pdf(contract, pdf_bytes):
    """Verifica o PDF assinado escaneado contra o contrato.

    Retorna (ok: bool, code: str, message: str). Só retorna ok=True quando o
    arquivo é deste contrato, na versão atual, com todas as páginas na ordem.
    """
    try:
        per_page = read_pdf_page_tokens(pdf_bytes)
    except Exception:
        return (False, 'read_error', 'Não foi possível processar o PDF enviado. Verifique se o arquivo é um PDF válido.')

    n_pages = len(per_page)
    if n_pages == 0:
        return (False, 'empty', 'O PDF enviado está vazio.')

    flat = [t for toks in per_page for t in toks]
    if not flat:
        return (False, 'no_qr', 'Não foi possível ler o código de segurança (QR) em nenhuma página. '
                                'Confira se você imprimiu o PDF gerado pelo sistema e se o scan está nítido.')

    # 1) Todos os QR precisam ser DESTE contrato.
    if any(t['cid'] != contract.id for t in flat):
        return (False, 'other_contract', 'Este PDF é de outro contrato. Envie o PDF assinado deste contrato.')

    # 2) Todos precisam ser da versão ATUAL (editar o contrato sobe a versão).
    current = contract.signing_version
    if any(t['ver'] != current for t in flat):
        return (False, 'stale_version', 'Este PDF é de uma versão anterior do contrato (o contrato foi alterado depois). '
                                        'Baixe o PDF atualizado, imprima e colha a assinatura nessa versão.')

    # 3) Total de páginas declarado nos QR precisa ser consistente.
    totals = {t['total'] for t in flat}
    if len(totals) != 1:
        return (False, 'tampered', 'As páginas não pertencem ao mesmo documento (códigos inconsistentes).')
    total = totals.pop()

    # 4) Nº de páginas do arquivo tem que bater com o total esperado.
    if n_pages != total:
        if n_pages < total:
            return (False, 'missing_pages', f'Faltam páginas: o documento tem {total} página(s), mas o arquivo enviado tem {n_pages}.')
        return (False, 'extra_pages', f'O arquivo tem páginas a mais: são {total} página(s) no documento, mas o arquivo enviado tem {n_pages}.')

    # 5) Cada página física i tem que conter o QR da página i (ordem correta) e
    #    nenhuma página pode estar sem QR legível.
    unreadable = [i + 1 for i, toks in enumerate(per_page) if not toks]
    if unreadable:
        return (False, 'unreadable_pages', 'Não foi possível ler o código de segurança nas páginas '
                f'{", ".join(map(str, unreadable))}. Verifique a nitidez do scan dessas páginas.')

    out_of_order = [i + 1 for i, toks in enumerate(per_page) if (i + 1) not in {t['page'] for t in toks}]
    if out_of_order:
        return (False, 'wrong_order', 'As páginas estão fora da ordem original do documento. '
                'Envie o PDF com as páginas na mesma ordem em que foram geradas.')

    # 6) Todas as páginas de 1..total presentes exatamente uma vez.
    pages_found = [t['page'] for toks in per_page for t in toks]
    if sorted(set(pages_found)) != list(range(1, total + 1)):
        return (False, 'missing_pages', 'Faltam páginas do documento ou há páginas repetidas.')

    return (True, OK, 'Documento verificado com sucesso.')
