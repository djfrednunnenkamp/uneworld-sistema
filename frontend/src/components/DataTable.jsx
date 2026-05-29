import { useState, useMemo } from 'react'
import { Ic } from './Icon'

/* ── Status badge ── */
const STATUS_CLS = {
  active: 'bg-green',   Ativo: 'bg-green',    Ativa: 'bg-green',   Confirmada: 'bg-green',   confirmed: 'bg-green',
  pending:'bg-amber',   Pendente:'bg-amber',
  inactive:'bg-red',    Inativo:'bg-red',      Inativa:'bg-red',    Cancelada:'bg-red',       cancelled:'bg-red',
  scheduled:'bg-blue',  Agendada:'bg-blue',    'Em Andamento':'bg-blue', ongoing:'bg-blue',
  completed:'bg-green', Concluída:'bg-green',
  open:'bg-blue',       Aberta:'bg-blue',
  full:'bg-amber',      Lotada:'bg-amber',
  no_show:'bg-red',
}

const STATUS_PT = {
  active:'Ativo', inactive:'Inativo', pending:'Pendente',
  scheduled:'Agendada', completed:'Concluída', cancelled:'Cancelada',
  open:'Aberta', full:'Lotada', ongoing:'Em andamento', confirmed:'Confirmado', no_show:'Não compareceu',
}

export function StatusBadge({ value }) {
  const cls   = STATUS_CLS[value] ?? 'bg-amber'
  const label = STATUS_PT[value]  ?? value
  return <span className={`badge ${cls}`}>{label}</span>
}

/**
 * Generic reusable data table.
 *
 * Props:
 *   title       – page title (string)
 *   addLabel    – text for primary CTA button
 *   data        – array of records
 *   cols        – [{ key, label, render? }]   render(value, row) → ReactNode
 *   searchKeys  – keys to search against
 *   filterKey   – key used for chip filter (usually 'status')
 *   filterOpts  – array of raw values for chips
 *   onAdd       – () => void
 *   onEdit      – (row) => void
 *   onDelete    – (row) => void
 *   loading     – boolean
 */
export default function DataTable({
  title, addLabel, data = [], cols = [],
  searchKeys = [], filterKey = 'status', filterOpts,
  onAdd, onEdit, onDelete, loading,
}) {
  const [q,   setQ]   = useState('')
  const [flt, setFlt] = useState('Todos')
  const [sel, setSel] = useState(new Set())

  const rows = useMemo(() => data.filter((r) => {
    const matchQ   = !q || searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q.toLowerCase()))
    const matchFlt = flt === 'Todos' || r[filterKey] === flt
    return matchQ && matchFlt
  }), [data, q, flt])

  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id))
  const togAll = () => {
    const s = new Set(sel)
    allSel ? rows.forEach((r) => s.delete(r.id)) : rows.forEach((r) => s.add(r.id))
    setSel(s)
  }
  const tog1 = (id) => {
    const s = new Set(sel)
    s.has(id) ? s.delete(id) : s.add(id)
    setSel(s)
  }

  return (
    <>
      {/* ── Page header ── */}
      <div className="ph">
        <h1 className="ph-title">{title}</h1>
        <div className="ph-actions">
          <button className="btn btn-outline"><Ic n="dl" s={13}/>Exportar</button>
          <button className="btn btn-outline"><Ic n="ul" s={13}/>Importar</button>
          <button className="btn btn-primary" onClick={onAdd}><Ic n="plus" s={13}/>{addLabel}</button>
        </div>
      </div>

      {/* ── Search + filters ── */}
      <div className="search-row">
        <div className="search-wrap">
          <span className="search-ico"><Ic n="search" s={14}/></span>
          <input
            className="search-in"
            placeholder="Buscar por nome…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {filterOpts && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {['Todos', ...filterOpts].map((s) => (
              <button key={s} className={`chip${flt === s ? ' on' : ''}`} onClick={() => setFlt(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Table card ── */}
      <div className="tcard">
        {loading ? (
          <div className="empty-state">
            <p style={{ color: '#94a3b8' }}>Carregando…</p>
          </div>
        ) : (
          <table className="dt">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input type="checkbox" className="chk" checked={allSel} onChange={togAll} />
                </th>
                {cols.map((c) => <th key={c.key}>{c.label}</th>)}
                <th style={{ width: 108 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={cols.length + 2}>
                    <div className="empty-state">
                      <div style={{ color: '#cbd5e1' }}><Ic n="search" s={28}/></div>
                      <p>Nenhum resultado encontrado</p>
                    </div>
                  </td>
                </tr>
              ) : rows.map((row) => (
                <tr key={row.id}>
                  <td><input type="checkbox" className="chk" checked={sel.has(row.id)} onChange={() => tog1(row.id)}/></td>
                  {cols.map((c) => (
                    <td key={c.key}>
                      {c.render ? c.render(row[c.key], row) : row[c.key]}
                    </td>
                  ))}
                  <td>
                    <div className="r-acts">
                      <button className="r-btn edit" title="Editar"      onClick={() => onEdit?.(row)}><Ic n="edit"  s={13}/></button>
                      <button className="r-btn view" title="Visualizar"                                ><Ic n="eye"   s={13}/></button>
                      <button className="r-btn del"  title="Excluir"     onClick={() => onDelete?.(row)}><Ic n="trash" s={13}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
