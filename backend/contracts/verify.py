"""Conferência automática do contrato assinado, no servidor.

Lê o documento enviado (camada de texto do PDF ou OCR de foto/scan), localiza
cada campo e devolve:

  - data: conferência campo a campo (reserva, contratante, agência, pacote,
    totais, datas, cláusulas) com o status (confere / divergente / não
    preenchido / não localizado) e a CAIXA (coordenadas) de cada campo errado,
    para destacar em vermelho sobre o documento.
  - signature: detecção das duas áreas de assinatura ("Assinatura do
    Contratante" e "Assinatura da Operadora / Agência") — considera assinada se
    houver QUALQUER coisa escrita (tinta) na área, não importa o quê.

Tudo best-effort: se o Tesseract não estiver instalado, PDFs digitais (com
texto) ainda são conferidos; fotos/scans retornam readable=False.

Coordenadas das caixas são frações 0..1 da página (x0, y0, x1, y1), para o
frontend sobrepor independente do zoom.
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


# ── Extração de palavras com posição (por página) ────────────────────────────
# Estrutura por página: {'words': [{'text', 'box': (x0,y0,x1,y1) frac}], 'image': PIL.Image|None}

def _ocr_words(img):
    """OCR de uma imagem PIL → palavras com caixa (frações). [] se Tesseract faltar."""
    try:
        import pytesseract
        data = pytesseract.image_to_data(img, lang='por', output_type=pytesseract.Output.DICT)
    except Exception:
        return []
    W, H = img.size
    if not W or not H:
        return []
    words = []
    for i in range(len(data['text'])):
        t = (data['text'][i] or '').strip()
        if not t:
            continue
        x, y, w, h = data['left'][i], data['top'][i], data['width'][i], data['height'][i]
        words.append({'text': t, 'box': (x / W, y / H, (x + w) / W, (y + h) / H)})
    return words


def _gather(content, filename='', content_type=''):
    """Devolve (pages, used_ocr). Best-effort — nunca levanta exceção."""
    name = (filename or '').lower()
    is_pdf = content_type == 'application/pdf' or name.endswith('.pdf')

    if is_pdf:
        try:
            import fitz  # PyMuPDF
            from PIL import Image
            doc = fitz.open(stream=content, filetype='pdf')
            pages, total_text = [], ''
            raster = []
            for page in doc:
                pw, ph = page.rect.width or 1, page.rect.height or 1
                words = []
                for w in page.get_text('words'):
                    x0, y0, x1, y1, txt = w[0], w[1], w[2], w[3], w[4]
                    words.append({'text': txt, 'box': (x0 / pw, y0 / ph, x1 / pw, y1 / ph)})
                    total_text += ' ' + txt
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
                pages.append({'words': words, 'image': img})
                raster.append(img)
            if len(_norm(total_text)) >= 80:
                return pages, False                      # PDF digital (tem texto)
            # PDF escaneado → OCR das páginas rasterizadas
            for pg, img in zip(pages, raster):
                pg['words'] = _ocr_words(img)
            return pages, True
        except Exception:
            return [], False

    # Imagem (foto/scan)
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(content)).convert('RGB')
        return [{'words': _ocr_words(img), 'image': img}], True
    except Exception:
        return [], True


# ── Localização de campos ────────────────────────────────────────────────────

def _union(boxes):
    xs0 = [b[0] for b in boxes]; ys0 = [b[1] for b in boxes]
    xs1 = [b[2] for b in boxes]; ys1 = [b[3] for b in boxes]
    return (min(xs0), min(ys0), max(xs1), max(ys1))


def _locate_value(pages, item):
    """Procura o VALOR do campo no documento. Devolve (achou, page_index, box|None)."""
    kind, value = item['kind'], item['value']
    if kind == 'digits':
        target = _digits(value)
        if len(target) < 3:
            return False, None, None
        for pi, pg in enumerate(pages):
            for w in pg['words']:
                wd = _digits(w['text'])
                if len(wd) >= 3 and (wd == target or wd in target or target in wd):
                    return True, pi, w['box']
        return False, None, None
    # nome/texto: casa por tokens
    tokens = [t for t in _norm(value).split(' ') if len(t) >= 3]
    if not tokens:
        return False, None, None
    best = None  # (hits, pi, boxes)
    for pi, pg in enumerate(pages):
        hit_boxes = [w['box'] for w in pg['words'] if _norm(w['text']) in tokens]
        # tokens distintos casados nesta página
        matched = {tok for w in pg['words'] for tok in [_norm(w['text'])] if tok in tokens}
        if len(matched) and (best is None or len(matched) > best[0]):
            best = (len(matched), pi, hit_boxes)
    if best and best[0] / len(set(tokens)) >= 0.6 and best[2]:
        return True, best[1], _union(best[2])
    return False, None, None


def _locate_label(pages, label):
    """Procura o RÓTULO do campo (ex.: 'Reserva', 'Contratante'). Devolve
    (page_index, box) do rótulo, ou (None, None)."""
    # usa as palavras significativas do rótulo (ignora "nº", "de", etc.)
    base = label.split(':')[-1]
    tokens = [t for t in _norm(base).split(' ') if len(t) >= 4]
    if not tokens:
        tokens = [t for t in _norm(base).split(' ') if len(t) >= 3]
    if not tokens:
        return None, None
    for pi, pg in enumerate(pages):
        boxes = [w['box'] for w in pg['words'] if _norm(w['text']) in tokens]
        if boxes:
            return pi, _union(boxes)
    return None, None


def _value_region_after(pages, pi, label_box):
    """Região do VALOR à direita do rótulo, na mesma linha. Devolve (box, tem_texto)."""
    lx0, ly0, lx1, ly1 = label_box
    cy = (ly0 + ly1) / 2
    h = max(ly1 - ly0, 0.012)
    region = (lx1 + 0.005, max(0, cy - h * 0.9), min(1, lx1 + 0.42), min(1, cy + h * 0.9))
    has_text = False
    if 0 <= pi < len(pages):
        for w in pages[pi]['words']:
            wx0, wy0, wx1, wy1 = w['box']
            wcx, wcy = (wx0 + wx1) / 2, (wy0 + wy1) / 2
            if region[0] <= wcx <= region[2] and region[1] <= wcy <= region[3]:
                has_text = True
                break
    return region, has_text


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


def _check_field(pages, item):
    found, pi, box = _locate_value(pages, item)
    if found:
        return {'label': item['label'], 'value': item['value'], 'ok': True,
                'status': 'confere', 'page': pi, 'box': list(box) if box else None}
    # não achou o valor → tenta localizar o rótulo p/ destacar onde deveria estar
    lpi, lbox = _locate_label(pages, item['label'])
    if lbox is not None:
        region, has_text = _value_region_after(pages, lpi, lbox)
        status = 'divergente' if has_text else 'nao_preenchido'
        return {'label': item['label'], 'value': item['value'], 'ok': False,
                'status': status, 'page': lpi, 'box': list(region)}
    return {'label': item['label'], 'value': item['value'], 'ok': False,
            'status': 'nao_localizado', 'page': None, 'box': None}


# ── Detecção de assinatura ───────────────────────────────────────────────────

def _ink_ratio(img, box):
    if img is None:
        return 0.0
    W, H = img.size
    x0, y0, x1, y1 = box
    l, t, r, b = int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)
    if r - l < 2 or b - t < 2:
        return 0.0
    crop = img.crop((l, t, r, b)).convert('L')
    hist = crop.histogram()
    tot = sum(hist) or 1
    dark = sum(hist[:130])     # pixels escuros (tinta)
    return dark / tot


def _caption_center(pages, anchor_pi, anchor_word, anchor_box):
    """A partir da palavra 'assinatura', junta as palavras seguintes na mesma
    linha (a legenda completa) e devolve (centro_x, topo_y, rotulo)."""
    ax0, ay0, ax1, ay1 = anchor_box
    cy = (ay0 + ay1) / 2
    boxes = [anchor_box]
    parts = ['assinatura']
    for w in pages[anchor_pi]['words']:
        wx0, wy0, wx1, wy1 = w['box']
        wcy = (wy0 + wy1) / 2
        if abs(wcy - cy) <= (ay1 - ay0) and wx0 >= ax1 - 0.005 and wx0 <= ax1 + 0.3:
            boxes.append(w['box'])
            parts.append(_norm(w['text']))
    u = _union(boxes)
    cx = (u[0] + u[2]) / 2
    text = ' '.join(parts)
    if 'contratante' in text:
        rot = 'Assinatura do Contratante'
    elif 'operadora' in text or 'agencia' in text:
        rot = 'Assinatura da Operadora / Agência'
    else:
        rot = 'Assinatura'
    return cx, u[1], rot


def detect_signatures(pages, threshold=0.004):
    """Acha as áreas de assinatura e mede se há tinta (algo escrito) acima de
    cada legenda. Devolve dict {checked, signed, fields[]}."""
    anchors = []
    for pi, pg in enumerate(pages):
        for w in pg['words']:
            if _norm(w['text']) == 'assinatura':
                anchors.append((pi, w['text'], w['box']))
    fields = []
    for pi, txt, box in anchors:
        cx, cap_top, rot = _caption_center(pages, pi, txt, box)
        # área onde se assina: faixa ACIMA da legenda (e acima da linha impressa)
        region = (max(0.0, cx - 0.20), max(0.0, cap_top - 0.11),
                  min(1.0, cx + 0.20), max(0.0, cap_top - 0.022))
        img = pages[pi].get('image')
        ratio = _ink_ratio(img, region)
        # também conta como assinada se o OCR achou texto manuscrito na área
        has_word = any(region[0] <= (w['box'][0] + w['box'][2]) / 2 <= region[2]
                       and region[1] <= (w['box'][1] + w['box'][3]) / 2 <= region[3]
                       for w in pages[pi]['words'])
        signed = ratio >= threshold or has_word
        fields.append({'label': rot, 'signed': bool(signed), 'page': pi,
                       'box': list(region), 'ink': round(ratio, 4)})
    # de-duplica por rótulo mantendo a "mais assinada"
    by_label = {}
    for f in fields:
        cur = by_label.get(f['label'])
        if cur is None or (f['signed'] and not cur['signed']) or (f['ink'] > cur['ink']):
            by_label[f['label']] = f
    fields = list(by_label.values())
    checked = len(fields) > 0
    signed_all = checked and all(f['signed'] for f in fields)
    return {'checked': checked, 'signed': signed_all, 'fields': fields}


# ── Entrada principal ────────────────────────────────────────────────────────

def verify_signed_contract(contract, content, filename='', content_type=''):
    """Confere o documento (bytes) contra o contrato. Retorna dict serializável:
    { ocr, readable, data:{all_ok, items[]}, signature:{checked, signed, fields[]} }
    """
    pages, used_ocr = _gather(content, filename, content_type)
    text_len = sum(len(_norm(w['text'])) for pg in pages for w in pg['words'])

    items = [_check_field(pages, it) for it in build_expected(contract)]
    signature = detect_signatures(pages)

    return {
        'ocr': used_ocr,
        'readable': text_len >= 20,
        'data': {
            'all_ok': all(i['ok'] for i in items) if items else True,
            'items': items,
        },
        'signature': signature,
    }
