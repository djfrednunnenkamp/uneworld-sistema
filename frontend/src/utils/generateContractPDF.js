import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { configApi } from '../api'

const NAV    = [26, 45, 79]      // #1a2d4f
const BORDER = [226, 232, 240]   // #e2e8f0
const MUTED  = [71, 85, 105]

const fmtDateBR = (iso) => {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('-')
  return (y && m && d) ? `${d}/${m}/${y}` : String(iso)
}

const fmtMoney = (v) => v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

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
  doc.rect(10, y, pw - 20, 7, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(255, 255, 255)
  doc.text(title, 13, y + 5)
  return y + 7
}

function kvTable(doc, y, rows) {
  // rows: [[label, value, label2, value2]] — 4 colunas (2 pares label/valor por linha)
  autoTable(doc, {
    startY: y,
    body: rows,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.2, lineColor: BORDER, lineWidth: 0.2, textColor: [30, 41, 59] },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: MUTED, cellWidth: 35 },
      1: { cellWidth: 60 },
      2: { fontStyle: 'bold', textColor: MUTED, cellWidth: 35 },
      3: { cellWidth: 'auto' },
    },
    margin: { left: 10, right: 10 },
    tableLineColor: BORDER,
    tableLineWidth: 0.2,
  })
  return doc.lastAutoTable.finalY
}

export async function generateContractPDF(contract) {
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
  let y = 10

  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', 10, y, 22, 14) } catch {}
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...NAV)
  doc.text('COMPRA DE SERVIÇOS TURÍSTICOS E CONTRATO DE VIAGEM POR ADESÃO', pw / 2 + 10, y + 6, { align: 'center' })
  doc.setFontSize(9)
  doc.text('EXCLUSIVO PARA GRUPOS', pw / 2 + 10, y + 11, { align: 'center' })
  y += 20

  y = kvTable(doc, y, [['Reserva nº', contract.reservation_number || '—', 'Data desta contratação', fmtDateBR(contract.contract_date)]])

  // Agência
  y = sectionHeader(doc, 'AGÊNCIA DE VIAGEM (INTERMEDIADORA)', y + 3)
  const ag = contract.agency_data || {}
  y = kvTable(doc, y, [
    ['Empresa', ag.name || '', 'CNPJ', ag.cnpj || ''],
    ['Telefone', ag.phone || '', 'Celular', ag.mobile || ''],
    ['E-mail', ag.email || '', 'Responsável', ag.responsible || ''],
    ['Endereço', { content: ag.address || '', colSpan: 3 }],
  ])

  // Operadora
  y = sectionHeader(doc, 'OPERADORA (FORNECEDORA DO PACOTE TURÍSTICO)', y + 3)
  y = kvTable(doc, y, [
    ['Nome/Empresa', company.company_name || '', 'CNPJ', company.cnpj || ''],
    ['Vendedor', company.seller || '', 'Telefone fixo', company.phone || ''],
    ['Celular', company.mobile || '', 'E-mail', company.email || ''],
    ['Endereço', { content: company.address || '', colSpan: 3 }],
  ])

  // Pacote de viagem
  y = sectionHeader(doc, 'PACOTE DE VIAGEM', y + 3)
  y = kvTable(doc, y, [
    ['Nome do pacote', contract.package_name || '', 'Data da viagem', fmtDateBR(contract.departure_date)],
    ['Aeroporto de embarque', contract.departure_airport || '', 'Observações', contract.observations || ''],
  ])

  // Tipos de acomodação
  y = sectionHeader(doc, 'TIPOS DE ACOMODAÇÃO / VALORES POR PESSOA', y + 3)
  const accomRows = (contract.accommodation_lines || []).map(l => [
    l.accommodation_type_name || '', fmtMoney(l.value_per_person_usd), fmtMoney(l.taxes_usd),
    String(l.quantity ?? ''), fmtMoney(l.total_usd),
  ])
  autoTable(doc, {
    startY: y,
    head: [['Tipo de Acomodação', 'Valor/pessoa (USD)', 'Taxas (USD)', 'Quantidade', 'Total (USD)']],
    body: accomRows.length ? accomRows : [['—', '', '', '', '']],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.2, lineColor: BORDER, lineWidth: 0.2 },
    headStyles: { fillColor: NAV, textColor: 255, fontStyle: 'bold', fontSize: 8 },
    margin: { left: 10, right: 10 },
  })
  y = doc.lastAutoTable.finalY

  // Dados de pagamento
  y = sectionHeader(doc, 'DADOS DOS PAGAMENTOS / VALORES', y + 3)
  y = kvTable(doc, y, [
    ['Soma total (USD)', fmtMoney(contract.total_usd), 'Total em (BRL)', fmtMoney(contract.total_brl)],
    ['Câmbio', contract.exchange_rate ?? '', 'Forma de pagamento', contract.payment_method || ''],
    ['Recebido na entrada', fmtMoney(contract.received_down_payment_brl), 'Recebido a prazo', fmtMoney(contract.received_installments_brl)],
  ])

  // Parcelas
  const installments = contract.installments || []
  const entrada  = installments.find(i => i.kind === 'entrada')
  const parcelas = installments.filter(i => i.kind === 'parcela').sort((a, b) => a.installment_number - b.installment_number)
  const installmentRows = []
  if (entrada) installmentRows.push(['Entrada', entrada.detail || '', fmtDateBR(entrada.due_date), fmtMoney(entrada.value_brl)])
  parcelas.forEach(p => installmentRows.push([`${p.installment_number}ª parcela`, p.detail || '', fmtDateBR(p.due_date), fmtMoney(p.value_brl)]))
  if (installmentRows.length) {
    y = sectionHeader(doc, 'PARCELAS', y + 3)
    autoTable(doc, {
      startY: y,
      head: [['Parcela', 'Detalhe do pagamento', 'Para (data)', 'Valor (BRL)']],
      body: installmentRows,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.2, lineColor: BORDER, lineWidth: 0.2 },
      headStyles: { fillColor: NAV, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      margin: { left: 10, right: 10 },
    })
    y = doc.lastAutoTable.finalY
  }

  // Cliente contratante
  const checkPageBreak = (needed) => {
    const ph = doc.internal.pageSize.getHeight()
    if (y + needed > ph - 15) { doc.addPage(); y = 12 }
  }
  checkPageBreak(40)
  y = sectionHeader(doc, 'CLIENTE: CONTRATANTE / RESPONSÁVEL PELO PAGAMENTO', y + 3)
  const ct = contract.contratante_data || {}
  y = kvTable(doc, y, [
    ['Nome completo', ct.full_name || '', 'Sexo', ct.gender || ''],
    ['Data de nascimento', fmtDateBR(ct.birth_date), 'CPF', ct.cpf || ''],
    ['Celular', ct.mobile || '', 'E-mail', ct.email || ''],
  ])

  // Nome dos passageiros
  checkPageBreak(20)
  y = sectionHeader(doc, 'NOME DOS PASSAGEIROS (CONTRATANTE E DEMAIS USUÁRIOS)', y + 3)
  const guestRows = (contract.guests || []).map(g => {
    const p = g.passenger_data || {}
    return [p.full_name || '', p.gender || '', fmtDateBR(p.birth_date), p.passport || '', p.cpf || '', g.accommodation_type_name || '']
  })
  autoTable(doc, {
    startY: y,
    head: [['Nome completo', 'Sexo', 'Data de nascimento', 'Passaporte', 'CPF', 'Acomodação']],
    body: guestRows.length ? guestRows : [['—', '', '', '', '', '']],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.2, lineColor: BORDER, lineWidth: 0.2 },
    headStyles: { fillColor: NAV, textColor: 255, fontStyle: 'bold', fontSize: 8 },
    margin: { left: 10, right: 10 },
  })
  y = doc.lastAutoTable.finalY

  // ── Cláusulas contratuais — uma ou mais páginas, texto corrido ──
  const clauses = contract.clauses_data || []
  if (clauses.length) {
    doc.addPage()
    y = 14
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...NAV)
    doc.text('CLÁUSULAS CONTRATUAIS', pw / 2, y, { align: 'center' })
    y += 8

    const lineHeight = 4.6
    const maxWidth   = pw - 20

    clauses.forEach((clause) => {
      const ph = doc.internal.pageSize.getHeight()
      if (y + 12 > ph - 15) { doc.addPage(); y = 14 }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(...NAV)
      doc.text(clause.name, 10, y)
      y += 6

      const text  = htmlToText(clause.content)
      const lines = doc.splitTextToSize(text, maxWidth)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
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
  doc.save(filename)
}
