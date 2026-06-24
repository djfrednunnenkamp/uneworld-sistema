/* Exportação CSV individual por seção de Configurações — usa o MESMO formato de
   7 colunas do CSV combinado ("Exportar tudo"), para que qualquer arquivo
   individual seja reimportável pela mesma tela de revisão (FlatImport.jsx). */
import { auditApi } from '../api'

export const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`

export const SECTION_HEADER = 'lista,nome,pessoas,casal,pais,estado,codigo'

/* Constrói uma linha CSV para um item de uma seção "rica" (com colunas extras) */
export const SECTION_ROW_BUILDERS = {
  accommodations: (label, a) => `${q(label)},${q(a.name)},${a.capacity},${a.is_couple ? 'sim' : 'não'},,,`,
  doc_types: (label, d) => {
    const payload = JSON.stringify({ key: d.key, icon: d.icon, color: d.color })
    return `${q(label)},${q(d.label)},,,,,${q(payload)}`
  },
  airports: (label, a) => `${q(label)},${q(a.name)},,${a.is_favorite ? 'sim' : 'não'},${q(a.country || '')},${q(a.city || '')},${q(a.iata_code || '')}`,
  airlines: (label, a) => `${q(label)},${q(a.name)},,${a.is_favorite ? 'sim' : 'não'},${q(a.country || '')},,${q(a.iata_code || '')}`,
  bus_maps: (label, m) => {
    const payload = JSON.stringify({
      key: m.key, deck_count: m.deck_count, order: m.order, is_active: m.is_active,
      rows: (m.rows ?? []).map(r => ({
        deck: r.deck, left_seats: r.left_seats, right_seats: r.right_seats,
        left_labels: r.left_labels, right_labels: r.right_labels,
      })),
    })
    return `${q(label)},${q(m.label)},${m.rows?.length ?? 0},,,,${q(payload)}`
  },
  perm_profiles: (label, p) => {
    const active = Object.entries(p.permissions ?? {}).filter(([, v]) => v).map(([k]) => k).join('|')
    return `${q(label)},${q(p.name)},,,,,${q(active)}`
  },
  contract_clauses: (label, c) => {
    const payload = JSON.stringify({ content: c.content || '', is_default: !!c.is_default })
    return `${q(label)},${q(c.name)},,,,,${q(payload)}`
  },
  terms: (label, t) => {
    const payload = JSON.stringify({ content: t.content || '' })
    return `${q(label)},${q(t.name)},,,,,${q(payload)}`
  },
  exchange_rates: (label, er) => {
    const payload = JSON.stringify({ from_currency: er.from_currency, to_currency: er.to_currency, rate: er.rate })
    return `${q(label)},${q(`${er.from_currency} → ${er.to_currency}`)},,,,,${q(payload)}`
  },
}

export function downloadCsv(text, filename, logMeta) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
  const lineCount = Math.max(text.split('\n').length - 1, 0)
  auditApi.logDownload({
    label: filename,
    model_label: logMeta?.model_label || 'Exportação CSV',
    model_name: logMeta?.model_name || 'CsvExport',
    summary: { Linhas: lineCount, ...(logMeta?.summary || {}) },
  }).catch(() => {})
}

export function exportSectionCsv(key, label, items, filename) {
  const builder = SECTION_ROW_BUILDERS[key]
  if (!builder) return
  const rows = [SECTION_HEADER, ...items.map(i => builder(label, i))]
  downloadCsv(rows.join('\n'), filename, { model_label: `Exportação CSV — ${label}` })
}
