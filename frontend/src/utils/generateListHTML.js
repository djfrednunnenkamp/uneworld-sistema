import { fmtDate, fmtGender, fmtNat, fmtDiet, hasCrew, crewSuffix, passportRg, accomTypeLabel, hasBirthdayInTrip } from './listFormat'

// ── Tema (mesmas cores do PDF) ────────────────────────────────────────────────

const NAV    = '#1a2d4f'
const BLUE   = '#2e6db4'
const HEADER = '#f8fafc'
const BORDER = '#e2e8f0'
const RED    = '#dc2626'   // equipe tecnica
const GREEN  = '#16a34a'   // bloqueio aereo
const ORANGE = '#dc5014'   // aniversario

// ── Helpers de montagem do HTML ───────────────────────────────────────────────

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Mescla verticalmente (rowspan) uma coluna quando passageiros consecutivos dividem a mesma acomodacao
function mergeAccomCells(body, pax, colIndex) {
  let i = 0
  while (i < body.length) {
    const room = pax[i].accommodation
    if (!room) { i++; continue }
    let j = i + 1
    while (j < body.length && pax[j].accommodation === room) j++
    if (j - i > 1) {
      body[i][colIndex] = { ...body[i][colIndex], rowSpan: j - i }
      for (let k = i + 1; k < j; k++) body[k][colIndex] = null
    }
    i = j
  }
}

function renderTable(headers, body) {
  const head = headers.map(h =>
    `<th style="background:${NAV};color:#ffffff;font-weight:bold;font-size:11px;padding:6px 8px;border:1px solid ${BORDER};text-align:center;white-space:nowrap;">${esc(h).replace(/\n/g, '<br>')}</th>`
  ).join('')

  const rows = body.map((row, ri) => {
    const cells = row.map(cell => {
      if (cell === null) return ''
      const { text = '', raw, align = 'left', color, bold, rowSpan, colSpan, fillColor } = cell
      const content = raw !== undefined ? raw : esc(text).replace(/\n/g, '<br>')
      const styles = [
        'padding:5px 8px',
        `border:1px solid ${BORDER}`,
        `text-align:${align}`,
        'font-size:11px',
        'vertical-align:middle',
      ]
      if (color)     styles.push(`color:${color}`)
      if (bold)      styles.push('font-weight:bold')
      if (fillColor) styles.push(`background:${fillColor}`)
      const attrs = []
      if (rowSpan) attrs.push(`rowspan="${rowSpan}"`)
      if (colSpan) attrs.push(`colspan="${colSpan}"`)
      return `<td ${attrs.join(' ')} style="${styles.join(';')}">${content}</td>`
    }).join('')
    const stripe = ri % 2 === 1 ? `background:${HEADER};` : ''
    return `<tr style="${stripe}">${cells}</tr>`
  }).join('')

  return `<table style="width:100%;border-collapse:collapse;margin-bottom:28px;">
    <thead><tr>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

function sectionTitle(title, summary) {
  return `<div style="margin:0 0 10px;">
    <div style="font-size:13px;font-weight:bold;color:${NAV};border-bottom:2px solid ${BLUE};padding-bottom:6px;letter-spacing:.4px;">${esc(title)}</div>
    ${summary ? `<div style="font-size:11px;color:#64748b;margin-top:6px;">${esc(summary)}</div>` : ''}
  </div>`
}

function birthdayCell(birthDate, isBirthday, align = 'center') {
  const dateStr = fmtDate(birthDate)
  if (isBirthday) return { text: '🎂 ' + dateStr + ' 🎂', align, color: ORANGE }
  return { text: dateStr, align }
}

function nameCell(text, crew) {
  return { text, color: crew ? RED : undefined }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateListHTML(list, enrollments, opts, accomTypes = [], busMap = null) {
  let logoDataUrl = null
  try {
    const resp = await fetch('/logo.png')
    const blob = await resp.blob()
    logoDataUrl = await new Promise(res => {
      const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob)
    })
  } catch { /* logo opcional */ }

  const pax    = enrollments.filter(e => !e.is_block && e.enrollment_status !== 'cancelado')
  const paxNumber = new Map(pax.map((e, i) => [e.id, i + 1]))
  const dates  = fmtDate(list.start_date) + ' a ' + fmtDate(list.end_date)
  const lname  = (list.name || '').toUpperCase()
  const lnum   = list.id

  const accomPairs = {}
  pax.forEach(e => {
    if (e.accommodation) {
      if (!accomPairs[e.accommodation]) accomPairs[e.accommodation] = []
      accomPairs[e.accommodation].push(e.id)
    }
  })

  const sections = []

  // ── 1. Lista de Passageiros Confirmados ─────────────────────────────────────
  if (opts.confirmados) {
    const accomCounts = {}
    pax.forEach(e => { const k = e.accommodation || '—'; accomCounts[k] = (accomCounts[k] || 0) + 1 })
    const summary = Object.entries(accomCounts).map(([k, v]) => k + ': ' + v).join('   ') + '   Total: ' + pax.length

    const body = pax.map((e, i) => {
      const crew = hasCrew(e)
      const nameTxt = e.passenger_name + (e.passenger_is_guide ? ' (Guia acompanhante)' : '') + crewSuffix(e)
      return [
        { text: String(i + 1), align: 'center' },
        e.ticket_status === 'via_bloqueio'
          ? { text: '✅ Sim', align: 'center', color: GREEN, bold: true }
          : { text: 'Não', align: 'center' },
        nameCell(nameTxt, crew),
        { text: accomTypeLabel(accomTypes, e.accommodation) },
        birthdayCell(e.passenger_birth_date, hasBirthdayInTrip(e.passenger_birth_date, list.start_date, list.end_date)),
        { text: fmtNat(e.passenger_nationality), align: 'center' },
        { text: fmtGender(e.passenger_gender), align: 'center' },
        { text: passportRg(e), align: 'center' },
        { text: e.passenger_cpf || '' },
        { text: e.agency_name || '' },
      ]
    })
    mergeAccomCells(body, pax, 3)
    sections.push(
      sectionTitle('LISTA DE PASSAGEIROS CONFIRMADOS', summary) +
      renderTable(['N', 'Bloqueio aéreo', 'Nome', 'Tipo Apto.', 'Nascimento', 'Nac.', 'Gênero', 'PASS / RG', 'CPF', 'Agência'], body)
    )
  }

  // ── 2. Lista com Data de Expedicao ──────────────────────────────────────────
  if (opts.data_expedicao) {
    const body = pax.map((e, i) => {
      const crew = hasCrew(e)
      const nameTxt = e.passenger_name + (e.passenger_is_guide ? ' (Guia acompanhante)' : '') + crewSuffix(e)
      return [
        { text: String(i + 1), align: 'center' },
        nameCell(nameTxt, crew),
        birthdayCell(e.passenger_birth_date, hasBirthdayInTrip(e.passenger_birth_date, list.start_date, list.end_date)),
        { text: fmtNat(e.passenger_nationality), align: 'center' },
        { text: fmtGender(e.passenger_gender), align: 'center' },
        { text: passportRg(e), align: 'center' },
        { text: fmtDate(e.passenger_passport_issue), align: 'center' },
        { text: fmtDate(e.passenger_passport_expiry), align: 'center' },
        { text: e.passenger_cpf || '' },
      ]
    })
    sections.push(
      sectionTitle('LISTA COM DATA DE EXPEDIÇÃO') +
      renderTable(['N', 'Nome', 'Nascimento', 'Nac.', 'Gênero', 'PASS / RG', 'Expedição', 'Validade', 'CPF'], body)
    )
  }

  // ── 3. Lista Aereo ───────────────────────────────────────────────────────────
  if (opts.aereo) {
    const body = pax.map((e, i) => {
      const crew = hasCrew(e)
      const sameRoom = accomPairs[e.accommodation]
      const nameTxt = e.passenger_name + (e.passenger_is_guide ? ' (Guia acompanhante)' : '') + crewSuffix(e)
      return [
        { text: String(i + 1), align: 'center' },
        nameCell(nameTxt, crew),
        { text: (e.passenger_seat_preference || '').toUpperCase(), align: 'center' },
        { text: sameRoom && sameRoom.length > 1 ? 'Juntos' : '', align: 'center' },
        { text: fmtDiet(e), align: 'center' },
        birthdayCell(e.passenger_birth_date, hasBirthdayInTrip(e.passenger_birth_date, list.start_date, list.end_date)),
        { text: fmtNat(e.passenger_nationality), align: 'center' },
        { text: fmtGender(e.passenger_gender), align: 'center' },
        { text: e.passenger_cpf || '', align: 'center' },
      ]
    })
    mergeAccomCells(body, pax, 3)
    sections.push(
      sectionTitle('LISTA AÉREO') +
      renderTable(['N', 'Nome', 'Assento', 'Assentos\njuntos', 'Tipo Alimentação', 'Nascimento', 'Nac.', 'Gênero', 'CPF'], body)
    )
  }

  // ── 4. Lista de Embarque ─────────────────────────────────────────────────────
  if (opts.embarque) {
    const groups = {}
    pax.forEach(e => {
      const ap  = e.departure_airport_data
      const key = ap ? (ap.name || '').toUpperCase() + (ap.iata_code ? ' - ' + ap.iata_code : '') : 'SEM AEROPORTO DEFINIDO'
      if (!groups[key]) groups[key] = []
      groups[key].push(e)
    })

    const def    = list.default_airport_data
    const defKey = def ? (def.name || '').toUpperCase() + (def.iata_code ? ' - ' + def.iata_code : '') : null
    const groupKeys = Object.keys(groups)
    if (defKey && groupKeys.includes(defKey)) {
      groupKeys.splice(groupKeys.indexOf(defKey), 1)
      groupKeys.unshift(defKey)
    }

    const body = []
    groupKeys.forEach(airport => {
      body.push([{ text: 'EMBARQUE: ' + airport, colSpan: 8, fillColor: BLUE, color: '#ffffff', bold: true, align: 'left' }])
      groups[airport].forEach(e => {
        const crew = hasCrew(e)
        const nameTxt = e.passenger_name + (e.passenger_is_guide ? ' (Guia acompanhante)' : '') + crewSuffix(e)
        body.push([
          { text: String(paxNumber.get(e.id)), align: 'center' },
          nameCell(nameTxt, crew),
          { text: (e.passenger_seat_preference || '').toUpperCase(), align: 'center' },
          birthdayCell(e.passenger_birth_date, hasBirthdayInTrip(e.passenger_birth_date, list.start_date, list.end_date)),
          { text: fmtNat(e.passenger_nationality), align: 'center' },
          { text: fmtGender(e.passenger_gender), align: 'center' },
          { text: e.passenger_cpf || '', align: 'center' },
          { text: fmtDiet(e), align: 'center' },
        ])
      })
    })
    sections.push(
      sectionTitle('LISTA DE LOCAIS DE EMBARQUE') +
      renderTable(['N', 'Nome', 'Assento', 'Nascimento', 'Nac.', 'Gênero', 'CPF', 'Tipo Alimentação'], body)
    )
  }

  // ── 5. Lista de Observacoes ──────────────────────────────────────────────────
  if (opts.observacoes) {
    const paxWithNotes = pax.filter(e => e.notes || (e.additionals_data && e.additionals_data.length > 0))
    const body = paxWithNotes.map(e => {
      const crew = hasCrew(e)
      return [
        { text: String(paxNumber.get(e.id)), align: 'center' },
        nameCell(e.passenger_name + crewSuffix(e), crew),
        { text: (e.additionals_data || []).map(a => a.name).join(', ') },
        { text: e.notes || '' },
        { text: fmtDiet(e), align: 'center' },
      ]
    })
    sections.push(
      sectionTitle('LISTA DE OBSERVAÇÕES') +
      renderTable(['N', 'Nome', 'Adicionais', 'Observações', 'Alimentação'], body)
    )
  }

  // ── 6. Lista de Contatos ─────────────────────────────────────────────────────
  if (opts.contato) {
    const body = pax.map((e, i) => {
      const crew = hasCrew(e)
      const nameTxt = e.passenger_name + (e.passenger_is_guide ? ' (Guia acompanhante)' : '') + crewSuffix(e)
      return [
        { text: String(i + 1), align: 'center' },
        nameCell(nameTxt, crew),
        { text: e.passenger_phone  || '' },
        { text: e.passenger_phone2 || '' },
        { text: '' },
        { text: e.passenger_mobile || '' },
      ]
    })
    sections.push(
      sectionTitle('LISTA DE CONTATOS') +
      renderTable(['N', 'Nome', 'Telefone 1', 'Telefone 2', 'Telefone 3', 'Celular'], body)
    )
  }

  // ── 7. Lista Completa ────────────────────────────────────────────────────────
  if (opts.completa) {
    const body = pax.map((e, i) => {
      const crew = hasCrew(e)
      const docLine  = passportRg(e)
      const expLine  = e.passenger_passport_issue  ? 'EXP: ' + fmtDate(e.passenger_passport_issue)  : ''
      const valLine  = e.passenger_passport_expiry ? 'VAL: ' + fmtDate(e.passenger_passport_expiry) : ''
      const passport = [docLine ? 'DOC: ' + docLine : '', expLine, valLine].filter(Boolean).join('\n')
      const nacGen   = [fmtDate(e.passenger_birth_date), fmtNat(e.passenger_nationality), fmtGender(e.passenger_gender)].filter(Boolean).join('\n')
      const nameTxt  = e.passenger_name + (e.passenger_is_guide ? '\n(Guia acompanhante)' : '') + (crew ? '\n' + crewSuffix(e).trim() : '')
      return [
        { text: String(i + 1), align: 'center' },
        nameCell(nameTxt, crew),
        { text: accomTypeLabel(accomTypes, e.accommodation), align: 'center' },
        { text: nacGen, align: 'center' },
        { text: passport, align: 'center' },
        { text: e.passenger_cpf || '', align: 'center' },
        { text: e.passenger_address || '', align: 'center' },
        { text: e.passenger_mobile || e.passenger_phone || '', align: 'center' },
        { text: e.agency_name || '', align: 'center' },
      ]
    })
    mergeAccomCells(body, pax, 2)
    sections.push(
      sectionTitle('LISTA COMPLETA') +
      renderTable(['N', 'Nome', 'Tipo Apto.', 'Nasc / Nac / Gen', 'PASS / RG', 'CPF', 'Endereço', 'Celular', 'Agência'], body)
    )
  }

  // ── 8. Mapa de Assentos ─────────────────────────────────────────────────────
  if (opts.mapa_assentos && busMap) {
    const seatOf = {}
    enrollments.forEach(e => { if (e.seat) seatOf[e.seat] = e })

    const sz = 44  // px por assento
    const gap = 4, aisle = 16

    const renderSeat = (label, occupant) => {
      if (!label) return `<div style="width:${sz}px;height:${sz}px;flex-shrink:0;"></div>`
      const bg  = occupant ? '#fef9c3' : '#e8f0fb'
      const bdr = occupant ? '#fde68a' : '#bfdbfe'
      const fg  = occupant ? '#92400e' : '#2e6db4'
      const fn  = occupant ? esc((occupant.passenger_name || occupant.block_agency || '').split(' ')[0]) : ''
      return `<div style="width:${sz}px;height:${sz}px;border-radius:6px;background:${bg};border:1px solid ${bdr};display:flex;flex-direction:column;align-items:center;justify-content:center;box-sizing:border-box;flex-shrink:0;">
        <span style="font-size:12px;font-weight:700;color:${fg};">${esc(label)}</span>
        ${fn ? `<span style="font-size:9px;color:${fg};margin-top:2px;max-width:${sz-4}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${fn}</span>` : ''}
      </div>`
    }

    const renderDeck = (rows, deckLabel) => {
      const maxLeft  = Math.max(0, ...rows.map(r => r.left_seats  ?? 0))
      const maxRight = Math.max(0, ...rows.map(r => r.right_seats ?? 0))
      const rowsHtml = rows.map(row => {
        const left  = Array.from({ length: maxLeft  }, (_, i) => renderSeat((row.left_labels?.[i]  ?? '').toString(), seatOf[row.left_labels?.[i]  ?? ''])).join('')
        const right = Array.from({ length: maxRight }, (_, i) => renderSeat((row.right_labels?.[i] ?? '').toString(), seatOf[row.right_labels?.[i] ?? ''])).join('')
        return `<div style="display:flex;gap:${gap}px;margin-bottom:${gap}px;">${left}<div style="width:${aisle}px;flex-shrink:0;"></div>${right}</div>`
      }).join('')
      const deckHead = deckLabel ? `<div style="font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;">${esc(deckLabel)}</div>` : ''
      return `<div>${deckHead}<div style="font-size:9px;font-weight:700;color:#94a3b8;letter-spacing:.08em;text-align:center;margin-bottom:6px;">FRENTE</div>${rowsHtml}</div>`
    }

    const twoDecks  = busMap.deck_count === 2
    const rowsDeck1 = (busMap.rows ?? []).filter(r => (r.deck ?? 1) === 1)
    const rowsDeck2 = (busMap.rows ?? []).filter(r => r.deck === 2)
    const mapHtml = twoDecks
      ? `<div style="display:flex;gap:32px;justify-content:center;">${renderDeck(rowsDeck1,'1º Andar')}${renderDeck(rowsDeck2,'2º Andar')}</div>`
      : `<div style="display:flex;justify-content:center;">${renderDeck(rowsDeck1,'')}</div>`

    const seated = enrollments.filter(e => e.seat).sort((a,b) => {
      const n = parseInt(a.seat)||0, m = parseInt(b.seat)||0
      return n - m || a.seat.localeCompare(b.seat)
    })
    const seatedTable = seated.length === 0 ? '' : (
      `<h3 style="margin:20px 0 8px;font-size:13px;color:${NAV};">Passageiros com assento atribuído</h3>` +
      renderTable(['Assento', 'Passageiro'], seated.map(e => [
        { text: e.seat,  align:'center', bold:true, color:BLUE },
        { text: e.passenger_name || e.block_agency || '—' },
      ]))
    )

    sections.push(
      sectionTitle('MAPA DE ASSENTOS') +
      `<div style="display:flex;gap:20px;align-items:center;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#64748b;"><div style="width:14px;height:14px;border-radius:3px;background:#e8f0fb;border:1px solid #bfdbfe;flex-shrink:0;"></div>Disponível</div>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#64748b;"><div style="width:14px;height:14px;border-radius:3px;background:#fef9c3;border:1px solid #fde68a;flex-shrink:0;"></div>Ocupado</div>
      </div>` +
      mapHtml + seatedTable
    )
  }

  // ── Documento ────────────────────────────────────────────────────────────────
  const numStr = 'LISTA DE PASSAGEIROS Nº ' + String(lnum).padStart(5, '0')
  const header = `<table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
    <tr>
      <td style="width:140px;vertical-align:middle;">
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="logo" style="height:42px;">` : ''}
      </td>
      <td style="vertical-align:middle;text-align:center;">
        <div style="font-size:18px;font-weight:bold;color:${NAV};">${esc(lname)}</div>
        <div style="font-size:12px;color:#475569;margin-top:3px;">${esc(dates)}</div>
      </td>
      <td style="width:160px;vertical-align:middle;text-align:right;font-size:11px;font-weight:bold;color:${NAV};">
        ${esc(numStr)}
      </td>
    </tr>
  </table>
  <div style="border-bottom:3px solid ${BLUE};margin-bottom:24px;"></div>`

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<title>${esc(list.name || 'Lista de passageiros')}</title>
</head>
<body style="font-family: Arial, Helvetica, sans-serif; color:#1e293b; margin:0; padding:24px; background:#ffffff;">
${header}
${sections.join('')}
</body>
</html>`

  const safeName = (list.name || '').trim().replace(/[\\/:*?"<>|]/g, '-')
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = (safeName || 'lista-passageiros-' + String(lnum).padStart(5, '0')) + '.html'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
