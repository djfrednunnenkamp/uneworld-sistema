// Helpers de formatacao compartilhados entre exportacao em PDF e HTML

export function fmtDate(d) {
  if (!d) return ''
  const [y, m, day] = String(d).split('-')
  return `${day}/${m}/${y}`
}

export function fmtGender(g) {
  if (!g) return ''
  const s = String(g).toLowerCase()
  if (s.startsWith('m') || s === 'masculino') return 'M'
  if (s.startsWith('f') || s === 'feminino')  return 'F'
  return g.slice(0, 1).toUpperCase()
}

export function fmtNat(n) {
  if (!n) return ''
  const map = { BRASILEIRA: 'BRA', BRASILEIRO: 'BRA', BRA: 'BRA' }
  const up = n.toUpperCase().replace(/[^A-Z]/g, '')
  return map[up] || up.slice(0, 3)
}

export function fmtDiet(e) {
  const tipo = e?.passenger_diet_type || ''
  if (!tipo) return ''
  const obs = e?.notes || ''
  return obs ? `${tipo} - ${obs}` : tipo
}

export function hasCrew(e) {
  return !!(e.crew_roles_data && e.crew_roles_data.length > 0)
}

export function crewSuffix(e) {
  if (!hasCrew(e)) return ''
  return ' (' + e.crew_roles_data.map(r => r.name).join(', ') + ')'
}

export function passportRg(e) {
  const pp = e.selected_passport_data?.doc_number || e.passenger_passport
  return pp || e.passenger_rg || ''
}

// Encontra o tipo de acomodacao pelo nome mais longo que bate como prefixo — evita "Duplo" engolir "Duplo Casal"
export function findAccomType(types, roomName) {
  if (!roomName) return null
  return [...types].sort((a, b) => b.name.length - a.name.length)
    .find(t => roomName === t.name || roomName.startsWith(t.name + ' ')) || null
}

// Rotulo "Apto. <Tipo>" para a coluna Tipo Apto. — mesmo tipo para todos os ocupantes da mesma acomodacao
export function accomTypeLabel(types, roomName) {
  if (!roomName) return ''
  const type = findAccomType(types, roomName)
  return type ? `Apto. ${type.name}` : roomName
}

export function hasBirthdayInTrip(birthDate, startDate, endDate) {
  if (!birthDate || !startDate || !endDate) return false
  try {
    // 'YYYY-MM-DD' sem hora é interpretado como UTC; em UTC-3 (Brasil) getDate()/getMonth()
    // leem o dia anterior. Forçar 'T00:00:00' faz o parse no fuso local e evita o off-by-one.
    const b  = new Date(birthDate + 'T00:00:00')
    const s  = new Date(startDate + 'T00:00:00')
    const en = new Date(endDate + 'T00:00:00')
    const bm = b.getMonth(); const bd = b.getDate()
    let cur = new Date(s)
    while (cur <= en) {
      if (cur.getMonth() === bm && cur.getDate() === bd) return true
      cur.setDate(cur.getDate() + 1)
    }
  } catch { /* data invalida */ }
  return false
}
