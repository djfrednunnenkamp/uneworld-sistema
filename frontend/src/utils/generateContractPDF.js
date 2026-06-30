import jsPDF from 'jspdf'
import { configApi } from '../api'

// ── Paleta (RGB) — alinhamento e cores feitos 100% em jsPDF, sem CSS ──────────
const NAV        = [26, 45, 79]      // #1a2d4f (títulos de cláusulas)
const BLUE_DARK  = [25, 45, 88]      // #192D58
const BLUE       = [11, 79, 159]     // #0B4F9F
const BLUE_LIGHT = [14, 158, 221]    // #0E9EDD
const LINE       = [201, 216, 238]   // #C9D8EE (bordas dos cards)
const TEXTC      = [13, 27, 53]      // #0D1B35 (texto base)
const GRID       = [216, 227, 243]   // #D8E3F3 (linhas finas internas)
const SUB        = [71, 85, 105]     // cinza dos rótulos auxiliares
const WHITE      = [255, 255, 255]
const GREEN      = [14, 122, 70]     // #0E7A46 (badge assinatura digital)

// Aceita 'YYYY-MM-DD' e também ISO completo ('2026-06-29T00:00:00Z'). Se não
// der pra interpretar com segurança, devolve o valor original como string.
const fmtDateBR = (iso) => {
  if (!iso) return ''
  const s = String(iso)
  const [y, m, d] = s.split('T')[0].split('-')
  if (y && m && d && /^\d{4}$/.test(y)) return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`
  return s
}

// Formata dinheiro com segurança: valor vazio/inválido vira '' (nunca "NaN").
const fmtMoney = (v) => {
  if (v == null || v === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Câmbio vem do banco com 4 casas decimais fixas (ex: "5.4000") — exibe sem
// zeros à direita desnecessários (5,4 em vez de 5,4000; 5,4321 mantém as 4 se forem reais).
// Valor vazio/inválido vira '' (nunca "NaN").
const fmtRate = (v) => {
  if (v == null || v === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return String(n).replace('.', ',')
}

/* Converte o HTML rico das cláusulas em texto simples preservando a estrutura:
 * - itens de lista (<li>) viram linhas com marcador "• ";
 * - títulos e parágrafos (<p>, <h1-4>, <div>, <br>) viram linhas separadas;
 * - evita que tudo fique grudado num parágrafo só. */
function htmlToText(html) {
  if (!html) return ''
  const div = document.createElement('div')
  div.innerHTML = html
  // Itens de lista: marcador simples antes + quebra depois.
  div.querySelectorAll('li').forEach(li => {
    li.insertAdjacentText('afterbegin', '• ')
    li.insertAdjacentText('afterend', '\n')
  })
  // Blocos e títulos: quebra de linha após cada um.
  div.querySelectorAll('p, div, br, h1, h2, h3, h4, h5, h6, tr').forEach(el => el.insertAdjacentText('afterend', '\n'))
  return div.textContent
    .replace(/[ \t]+\n/g, '\n')   // remove espaços no fim das linhas
    .replace(/\n{3,}/g, '\n\n')   // colapsa quebras excessivas
    .trim()
}

// Texto cru (sem escape HTML) com travessão de fallback quando vazio. Preserva
// quebras de linha internas (endereços multilinha) — o jsPDF as respeita.
const dashTxt  = (s) => { const t = String(s ?? '').trim(); return t || '—' }
const moneyTxt = (v) => { const m = fmtMoney(v); return m === '' ? '0,00' : m }

/* ── Ícones em SVG (não emoji) ──────────────────────────────────────────────
 * Rasterizados para PNG e desenhados com doc.addImage() em posições calculadas
 * matematicamente. Corpos no padrão Lucide (viewBox 0 0 24 24, traço). */
const ICON_PATHS = {
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  takeoff: '<path d="M2 22h20"/><path d="M6.36 17.4 4 17l-2-4 1.1-.55a2 2 0 0 1 1.8 0l.17.1a2 2 0 0 0 1.8 0L8 12 5 6l.9-.45a2 2 0 0 1 2.09.2l4.02 3 4.99-.99a2 2 0 0 1 2.37 1.47 2 2 0 0 1-1.32 2.39L7.66 17.16a2 2 0 0 1-1.3.24z"/>',
  building: '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9h.01"/><path d="M9 12h.01"/><path d="M9 15h.01"/><path d="M9 18h.01"/>',
  dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/>',
  exchange: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
}
const svgMarkup = (name, color, sw = 2) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`

/* Rasteriza um SVG para PNG data-URI (o browser decodifica o vetor no canvas;
 * o jsPDF desenha PNG de forma confiável). Resolve com null se falhar. */
function svgToPng(svgString, size) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = size; c.height = size
      c.getContext('2d').drawImage(img, 0, 0, size, size)
      try { resolve(c.toDataURL('image/png')) } catch { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svgString)
  })
}

const CIRCLE_ICONS = ['users', 'plane', 'user', 'building', 'dollar', 'card']
const MINI_ICONS   = ['briefcase', 'calendar', 'takeoff', 'message', 'dollar', 'receipt', 'exchange', 'wallet', 'file']

/* Pré-rasteriza todos os ícones (brancos p/ os círculos, azuis p/ os de apoio)
 * num mapa nome→PNG, usado depois no desenho jsPDF. */
async function prepareIcons() {
  const icons = {}
  for (const n of CIRCLE_ICONS) icons['w_' + n] = await svgToPng(svgMarkup(n, '#ffffff', 2.1), 44)
  for (const n of MINI_ICONS)   icons['b_' + n] = await svgToPng(svgMarkup(n, '#0B4F9F', 2), 36)
  return icons
}

/* ── Dados das tabelas desenhadas nativamente no jsPDF ──────────────────────
 * Devolve { columns, rows } por tabela. `rows` são arrays de STRINGS já
 * formatadas (uma por coluna). As regras de negócio (ordem entrada→parcelas,
 * sufixo "/ Final", à vista) são EXATAMENTE as mesmas de antes. */
function buildTablesData(contract) {
  const cc = contract.base_currency || 'USD'

  // ── Passageiros ──
  const guests = contract.guests || []
  const passengerRows = guests.length
    ? guests.map((g, i) => {
        const p = g.passenger_data || {}
        return [
          `${i + 1}. ${dashTxt(p.full_name)}`,
          dashTxt(p.gender),
          p.birth_date ? fmtDateBR(p.birth_date) : '—',
          dashTxt(p.passport || p.cpf),
          dashTxt(g.accommodation_type_name),
        ]
      })
    : [['—', '—', '—', '—', '—']]

  // ── Acomodações contratadas ──
  const lines = contract.accommodation_lines || []
  const accomRows = lines.length
    ? lines.map(l => [
        dashTxt(l.accommodation_type_name),
        moneyTxt(l.value_per_person_usd),
        moneyTxt(l.taxes_usd),
        dashTxt(l.quantity),
        moneyTxt(l.total_usd),
      ])
    : [['—', '—', '—', '—', '—']]

  // ── Plano de pagamento ──
  const insts = contract.installments || []
  const aVista = contract.payment_type === 'a_vista'
  const entrada  = insts.find(i => i.kind === 'entrada')
  const parcelas = insts.filter(i => i.kind === 'parcela').sort((a, b) => (a.installment_number || 0) - (b.installment_number || 0))
  let paymentRows
  if (aVista) {
    const p = parcelas[0] || entrada
    paymentRows = p
      ? [['01', dashTxt(p.detail || 'À vista'), p.due_date ? fmtDateBR(p.due_date) : '—', moneyTxt(p.value_brl), dashTxt(p.payment_method)]]
      : []
  } else {
    const ordered = [...(entrada ? [entrada] : []), ...parcelas]
    paymentRows = ordered.map((p, idx) => {
      const isLast = idx === ordered.length - 1
      let detail
      if (p.kind === 'entrada') detail = p.detail || 'Entrada (Sinal)'
      else detail = p.detail || `Parcela ${p.installment_number ?? idx}`
      if (isLast && p.kind === 'parcela' && !/final/i.test(detail)) detail += ' / Final'
      return [
        String(idx + 1).padStart(2, '0'),
        dashTxt(detail),
        p.due_date ? fmtDateBR(p.due_date) : '—',
        moneyTxt(p.value_brl),
        dashTxt(p.payment_method),
      ]
    })
  }
  if (!paymentRows.length) paymentRows = [['—', '—', '—', '—', '—']]

  return {
    passengers: {
      columns: [
        { title: 'Nome completo',       width: 42, align: 'left' },
        { title: 'Sexo',                width: 13, align: 'center' },
        { title: 'Data de nascimento',  width: 16, align: 'center' },
        { title: 'Passaporte/CPF',      width: 15, align: 'center' },
        { title: 'Acomodação',          width: 14, align: 'center' },
      ],
      rows: passengerRows,
    },
    accommodations: {
      columns: [
        { title: 'Tipo de acomodação',     width: 24, align: 'left' },
        { title: `Valor/pessoa (${cc})`,   width: 19, align: 'center' },
        { title: `Taxas (${cc})`,          width: 19, align: 'center' },
        { title: 'Quantidade',             width: 19, align: 'center' },
        { title: `Total (${cc})`,          width: 19, align: 'center', bold: true },
      ],
      rows: accomRows,
    },
    payment: {
      columns: [
        { title: 'Parcela',             width: 14, align: 'center' },
        { title: 'Detalhe',             width: 24, align: 'left' },
        { title: 'Vencimento',          width: 20, align: 'center' },
        { title: 'Valor (BRL)',         width: 21, align: 'center' },
        { title: 'Forma de pagamento',  width: 21, align: 'center' },
      ],
      rows: paymentRows,
    },
  }
}

const PT2MM = 0.352777778           // pontos → mm

/* ════════════════════ HELPERS NATIVOS jsPDF (tudo em mm) ════════════════════
 * Todo alinhamento é feito por coordenadas/medidas — nada de CSS/html2canvas. */

// Texto: aplica fonte/tamanho/cor e desenha. `o`: {size, style, color, align,
// baseline, maxWidth}. Tamanhos em pt; coordenadas em mm.
function drawText(doc, text, x, y, o = {}) {
  doc.setFont('helvetica', o.style || 'normal')
  doc.setFontSize(o.size || 10)
  const c = o.color || TEXTC
  doc.setTextColor(c[0], c[1], c[2])
  const opt = {}
  if (o.align)    opt.align = o.align
  if (o.baseline) opt.baseline = o.baseline
  if (o.maxWidth) opt.maxWidth = o.maxWidth
  doc.text(String(text), x, y, opt)
}

// Quebra de página: se não couber `needed` mm, cria página e volta ao topo.
function checkPageBreak(doc, y, needed, top, bottom) {
  if (y + needed > bottom) { doc.addPage(); return top }
  return y
}

// Círculo azul com o ícone branco centralizado (seções numeradas).
function drawIconCircle(doc, cx, cy, r, iconPng) {
  doc.setFillColor(...BLUE)
  doc.circle(cx, cy, r, 'F')
  if (iconPng) {
    const s = r * 1.25
    doc.addImage(iconPng, 'PNG', cx - s / 2, cy - s / 2, s, s)
  }
}

// Mini-ícone azul (sem círculo) posicionado matematicamente.
function drawMiniIcon(doc, iconPng, x, y, sz = 4) {
  if (iconPng) doc.addImage(iconPng, 'PNG', x, y, sz, sz)
}

// Título de seção: círculo+ícone à esquerda, texto centralizado verticalmente
// com o círculo. Retorna o Y (mm) logo abaixo do título.
function drawSectionTitle(doc, { x, y, iconPng, main, sub = '', mainSize = 11, r = 3.4 }) {
  const cx = x + r
  const cyc = y + r
  drawIconCircle(doc, cx, cyc, r, iconPng)
  const tx = x + 2 * r + 2.5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(mainSize)
  doc.setTextColor(...BLUE_DARK)
  doc.text(String(main).toUpperCase(), tx, cyc, { baseline: 'middle' })
  if (sub) {
    const mw = doc.getTextWidth(String(main).toUpperCase())
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(mainSize - 2.5)
    doc.setTextColor(...SUB)
    doc.text(String(sub), tx + mw + 2, cyc, { baseline: 'middle' })
  }
  return y + 2 * r + 2
}

// Moldura arredondada do card (desenhada por cima, depois do conteúdo).
function drawCard(doc, x, top, w, bottom, radius = 2.5) {
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.3)
  doc.roundedRect(x, top, w, bottom - top, radius, radius, 'S')
}

// Campo "Rótulo: valor" com rótulo em negrito inline e o valor fluindo/quebrando
// na largura `w`. Respeita \n no valor. Retorna o Y (mm) abaixo do campo.
function drawField(doc, x, y, w, label, value, size = 8.2) {
  const lh = size * PT2MM * 1.35
  doc.setFontSize(size)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...BLUE_DARK)
  const labelStr = label + ' '
  const lw = doc.getTextWidth(labelStr)
  doc.text(labelStr, x, y, { baseline: 'top' })

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...TEXTC)
  // Monta as linhas do valor: 1ª divide espaço com o rótulo; demais usam w cheio.
  const valueLines = []
  let cur = ''
  const widthFor = () => (valueLines.length === 0 ? w - lw : w)
  for (const para of String(value).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    for (const wd of words) {
      const test = cur ? cur + ' ' + wd : wd
      if (doc.getTextWidth(test) > widthFor() && cur) { valueLines.push(cur); cur = wd }
      else cur = test
    }
    valueLines.push(cur); cur = ''   // limite de parágrafo → nova linha
  }
  while (valueLines.length && valueLines[valueLines.length - 1] === '') valueLines.pop()
  if (!valueLines.length) valueLines.push('')

  doc.text(valueLines[0], x + lw, y, { baseline: 'top' })
  let yy = y
  for (let i = 1; i < valueLines.length; i++) { yy += lh; doc.text(valueLines[i], x, yy, { baseline: 'top' }) }
  return y + valueLines.length * lh
}

// Grade de campos (rótulo em cima, valor embaixo) em `cols` colunas com divisória
// vertical fina entre elas. `fields`: [[label, value], ...]. Retorna Y abaixo.
function drawInfoGrid(doc, { x, y, w, fields, cols = 4, size = 8.2 }) {
  const lh = size * PT2MM * 1.32
  const colW = w / cols
  let yy = y
  for (let r = 0; r * cols < fields.length; r++) {
    const rowFields = fields.slice(r * cols, (r + 1) * cols)
    // Mede a altura da linha (maior célula).
    let maxLines = 1
    const cellVals = rowFields.map(([, val]) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(size)
      const vl = doc.splitTextToSize(String(val), colW - 3)
      maxLines = Math.max(maxLines, 1 + vl.length)
      return vl
    })
    const rowH = maxLines * lh + 2.4
    rowFields.forEach(([label], ci) => {
      const cx = x + ci * colW
      let cyy = yy + 1
      doc.setFont('helvetica', 'bold'); doc.setFontSize(size); doc.setTextColor(...BLUE_DARK)
      doc.text(label, cx, cyy, { baseline: 'top' }); cyy += lh
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...TEXTC)
      cellVals[ci].forEach(l => { doc.text(l, cx, cyy, { baseline: 'top' }); cyy += lh })
      if (ci > 0) { doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.line(cx - 1.5, yy, cx - 1.5, yy + rowH - 1) }
    })
    yy += rowH
  }
  return yy
}

// Badge de assinatura: pílula verde (digital) ou azul (física), "✓ Assinado ..."
// com o check desenhado como vetor (✓ não existe no core font helvetica).
function drawBadge(doc, { x, y, w, h, type }) {
  const isDigital = type === 'digital'
  doc.setFillColor(...(isDigital ? GREEN : BLUE))
  doc.roundedRect(x, y, w, h, h / 2.6, h / 2.6, 'F')

  const label = isDigital ? 'ASSINADO DIGITALMENTE' : 'ASSINADO FISICAMENTE'
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...WHITE)
  const tw = doc.getTextWidth(label)
  const checkW = 2.8
  const gap = 1.6
  const startX = x + (w - (checkW + gap + tw)) / 2
  const cy = y + h / 2
  // Check vetorial (duas linhas).
  doc.setDrawColor(...WHITE)
  doc.setLineWidth(0.55)
  doc.line(startX, cy + 0.2, startX + 1.0, cy + 1.4)
  doc.line(startX + 1.0, cy + 1.4, startX + checkW, cy - 1.4)
  doc.text(label, startX + checkW + gap, cy, { baseline: 'middle' })
}

/* ── Desenha uma tabela DIRETO no jsPDF ──────────────────────────────────────
 * A posição vertical é calculada matematicamente:
 *   baselineY = topoDaLinhaDeTexto + fontSizeMM * 0.35   (≈ metade da cap-height)
 * centrando cada linha de texto na sua faixa e o bloco no meio da célula. Texto
 * longo quebra com doc.splitTextToSize e a altura da linha cresce. Quebra de
 * página redesenha o header. Retorna o Y (mm) logo abaixo da tabela. */
function drawTable(doc, opts) {
  const {
    x, y, width, columns, rows,
    rowHeight = 6, headerHeight = 7,
    fontSize = 8, headerFontSize = 7.5,
    pageTop = 10, pageBottom = 288,
  } = opts

  const HEADER_BG = [19, 54, 110]      // navy sólido
  const padX      = 1.8                // respiro horizontal interno da célula (mm)
  const lineGap   = 1.18               // multiplicador de entrelinha

  // Largura de cada coluna (peso relativo → mm) e seu X de início.
  const totalW = columns.reduce((s, c) => s + (c.width || 1), 0)
  const colW = columns.map(c => (c.width || 1) / totalW * width)
  const colX = []
  let ax = x
  for (const w of colW) { colX.push(ax); ax += w }

  let cy = y

  const measure = (cells, fs, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(fs)
    const wrapped = cells.map((txt, ci) => doc.splitTextToSize(String(txt ?? ''), colW[ci] - padX * 2))
    const maxLines = Math.max(1, ...wrapped.map(w => w.length))
    return { wrapped, maxLines }
  }

  const drawRow = (cells, wrapped, rowH, isHeader) => {
    const fs    = isHeader ? headerFontSize : fontSize
    const fsMM  = fs * PT2MM
    const lineH = fsMM * lineGap

    if (isHeader) { doc.setFillColor(...HEADER_BG); doc.rect(x, cy, width, rowH, 'F') }

    doc.setTextColor(...(isHeader ? WHITE : TEXTC))
    cells.forEach((_, ci) => {
      const lines  = wrapped[ci]
      const n      = lines.length
      const blockH = n * lineH
      const col    = columns[ci]
      const align  = col.align || 'center'
      const bold   = isHeader || col.bold
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(fs)
      lines.forEach((ln, li) => {
        const lineMid = cy + (rowH - blockH) / 2 + (li + 0.5) * lineH
        const baseY   = lineMid + fsMM * 0.35
        if (align === 'left') doc.text(ln, colX[ci] + padX, baseY)
        else                  doc.text(ln, colX[ci] + colW[ci] / 2, baseY, { align: 'center' })
      })
    })

    doc.setDrawColor(...LINE); doc.setLineWidth(0.2)
    doc.line(x, cy + rowH, x + width, cy + rowH)
    cy += rowH
  }

  const headerTitles = columns.map(c => c.title)
  const drawHeaderRow = () => {
    const { wrapped, maxLines } = measure(headerTitles, headerFontSize, true)
    const rowH = Math.max(headerHeight, maxLines * (headerFontSize * PT2MM * lineGap) + 2.0)
    drawRow(headerTitles, wrapped, rowH, true)
  }

  const strokeSeg = (top, bottom) => {
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2)
    doc.rect(x, top, width, bottom - top, 'S')
    for (let i = 1; i < columns.length; i++) doc.line(colX[i], top, colX[i], bottom)
  }

  let segTop = cy
  drawHeaderRow()
  for (const row of rows) {
    const { wrapped, maxLines } = measure(row, fontSize, false)
    const rowH = Math.max(rowHeight, maxLines * (fontSize * PT2MM * lineGap) + 2.0)
    if (cy + rowH > pageBottom) {
      strokeSeg(segTop, cy)
      doc.addPage(); cy = pageTop; segTop = cy
      drawHeaderRow()
    }
    drawRow(row, wrapped, rowH, false)
  }
  strokeSeg(segTop, cy)
  return cy
}

/* ════════════════════════════════════════════════════════════════════════════
 * Geração do contrato — TUDO desenhado nativamente em jsPDF (sem html2canvas).
 * ════════════════════════════════════════════════════════════════════════════ */
export async function generateContractPDF(contract, opts = {}) {
  let logoDataUrl = null
  try {
    const resp = await fetch('/logo.png')
    const blob = await resp.blob()
    logoDataUrl = await new Promise(res => {
      const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob)
    })
  } catch {}

  let company = {}
  try { company = (await configApi.operatingCompany()).data } catch {}

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pw  = doc.internal.pageSize.getWidth()
  const ph  = doc.internal.pageSize.getHeight()

  const marginX = 11, marginTop = 12, marginBottom = 12
  const contentW  = pw - marginX * 2
  const pageBottom = ph - marginBottom

  const icons = await prepareIcons()
  const tables = buildTablesData(contract)

  // ── Dados derivados (antes vinham do HTML) ──
  const cc = contract.base_currency || 'USD'
  const ag = contract.agency_data || {}
  const ct = contract.contratante_data || {}
  const isJuridica = ct.payer_type === 'juridica'
  const periodo = (contract.departure_date || contract.return_date)
    ? `${fmtDateBR(contract.departure_date)} a ${fmtDateBR(contract.return_date)}`
    : '—'
  const accLines = contract.accommodation_lines || []
  const baseSum = accLines.reduce((s, l) => s + Number(l.value_per_person_usd || 0) * Number(l.quantity || 1), 0)
  const taxSum  = accLines.reduce((s, l) => s + Number(l.taxes_usd || 0) * Number(l.quantity || 1), 0)
  const clientFields = isJuridica ? [
    ['Razão social:', dashTxt(ct.full_name)],
    ['CNPJ:', dashTxt(ct.cnpj || ct.cpf)],
    ['E-mail:', dashTxt(ct.email)],
    ['Celular:', dashTxt(ct.mobile)],
    ['Endereço:', dashTxt(ct.address)],
  ] : [
    ['Nome:', dashTxt(ct.full_name)],
    ['Sexo:', dashTxt(ct.gender)],
    ['Data de nascimento:', ct.birth_date ? fmtDateBR(ct.birth_date) : '—'],
    ['CPF:', dashTxt(ct.cpf)],
    ['E-mail:', dashTxt(ct.email)],
    ['Celular:', dashTxt(ct.mobile)],
    ['Endereço:', dashTxt(ct.address)],
  ]

  const tableOpts = { rowHeight: 5.8, headerHeight: 7.2, fontSize: 7.8, headerFontSize: 7, pageTop: marginTop, pageBottom }

  let y = marginTop

  // ═══ CABEÇALHO ═══════════════════════════════════════════════════════════
  const headerTop = marginTop
  const headerH = 26
  // Logo (esquerda) — proporção preservada via getImageProperties.
  if (logoDataUrl) {
    try {
      const props = doc.getImageProperties(logoDataUrl)
      const ratio = props.width / props.height
      let lw = 42, lh = lw / ratio
      if (lh > 20) { lh = 20; lw = lh * ratio }
      doc.addImage(logoDataUrl, props.fileType || 'PNG', marginX, headerTop + 1, lw, lh)
    } catch {}
  }
  // Título (centro) com divisória vertical à esquerda.
  const titleX = marginX + 50
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3)
  doc.line(titleX - 6, headerTop, titleX - 6, headerTop + headerH)
  let ty = headerTop + 2
  for (const l of ['Contrato de', 'Prestação de', 'Serviços Turísticos']) {
    drawText(doc, l.toUpperCase(), titleX, ty, { size: 15, style: 'bold', color: BLUE_DARK, baseline: 'top' })
    ty += 6
  }
  drawText(doc, 'INSTRUMENTO PARTICULAR DE CONTRATAÇÃO DE VIAGEM', titleX, ty + 1, { size: 7, style: 'bold', color: BLUE, baseline: 'top' })
  // Meta (direita) alinhada à borda direita.
  const rightEdge = pw - marginX
  let my = headerTop + 2
  drawText(doc, ('Reserva nº ' + dashTxt(contract.reservation_number)).toUpperCase(), rightEdge, my, { size: 8.5, style: 'bold', color: BLUE_DARK, align: 'right', baseline: 'top' }); my += 5.5
  drawText(doc, 'DATA DA CONTRATAÇÃO', rightEdge, my, { size: 7.5, style: 'bold', color: BLUE_DARK, align: 'right', baseline: 'top' }); my += 4
  drawText(doc, contract.contract_date ? fmtDateBR(contract.contract_date) : '—', rightEdge, my, { size: 12, style: 'bold', color: BLUE_DARK, align: 'right', baseline: 'top' }); my += 6.5
  const badgeW = 52, badgeH = 7
  drawBadge(doc, { x: rightEdge - badgeW, y: my, w: badgeW, h: badgeH, type: contract.signature_type })
  // Borda inferior do cabeçalho.
  const headerBottom = headerTop + headerH
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3)
  doc.line(marginX, headerBottom, marginX + contentW, headerBottom)
  y = headerBottom + 4

  // ═══ 1. PARTES CONTRATANTES (esq.) + 2. RESUMO DA VIAGEM (dir.) ═══════════
  const drawPartes = (x, top, w) => {
    const pad = 3
    let yy = drawSectionTitle(doc, { x: x + pad, y: top + pad, iconPng: icons.w_users, main: '1. Partes Contratantes' }) + 1.5
    const colGap = 4
    const colW = (w - 2 * pad - colGap) / 2
    const colX1 = x + pad, colX2 = x + pad + colW + colGap
    const drawCol = (cx, head, fields) => {
      let cyy = yy
      drawText(doc, head.toUpperCase(), cx, cyy, { size: 8.5, style: 'bold', color: BLUE, baseline: 'top' }); cyy += 4.4
      for (const [lab, val] of fields) cyy = drawField(doc, cx, cyy, colW, lab, val, 8.2) + 1
      return cyy
    }
    const b1 = drawCol(colX1, 'Agência Intermediadora', [
      ['Empresa:', dashTxt(ag.name)], ['CNPJ:', dashTxt(ag.cnpj)], ['Telefone:', dashTxt(ag.phone)],
      ['E-mail:', dashTxt(ag.email)], ['Endereço:', dashTxt(ag.address)],
    ])
    const b2 = drawCol(colX2, 'Operadora Fornecedora', [
      ['Empresa:', dashTxt(company.company_name)], ['CNPJ:', dashTxt(company.cnpj)],
      ['Telefone:', dashTxt(company.mobile || company.phone)], ['E-mail:', dashTxt(company.email)],
      ['Endereço:', dashTxt(company.address)],
    ])
    const bottom = Math.max(b1, b2)
    doc.setDrawColor(...GRID); doc.setLineWidth(0.2)
    doc.line(x + pad + colW + colGap / 2, yy, x + pad + colW + colGap / 2, bottom)
    return bottom + pad
  }

  const drawResumo = (x, top, w) => {
    const pad = 3
    let yy = drawSectionTitle(doc, { x: x + pad, y: top + pad, iconPng: icons.w_plane, main: '2. Resumo da Viagem' }) + 1.5
    const innerX = x + pad, innerW = w - 2 * pad
    const rows = [
      ['briefcase', 'Pacote:', dashTxt(contract.package_name)],
      ['calendar', 'Período da viagem:', periodo],
      ['takeoff', 'Aeroporto de embarque:', dashTxt(contract.departure_airport)],
      ['message', 'Observações:', dashTxt(contract.observations)],
    ]
    for (const [icon, lab, val] of rows) {
      const iconSz = 4
      drawMiniIcon(doc, icons['b_' + icon], innerX, yy + 0.3, iconSz)
      const tx = innerX + iconSz + 2, tw = innerW - iconSz - 2
      drawText(doc, lab, tx, yy, { size: 8.2, style: 'bold', color: BLUE_DARK, baseline: 'top' })
      let cyy = yy + 4
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(...TEXTC)
      doc.splitTextToSize(val, tw).forEach(l => { doc.text(l, tx, cyy, { baseline: 'top' }); cyy += 3.8 })
      const rowBottom = cyy + 1
      doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.line(innerX, rowBottom, innerX + innerW, rowBottom)
      yy = rowBottom + 1.6
    }
    return yy + pad - 1.6
  }

  const gap12 = 4
  const w1 = (contentW - gap12) * 1.6 / 2.25
  const w2 = (contentW - gap12) - w1
  const top12 = y
  const b1 = drawPartes(marginX, top12, w1)
  const b2 = drawResumo(marginX + w1 + gap12, top12, w2)
  const cardBottom = Math.max(b1, b2)
  drawCard(doc, marginX, top12, w1, cardBottom)
  drawCard(doc, marginX + w1 + gap12, top12, w2, cardBottom)
  y = cardBottom + 4

  // ═══ 3. CLIENTE CONTRATANTE (card largura total) ══════════════════════════
  {
    const pad = 3
    const top3 = y
    let yy = drawSectionTitle(doc, { x: marginX + pad, y: top3 + pad, iconPng: icons.w_user, main: '3. Cliente Contratante', sub: '(Responsável pelo pagamento)' }) + 1
    doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.line(marginX + pad, yy, marginX + contentW - pad, yy); yy += 2
    const bottom3 = drawInfoGrid(doc, { x: marginX + pad, y: yy, w: contentW - 2 * pad, fields: clientFields, cols: 4, size: 8.2 })
    drawCard(doc, marginX, top3, contentW, bottom3 + pad)
    y = bottom3 + pad + 4
  }

  // ═══ 4. PASSAGEIROS — título + tabela nativa ══════════════════════════════
  y = checkPageBreak(doc, y, 24, marginTop, pageBottom)
  y = drawSectionTitle(doc, { x: marginX, y, iconPng: icons.w_users, main: '4. Passageiros', sub: '(Contratante e demais usuários)' }) + 1
  y = drawTable(doc, { x: marginX, y, width: contentW, ...tables.passengers, ...tableOpts }) + 3

  // ═══ 5. ACOMODAÇÕES CONTRATADAS ═══════════════════════════════════════════
  y = checkPageBreak(doc, y, 24, marginTop, pageBottom)
  y = drawSectionTitle(doc, { x: marginX, y, iconPng: icons.w_building, main: '5. Acomodações Contratadas' }) + 1
  y = drawTable(doc, { x: marginX, y, width: contentW, ...tables.accommodations, ...tableOpts }) + 3

  // ═══ 6. VALORES (esq. ~32%) + 7. PLANO DE PAGAMENTO (dir. ~66%) ═══════════
  // Ambos começam no MESMO Y; a altura do 6 não empurra o 7; Y final = max.
  const colGap = 4
  const sixW   = contentW * 0.32
  const sevenW = contentW - sixW - colGap
  const sevenX = marginX + sixW + colGap
  y = checkPageBreak(doc, y, 50, marginTop, pageBottom)
  const yStart = y

  const drawValores = (x, top, w) => {
    const pad = 3
    let yy = drawSectionTitle(doc, { x: x + pad, y: top + pad, iconPng: icons.w_dollar, main: '6. Valores e Condições', mainSize: 9, r: 3 }) + 1.5
    const innerX = x + pad, innerW = w - 2 * pad
    const rows = [
      ['dollar',   `Valor/pessoa (${cc})`, moneyTxt(baseSum), false],
      ['receipt',  `Taxas (${cc})`,        moneyTxt(taxSum), false],
      ['exchange', 'Câmbio',               dashTxt(fmtRate(contract.exchange_rate)), false],
      ['wallet',   `Total (${cc})`,        moneyTxt(contract.total_usd), true],
      ['file',     'Total (BRL)',          moneyTxt(contract.total_brl), false],
    ]
    for (const [icon, lab, val, isTotal] of rows) {
      const iconSz = 3.6
      drawMiniIcon(doc, icons['b_' + icon], innerX, yy + 0.4, iconSz)
      const lx = innerX + iconSz + 1.6
      const size = isTotal ? 9.5 : 8
      const mid = yy + (isTotal ? 2.2 : 1.9)
      drawText(doc, lab, lx, mid, { size, style: isTotal ? 'bold' : 'normal', color: isTotal ? BLUE : TEXTC, baseline: 'middle' })
      drawText(doc, val, innerX + innerW, mid, { size, style: 'bold', color: isTotal ? BLUE : BLUE_DARK, align: 'right', baseline: 'middle' })
      yy += isTotal ? 6.2 : 5.2
      doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.line(innerX, yy - 1.2, innerX + innerW, yy - 1.2)
    }
    return yy + pad - 1.2
  }

  const bottom6 = drawValores(marginX, yStart, sixW)
  drawCard(doc, marginX, yStart, sixW, bottom6)

  let y7 = drawSectionTitle(doc, { x: sevenX, y: yStart, iconPng: icons.w_card, main: '7. Plano de Pagamento' }) + 1
  const bottom7 = drawTable(doc, { x: sevenX, y: y7, width: sevenW, ...tables.payment, ...tableOpts })

  y = Math.max(bottom6, bottom7) + 3

  // ═══ CLÁUSULAS CONTRATUAIS ════════════════════════════════════════════════
  const clauses = contract.clauses_data || []
  if (clauses.length) {
    y += 4
    if (y + 16 > pageBottom) { doc.addPage(); y = marginTop }
    drawText(doc, 'CLÁUSULAS CONTRATUAIS', pw / 2, y, { size: 12, style: 'bold', color: NAV, align: 'center' })
    y += 8
    const lineHeight = 5.2
    clauses.forEach((clause) => {
      if (y + 12 > pageBottom) { doc.addPage(); y = marginTop }
      drawText(doc, clause.name, marginX, y, { size: 11, style: 'bold', color: NAV })
      y += 6.5
      const text  = htmlToText(clause.content)
      const lines = doc.splitTextToSize(text, contentW)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(30, 41, 59)
      lines.forEach((line) => {
        if (y + lineHeight > pageBottom) { doc.addPage(); y = marginTop }
        doc.text(line, marginX, y)
        y += lineHeight
      })
      y += 4
    })
  }

  // ═══ ASSINATURAS — só no contrato FÍSICO ══════════════════════════════════
  if (contract.signature_type !== 'digital') {
    if (y + 38 > pageBottom) { doc.addPage(); y = marginTop }
    y += 16
    const sigGap = 14
    const sigColW = (contentW - sigGap) / 2
    doc.setDrawColor(100, 116, 139); doc.setLineWidth(0.3)
    doc.line(marginX, y, marginX + sigColW, y)
    doc.line(marginX + sigColW + sigGap, y, pw - marginX, y)
    y += 5
    drawText(doc, 'Assinatura do Contratante', marginX + sigColW / 2, y, { size: 10, color: SUB, align: 'center' })
    drawText(doc, 'Assinatura da Operadora / Agência', marginX + sigColW + sigGap + sigColW / 2, y, { size: 10, color: SUB, align: 'center' })
  }

  // ═══ NUMERAÇÃO DE PÁGINA ══════════════════════════════════════════════════
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    drawText(doc, `Página ${i} de ${pageCount}`, pw / 2, ph - 8, { size: 8, color: [148, 163, 184], align: 'center' })
  }

  // ═══ NOME DO ARQUIVO ══════════════════════════════════════════════════════
  const firstName   = (ct.full_name || '').trim().split(/\s+/)[0] || ''
  const tripName    = contract.package_name || ''
  const companyName = company.company_name || ''
  const clean = (s, max = 40) => {
    const t = String(s).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim()
    return t.length > max ? t.slice(0, max).trim() : t
  }
  const parts = [clean('Contrato'), clean(tripName), clean(firstName, 20), clean(companyName, 30)].filter(Boolean)
  let base = parts.length > 1 ? parts.join(' - ') : `Contrato ${contract.reservation_number || contract.id}`
  if (base.length > 120) base = base.slice(0, 120).trim()
  const filename = `${base}.pdf`

  if (opts.output === 'blob')    return doc.output('blob')
  if (opts.output === 'bloburl') return URL.createObjectURL(doc.output('blob'))
  doc.save(filename)
}
