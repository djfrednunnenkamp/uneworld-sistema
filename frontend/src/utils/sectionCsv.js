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
  itinerary_templates: (label, t) => {
    // Guarda o tipo (seguro/pagamento/condições/documentação) e o conteúdo
    // rico no JSON da coluna "codigo" — pra reimportar idêntico.
    const payload = JSON.stringify({ kind: t.kind, content: t.content || '' })
    return `${q(label)},${q(t.name)},,,,,${q(payload)}`
  },
  operating_company: (label, o) => {
    // Singleton — exporta como uma única linha, com todos os dados da operadora
    // embutidos no JSON da coluna "codigo".
    const payload = JSON.stringify({
      company_name: o.company_name || '', cnpj: o.cnpj || '', seller: o.seller || '',
      phone: o.phone || '', mobile: o.mobile || '', email: o.email || '', address: o.address || '',
      pix_key_type: o.pix_key_type || '', pix_key: o.pix_key || '',
      default_signature_type: o.default_signature_type || 'fisica',
    })
    return `${q(label)},${q(o.company_name || 'Operadora')},,,,,${q(payload)}`
  },
  exchange_rates: (label, er) => {
    // Inclui TODAS as configs do câmbio (taxa de mercado, acréscimo, favorito,
    // atualização automática, link e script) — pra reimportar idêntico.
    const payload = JSON.stringify({
      from_currency: er.from_currency, to_currency: er.to_currency,
      base_rate: er.base_rate ?? er.rate, markup_percent: er.markup_percent ?? 0,
      is_favorite: !!er.is_favorite, auto_update: !!er.auto_update,
      source_url: er.source_url || '', script: er.script || '',
      update_time: er.update_time ? String(er.update_time).slice(0, 5) : '',
    })
    return `${q(label)},${q(`${er.from_currency} → ${er.to_currency}`)},,,,,${q(payload)}`
  },
  payment_plans: (label, p) => {
    // Modelo de pagamento estruturado: todos os campos no JSON da coluna "codigo".
    const payload = JSON.stringify({
      has_down_payment: !!p.has_down_payment,
      down_payment_mode: p.down_payment_mode || 'percent',
      down_payment_value: p.down_payment_value ?? 0,
      installments_count: p.installments_count ?? 0,
      payment_method: p.payment_method || '',
      first_due_days: p.first_due_days ?? 30,
      interval_days: p.interval_days ?? 30,
    })
    return `${q(label)},${q(p.name)},,,,,${q(payload)}`
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
