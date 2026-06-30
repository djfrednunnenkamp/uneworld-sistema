import jsPDF from 'jspdf'
import { configApi } from '../api'

// ── Paleta (RGB) — alinhamento e cores feitos 100% em jsPDF, sem CSS ──────────
const NAV        = [26, 45, 79]      // #1a2d4f (títulos de cláusulas)
const BLUE_DARK  = [25, 45, 88]      // #192D58
const BLUE       = [11, 79, 159]     // #0B4F9F
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
  // Chave de mescla da coluna "Acomodação": passageiros do MESMO quarto
  // (mesmo room_group) viram uma célula só, igual à lista de passageiros.
  const passengerSpans = guests.length ? guests.map(g => g.room_group ?? null) : [null]

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
        { title: 'Sexo',                width: 11, align: 'center' },
        { title: 'Data de nascimento',  width: 14, align: 'center' },
        { title: 'Passaporte/CPF',      width: 19, align: 'center' },
        { title: 'Acomodação',          width: 14, align: 'center' },
      ],
      rows: passengerRows,
      spanCol: 4,                 // mescla vertical da coluna "Acomodação"
      spanGroups: passengerSpans,
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
function drawSectionTitle(doc, { x, y, iconPng, main, sub = '', mainSize = 10, r = 2.9 }) {
  const cx = x + r
  const cyc = y + r
  drawIconCircle(doc, cx, cyc, r, iconPng)
  const tx = x + 2 * r + 2.2
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
  return y + 2 * r + 1.4
}

// Moldura arredondada do card (desenhada por cima, depois do conteúdo).
function drawCard(doc, x, top, w, bottom, radius = 2.5) {
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.3)
  doc.roundedRect(x, top, w, bottom - top, radius, radius, 'S')
}

// Campo "Rótulo: valor" com rótulo em negrito inline e o valor fluindo/quebrando
// na largura `w`. Respeita \n no valor. Retorna o Y (mm) abaixo do campo.
function drawField(doc, x, y, w, label, value, size = 8) {
  const lh = size * PT2MM * 1.22
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
function drawInfoGrid(doc, { x, y, w, fields, cols = 4, size = 8 }) {
  const lh = size * PT2MM * 1.2
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
    const rowH = maxLines * lh + 1.5
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
 * página redesenha o header. Retorna o Y (mm) logo abaixo da tabela.
 *
 * Mescla vertical (rowSpan): passe `spanCol` (índice da coluna) e `spanGroups`
 * (uma chave por linha). Linhas consecutivas com a MESMA chave não-vazia viram
 * uma única célula naquela coluna — o texto aparece uma vez, centralizado
 * verticalmente na faixa combinada, e a divisória interna some (igual à mescla
 * de "Tipo Apto." na lista de passageiros). */
function drawTable(doc, opts) {
  const {
    x, y, width, columns, rows,
    rowHeight = 6, headerHeight = 7,
    fontSize = 8, headerFontSize = 7.5,
    pageTop = 10, pageBottom = 288,
    spanCol = null, spanGroups = null,
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

  // Desenha o texto de uma célula centralizado V/H numa faixa de altura `cellH`.
  const drawCellText = (lines, ci, topY, cellH, fs, bold) => {
    const fsMM = fs * PT2MM, lineH = fsMM * lineGap, blockH = lines.length * lineH
    const align = columns[ci].align || 'center'
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(fs)
    lines.forEach((ln, li) => {
      const lineMid = topY + (cellH - blockH) / 2 + (li + 0.5) * lineH
      const baseY   = lineMid + fsMM * 0.35
      if (align === 'left') doc.text(ln, colX[ci] + padX, baseY)
      else                  doc.text(ln, colX[ci] + colW[ci] / 2, baseY, { align: 'center' })
    })
  }

  // Pré-mede o corpo (linhas quebradas + altura de cada linha).
  const bodyMeasured = rows.map(r => measure(r, fontSize, false))
  const rowHs = bodyMeasured.map(m => Math.max(rowHeight, m.maxLines * (fontSize * PT2MM * lineGap) + 2.0))
  const pageH = pageBottom - pageTop

  // Grupos de mescla na coluna `spanCol` (consecutivos com a mesma chave). Só
  // mescla se o grupo couber numa página — senão mantém células separadas.
  const spans = new Array(rows.length).fill(1)   // n de linhas no topo; 0 = coberta
  if (spanCol != null && spanGroups) {
    let i = 0
    while (i < rows.length) {
      const key = spanGroups[i]
      if (key == null || key === '') { i++; continue }
      let j = i + 1
      while (j < rows.length && spanGroups[j] === key) j++
      if (j - i > 1) {
        let gh = 0; for (let k = i; k < j; k++) gh += rowHs[k]
        if (gh <= pageH) { spans[i] = j - i; for (let k = i + 1; k < j; k++) spans[k] = 0 }
      }
      i = j
    }
  }

  const headerTitles = columns.map(c => c.title)
  let headerH = headerHeight
  const drawHeaderRow = () => {
    const m = measure(headerTitles, headerFontSize, true)
    headerH = Math.max(headerHeight, m.maxLines * (headerFontSize * PT2MM * lineGap) + 2.0)
    doc.setFillColor(...HEADER_BG); doc.rect(x, cy, width, headerH, 'F')
    doc.setTextColor(...WHITE)
    headerTitles.forEach((_, ci) => drawCellText(m.wrapped[ci], ci, cy, headerH, headerFontSize, true))
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(x, cy + headerH, x + width, cy + headerH)
    cy += headerH
  }

  const strokeSeg = (top, bottom) => {
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2)
    doc.rect(x, top, width, bottom - top, 'S')
    for (let i = 1; i < columns.length; i++) doc.line(colX[i], top, colX[i], bottom)
  }

  let segTop = cy
  drawHeaderRow()
  for (let idx = 0; idx < rows.length; idx++) {
    // Reserva o grupo mesclado inteiro p/ não quebrar no meio (quando cabe).
    let need = rowHs[idx]
    if (spans[idx] > 1) { let gh = 0; for (let k = idx; k < idx + spans[idx]; k++) gh += rowHs[k]; need = gh }
    if (cy + need > pageBottom) {
      strokeSeg(segTop, cy)
      doc.addPage(); cy = pageTop; segTop = cy
      drawHeaderRow()
    }

    const rowH = rowHs[idx]
    const { wrapped } = bodyMeasured[idx]
    columns.forEach((col, ci) => {
      doc.setTextColor(...TEXTC)
      if (ci === spanCol) {
        if (spans[idx] === 0) return                 // coberta pela mescla acima
        if (spans[idx] > 1) {
          let gh = 0; for (let k = idx; k < idx + spans[idx]; k++) gh += rowHs[k]
          drawCellText(wrapped[ci], ci, cy, gh, fontSize, col.bold)
          return
        }
      }
      drawCellText(wrapped[ci], ci, cy, rowH, fontSize, col.bold)
    })

    // Linha inferior da linha — pula o trecho da coluna mesclada quando a próxima
    // linha continua o mesmo grupo (deixa a célula combinada sem divisória).
    const by = cy + rowH
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2)
    if (spanCol != null && idx + 1 < rows.length && spans[idx + 1] === 0) {
      const cxs = colX[spanCol], cxe = colX[spanCol] + colW[spanCol]
      if (cxs > x)         doc.line(x, by, cxs, by)
      if (cxe < x + width) doc.line(cxe, by, x + width, by)
    } else {
      doc.line(x, by, x + width, by)
    }
    cy = by
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
  } catch { /* sem logo: segue sem o brasão */ }

  let company = {}
  try { company = (await configApi.operatingCompany()).data } catch { /* sem dados da operadora */ }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pw  = doc.internal.pageSize.getWidth()
  const ph  = doc.internal.pageSize.getHeight()

  const marginX = 11, marginTop = 6, marginBottom = 10
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

  const tableOpts = { rowHeight: 4.8, headerHeight: 5.8, fontSize: 7.2, headerFontSize: 6.6, pageTop: marginTop, pageBottom }

  let y = marginTop

  // ═══ CABEÇALHO ═══════════════════════════════════════════════════════════
  // Arquitetura de colunas: área da logo à esquerda, título (com divisória) ao
  // centro e meta/badge à direita. Header mais compacto e melhor alinhado.
  const headerTop = marginTop
  const headerH = 19
  const logoBoxX = marginX
  const logoBoxW = 42
  const titleX   = marginX + 45
  const dividerX = titleX - 6
  // Logo (esquerda) — centralizada DENTRO da área dela (não pelo canto),
  // proporção preservada via getImageProperties.
  if (logoDataUrl) {
    try {
      const props = doc.getImageProperties(logoDataUrl)
      const ratio = props.width / props.height
      let lw = 35, lh = lw / ratio
      if (lh > 16) { lh = 16; lw = lh * ratio }
      const logoX = logoBoxX + (logoBoxW - lw) / 2
      const logoY = headerTop + (headerH - lh) / 2 - 0.2
      doc.addImage(logoDataUrl, props.fileType || 'PNG', logoX, logoY, lw, lh)
    } catch { /* logo inválido: ignora */ }
  }
  // Título (centro) com divisória vertical à esquerda.
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3)
  doc.line(dividerX, headerTop, dividerX, headerTop + headerH)
  let ty = headerTop + 1
  for (const l of ['Contrato de', 'Prestação de', 'Serviços Turísticos']) {
    drawText(doc, l.toUpperCase(), titleX, ty, { size: 12.2, style: 'bold', color: BLUE_DARK, baseline: 'top' })
    ty += 4.5
  }
  drawText(doc, 'INSTRUMENTO PARTICULAR DE CONTRATAÇÃO DE VIAGEM', titleX, ty + 0.6, { size: 6.2, style: 'bold', color: BLUE, baseline: 'top' })
  // Meta (direita) alinhada à borda direita.
  const rightEdge = pw - marginX
  let my = headerTop + 0.6
  drawText(doc, ('Reserva nº ' + dashTxt(contract.reservation_number)).toUpperCase(), rightEdge, my, { size: 8.2, style: 'bold', color: BLUE_DARK, align: 'right', baseline: 'top' }); my += 4.2
  drawText(doc, 'DATA DA CONTRATAÇÃO', rightEdge, my, { size: 7, style: 'bold', color: BLUE_DARK, align: 'right', baseline: 'top' }); my += 3.1
  drawText(doc, contract.contract_date ? fmtDateBR(contract.contract_date) : '—', rightEdge, my, { size: 11, style: 'bold', color: BLUE_DARK, align: 'right', baseline: 'top' }); my += 4.5
  const badgeW = 50, badgeH = 5.8
  drawBadge(doc, { x: rightEdge - badgeW, y: my, w: badgeW, h: badgeH, type: contract.signature_type })
  // Borda inferior do cabeçalho.
  const headerBottom = headerTop + headerH
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3)
  doc.line(marginX, headerBottom, marginX + contentW, headerBottom)
  y = headerBottom + 3

  // ═══ 1. PARTES CONTRATANTES (esq.) + 2. RESUMO DA VIAGEM (dir.) ═══════════
  const drawPartes = (x, top, w) => {
    const pad = 2.4
    let yy = drawSectionTitle(doc, { x: x + pad, y: top + pad, iconPng: icons.w_users, main: '1. Partes Contratantes' }) + 1
    const colGap = 4
    const colW = (w - 2 * pad - colGap) / 2
    const colX1 = x + pad, colX2 = x + pad + colW + colGap
    const drawCol = (cx, head, fields) => {
      let cyy = yy
      drawText(doc, head.toUpperCase(), cx, cyy, { size: 8.2, style: 'bold', color: BLUE, baseline: 'top' }); cyy += 3.8
      for (const [lab, val] of fields) cyy = drawField(doc, cx, cyy, colW, lab, val, 8) + 0.6
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
    const pad = 2.4
    let yy = drawSectionTitle(doc, { x: x + pad, y: top + pad, iconPng: icons.w_plane, main: '2. Resumo da Viagem' }) + 1
    const innerX = x + pad, innerW = w - 2 * pad
    const rows = [
      ['briefcase', 'Pacote:', dashTxt(contract.package_name)],
      ['calendar', 'Período da viagem:', periodo],
      ['takeoff', 'Aeroporto de embarque:', dashTxt(contract.departure_airport)],
      ['message', 'Observações:', dashTxt(contract.observations)],
    ]
    for (const [icon, lab, val] of rows) {
      const iconSz = 3.6
      drawMiniIcon(doc, icons['b_' + icon], innerX, yy + 0.2, iconSz)
      const tx = innerX + iconSz + 1.8, tw = innerW - iconSz - 1.8
      drawText(doc, lab, tx, yy, { size: 8, style: 'bold', color: BLUE_DARK, baseline: 'top' })
      let cyy = yy + 3.5
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...TEXTC)
      doc.splitTextToSize(val, tw).forEach(l => { doc.text(l, tx, cyy, { baseline: 'top' }); cyy += 3.3 })
      const rowBottom = cyy + 0.6
      doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.line(innerX, rowBottom, innerX + innerW, rowBottom)
      yy = rowBottom + 1.1
    }
    return yy + pad - 1.1
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
  y = cardBottom + 2.5

  // ═══ Grade 2×2: 3│5 (linha 1) e 6│4 (linha 2) │ 7 em largura total embaixo ══
  y = checkPageBreak(doc, y, 40, marginTop, pageBottom)
  const colGap = 4
  const pad    = 2.4
  const halfW  = (contentW - colGap) / 2

  // Card de valores (item 6). Com `dry=true` só calcula a altura (não desenha),
  // pra dar pra centralizar verticalmente em relação a outro bloco.
  const drawValores = (x, top, w, dry = false) => {
    const p = 2.4, r = 2.7
    // Altura do título = igual ao retorno do drawSectionTitle (y + 2r + 1.4) + 1.
    let yy = (top + p) + 2 * r + 1.4 + 1
    if (!dry) drawSectionTitle(doc, { x: x + p, y: top + p, iconPng: icons.w_dollar, main: '6. Valores e Condições', mainSize: 8.5, r })
    const innerX = x + p, innerW = w - 2 * p
    const rows = [
      ['dollar',   `Valor/pessoa (${cc})`, moneyTxt(baseSum), false],
      ['receipt',  `Taxas (${cc})`,        moneyTxt(taxSum), false],
      ['exchange', 'Câmbio',               dashTxt(fmtRate(contract.exchange_rate)), false],
      ['wallet',   `Total (${cc})`,        moneyTxt(contract.total_usd), true],
      ['file',     'Total (BRL)',          moneyTxt(contract.total_brl), false],
    ]
    for (const [icon, lab, val, isTotal] of rows) {
      const iconSz = 3.3
      const lx = innerX + iconSz + 1.4
      const size = isTotal ? 9 : 7.8
      const mid = yy + (isTotal ? 2 : 1.7)
      if (!dry) {
        drawMiniIcon(doc, icons['b_' + icon], innerX, yy + 0.3, iconSz)
        drawText(doc, lab, lx, mid, { size, style: isTotal ? 'bold' : 'normal', color: isTotal ? BLUE : TEXTC, baseline: 'middle' })
        drawText(doc, val, innerX + innerW, mid, { size, style: 'bold', color: isTotal ? BLUE : BLUE_DARK, align: 'right', baseline: 'middle' })
      }
      yy += isTotal ? 5.2 : 4.4
      if (!dry) { doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.line(innerX, yy - 1, innerX + innerW, yy - 1) }
    }
    return yy + p - 1
  }

  // ── Linha 1: 3. Cliente Contratante (esq.) │ 5. Acomodações Contratadas (dir.) ──
  const topRow1 = y
  const startP1 = doc.internal.getNumberOfPages()
  const item3W = halfW * 0.82                    // item 3 (Contratante) mais estreito
  const item5W = contentW - colGap - item3W      // item 5 (Acomodações) ocupa o resto
  const item5X = marginX + item3W + colGap
  let yL = drawSectionTitle(doc, { x: marginX + pad, y: topRow1 + pad, iconPng: icons.w_user, main: '3. Cliente Contratante' }) + 0.8
  doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.line(marginX + pad, yL, marginX + item3W - pad, yL); yL += 1.6
  const bottom3 = drawInfoGrid(doc, { x: marginX + pad, y: yL, w: item3W - 2 * pad, fields: clientFields, cols: 2, size: 8 }) + pad
  drawCard(doc, marginX, topRow1, item3W, bottom3)
  let y5 = drawSectionTitle(doc, { x: item5X, y: topRow1, iconPng: icons.w_building, main: '5. Acomodações Contratadas', mainSize: 9 }) + 0.8
  const bottom5 = drawTable(doc, { x: item5X, y: y5, width: item5W, ...tables.accommodations, ...tableOpts })
  const row1Bottom = doc.internal.getNumberOfPages() > startP1 ? bottom5 : Math.max(bottom3, bottom5)

  // ── Linha 2: 4. Passageiros (esq.) │ 6. Valores e Condições (dir.) ──
  const topRow2 = row1Bottom + 2.5
  const startP2 = doc.internal.getNumberOfPages()
  const item6W = halfW * 0.58                   // item 6 (Valores) mais estreito
  const item6X = marginX + contentW - item6W    // encostado na margem direita
  const item4W = contentW - colGap - item6W     // item 4 ocupa o resto à esquerda
  // Item 4 (Passageiros) primeiro, p/ conhecer a altura e centralizar o 6 nela.
  let yP = drawSectionTitle(doc, { x: marginX, y: topRow2, iconPng: icons.w_users, main: '4. Passageiros' }) + 0.8
  const bottom4 = drawTable(doc, { x: marginX, y: yP, width: item4W, ...tables.passengers, ...tableOpts })
  const endP4 = doc.internal.getNumberOfPages()
  // Item 6 (Valores) centralizado verticalmente na altura do item 4 (quando o 4
  // não quebrou de página); senão começa junto ao topo da linha.
  const h6 = drawValores(item6X, topRow2, item6W, true) - topRow2
  const top6 = endP4 > startP2 ? topRow2 : topRow2 + Math.max(0, ((bottom4 - topRow2) - h6) / 2)
  doc.setPage(startP2)
  const bottom6 = drawValores(item6X, top6, item6W)
  drawCard(doc, item6X, top6, item6W, bottom6)
  doc.setPage(endP4)
  const row2Bottom = endP4 > startP2 ? bottom4 : Math.max(bottom6, bottom4)

  // ── Item 7: Plano de Pagamento — duas colunas (metades das parcelas) ──
  y = checkPageBreak(doc, row2Bottom + 2.5, 22, marginTop, pageBottom)
  let y7 = drawSectionTitle(doc, { x: marginX, y, iconPng: icons.w_card, main: '7. Plano de Pagamento' }) + 0.8
  const payRows   = tables.payment.rows
  const payHalf   = Math.ceil(payRows.length / 2)
  const col7W     = (contentW - colGap) / 2
  const col7RX    = marginX + col7W + colGap
  const startP7   = doc.internal.getNumberOfPages()
  const b7L = drawTable(doc, { x: marginX, y: y7, width: col7W, ...tables.payment, rows: payRows.slice(0, payHalf), ...tableOpts })
  const leftEndP7 = doc.internal.getNumberOfPages()
  doc.setPage(startP7)
  const rightRows = payRows.slice(payHalf)
  const b7R = rightRows.length
    ? drawTable(doc, { x: col7RX, y: y7, width: col7W, ...tables.payment, rows: rightRows, ...tableOpts })
    : y7
  const rightEndP7 = doc.internal.getNumberOfPages()
  if (leftEndP7 > rightEndP7)      { doc.setPage(leftEndP7); y = b7L + 2.5 }
  else if (rightEndP7 > leftEndP7) { y = b7R + 2.5 }
  else                             { y = Math.max(b7L, b7R) + 2.5 }

  // ═══ CLÁUSULAS CONTRATUAIS ════════════════════════════════════════════════
  const clauses = contract.clauses_data || []
  if (clauses.length) {
    // +3 do baseline do título (o texto cresce p/ cima) → ~2,5 mm de respiro
    // visível entre o fim da tabela e "CLÁUSULAS CONTRATUAIS".
    y += 3
    if (y + 13 > pageBottom) { doc.addPage(); y = marginTop }
    drawText(doc, 'CLÁUSULAS CONTRATUAIS', pw / 2, y, { size: 11, style: 'bold', color: NAV, align: 'center' })
    y += 6
    const lineHeight = 4.3
    clauses.forEach((clause) => {
      if (y + 10 > pageBottom) { doc.addPage(); y = marginTop }
      drawText(doc, clause.name, marginX, y, { size: 9.5, style: 'bold', color: NAV })
      y += 5.2
      const text  = htmlToText(clause.content)
      const lines = doc.splitTextToSize(text, contentW)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(30, 41, 59)
      lines.forEach((line) => {
        if (y + lineHeight > pageBottom) { doc.addPage(); y = marginTop }
        doc.text(line, marginX, y)
        y += lineHeight
      })
      y += 3
    })
  }

  // ═══ ASSINATURAS — só no contrato FÍSICO ══════════════════════════════════
  if (contract.signature_type !== 'digital') {
    if (y + 26 > pageBottom) { doc.addPage(); y = marginTop }
    y += 11
    const sigGap = 14
    const sigColW = (contentW - sigGap) / 2
    doc.setDrawColor(100, 116, 139); doc.setLineWidth(0.3)
    doc.line(marginX, y, marginX + sigColW, y)
    doc.line(marginX + sigColW + sigGap, y, pw - marginX, y)
    y += 4.5
    drawText(doc, 'Assinatura do Contratante', marginX + sigColW / 2, y, { size: 9.5, color: SUB, align: 'center' })
    drawText(doc, 'Assinatura da Operadora / Agência', marginX + sigColW + sigGap + sigColW / 2, y, { size: 9.5, color: SUB, align: 'center' })
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
