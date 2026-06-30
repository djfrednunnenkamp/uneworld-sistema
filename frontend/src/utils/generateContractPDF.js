import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { configApi } from '../api'

const NAV = [26, 45, 79]      // #1a2d4f

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

// ── Helpers de escape pra montar o HTML da 1ª página com dados do usuário ──
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// Texto com travessão de fallback quando vazio.
const dash = (s) => { const t = String(s ?? '').trim(); return t ? esc(t) : '—' }
// Endereço (ou outro multilinha) preservando quebras como <br>.
const addr = (s) => { const t = String(s ?? '').trim(); return t ? esc(t).replace(/\n/g, '<br>') : '—' }
const money = (v) => { const m = fmtMoney(v); return m === '' ? '0,00' : m }

// ── Versões "texto puro" (SEM escape HTML) para as tabelas desenhadas direto
//    no jsPDF (doc.text recebe a string crua; escapar quebraria & e aspas). ──
const dashTxt = (s) => { const t = String(s ?? '').trim(); return t || '—' }
const moneyTxt = (v) => { const m = fmtMoney(v); return m === '' ? '0,00' : m }

/* ── Ícones em SVG (não emoji) ──────────────────────────────────────────────
 * Emoji é renderizado de forma imprevisível pelo html2canvas (o glifo sai
 * descentralizado e varia conforme o sistema). Usamos SVG de traço como <img>
 * data-URI: tamanho fixo e centralização por posição absoluta = determinístico.
 * Corpos no padrão Lucide (viewBox 0 0 24 24, traço, cantos arredondados). */
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

/* Rasteriza um SVG para PNG data-URI. O browser decodifica o vetor
 * corretamente para o canvas; o html2canvas, por sua vez, desenha PNG de forma
 * confiável (SVG ele renderiza errado). Resolve com null se falhar. */
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
 * num mapa nome→PNG, usado depois no HTML. */
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

/* ── Desenha uma tabela DIRETO no jsPDF (sem html2canvas) ────────────────────
 * Foi o que finalmente resolveu a centralização vertical: o html2canvas
 * posiciona o texto fora do centro da célula em qualquer estrutura HTML
 * (<table> ou grid). Aqui a posição é calculada matematicamente:
 *   baselineY = topoDaLinhaDeTexto + fontSizeMM * 0.35   (≈ metade da cap-height)
 * o que centra cada linha de texto na sua faixa, e o bloco inteiro (1 ou 2
 * linhas) no meio da célula. Texto longo quebra com doc.splitTextToSize e a
 * altura da linha cresce para acomodá-lo. Quebra de página redesenha o header.
 * Retorna o Y (mm) logo abaixo da tabela. */
function drawPdfTable(doc, opts) {
  const {
    x, y, width, columns, rows,
    rowHeight = 6, headerHeight = 7,
    fontSize = 8, headerFontSize = 7.5,
    pageTop = 10, pageBottom = 288,
  } = opts

  const HEADER_BG = [19, 54, 110]      // navy sólido (no lugar do gradiente azul)
  const LINE      = [201, 216, 238]    // var(--line) #C9D8EE
  const TEXT      = [13, 27, 53]       // var(--text) #0D1B35
  const HEAD_TEXT = [255, 255, 255]
  const PT2MM     = 0.352777778        // pontos → mm
  const padX      = 1.8                // respiro horizontal interno da célula (mm)
  const lineGap   = 1.18               // multiplicador de entrelinha

  // Largura de cada coluna (peso relativo → mm) e seu X de início.
  const totalW = columns.reduce((s, c) => s + (c.width || 1), 0)
  const colW = columns.map(c => (c.width || 1) / totalW * width)
  const colX = []
  let ax = x
  for (const w of colW) { colX.push(ax); ax += w }

  let cy = y

  // Quebra o texto de cada célula conforme a largura da coluna e mede nº de linhas.
  const measure = (cells, fs, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(fs)
    const wrapped = cells.map((txt, ci) => doc.splitTextToSize(String(txt ?? ''), colW[ci] - padX * 2))
    const maxLines = Math.max(1, ...wrapped.map(w => w.length))
    return { wrapped, maxLines }
  }

  // Desenha uma linha (header ou corpo) já com a altura calculada.
  const drawRow = (cells, wrapped, rowH, isHeader) => {
    const fs    = isHeader ? headerFontSize : fontSize
    const fsMM  = fs * PT2MM
    const lineH = fsMM * lineGap

    if (isHeader) { doc.setFillColor(...HEADER_BG); doc.rect(x, cy, width, rowH, 'F') }

    doc.setTextColor(...(isHeader ? HEAD_TEXT : TEXT))
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
        // Centra o BLOCO de linhas na célula e cada linha na sua faixa.
        const lineMid = cy + (rowH - blockH) / 2 + (li + 0.5) * lineH
        const baseY   = lineMid + fsMM * 0.35
        if (align === 'left') doc.text(ln, colX[ci] + padX, baseY)
        else                  doc.text(ln, colX[ci] + colW[ci] / 2, baseY, { align: 'center' })
      })
    })

    // Linha horizontal inferior da célula.
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

  // Bordas externas + verticais internas de um trecho contínuo (por página).
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
    if (cy + rowH > pageBottom) {            // não cabe: fecha trecho e quebra página
      strokeSeg(segTop, cy)
      doc.addPage(); cy = pageTop; segTop = cy
      drawHeaderRow()
    }
    drawRow(row, wrapped, rowH, false)
  }
  strokeSeg(segTop, cy)
  return cy
}

/* Monta o HTML dos BLOCOS VISUAIS da 1ª página (tudo MENOS as 3 tabelas, que
 * agora são desenhadas direto no jsPDF). Cada filho de nível superior leva um
 * data-block para ser posicionado individualmente; as tabelas entram entre eles
 * em generateContractPDF. O CSS é escopado em `.ctpdf`. */
function buildFirstPageHTML(contract, company, logoDataUrl, icons = {}) {
  const cc = contract.base_currency || 'USD'
  const ag = contract.agency_data || {}
  const ct = contract.contratante_data || {}
  const isJuridica = ct.payer_type === 'juridica'
  // Ícone branco dentro do círculo azul da seção / ícone azul de apoio.
  // Se o PNG do ícone falhar (icons[...] vazio), não gera <img src=""> quebrado:
  // o círculo fica vazio e o mini-ícone é simplesmente omitido.
  const circleIcon = (name) => {
    const src = icons['w_' + name]
    return `<span class="icon">${src ? `<img src="${src}"/>` : ''}</span>`
  }
  const miniIcon = (name) => {
    const src = icons['b_' + name]
    return src ? `<img class="mini-img" src="${src}"/>` : `<span class="mini-img"></span>`
  }
  // Título de seção isolado (vira um bloco próprio, desenhado acima da tabela nativa).
  const titleBlock = (id, name, main, sub = '', fontSize = '11.5px') =>
    `<div class="section-title" data-block="${id}" style="font-size:${fontSize}">${circleIcon(name)}<span class="ttl">${main}${sub ? ` <span style="font-size:10px;">${sub}</span>` : ''}</span></div>`

  const periodo = (contract.departure_date || contract.return_date)
    ? `${fmtDateBR(contract.departure_date)} a ${fmtDateBR(contract.return_date)}`
    : '—'

  const sigText = contract.signature_type === 'digital' ? '✓ Assinado Digitalmente' : '✓ Assinado Fisicamente'

  // ── Valores (resumo) ── soma das bases e das taxas (×quantidade) para
  // bater com o Total do contrato.
  const lines = contract.accommodation_lines || []
  const baseSum = lines.reduce((s, l) => s + Number(l.value_per_person_usd || 0) * Number(l.quantity || 1), 0)
  const taxSum  = lines.reduce((s, l) => s + Number(l.taxes_usd || 0) * Number(l.quantity || 1), 0)

  // ── Bloco do cliente contratante (físico × jurídico) ──
  const clientFields = isJuridica ? [
    ['Razão social', dash(ct.full_name)],
    ['CNPJ', dash(ct.cnpj || ct.cpf)],
    ['E-mail', dash(ct.email)],
    ['Celular', dash(ct.mobile)],
    ['Endereço', addr(ct.address)],
  ] : [
    ['Nome', dash(ct.full_name)],
    ['Sexo', dash(ct.gender)],
    ['Data de nascimento', ct.birth_date ? fmtDateBR(ct.birth_date) : '—'],
    ['CPF', dash(ct.cpf)],
    ['E-mail', dash(ct.email)],
    ['Celular', dash(ct.mobile)],
    ['Endereço', addr(ct.address)],
  ]
  const clientGrid = clientFields.map(([k, v]) => `<div class="field"><strong>${k}:</strong><br>${v}</div>`).join('')

  const logoTag = logoDataUrl
    ? `<img class="logo" src="${logoDataUrl}" alt="Uneworld" />`
    : `<div class="logo"></div>`

  const css = `
    .ctpdf { --blue-dark:#192D58; --blue:#0B4F9F; --blue-light:#0E9EDD; --line:#C9D8EE; --soft:#F6F9FD; --text:#0D1B35; color:var(--text); font-family:Arial,Helvetica,sans-serif; font-size:9.5px; }
    .ctpdf * { box-sizing:border-box; }
    /* Evita overflow horizontal de campos longos (endereço, observações). */
    .ctpdf .field, .ctpdf .travel-row > div { overflow-wrap:anywhere; word-break:break-word; }
    .ctpdf .page { width:188mm; background:white; padding:0; position:relative; overflow:hidden; }
    .ctpdf .header { display:grid; grid-template-columns:160px 1fr 160px; gap:18px; align-items:start; padding-bottom:6px; border-bottom:1px solid var(--line); }
    .ctpdf .logo { width:140px; max-width:100%; max-height:72px; height:auto; object-fit:contain; display:block; }
    .ctpdf .title { border-left:1px solid var(--line); padding-left:18px; }
    .ctpdf .title h1 { margin:0; color:var(--blue-dark); font-size:20px; line-height:1.12; font-weight:800; text-transform:uppercase; }
    .ctpdf .title p { margin:6px 0 0; color:var(--blue); font-size:9.5px; font-weight:700; text-transform:uppercase; }
    .ctpdf .meta { color:var(--blue-dark); font-weight:800; text-transform:uppercase; padding-top:6px; }
    .ctpdf .meta .label { font-size:10px; margin-bottom:3px; }
    .ctpdf .meta .value { font-size:14px; margin-bottom:7px; }
    .ctpdf .signature-card { width:100%; min-height:28px; padding:0 10px; border-radius:7px; background:linear-gradient(135deg,#0B4F9F,#0E9EDD); color:white; font-size:10px; font-weight:700; text-transform:uppercase; box-shadow:0 3px 10px rgba(11,79,159,.25); display:flex; align-items:center; justify-content:center; text-align:center; line-height:1.1; }
    .ctpdf .grid-top { display:grid; grid-template-columns:1.6fr 0.65fr; gap:12px; margin-top:6px; }
    .ctpdf .section { border:1px solid var(--line); border-radius:8px; padding:8px 9px; background:linear-gradient(180deg,#fff,#fbfdff); }
    .ctpdf .section-title { display:flex; align-items:center; gap:7px; color:var(--blue-dark); font-weight:800; font-size:11.5px; line-height:27px; text-transform:uppercase; margin:0 0 5px; }
    .ctpdf .section-title .ttl { display:flex; align-items:center; gap:4px; min-height:27px; line-height:1.1; }
    /* Ícone do círculo centralizado com flex (fora de tabela, html2canvas ok) —
       sem números mágicos de top/left. */
    .ctpdf .icon { display:flex; align-items:center; justify-content:center; min-width:27px; width:27px; height:27px; border-radius:50%; background:var(--blue); flex-shrink:0; }
    .ctpdf .icon img { width:15px; height:15px; display:block; }
    .ctpdf .two-cols { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .ctpdf .col + .col { border-left:1px solid var(--line); padding-left:12px; }
    .ctpdf h3 { margin:0 0 7px; color:var(--blue); font-size:10px; text-transform:uppercase; }
    .ctpdf .field { margin-bottom:5px; line-height:1.25; }
    .ctpdf .field strong { color:var(--blue-dark); margin-right:4px; }
    .ctpdf .travel-row { display:grid; grid-template-columns:22px 1fr; gap:7px; align-items:center; padding:4.5px 0; border-bottom:1px solid #D8E3F3; }
    .ctpdf .travel-row:last-child { border-bottom:0; }
    /* Mini-ícone centralizado na sua coluna via flex — sem padding-top manual. */
    .ctpdf .mini-icon { display:flex; align-items:center; justify-content:center; }
    .ctpdf .mini-img { width:14px; height:14px; display:block; }
    .ctpdf .client { margin-top:3px; }
    .ctpdf .client-grid { display:grid; grid-template-columns:1.3fr .8fr 1fr 1fr; gap:8px; border-top:1px solid #D8E3F3; padding-top:4px; }
    .ctpdf .client-grid .field { display:block; border-right:1px solid #D8E3F3; min-height:18px; padding-right:7px; margin:0; line-height:1.15; }
    .ctpdf .client-grid .field strong { display:block; margin-bottom:1px; }
    .ctpdf .client-grid .field:last-child { border-right:0; }
    .ctpdf .values-list { display:grid; gap:7px; padding-top:4px; }
    /* Ícone, rótulo e valor na mesma linha de base vertical via align-items:center —
       o valor da direita não fica mais deslocado pra cima. */
    .ctpdf .value-row { display:grid; grid-template-columns:22px 1fr auto; gap:7px; align-items:center; min-height:22px; padding:0; border-bottom:1px solid #D8E3F3; }
    .ctpdf .value-row .mini-icon { height:22px; display:flex; align-items:center; justify-content:center; }
    .ctpdf .value-row span, .ctpdf .value-row strong { display:flex; align-items:center; min-height:22px; line-height:1.1; }
    .ctpdf .value-row.total { color:var(--blue); font-size:13.5px; font-weight:800; }
    .ctpdf .valores-card { width:60mm; }
    .ctpdf .valores-card .section-title { font-size:11.5px; line-height:27px; }
  `

  return `<style>${css}</style>
  <div class="ctpdf">
    <main class="page">
      <header class="header" data-block="header">
        ${logoTag}
        <div class="title">
          <h1>Contrato de<br>Prestação de<br>Serviços Turísticos</h1>
          <p>Instrumento particular de contratação de viagem</p>
        </div>
        <div class="meta">
          <div class="label">Reserva nº ${dash(contract.reservation_number)}</div>
          <div class="label">Data da contratação</div>
          <div class="value">${contract.contract_date ? fmtDateBR(contract.contract_date) : '—'}</div>
          <div class="signature-card">${sigText}</div>
        </div>
      </header>

      <section class="grid-top" data-block="gridTop">
        <div class="section">
          <div class="section-title">${circleIcon('users')}<span class="ttl">1. Partes Contratantes</span></div>
          <div class="two-cols">
            <div class="col">
              <h3>Agência Intermediadora</h3>
              <div class="field"><strong>Empresa:</strong> ${dash(ag.name)}</div>
              <div class="field"><strong>CNPJ:</strong> ${dash(ag.cnpj)}</div>
              <div class="field"><strong>Telefone:</strong> ${dash(ag.phone)}</div>
              <div class="field"><strong>E-mail:</strong> ${dash(ag.email)}</div>
              <div class="field"><strong>Endereço:</strong><br>${addr(ag.address)}</div>
            </div>
            <div class="col">
              <h3>Operadora Fornecedora</h3>
              <div class="field"><strong>Empresa:</strong> ${dash(company.company_name)}</div>
              <div class="field"><strong>CNPJ:</strong> ${dash(company.cnpj)}</div>
              <div class="field"><strong>Telefone:</strong> ${dash(company.mobile || company.phone)}</div>
              <div class="field"><strong>E-mail:</strong> ${dash(company.email)}</div>
              <div class="field"><strong>Endereço:</strong><br>${addr(company.address)}</div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">${circleIcon('plane')}<span class="ttl">2. Resumo da Viagem</span></div>
          <div class="travel-row"><div class="mini-icon">${miniIcon('briefcase')}</div><div><strong>Pacote:</strong><br>${dash(contract.package_name)}</div></div>
          <div class="travel-row"><div class="mini-icon">${miniIcon('calendar')}</div><div><strong>Período da viagem:</strong><br>${periodo}</div></div>
          <div class="travel-row"><div class="mini-icon">${miniIcon('takeoff')}</div><div><strong>Aeroporto de embarque:</strong><br>${dash(contract.departure_airport)}</div></div>
          <div class="travel-row"><div class="mini-icon">${miniIcon('message')}</div><div><strong>Observações:</strong><br>${addr(contract.observations)}</div></div>
        </div>
      </section>

      <section class="section client" data-block="client">
        <div class="section-title">${circleIcon('user')}<span class="ttl">3. Cliente Contratante <span style="font-size:10px;">(Responsável pelo pagamento)</span></span></div>
        <div class="client-grid">${clientGrid}</div>
      </section>

      ${titleBlock('title4', 'users', '4. Passageiros', '(Contratante e demais usuários)')}

      ${titleBlock('title5', 'building', '5. Acomodações Contratadas')}

      <section class="section valores-card" data-block="valores">
        <div class="section-title">${circleIcon('dollar')}<span class="ttl">6. Valores e Condições</span></div>
        <div class="values-list">
          <div class="value-row"><span class="mini-icon">${miniIcon('dollar')}</span><span>Valor por pessoa (${esc(cc)})</span><strong>${money(baseSum)}</strong></div>
          <div class="value-row"><span class="mini-icon">${miniIcon('receipt')}</span><span>Taxas (${esc(cc)})</span><strong>${money(taxSum)}</strong></div>
          <div class="value-row"><span class="mini-icon">${miniIcon('exchange')}</span><span>Câmbio</span><strong>${dash(fmtRate(contract.exchange_rate))}</strong></div>
          <div class="value-row total"><span class="mini-icon">${miniIcon('wallet')}</span><span>Total (${esc(cc)})</span><strong>${money(contract.total_usd)}</strong></div>
          <div class="value-row"><span class="mini-icon">${miniIcon('file')}</span><span>Total em (BRL)</span><strong>${money(contract.total_brl)}</strong></div>
        </div>
      </section>

      ${titleBlock('title7', 'card', '7. Plano de Pagamento', '', '19.5px')}
    </main>
  </div>`
}

/* Renderiza cada bloco visual de nível superior (com data-block) num canvas
 * próprio e devolve um mapa data-block → canvas. As tabelas NÃO entram aqui —
 * são desenhadas direto no jsPDF por drawPdfTable. */
async function renderFirstPageBlocks(html) {
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:184mm;background:#fff;z-index:-1;'
  holder.innerHTML = html
  document.body.appendChild(holder)
  try {
    // Garante que imagens (logo, ícones) terminem de carregar antes de capturar.
    await Promise.all(Array.from(holder.querySelectorAll('img')).map(img =>
      img.complete ? Promise.resolve() : new Promise(res => { img.onload = img.onerror = res })))
    const pageEl = holder.querySelector('.page')
    const map = {}
    let auto = 0
    for (const block of Array.from(pageEl.children)) {
      const id = block.getAttribute('data-block') || `b${auto++}`
      map[id] = await html2canvas(block, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false })
    }
    return map
  } finally {
    document.body.removeChild(holder)
  }
}

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

  // ── 1ª página: blocos visuais via html2canvas + 3 tabelas via jsPDF nativo ──
  const marginX = 11, marginTop = 10, marginBottom = 9, blockGap = 2
  const contentW = pw - marginX * 2
  const usableH  = ph - marginTop - marginBottom
  const pageBottom = ph - marginBottom
  const icons  = await prepareIcons()
  const html   = buildFirstPageHTML(contract, company, logoDataUrl, icons)
  const blocks = await renderFirstPageBlocks(html)
  const tables = buildTablesData(contract)
  let y = marginTop

  // Coloca um bloco-imagem na posição atual; quebra/fatiamento de página igual
  // ao fluxo anterior. `gap` é o respiro adicionado depois do bloco.
  const placeImg = (canvas, gap = blockGap) => {
    if (!canvas) return
    const fullH = canvas.height * contentW / canvas.width
    if (fullH <= usableH) {
      if (y + fullH > pageBottom && y > marginTop) { doc.addPage(); y = marginTop }
      doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', marginX, y, contentW, fullH)
      y += fullH + gap
    } else {
      const pxPerMm = canvas.height / fullH
      let srcY = 0
      while (srcY < canvas.height) {
        let availMm = pageBottom - y
        if (availMm < 14) { doc.addPage(); y = marginTop; availMm = usableH }
        const sliceHpx = Math.min(Math.round(availMm * pxPerMm), canvas.height - srcY)
        const tmp = document.createElement('canvas')
        tmp.width = canvas.width
        tmp.height = sliceHpx
        tmp.getContext('2d').drawImage(canvas, 0, srcY, canvas.width, sliceHpx, 0, 0, canvas.width, sliceHpx)
        const sliceHmm = sliceHpx / pxPerMm
        doc.addImage(tmp.toDataURL('image/jpeg', 0.92), 'JPEG', marginX, y, contentW, sliceHmm)
        y += sliceHmm
        srcY += sliceHpx
        if (srcY < canvas.height) { doc.addPage(); y = marginTop }
      }
      y += gap
    }
  }

  // Garante espaço mínimo (título + header + 1 linha) antes de iniciar uma tabela.
  const ensureRoom = (h) => { if (y + h > pageBottom) { doc.addPage(); y = marginTop } }

  // Opções comuns das 3 tabelas (células finas + texto centralizado de verdade).
  const tableOpts = { rowHeight: 5.8, headerHeight: 7.2, fontSize: 7.8, headerFontSize: 7, pageTop: marginTop, pageBottom }

  // Blocos visuais do topo.
  placeImg(blocks.header)
  placeImg(blocks.gridTop, 1)
  placeImg(blocks.client)

  // 4. Passageiros — título (imagem) + tabela nativa.
  ensureRoom(22)
  placeImg(blocks.title4, 1)
  y = drawPdfTable(doc, { x: marginX, y, width: contentW, ...tables.passengers, ...tableOpts })
  y += 3

  // 5. Acomodações Contratadas.
  ensureRoom(22)
  placeImg(blocks.title5, 1)
  y = drawPdfTable(doc, { x: marginX, y, width: contentW, ...tables.accommodations, ...tableOpts })
  y += 3

  // ── 6. Valores e Condições (esq.) + 7. Plano de Pagamento (dir.) lado a lado ──
  // Ambos começam no MESMO Y; a altura do bloco 6 não empurra o 7. O Y final é o
  // mais baixo dos dois (max das bordas inferiores).
  const colGap = 4                              // gap horizontal entre 6 e 7 (mm)
  const sixW   = contentW * 0.32                // item 6 ≈ 32% da largura útil
  const sevenW = contentW - sixW - colGap       // item 7 ≈ 66% da largura útil
  const sevenX = marginX + sixW + colGap
  ensureRoom(46)                                // espaço mínimo p/ os dois iniciarem juntos
  const yStart = y

  // Bloco 6 (esquerda) — card visual via html2canvas, largura sixW.
  let bottom6 = yStart
  if (blocks.valores) {
    const c6 = blocks.valores
    const h6 = c6.height * sixW / c6.width
    doc.addImage(c6.toDataURL('image/jpeg', 0.92), 'JPEG', marginX, yStart, sixW, h6)
    bottom6 = yStart + h6
  }

  // Bloco 7 (direita) — título (imagem) + tabela nativa, largura sevenW, X deslocado.
  let y7 = yStart
  if (blocks.title7) {
    const c7 = blocks.title7
    const h7 = c7.height * sevenW / c7.width
    doc.addImage(c7.toDataURL('image/jpeg', 0.92), 'JPEG', sevenX, y7, sevenW, h7)
    y7 += h7 + 1
  }
  const bottom7 = drawPdfTable(doc, { x: sevenX, y: y7, width: sevenW, ...tables.payment, ...tableOpts })

  y = Math.max(bottom6, bottom7) + 3

  // ── Cláusulas contratuais — seguem logo após as informações, na mesma
  //    página se houver espaço (sem forçar página nova). ──
  const clauses = contract.clauses_data || []
  if (clauses.length) {
    y += 4
    if (y + 16 > ph - marginBottom) { doc.addPage(); y = marginTop }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...NAV)
    doc.text('CLÁUSULAS CONTRATUAIS', pw / 2, y, { align: 'center' })
    y += 8

    const lineHeight = 5.2

    clauses.forEach((clause) => {
      if (y + 12 > ph - marginBottom) { doc.addPage(); y = marginTop }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...NAV)
      doc.text(clause.name, marginX, y)
      y += 6.5

      const text  = htmlToText(clause.content)
      const lines = doc.splitTextToSize(text, contentW)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10.5)
      doc.setTextColor(30, 41, 59)
      lines.forEach((line) => {
        if (y + lineHeight > ph - marginBottom) { doc.addPage(); y = marginTop }
        doc.text(line, marginX, y)
        y += lineHeight
      })
      y += 4
    })
  }

  // ── Assinaturas — só no contrato FÍSICO (impresso e assinado à mão). No
  //    digital a assinatura é feita na Autentique, então não desenha os campos. ──
  if (contract.signature_type !== 'digital') {
    if (y + 38 > ph - marginBottom) { doc.addPage(); y = marginTop }
    y += 16
    const sigGap = 14
    const sigColW = (contentW - sigGap) / 2
    doc.setDrawColor(100, 116, 139)
    doc.setLineWidth(0.3)
    doc.line(marginX, y, marginX + sigColW, y)
    doc.line(marginX + sigColW + sigGap, y, pw - marginX, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(71, 85, 105)
    doc.text('Assinatura do Contratante', marginX + sigColW / 2, y, { align: 'center' })
    doc.text('Assinatura da Operadora / Agência', marginX + sigColW + sigGap + sigColW / 2, y, { align: 'center' })
  }

  // ── Numeração de página ──
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(148, 163, 184)
    doc.text(`Página ${i} de ${pageCount}`, pw / 2, ph - 8, { align: 'center' })
  }

  // Nome do arquivo: "Contrato - <viagem> - <1º nome do pagante> - <empresa>".
  // Partes vazias são omitidas; caracteres inválidos pra nome de arquivo são removidos.
  const ct = contract.contratante_data || {}
  const firstName   = (ct.full_name || '').trim().split(/\s+/)[0] || ''
  const tripName    = contract.package_name || ''
  const companyName = company.company_name || ''
  // Limpa caracteres inválidos e limita cada parte para não gerar nomes enormes
  // quando o pacote ou a empresa têm nome muito comprido.
  const clean = (s, max = 40) => {
    const t = String(s).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim()
    return t.length > max ? t.slice(0, max).trim() : t
  }
  const parts = [clean('Contrato'), clean(tripName), clean(firstName, 20), clean(companyName, 30)].filter(Boolean)
  let base = parts.length > 1 ? parts.join(' - ') : `Contrato ${contract.reservation_number || contract.id}`
  if (base.length > 120) base = base.slice(0, 120).trim()   // teto final de segurança
  const filename = `${base}.pdf`
  // Para pré-visualizar (em vez de baixar): retorna o PDF como blob URL.
  if (opts.output === 'blob')    return doc.output('blob')
  if (opts.output === 'bloburl') return URL.createObjectURL(doc.output('blob'))
  doc.save(filename)
}
