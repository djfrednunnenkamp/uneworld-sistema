export function fmtHour(h, timeFormat) {
  if (timeFormat === '12h') {
    const period = h < 12 ? 'AM' : 'PM'
    const h12 = h % 12 || 12
    return `${h12}:00 ${period}`
  }
  return `${String(h).padStart(2, '0')}:00`
}

export function fmtDateTime(iso, timeFormat) {
  if (!iso) return ''
  const d = new Date(iso)
  return (
    d.toLocaleDateString('pt-BR') + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: timeFormat === '12h' })
  )
}
