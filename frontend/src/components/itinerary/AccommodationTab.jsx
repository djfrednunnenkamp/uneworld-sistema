import { memo, useEffect, useState } from 'react'
import Dropdown from '../Dropdown'
import MoneyInput from '../MoneyInput'
import { Ic } from '../Icon'
import { configApi } from '../../api'
import { FormRow, TabCard } from './ui'
import { inp, CURRENCY_OPTS } from './constants'

/* Aba "Valores": moeda base + tabela de preços por acomodação (valor/pessoa + taxas).
   Esses valores são puxados automaticamente para o contrato ao escolher o roteiro. */
function AccommodationTab({ data, setData, canEdit, accommodationOptions }) {
  // Moeda base: as opções vêm das moedas cadastradas no Câmbio (favoritas no topo).
  const [currencyOpts, setCurrencyOpts] = useState(CURRENCY_OPTS)
  useEffect(() => {
    configApi.exchangeRates().then(r => {
      const rows = r.data.results ?? r.data
      const seen = new Map()   // code -> é favorita?
      rows.forEach(er => {
        if (er.from_currency) seen.set(er.from_currency, seen.get(er.from_currency) || !!er.is_favorite)
        if (er.to_currency && !seen.has(er.to_currency)) seen.set(er.to_currency, false)
      })
      const opts = [...seen.entries()]
        .sort((a, b) => (Number(b[1]) - Number(a[1])) || a[0].localeCompare(b[0]))
        .map(([code]) => ({ value: code, label: code }))
      if (opts.length) setCurrencyOpts(opts)
    }).catch(() => {})
  }, [])

  const currencyLabel = data.base_currency || ''
  const accomLines = data.accommodation_lines || []
  const addAccomLine    = () => setData(d => ({ ...d, accommodation_lines: [...(d.accommodation_lines || []), { accommodation_type: null, value_per_person: 0, taxes: 0 }] }))
  const updateAccomLine = (idx, patch) => setData(d => ({ ...d, accommodation_lines: d.accommodation_lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }))
  const removeAccomLine = (idx) => setData(d => ({ ...d, accommodation_lines: d.accommodation_lines.filter((_, i) => i !== idx) }))

  return (
    <>
      <TabCard>
        <FormRow label="Moeda base" last>
          <Dropdown value={data.base_currency} options={currencyOpts} disabled={!canEdit}
            onChange={v => setData(d => ({ ...d, base_currency: v }))} />
        </FormRow>
      </TabCard>

      <TabCard style={{ padding: '20px 24px', marginTop: 20 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: '0 0 4px' }}>Valores das acomodações</p>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 16px' }}>
          Valor por pessoa e taxas de cada tipo de acomodação, na moeda base do roteiro{currencyLabel ? ` (${currencyLabel})` : ''}. Puxados automaticamente no contrato ao escolher este roteiro.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 10, fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            <span style={{ width: 32, flexShrink: 0 }}>#</span>
            <span style={{ flex: 2 }}>Tipo de acomodação</span>
            <span style={{ flex: 1 }}>Valor por pessoa{currencyLabel ? ` (${currencyLabel})` : ''}</span>
            <span style={{ flex: 1 }}>Taxas{currencyLabel ? ` (${currencyLabel})` : ''}</span>
            <span style={{ width: 32, flexShrink: 0 }} />
          </div>
          {accomLines.map((line, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 32, flexShrink: 0, paddingTop: 8, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>{idx + 1}</div>
              <div style={{ flex: 2 }}>
                <Dropdown value={line.accommodation_type} options={accommodationOptions} disabled={!canEdit}
                  onChange={v => updateAccomLine(idx, { accommodation_type: v })} placeholder="Selecione a acomodação" />
              </div>
              <div style={{ flex: 1 }}>
                <MoneyInput style={inp} value={line.value_per_person} disabled={!canEdit} placeholder="0,00"
                  onChange={v => updateAccomLine(idx, { value_per_person: v })} />
              </div>
              <div style={{ flex: 1 }}>
                <MoneyInput style={inp} value={line.taxes} disabled={!canEdit} placeholder="0,00"
                  onChange={v => updateAccomLine(idx, { taxes: v })} />
              </div>
              <button type="button" onClick={() => removeAccomLine(idx)} disabled={!canEdit}
                style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 6, border: '1px solid #fee2e2', background: '#fef2f2', color: '#dc2626', cursor: canEdit ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Ic n="x" s={13} />
              </button>
            </div>
          ))}
          {canEdit && (
            <button type="button" onClick={addAccomLine}
              style={{ alignSelf: 'flex-start', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 7, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Ic n="plus" s={13} /> Adicionar acomodação
            </button>
          )}
        </div>
      </TabCard>
    </>
  )
}

export default memo(AccommodationTab)
