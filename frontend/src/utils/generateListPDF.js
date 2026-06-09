import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return ''
  const [y, m, day] = String(d).split('-')
  return `${day}/${m}/${y}`
}

function fmtGender(g) {
  if (!g) return ''
  const s = String(g).toLowerCase()
  if (s.startsWith('m') || s === 'masculino') return 'M'
  if (s.startsWith('f') || s === 'feminino')  return 'F'
  return g.slice(0, 1).toUpperCase()
}

function fmtNat(n) {
  if (!n) return ''
  // "BRASILEIRA" → "BRA"
  const map = { BRASILEIRA: 'BRA', BRASILEIR: 'BRA', BRASILEIRO: 'BRA', BRA: 'BRA' }
  const up = n.toUpperCase().replace(/[^A-Z]/g, '')
  return map[up] || up.slice(0, 3)
}

function passportRg(e) {
  const pp = e.selected_passport_data?.doc_number || e.passenger_passport
  return pp || e.passenger_rg || ''
}

function hasBirthdayInTrip(birthDate, startDate, endDate) {
  if (!birthDate || !startDate || !endDate) return false
  try {
    const b  = new Date(birthDate)
    const s  = new Date(startDate)
    const en = new Date(endDate)
    const bm = b.getMonth(); const bd = b.getDate()
    let cur = new Date(s)
    while (cur <= en) {
      if (cur.getMonth() === bm && cur.getDate() === bd) return true
      cur.setDate(cur.getDate() + 1)
    }
  } catch {}
  return false
}

// ── PDF theme ─────────────────────────────────────────────────────────────────

const NAV    = [26, 45, 79]      // #1a2d4f
const BLUE   = [46, 109, 180]    // #2e6db4
const HEADER = [248, 250, 252]   // #f8fafc
const BORDER = [226, 232, 240]   // #e2e8f0

function applyTableStyle(doc, startY, head, body, colStyles = {}) {
  autoTable(doc, {
    startY,
    head: [head],
    body,
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: { top: 3, right: 4, bottom: 3, left: 4 },
      lineColor: BORDER,
      lineWidth: 0.2,
      textColor: [30, 41, 59],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: NAV,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
      overflow: 'hidden',
      minCellHeight: 9,
      cellPadding: { top: 3, right: 4, bottom: 3, left: 4 },
    },
    alternateRowStyles: { fillColor: HEADER },
    columnStyles: colStyles,
    margin: { left: 14, right: 14 },
    tableLineColor: BORDER,
    tableLineWidth: 0.2,
  })
  return doc.lastAutoTable.finalY
}

function addPageHeader(doc, title, listName, listNumber, dates, logoDataUrl) {
  const pw = doc.internal.pageSize.getWidth()

  // Logo area
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', 14, 8, 24, 14) } catch {}
  }

  // Title block (centered)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...NAV)
  doc.text(`✈ ${title}`, pw / 2, 13, { align: 'center' })

  doc.setFontSize(8.5)
  doc.setTextColor(71, 85, 105)
  doc.text(`${listName} (${dates})`, pw / 2, 19, { align: 'center' })

  // List number badge (top-right)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...NAV)
  doc.text(`LISTA DE PASSAGEIROS Nº ${String(listNumber).padStart(5, '0')}`, pw - 14, 11, { align: 'right' })

  // Divider
  doc.setDrawColor(...BLUE)
  doc.setLineWidth(0.6)
  doc.line(14, 24, pw - 14, 24)

  return 28  // Y after header
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateListPDF(list, enrollments, opts) {
  // Load logo
  let logoDataUrl = null
  try {
    const resp = await fetch('/logo.png')
    const blob = await resp.blob()
    logoDataUrl = await new Promise(res => {
      const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob)
    })
  } catch {}

  const doc    = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pax    = enrollments.filter(e => !e.is_block && e.enrollment_status !== 'cancelado')
  const dates  = `${fmtDate(list.start_date)} A ${fmtDate(list.end_date)}`
  const lname  = (list.name || '').toUpperCase()
  const lnum   = list.id

  // Accommodation room-mate map: accommodation → first pax in that room
  const accomPairs = {}
  pax.forEach(e => {
    if (e.accommodation) {
      if (!accomPairs[e.accommodation]) accomPairs[e.accommodation] = []
      accomPairs[e.accommodation].push(e.id)
    }
  })

  let isFirst = true

  function newSection(title, summaryLine) {
    if (!isFirst) doc.addPage()
    isFirst = false
    const y = addPageHeader(doc, title, lname, lnum, dates, logoDataUrl)
    if (summaryLine) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(71, 85, 105)
      doc.text(summaryLine, 14, y - 1)
      return y + 3
    }
    return y
  }

  // ── 1. Lista de Passageiros Confirmados ─────────────────────────────────────
  if (opts.confirmados) {
    // Summary: Apto. Single: N  Apto. Duplo Twin: N  ...
    const accomCounts = {}
    pax.forEach(e => { const k = e.accommodation || '—'; accomCounts[k] = (accomCounts[k] || 0) + 1 })
    const summary = Object.entries(accomCounts).map(([k, v]) => `${k}: ${v}`).join('   ') + `   Total: ${pax.length}`
    const y = newSection('LISTA DE PASSAGEIROS CONFIRMADOS', summary)

    const body = pax.map((e, i) => {
      const isBirthday = hasBirthdayInTrip(e.passenger_birth_date, list.start_date, list.end_date)
      const bdate = (isBirthday ? '🎂 ' : '') + fmtDate(e.passenger_birth_date)
      const name  = e.passenger_name + (e.passenger_is_guide ? ' (Guia acompanhante)' : '')
      return [
        i + 1,
        e.ticket_status === 'via_bloqueio' ? 'Sim' : 'Não',
        name,
        e.accommodation || '',
        bdate,
        fmtNat(e.passenger_nationality),
        fmtGender(e.passenger_gender),
        passportRg(e),
        e.passenger_cpf || '',
        e.agency_name || '',
      ]
    })

    // Nº(7) + Bloq(22) + Nome(62) + Apto(26) + Nasc(22) + Nac(16) + Gen(16) + Pass(24) + CPF(28) + Agência(46) = 269
    applyTableStyle(doc, y,
      ['Nº', 'Bloqueio aéreo', 'Nome', 'Tipo Apto.', 'Nascimento', 'Nac.', 'Gênero', 'PASS / RG', 'CPF', 'Agência'],
      body,
      { 0:{cellWidth:7}, 1:{cellWidth:22}, 2:{cellWidth:62}, 3:{cellWidth:26}, 4:{cellWidth:22}, 5:{cellWidth:16,halign:'center'}, 6:{cellWidth:16,halign:'center'}, 7:{cellWidth:24}, 8:{cellWidth:28}, 9:{cellWidth:46} }
    )
  }

  // ── 2. Lista com Data de Expedição ──────────────────────────────────────────
  if (opts.data_expedicao) {
    const y = newSection('LISTA COM DATA DE EXPEDIÇÃO', null)
    const body = pax.map((e, i) => [
      i + 1,
      e.passenger_name + (e.passenger_is_guide ? ' (Guia acompanhante)' : ''),
      fmtDate(e.passenger_birth_date),
      fmtNat(e.passenger_nationality),
      fmtGender(e.passenger_gender),
      passportRg(e),
      fmtDate(e.passenger_passport_issue),
      fmtDate(e.passenger_passport_expiry),
      e.passenger_cpf || '',
    ])
    applyTableStyle(doc, y,
      ['Nº', 'Nome', 'Nascimento', 'Nac.', 'Gênero', 'PASS / RG', 'Expedição', 'Validade', 'CPF'],
      body,
      // Nº(7)+Nome(80)+Nasc(22)+Nac(16)+Gen(16)+Pass(28)+Exp(22)+Val(22)+CPF(56)=269
      { 0:{cellWidth:7}, 1:{cellWidth:80}, 2:{cellWidth:22}, 3:{cellWidth:16,halign:'center'}, 4:{cellWidth:16,halign:'center'}, 5:{cellWidth:28}, 6:{cellWidth:22}, 7:{cellWidth:22}, 8:{cellWidth:56} }
    )
  }

  // ── 3. Lista Aéreo ───────────────────────────────────────────────────────────
  if (opts.aereo) {
    const y = newSection('LISTA AÉREO', null)
    const body = pax.map((e, i) => {
      const sameRoom = accomPairs[e.accommodation]
      const juntos   = sameRoom && sameRoom.length > 1 ? 'Juntos' : ''
      return [
        i + 1,
        e.passenger_name + (e.passenger_is_guide ? ' (Guia acompanhante)' : ''),
        (e.passenger_seat_preference || '').toUpperCase(),
        juntos,
        e.passenger_diet_type || '',
        fmtDate(e.passenger_birth_date),
        fmtNat(e.passenger_nationality),
        fmtGender(e.passenger_gender),
        e.passenger_cpf || '',
      ]
    })
    applyTableStyle(doc, y,
      ['Nº', 'Nome', 'Assento', 'Assentos juntos', 'Tipo Alimentação', 'Nascimento', 'Nac.', 'Gênero', 'CPF'],
      body,
      // Nº(7)+Nome(70)+Assento(20)+Juntos(22)+Alim(30)+Nasc(22)+Nac(16)+Gen(16)+CPF(66)=269
      { 0:{cellWidth:7}, 1:{cellWidth:70}, 2:{cellWidth:20}, 3:{cellWidth:22}, 4:{cellWidth:30}, 5:{cellWidth:22}, 6:{cellWidth:16,halign:'center'}, 7:{cellWidth:16,halign:'center'}, 8:{cellWidth:66} }
    )
  }

  // ── 4. Lista de Embarque ─────────────────────────────────────────────────────
  if (opts.embarque) {
    const y = newSection('LISTA DE LOCAIS DE EMBARQUE', null)

    // Agrupar por aeroporto de saída (individual ou padrão da lista)
    const groups = {}
    pax.forEach(e => {
      const ap = e.departure_airport_data
      const key = ap ? `${ap.name?.toUpperCase()} - ${ap.iata_code || ''}` : 'SEM AEROPORTO DEFINIDO'
      if (!groups[key]) groups[key] = []
      groups[key].push(e)
    })

    const pw = doc.internal.pageSize.getWidth()
    let curY = y
    let globalIdx = 1

    Object.entries(groups).forEach(([airport, group]) => {
      // Airport header row
      if (curY > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); curY = addPageHeader(doc, 'LISTA DE LOCAIS DE EMBARQUE', lname, lnum, dates, logoDataUrl) }

      doc.setFillColor(...BLUE)
      doc.rect(14, curY, pw - 28, 7, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(255, 255, 255)
      doc.text(`EMBARQUE: ${airport}`, 17, curY + 4.5)
      curY += 9

      const body = group.map((e) => {
        const row = [
          globalIdx++,
          e.passenger_name + (e.passenger_is_guide ? ' (Guia acompanhante)' : ''),
          (e.passenger_seat_preference || '').toUpperCase(),
          fmtDate(e.passenger_birth_date),
          fmtNat(e.passenger_nationality),
          fmtGender(e.passenger_gender),
          e.passenger_cpf || '',
          e.passenger_diet_type || '',
        ]
        return row
      })

      curY = applyTableStyle(doc, curY,
        ['Nº', 'Nome', 'Assento', 'Nascimento', 'Nac.', 'Gênero', 'CPF', 'Tipo Alimentação'],
        body,
        // Nº(7)+Nome(76)+Assento(20)+Nasc(22)+Nac(16)+Gen(16)+CPF(30)+Alim(82)=269
        { 0:{cellWidth:7}, 1:{cellWidth:76}, 2:{cellWidth:20}, 3:{cellWidth:22}, 4:{cellWidth:16,halign:'center'}, 5:{cellWidth:16,halign:'center'}, 6:{cellWidth:30}, 7:{cellWidth:82} }
      )
      curY += 4
    })
  }

  // ── 5. Lista de Observações ──────────────────────────────────────────────────
  if (opts.observacoes) {
    const paxWithNotes = pax.filter(e => e.notes)
    const y = newSection('LISTA DE OBSERVAÇÕES', null)
    const body = paxWithNotes.map((e, i) => [
      i + 1,
      e.passenger_name,
      '',   // adicionais — campo futuro
      e.notes || '',
      e.passenger_diet_type || '',
    ])
    applyTableStyle(doc, y,
      ['Nº', 'Nome', 'Adicionais', 'Observações', 'Alimentação'],
      body,
      // Nº(7)+Nome(70)+Adicionais(50)+Obs(110)+Alim(32)=269
      { 0:{cellWidth:7}, 1:{cellWidth:70}, 2:{cellWidth:50}, 3:{cellWidth:110}, 4:{cellWidth:32} }
    )
  }

  // ── 6. Lista de Contatos ─────────────────────────────────────────────────────
  if (opts.contato) {
    const y = newSection('LISTA DE CONTATOS', null)
    const body = pax.map((e, i) => [
      i + 1,
      e.passenger_name + (e.passenger_is_guide ? ' (Guia acompanhante)' : ''),
      e.passenger_phone  || '',
      e.passenger_phone2 || '',
      '',                           // telefone 3 — não existe no modelo ainda
      e.passenger_mobile || '',
    ])
    applyTableStyle(doc, y,
      ['Nº', 'Nome', 'Telefone 1', 'Telefone 2', 'Telefone 3', 'Celular'],
      body,
      // Nº(7)+Nome(78)+Tel1(46)+Tel2(46)+Tel3(46)+Cel(46)=269
      { 0:{cellWidth:7}, 1:{cellWidth:78}, 2:{cellWidth:46}, 3:{cellWidth:46}, 4:{cellWidth:46}, 5:{cellWidth:46} }
    )
  }

  // ── 7. Lista Completa ────────────────────────────────────────────────────────
  if (opts.completa) {
    const y = newSection('LISTA COMPLETA', null)
    const body = pax.map((e, i) => {
      const docLine  = passportRg(e)
      const expLine  = e.passenger_passport_issue  ? `EXP: ${fmtDate(e.passenger_passport_issue)}`  : ''
      const valLine  = e.passenger_passport_expiry ? `VAL: ${fmtDate(e.passenger_passport_expiry)}` : ''
      const passport = [docLine ? `DOC: ${docLine}` : '', expLine, valLine].filter(Boolean).join('\n')
      const nacGen   = [fmtDate(e.passenger_birth_date), fmtNat(e.passenger_nationality), fmtGender(e.passenger_gender)].filter(Boolean).join('\n')
      return [
        i + 1,
        e.passenger_name + (e.passenger_is_guide ? '\n(Guia acompanhante)' : ''),
        e.accommodation || '',
        nacGen,
        passport,
        e.passenger_cpf || '',
        e.passenger_address || '',
        e.passenger_mobile || e.passenger_phone || '',
        e.agency_name || '',
      ]
    })
    applyTableStyle(doc, y,
      ['Nº', 'Nome', 'Tipo Apto.', 'Nasc / Nac / Gen', 'PASS / RG', 'CPF', 'Endereço', 'Celular', 'Agência'],
      body,
      // Nº(7)+Nome(54)+Apto(22)+NacGen(22)+Pass(32)+CPF(26)+End(60)+Cel(24)+Ag(22)=269
      { 0:{cellWidth:7}, 1:{cellWidth:54}, 2:{cellWidth:22}, 3:{cellWidth:22}, 4:{cellWidth:32}, 5:{cellWidth:26}, 6:{cellWidth:60}, 7:{cellWidth:24}, 8:{cellWidth:22} }
    )
  }

  doc.save(`lista-passageiros-${String(lnum).padStart(5, '0')}.pdf`)
}
