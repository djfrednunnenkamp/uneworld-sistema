import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { configApi } from '../api'

const NAV    = [26, 45, 79]      // #1a2d4f
const BORDER = [226, 232, 240]   // #e2e8f0
const MUTED  = [71, 85, 105]

// Fonte base 11pt — o usuário pediu pra não ir abaixo disso por legibilidade,
// preferindo espaçamento mais apertado a letra menor pra caber numa página.
const FONT_BODY = 11
const FONT_HEAD = 11
const PAD       = 1.3

const fmtDateBR = (iso) => {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('-')
  return (y && m && d) ? `${d}/${m}/${y}` : String(iso)
}

const fmtDateRangeBR = (start, end) => {
  if (!start && !end) return ''
  if (start && end) return `${fmtDateBR(start)} – ${fmtDateBR(end)}`
  return fmtDateBR(start || end)
}

const fmtMoney = (v) => v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

// Câmbio vem do banco com 4 casas decimais fixas (ex: "5.4000") — exibe sem
// zeros à direita desnecessários (5,4 em vez de 5,4000; 5,4321 mantém as 4 se forem reais).
const fmtRate = (v) => v == null || v === '' ? '' : String(Number(v)).replace('.', ',')

/* Converte o HTML rico das cláusulas em texto simples (com quebras de
 * parágrafo preservadas) — formatação (negrito, listas) ainda não é
 * reproduzida no PDF; fica pra uma próxima etapa. */
function htmlToText(html) {
  if (!html) return ''
  const div = document.createElement('div')
  div.innerHTML = html
  div.querySelectorAll('p, li, div, br, h1, h2, h3, h4').forEach(el => el.insertAdjacentText('afterend', '\n'))
  return div.textContent.replace(/\n{3,}/g, '\n\n').trim()
}

function sectionHeader(doc, title, y) {
  const pw = doc.internal.pageSize.getWidth()
  doc.setFillColor(...NAV)
  doc.rect(10, y, pw - 20, 5.5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(255, 255, 255)
  doc.text(title, 13, y + 3.9)
  return y + 5.5
}

function kvTable(doc, y, rows) {
  // rows: [[label, value, label2, value2]] — 4 colunas (2 pares label/valor por linha)
  autoTable(doc, {
    startY: y,
    body: rows,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: FONT_BODY, cellPadding: PAD, lineColor: BORDER, lineWidth: 0.2, textColor: [30, 41, 59] },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: MUTED, cellWidth: 33 },
      1: { cellWidth: 62 },
      2: { fontStyle: 'bold', textColor: MUTED, cellWidth: 33 },
      3: { cellWidth: 'auto' },
    },
    margin: { left: 10, right: 10 },
    tableLineColor: BORDER,
    tableLineWidth: 0.2,
  })
  return doc.lastAutoTable.finalY
}

function dataTable(doc, y, head, body) {
  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: FONT_BODY, cellPadding: PAD, lineColor: BORDER, lineWidth: 0.2 },
    headStyles: { fillColor: NAV, textColor: 255, fontStyle: 'bold', fontSize: FONT_HEAD },
    margin: { left: 10, right: 10 },
  })
  return doc.lastAutoTable.finalY
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
  let y = 8

  // ── Cabeçalho compacto: logo + título + reserva/data na mesma área ──
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', 10, y, 19, 12) } catch {}
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11.5)
  doc.setTextColor(...NAV)
  doc.text('COMPRA DE SERVIÇOS TURÍSTICOS E CONTRATO DE VIAGEM POR ADESÃO', pw / 2 + 8, y + 4.5, { align: 'center' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...MUTED)
  doc.text('EXCLUSIVO PARA GRUPOS', pw / 2 + 8, y + 9, { align: 'center' })
  doc.setFontSize(8.5)
  doc.text(`Reserva nº ${contract.reservation_number || '—'}    ·    Data desta contratação: ${fmtDateBR(contract.contract_date)}`, pw / 2 + 8, y + 13, { align: 'center' })
  // Forma de assinatura — em destaque no cabeçalho.
  const sigLabel = contract.signature_type === 'digital' ? 'ASSINADO DIGITALMENTE' : 'ASSINADO FISICAMENTE'
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...NAV)
  doc.text(sigLabel, pw / 2 + 8, y + 17.5, { align: 'center' })
  y += 21

  // Agência
  y = sectionHeader(doc, 'AGÊNCIA DE VIAGEM (INTERMEDIADORA)', y)
  const ag = contract.agency_data || {}
  y = kvTable(doc, y, [
    ['Empresa', ag.name || '', 'CNPJ', ag.cnpj || ''],
    ['Telefone', ag.phone || '', 'Celular', ag.mobile || ''],
    ['E-mail', ag.email || '', 'Responsável', ag.responsible || ''],
    ['Endereço', { content: ag.address || '', colSpan: 3 }],
  ])

  // Operadora
  y = sectionHeader(doc, 'OPERADORA (FORNECEDORA DO PACOTE TURÍSTICO)', y + 1.5)
  y = kvTable(doc, y, [
    ['Nome/Empresa', company.company_name || '', 'CNPJ', company.cnpj || ''],
    ['Vendedor', company.seller || '', 'Telefone fixo', company.phone || ''],
    ['Celular', company.mobile || '', 'E-mail', company.email || ''],
    ['Endereço', { content: company.address || '', colSpan: 3 }],
  ])

  // Pacote de viagem
  y = sectionHeader(doc, 'PACOTE DE VIAGEM', y + 1.5)
  y = kvTable(doc, y, [
    ['Nome do pacote', contract.package_name || '', 'Data da viagem', fmtDateRangeBR(contract.departure_date, contract.return_date)],
    ['Aeroporto de embarque', contract.departure_airport || '', 'Observações', contract.observations || ''],
  ])

  // Tipos de acomodação
  y = sectionHeader(doc, 'TIPOS DE ACOMODAÇÃO / VALORES POR PESSOA', y + 1.5)
  const accomRows = (contract.accommodation_lines || []).map(l => [
    l.accommodation_type_name || '', fmtMoney(l.value_per_person_usd), fmtMoney(l.taxes_usd),
    String(l.quantity ?? ''), fmtMoney(l.total_usd),
  ])
  y = dataTable(doc, y, ['Tipo de Acomodação', 'Valor/pessoa (USD)', 'Taxas (USD)', 'Quantidade', 'Total (USD)'],
    accomRows.length ? accomRows : [['—', '', '', '', '']])

  // Valores extras / descontos (só aparece quando há). Percentual incide sobre o
  // subtotal das acomodações.
  const accomSubtotal = (contract.accommodation_lines || []).reduce(
    (s, l) => s + (Number(l.value_per_person_usd || 0) + Number(l.taxes_usd || 0)) * Number(l.quantity || 1), 0)
  const adjRows = (contract.adjustments || []).map(a => {
    const amount = a.mode === 'percentual' ? accomSubtotal * Number(a.percent || 0) / 100 : Number(a.value_usd || 0)
    const tipo = `${a.kind === 'desconto' ? 'Desconto' : 'Acréscimo'}${a.mode === 'percentual' ? ` (${Number(a.percent || 0)}%)` : ''}`
    return [
      a.description || (a.kind === 'desconto' ? 'Desconto' : 'Acréscimo'),
      tipo,
      `${a.kind === 'desconto' ? '- ' : '+ '}${fmtMoney(amount)}`,
    ]
  })
  if (adjRows.length) {
    y = sectionHeader(doc, 'VALORES EXTRAS / DESCONTOS', y + 1.5)
    y = dataTable(doc, y, ['Descrição', 'Tipo', 'Valor (USD)'], adjRows)
  }

  // Dados de pagamento
  y = sectionHeader(doc, 'DADOS DOS PAGAMENTOS / VALORES', y + 1.5)
  y = kvTable(doc, y, [
    ['Soma total (USD)', fmtMoney(contract.total_usd), 'Total em (BRL)', fmtMoney(contract.total_brl)],
    ['Câmbio', fmtRate(contract.exchange_rate), '', ''],
    ['Recebido na entrada', fmtMoney(contract.received_down_payment_brl), 'Recebido a prazo', fmtMoney(contract.received_installments_brl)],
  ])

  // Pagamento — à vista (uma linha) ou parcelado (entrada + parcelas)
  const installments = contract.installments || []
  const aVista = contract.payment_type === 'a_vista'
  const entrada  = installments.find(i => i.kind === 'entrada')
  const parcelas = installments.filter(i => i.kind === 'parcela').sort((a, b) => a.installment_number - b.installment_number)
  const installmentRows = []
  if (aVista) {
    const p = parcelas[0] || entrada
    if (p) installmentRows.push(['À vista', p.detail || '', fmtDateBR(p.due_date), fmtMoney(p.value_brl), p.payment_method || ''])
  } else {
    if (entrada) installmentRows.push(['Entrada', entrada.detail || '', fmtDateBR(entrada.due_date), fmtMoney(entrada.value_brl), entrada.payment_method || ''])
    parcelas.forEach(p => installmentRows.push([`${p.installment_number}ª parcela`, p.detail || '', fmtDateBR(p.due_date), fmtMoney(p.value_brl), p.payment_method || '']))
  }
  if (installmentRows.length) {
    y = sectionHeader(doc, aVista ? 'PAGAMENTO' : 'PARCELAS', y + 1.5)
    y = dataTable(doc, y, [aVista ? 'Pagamento' : 'Parcela', 'Detalhe do pagamento', 'Para (data)', 'Valor (BRL)', 'Forma de pagamento'], installmentRows)
  }

  // Cliente contratante — só força nova página se realmente não houver espaço.
  const checkPageBreak = (needed) => {
    const ph = doc.internal.pageSize.getHeight()
    if (y + needed > ph - 12) { doc.addPage(); y = 10 }
  }
  const ct = contract.contratante_data || {}
  const isJuridica = ct.payer_type === 'juridica'
  checkPageBreak(28)
  y = sectionHeader(doc, 'CLIENTE: CONTRATANTE / RESPONSÁVEL PELO PAGAMENTO', y + 1.5)
  y = kvTable(doc, y, isJuridica ? [
    ['Razão social', ct.full_name || '', 'CNPJ', ct.cpf || ''],
    ['Celular', ct.mobile || '', 'E-mail', ct.email || ''],
    ['Endereço', { content: ct.address || '', colSpan: 3 }],
  ] : [
    ['Nome completo', ct.full_name || '', 'Sexo', ct.gender || ''],
    ['Data de nascimento', fmtDateBR(ct.birth_date), 'CPF', ct.cpf || ''],
    ['Celular', ct.mobile || '', 'E-mail', ct.email || ''],
  ])

  // Nome dos passageiros — precisa de espaço pro título + cabeçalho da
  // tabela + ao menos 1 linha; senão o autoTable desenha o cabeçalho
  // sozinho no fim da página e só as linhas no topo da seguinte.
  checkPageBreak(28)
  y = sectionHeader(doc, 'NOME DOS PASSAGEIROS (CONTRATANTE E DEMAIS USUÁRIOS)', y + 1.5)
  const guestRows = (contract.guests || []).map(g => {
    const p = g.passenger_data || {}
    return [p.full_name || '', p.gender || '', fmtDateBR(p.birth_date), p.passport || '', p.cpf || '', g.accommodation_type_name || '']
  })
  y = dataTable(doc, y, ['Nome completo', 'Sexo', 'Data de nascimento', 'Passaporte', 'CPF', 'Acomodação'],
    guestRows.length ? guestRows : [['—', '', '', '', '', '']])

  // ── Cláusulas contratuais — texto corrido ──
  // Começa direto após o conteúdo anterior se ainda houver espaço razoável
  // na página atual; só quebra pra uma nova se realmente não couber o
  // título + começo da primeira cláusula (evita página quase vazia no meio
  // do documento).
  const clauses = contract.clauses_data || []
  if (clauses.length) {
    const phClauses = doc.internal.pageSize.getHeight()
    if (y + 30 > phClauses - 15) { doc.addPage(); y = 14 } else { y += 8 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...NAV)
    doc.text('CLÁUSULAS CONTRATUAIS', pw / 2, y, { align: 'center' })
    y += 8

    const lineHeight = 5.2
    const maxWidth   = pw - 20

    clauses.forEach((clause) => {
      const ph = doc.internal.pageSize.getHeight()
      if (y + 12 > ph - 15) { doc.addPage(); y = 14 }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...NAV)
      doc.text(clause.name, 10, y)
      y += 6.5

      const text  = htmlToText(clause.content)
      const lines = doc.splitTextToSize(text, maxWidth)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10.5)
      doc.setTextColor(30, 41, 59)
      lines.forEach((line) => {
        const ph2 = doc.internal.pageSize.getHeight()
        if (y + lineHeight > ph2 - 15) { doc.addPage(); y = 14 }
        doc.text(line, 10, y)
        y += lineHeight
      })
      y += 4
    })
  }

  // ── Assinaturas — sempre no final do documento, depois de tudo ──
  const phSig = doc.internal.pageSize.getHeight()
  if (y + 38 > phSig - 15) { doc.addPage(); y = 14 }
  y += 16
  const sigGap = 14
  const sigColW = (pw - 20 - sigGap) / 2
  doc.setDrawColor(100, 116, 139)
  doc.setLineWidth(0.3)
  doc.line(10, y, 10 + sigColW, y)
  doc.line(10 + sigColW + sigGap, y, pw - 10, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(71, 85, 105)
  doc.text('Assinatura do Contratante', 10 + sigColW / 2, y, { align: 'center' })
  doc.text('Assinatura da Operadora / Agência', 10 + sigColW + sigGap + sigColW / 2, y, { align: 'center' })

  // ── Numeração de página ──
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    const ph = doc.internal.pageSize.getHeight()
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(148, 163, 184)
    doc.text(`Página ${i} de ${pageCount}`, pw / 2, ph - 8, { align: 'center' })
  }

  const filename = `contrato_${contract.reservation_number || contract.id}.pdf`
  // Para pré-visualizar (em vez de baixar): retorna o PDF como blob URL.
  if (opts.output === 'blob')    return doc.output('blob')
  if (opts.output === 'bloburl') return URL.createObjectURL(doc.output('blob'))
  doc.save(filename)
}
