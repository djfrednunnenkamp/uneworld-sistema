import { useState } from 'react'
import { Ic } from './Icon'

/**
 * Modal de seleção de seções para exportar o CSV global.
 *
 * Props:
 *   sections        – [{ key, label }] filtrado pelas permissões do usuário
 *   countries       – [{id, name}] lista de países (para filtro de estados)
 *   onClose()
 *   onExport({ selectedKeys: Set, countryFilter: string })
 */
export default function CsvExportModal({ sections, countries = [], onClose, onExport }) {
  const [selected, setSelected]           = useState(() => new Set(sections.map(s => s.key)))
  const [countryFilter, setCountryFilter] = useState('')

  const toggle = (key) => setSelected(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const toggleAll = (val) => {
    setSelected(val ? new Set(sections.map(s => s.key)) : new Set())
  }

  const allChecked  = selected.size === sections.length
  const noneChecked = selected.size === 0
  const includesCountries = selected.has('countries')

  const lbl11 = { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }

  return (
    <div className="overlay" style={{ zIndex: 800 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mbox" style={{ maxWidth: 500, width: '100%' }}>

        <div className="mhead">
          <span className="mtitle">Exportar CSV — selecionar seções</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={14}/></button>
        </div>

        <div className="mbody" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
            Escolha quais seções incluir no arquivo CSV baixado.
          </p>

          {/* Marcar / desmarcar tudo */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => toggleAll(true)}  disabled={allChecked}
              style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', fontSize: 12, cursor: allChecked ? 'default' : 'pointer', color: '#475569', fontFamily: 'inherit', opacity: allChecked ? .5 : 1 }}>
              Marcar tudo
            </button>
            <button onClick={() => toggleAll(false)} disabled={noneChecked}
              style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', fontSize: 12, cursor: noneChecked ? 'default' : 'pointer', color: '#475569', fontFamily: 'inherit', opacity: noneChecked ? .5 : 1 }}>
              Desmarcar tudo
            </button>
          </div>

          {/* Lista de seções */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', background: '#f8fafc', borderRadius: 8, padding: '12px 14px', border: '1px solid #e2e8f0' }}>
            {sections.map(sec => (
              <label key={sec.key} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13, color: '#1e293b', padding: '3px 0' }}>
                <input
                  type="checkbox"
                  checked={selected.has(sec.key)}
                  onChange={() => toggle(sec.key)}
                  style={{ accentColor: '#1a2d4f', width: 14, height: 14, flexShrink: 0 }} />
                {sec.label}
              </label>
            ))}
          </div>

          {/* Filtro de país para estados (só quando Países & Estados está selecionado) */}
          {includesCountries && countries.length > 0 && (
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '12px 14px' }}>
              <p style={{ ...lbl11, margin: '0 0 8px', color: '#1d4ed8' }}>Filtro de estados por país</p>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: '#1d4ed8' }}>
                Selecione um país para exportar apenas os estados desse país. Deixe em branco para exportar todos.
              </p>
              <select
                value={countryFilter}
                onChange={e => setCountryFilter(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 13, background: '#fff', color: '#1e293b', fontFamily: 'inherit', outline: 'none' }}>
                <option value="">Todos os países</option>
                {countries.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

        </div>

        <div className="mfoot" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button onClick={onClose}
            style={{ padding: '8px 18px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancelar
          </button>
          <button
            disabled={noneChecked}
            onClick={() => { if (!noneChecked) { onClose(); onExport({ selectedKeys: selected, countryFilter }) } }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px', borderRadius: 7, border: 'none', background: noneChecked ? '#e2e8f0' : '#059669', color: noneChecked ? '#94a3b8' : '#fff', fontSize: 13, fontWeight: 600, cursor: noneChecked ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            <Ic n="dl" s={14}/> Baixar CSV
          </button>
        </div>

      </div>
    </div>
  )
}
