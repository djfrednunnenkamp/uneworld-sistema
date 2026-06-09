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

// Renderiza um emoji numa canvas e retorna data URL PNG
function emojiToDataUrl(emoji, size = 20) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width  = size * 2
    canvas.height = size * 2
    const ctx = canvas.getContext('2d')
    ctx.font          = `${size * 1.8}px serif`
    ctx.textBaseline  = 'middle'
    ctx.textAlign     = 'center'
    ctx.fillText(emoji, size, size)
    return canvas.toDataURL('image/png')
  } catch { return null }
}

// Desenha um selo verde com check branco numa canvas e retorna data URL PNG
function checkBadgeDataUrl(size = 20) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width  = size * 2
    canvas.height = size * 2
    const ctx = canvas.getContext('2d')
    const r = size * 0.85
    ctx.beginPath()
    ctx.arc(size, size, r, 0, Math.PI * 2)
    ctx.fillStyle = '#16a34a'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth   = size * 0.18
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    ctx.beginPath()
    ctx.moveTo(size * 0.55, size * 1.02)
    ctx.lineTo(size * 0.9,  size * 1.35)
    ctx.lineTo(size * 1.5,  size * 0.65)
    ctx.stroke()
    return canvas.toDataURL('image/png')
  } catch { return null }
}

// ── PDF theme ─────────────────────────────────────────────────────────────────

const NAV    = [26, 45, 79]      // #1a2d4f
const BLUE   = [46, 109, 180]    // #2e6db4
const HEADER = [248, 250, 252]   // #f8fafc
const BORDER = [226, 232, 240]   // #e2e8f0

// hooks: { didParseCell?, didDrawCell? }
function applyTableStyle(doc, startY, head, body, colStyles = {}, hooks = {}) {
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
    ...hooks,
  })
  return doc.lastAutoTable.finalY
}

function addPageHeader(doc, title, listName, listNumber, dates, logoDataUrl) {
  const pw     = doc.internal.pageSize.getWidth()
  const LOGO_W = 30, LOGO_H = 16, LOGO_X = 14, LOGO_Y = 6
  const NUM_W  = 60

  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', LOGO_X, LOGO_Y, LOGO_W, LOGO_H) } catch {}
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...NAV)
  const numStr = 'LISTA DE PASSAGEIROS N' + String.fromCharCode(186) + ' ' + String(listNumber).padStart(5, '0')
  doc.text(numStr, pw - 14, 10, { align: 'right' })

  const areaStart = LOGO_X + LOGO_W + 4
  const areaEnd   = pw - 14 - NUM_W
  const centerX   = areaStart + (areaEnd - areaStart) / 2

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...NAV)
  doc.text(title, centerX, 12, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(71, 85, 105)
  doc.text(listName + ' (' + dates + ')', centerX, 19, { align: 'center' })

  doc.setDrawColor(...BLUE)
  doc.setLineWidth(0.5)
  doc.line(14, 24, pw - 14, 24)

  return 28
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateListPDF(list, enrollments, opts) {
  let logoDataUrl = null
  try {
    const resp = await fetch('/logo.png')
    const blob = await resp.blob()
    logoDataUrl = await new Promise(res => {
      const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob)
    })
  } catch {}

  // Emoji de aniversario renderizado em canvas
  const cakeImg = emojiToDataUrl('🎂', 20)   // 🎂

  // Selo verde de "Sim" (bloqueio aereo) renderizado em canvas
  const checkImg = checkBadgeDataUrl(20)

  const doc    = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pax    = enrollments.filter(e => !e.is_block && e.enrollment_status !== 'cancelado')
  const dates  = fmtDate(list.start_date) + ' A ' + fmtDate(list.end_date)
  const lname  = (list.name || '').toUpperCase()
  const lnum   = list.id

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

  // Hooks: zera o texto do autoTable e desenha tudo manualmente (centrado, mesma linha)
  function birthdayHooks(birthdaySet, colIndex) {
    if (!cakeImg || birthdaySet.size === 0) return {}
    const ICON   = 4      // mm
    const GAP    = 1.5    // mm entre icone e texto
    const ORANGE = [220, 80, 20]

    return {
      didParseCell: data => {
        // Limpa o texto que o autoTable desenharia — vamos renderizar manualmente
        if (data.section === 'body' && birthdaySet.has(data.row.index) && data.column.index === colIndex) {
          data.cell.text = ['']
        }
      },
      didDrawCell: data => {
        if (!cakeImg) return
        if (data.section === 'body' && birthdaySet.has(data.row.index) && data.column.index === colIndex) {
          const dateStr = String(data.cell.raw || '')
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(8)
          const tw      = doc.getTextWidth(dateStr)
          const totalW  = ICON + GAP + tw + GAP + ICON
          // centraliza horizontalmente na celula
          const startX  = data.cell.x + (data.cell.width - totalW) / 2
          // alinha pelo topo, igual ao texto normal (padding top + baseline 8pt)
          const padTop  = (data.cell.padding?.top ?? 3)
          const imgY    = data.cell.y + padTop
          const textY   = imgY + 2.8   // baseline para fonte 8pt

          try { doc.addImage(cakeImg, 'PNG', startX, imgY, ICON, ICON) } catch {}

          doc.setTextColor(...ORANGE)
          doc.text(dateStr, startX + ICON + GAP, textY)
          doc.setTextColor(30, 41, 59)  // reset

          try { doc.addImage(cakeImg, 'PNG', startX + ICON + GAP + tw + GAP, imgY, ICON, ICON) } catch {}
        }
      },
    }
  }

  // Combina varios hooks didParseCell/didDrawCell numa unica chamada de tabela
  function mergeHooks(...hooksList) {
    const list = hooksList.filter(h => h && (h.didParseCell || h.didDrawCell))
    if (list.length === 0) return {}
    return {
      didParseCell: data => list.forEach(h => h.didParseCell && h.didParseCell(data)),
      didDrawCell:  data => list.forEach(h => h.didDrawCell  && h.didDrawCell(data)),
    }
  }

  // Hooks: coluna "Bloqueio aereo" — Sim centralizado, verde, com selo de check
  function bloqueioHooks(colIndex) {
    const ICON  = 4      // mm
    const GAP   = 1.3    // mm entre selo e texto
    const GREEN = [22, 163, 74]

    return {
      didParseCell: data => {
        if (data.section === 'body' && data.column.index === colIndex && data.cell.raw === 'Sim' && checkImg) {
          data.cell.text = ['']
        }
      },
      didDrawCell: data => {
        if (data.section === 'body' && data.column.index === colIndex && data.cell.raw === 'Sim' && checkImg) {
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(8)
          const label  = 'Sim'
          const tw     = doc.getTextWidth(label)
          const totalW = ICON + GAP + tw
          const startX = data.cell.x + (data.cell.width - totalW) / 2
          const padTop = (data.cell.padding?.top ?? 3)
          const imgY   = data.cell.y + padTop
          const textY  = imgY + 2.8

          try { doc.addImage(checkImg, 'PNG', startX, imgY, ICON, ICON) } catch {}

          doc.setTextColor(...GREEN)
          doc.text(label, startX + ICON + GAP, textY)
          doc.setTextColor(30, 41, 59)
          doc.setFont('helvetica', 'normal')
        }
      },
    }
  }

  // ── 1. Lista de Passageiros Confirmados ─────────────────────────────────────
  if (opts.confirmados) {
    const accomCounts = {}
    pax.forEach(e => { const k = e.accommodation || '—'; accomCounts[k] = (accomCounts[k] || 0) + 1 })
    const summary = Object.entries(accomCounts).map(([k, v]) => k + ': ' + v).join('   ') + '   Total: ' + pax.length
    const y = newSection('LISTA DE PASSAGEIROS CONFIRMADOS', summary)

    const bdaySet = new Set(pax.map((e, i) => hasBirthdayInTrip(e.passenger_birth_date, list.start_date, list.end_date) ? i : -1).filter(i => i >= 0))

    const body = pax.map((e, i) => [
      i + 1,
      e.ticket_status === 'via_bloqueio' ? 'Sim' : 'Nao',
      e.passenger_name + (e.passenger_is_guide ? ' (Guia acompanhante)' : ''),
      e.accommodation || '',
      fmtDate(e.passenger_birth_date),          // sem prefixo — o bolo e desenhado via didDrawCell
      fmtNat(e.passenger_nationality),
      fmtGender(e.passenger_gender),
      passportRg(e),
      e.passenger_cpf || '',
      e.agency_name || '',
    ])

    // N(7)+Bloq(22)+Nome(58)+Apto(26)+Nasc(28)+Nac(16)+Gen(16)+Pass(24)+CPF(28)+Ag(44)=269
    applyTableStyle(doc, y,
      ['N', 'Bloqueio\naereo', 'Nome', 'Tipo Apto.', 'Nascimento', 'Nac.', 'Genero', 'PASS / RG', 'CPF', 'Agencia'],
      body,
      { 0:{cellWidth:7}, 1:{cellWidth:22,halign:'center'}, 2:{cellWidth:58}, 3:{cellWidth:26}, 4:{cellWidth:28,halign:'center'}, 5:{cellWidth:16,halign:'center'}, 6:{cellWidth:16,halign:'center'}, 7:{cellWidth:24}, 8:{cellWidth:28}, 9:{cellWidth:44} },
      mergeHooks(birthdayHooks(bdaySet, 4), bloqueioHooks(1))   // Nascimento = coluna 4, Bloqueio = coluna 1
    )
  }

  // ── 2. Lista com Data de Expedicao ──────────────────────────────────────────
  if (opts.data_expedicao) {
    const y = newSection('LISTA COM DATA DE EXPEDICAO', null)
    const bdaySet = new Set(pax.map((e, i) => hasBirthdayInTrip(e.passenger_birth_date, list.start_date, list.end_date) ? i : -1).filter(i => i >= 0))
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
    // N(7)+Nome(76)+Nasc(28)+Nac(16)+Gen(16)+Pass(28)+Exp(22)+Val(22)+CPF(54)=269
    applyTableStyle(doc, y,
      ['N', 'Nome', 'Nascimento', 'Nac.', 'Genero', 'PASS / RG', 'Expedicao', 'Validade', 'CPF'],
      body,
      { 0:{cellWidth:7}, 1:{cellWidth:76}, 2:{cellWidth:28,halign:'center'}, 3:{cellWidth:16,halign:'center'}, 4:{cellWidth:16,halign:'center'}, 5:{cellWidth:28}, 6:{cellWidth:22}, 7:{cellWidth:22}, 8:{cellWidth:54} },
      birthdayHooks(bdaySet, 2)   // Nascimento = coluna 2
    )
  }

  // ── 3. Lista Aereo ───────────────────────────────────────────────────────────
  if (opts.aereo) {
    const y = newSection('LISTA AEREO', null)
    const body = pax.map((e, i) => {
      const sameRoom = accomPairs[e.accommodation]
      return [
        i + 1,
        e.passenger_name + (e.passenger_is_guide ? ' (Guia acompanhante)' : ''),
        (e.passenger_seat_preference || '').toUpperCase(),
        sameRoom && sameRoom.length > 1 ? 'Juntos' : '',
        e.passenger_diet_type || '',
        fmtDate(e.passenger_birth_date),
        fmtNat(e.passenger_nationality),
        fmtGender(e.passenger_gender),
        e.passenger_cpf || '',
      ]
    })
    // N(7)+Nome(70)+Ass(20)+Juntos(22)+Alim(30)+Nasc(22)+Nac(16)+Gen(16)+CPF(66)=269
    applyTableStyle(doc, y,
      ['N', 'Nome', 'Assento', 'Assentos juntos', 'Tipo Alimentacao', 'Nascimento', 'Nac.', 'Genero', 'CPF'],
      body,
      { 0:{cellWidth:7}, 1:{cellWidth:70}, 2:{cellWidth:20}, 3:{cellWidth:22}, 4:{cellWidth:30}, 5:{cellWidth:22}, 6:{cellWidth:16,halign:'center'}, 7:{cellWidth:16,halign:'center'}, 8:{cellWidth:66} }
    )
  }

  // ── 4. Lista de Embarque ─────────────────────────────────────────────────────
  if (opts.embarque) {
    const y = newSection('LISTA DE LOCAIS DE EMBARQUE', null)
    const groups = {}
    pax.forEach(e => {
      const ap  = e.departure_airport_data
      const key = ap ? (ap.name || '').toUpperCase() + (ap.iata_code ? ' - ' + ap.iata_code : '') : 'SEM AEROPORTO DEFINIDO'
      if (!groups[key]) groups[key] = []
      groups[key].push(e)
    })
    const pw2 = doc.internal.pageSize.getWidth()
    let curY = y, globalIdx = 1
    Object.entries(groups).forEach(([airport, group]) => {
      if (curY > doc.internal.pageSize.getHeight() - 40) {
        doc.addPage()
        curY = addPageHeader(doc, 'LISTA DE LOCAIS DE EMBARQUE', lname, lnum, dates, logoDataUrl)
      }
      doc.setFillColor(...BLUE)
      doc.rect(14, curY, pw2 - 28, 7, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(255, 255, 255)
      doc.text('EMBARQUE: ' + airport, 17, curY + 4.5)
      curY += 9
      const body = group.map(e => [
        globalIdx++,
        e.passenger_name + (e.passenger_is_guide ? ' (Guia acompanhante)' : ''),
        (e.passenger_seat_preference || '').toUpperCase(),
        fmtDate(e.passenger_birth_date),
        fmtNat(e.passenger_nationality),
        fmtGender(e.passenger_gender),
        e.passenger_cpf || '',
        e.passenger_diet_type || '',
      ])
      // N(7)+Nome(76)+Ass(20)+Nasc(22)+Nac(16)+Gen(16)+CPF(30)+Alim(82)=269
      curY = applyTableStyle(doc, curY,
        ['N', 'Nome', 'Assento', 'Nascimento', 'Nac.', 'Genero', 'CPF', 'Tipo Alimentacao'],
        body,
        { 0:{cellWidth:7}, 1:{cellWidth:76}, 2:{cellWidth:20}, 3:{cellWidth:22}, 4:{cellWidth:16,halign:'center'}, 5:{cellWidth:16,halign:'center'}, 6:{cellWidth:30}, 7:{cellWidth:82} }
      )
      curY += 4
    })
  }

  // ── 5. Lista de Observacoes ──────────────────────────────────────────────────
  if (opts.observacoes) {
    const paxWithNotes = pax.filter(e => e.notes)
    const y = newSection('LISTA DE OBSERVACOES', null)
    const body = paxWithNotes.map((e, i) => [
      i + 1, e.passenger_name, '', e.notes || '', e.passenger_diet_type || '',
    ])
    // N(7)+Nome(70)+Adic(50)+Obs(110)+Alim(32)=269
    applyTableStyle(doc, y,
      ['N', 'Nome', 'Adicionais', 'Observacoes', 'Alimentacao'],
      body,
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
      '',
      e.passenger_mobile || '',
    ])
    // N(7)+Nome(78)+T1(46)+T2(46)+T3(46)+Cel(46)=269
    applyTableStyle(doc, y,
      ['N', 'Nome', 'Telefone 1', 'Telefone 2', 'Telefone 3', 'Celular'],
      body,
      { 0:{cellWidth:7}, 1:{cellWidth:78}, 2:{cellWidth:46}, 3:{cellWidth:46}, 4:{cellWidth:46}, 5:{cellWidth:46} }
    )
  }

  // ── 7. Lista Completa ────────────────────────────────────────────────────────
  if (opts.completa) {
    const y = newSection('LISTA COMPLETA', null)
    const body = pax.map((e, i) => {
      const docLine  = passportRg(e)
      const expLine  = e.passenger_passport_issue  ? 'EXP: ' + fmtDate(e.passenger_passport_issue)  : ''
      const valLine  = e.passenger_passport_expiry ? 'VAL: ' + fmtDate(e.passenger_passport_expiry) : ''
      const passport = [docLine ? 'DOC: ' + docLine : '', expLine, valLine].filter(Boolean).join('\n')
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
    // N(7)+Nome(54)+Apto(22)+NacGen(22)+Pass(32)+CPF(26)+End(60)+Cel(24)+Ag(22)=269
    applyTableStyle(doc, y,
      ['N', 'Nome', 'Tipo Apto.', 'Nasc / Nac / Gen', 'PASS / RG', 'CPF', 'Endereco', 'Celular', 'Agencia'],
      body,
      { 0:{cellWidth:7}, 1:{cellWidth:54}, 2:{cellWidth:22}, 3:{cellWidth:22}, 4:{cellWidth:32}, 5:{cellWidth:26}, 6:{cellWidth:60}, 7:{cellWidth:24}, 8:{cellWidth:22} }
    )
  }

  doc.save('lista-passageiros-' + String(lnum).padStart(5, '0') + '.pdf')
}
