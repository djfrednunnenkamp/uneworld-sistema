import { useState, useEffect, useCallback } from 'react'
import { auditApi } from '../api'

const ACTION_STYLE = {
  create: { label: '✦ Criado',      bg: '#dcfce7', color: '#16a34a', border: '#bbf7d0' },
  update: { label: '✎ Atualizado',  bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  delete: { label: '✕ Apagado',     bg: '#fee2e2', color: '#dc2626', border: '#fecaca' },
}

const MODEL_OPTIONS = [
  { value: '',                 label: 'Todos os tipos' },
  { value: 'Passenger',        label: 'Passageiro' },
  { value: 'PassengerDocument',label: 'Documento' },
  { value: 'Agency',           label: 'Agência' },
  { value: 'Trip',             label: 'Viagem' },
  { value: 'Meeting',          label: 'Reunião' },
  { value: 'User',             label: 'Usuário' },
  { value: 'CustomDocType',    label: 'Tipo de documento' },
  { value: 'ConfigProfession', label: 'Profissão' },
  { value: 'ConfigLanguage',   label: 'Idioma' },
  { value: 'ConfigCountry',    label: 'País' },
  { value: 'ConfigVaccine',    label: 'Vacina' },
  { value: 'ConfigGender',     label: 'Gênero' },
]

const inp = {
  padding: '7px 11px', border: '1.5px solid #e2e8f0', borderRadius: 8,
  fontSize: 13, outline: 'none', fontFamily: 'inherit', background: '#fff',
  color: '#0f172a', transition: 'border-color .12s',
}

/* ── Linha expansível ── */
function LogRow({ entry }) {
  const [expanded, setExpanded] = useState(false)
  const style = ACTION_STYLE[entry.action] ?? ACTION_STYLE.update
  const hasChanges = entry.changes && Object.keys(entry.changes).length > 0

  return (
    <>
      <tr
        onClick={() => hasChanges && setExpanded(e => !e)}
        style={{
          borderBottom: '1px solid #f1f5f9',
          cursor: hasChanges ? 'pointer' : 'default',
          background: expanded ? '#fafbff' : '#fff',
          transition: 'background .1s',
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = '#f8fafc' }}
        onMouseLeave={e => { e.currentTarget.style.background = expanded ? '#fafbff' : '#fff' }}
      >
        {/* Timestamp */}
        <td style={{ padding: '11px 16px', whiteSpace: 'nowrap', fontSize: 12, color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
          {entry.timestamp_br}
        </td>

        {/* Usuário */}
        <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 500, color: '#1e293b', whiteSpace: 'nowrap' }}>
          {entry.user_display || '—'}
        </td>

        {/* Ação */}
        <td style={{ padding: '11px 16px' }}>
          <span style={{
            padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
            background: style.bg, color: style.color, border: `1px solid ${style.border}`,
            whiteSpace: 'nowrap',
          }}>
            {style.label}
          </span>
        </td>

        {/* Tipo */}
        <td style={{ padding: '11px 16px', fontSize: 13, color: '#475569', whiteSpace: 'nowrap' }}>
          {entry.model_label}
        </td>

        {/* Descrição */}
        <td style={{ padding: '11px 16px', fontSize: 13, color: '#1e293b', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.object_repr}
        </td>

        {/* Campos alterados */}
        <td style={{ padding: '11px 16px', fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>
          {hasChanges
            ? <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span>{Object.keys(entry.changes).length} campo{Object.keys(entry.changes).length !== 1 ? 's' : ''}</span>
                <span style={{ fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>
              </span>
            : '—'}
        </td>

        {/* IP */}
        <td style={{ padding: '11px 16px', fontSize: 11, color: '#cbd5e1', whiteSpace: 'nowrap' }}>
          {entry.ip_address ?? '—'}
        </td>
      </tr>

      {/* Expansão: detalhes das mudanças */}
      {expanded && hasChanges && (
        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <td colSpan={7} style={{ padding: '0 16px 14px 40px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 10 }}>
              {Object.entries(entry.changes).map(([field, val]) => {
                /* create/delete: val é string direta; update: val = {antes, depois} */
                const isUpdate = val && typeof val === 'object' && 'antes' in val
                return (
                  <div key={field} style={{
                    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
                    padding: '8px 12px', fontSize: 12, minWidth: 160, maxWidth: 300,
                  }}>
                    <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 4px' }}>
                      {field}
                    </p>
                    {isUpdate ? (
                      <div>
                        {val.antes !== null && val.antes !== '' && (
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginBottom: 3 }}>
                            <span style={{ fontSize: 10, color: '#dc2626', background: '#fee2e2', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>antes</span>
                            <span style={{ color: '#dc2626', textDecoration: 'line-through', wordBreak: 'break-word' }}>{String(val.antes ?? '—')}</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                          <span style={{ fontSize: 10, color: '#16a34a', background: '#dcfce7', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>depois</span>
                          <span style={{ color: '#16a34a', fontWeight: 600, wordBreak: 'break-word' }}>{String(val.depois ?? '—')}</span>
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: '#1e293b', wordBreak: 'break-word' }}>{String(val ?? '—')}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

/* ── Página principal ── */
export default function AuditLog() {
  const [logs,     setLogs]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [count,    setCount]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [filters,  setFilters]  = useState({ action: '', model: '', user: '', date_from: '', date_to: '', search: '' })

  const load = useCallback(async (p = 1, f = filters) => {
    setLoading(true)
    try {
      const params = { page: p, page_size: 50 }
      if (f.action)    params.action    = f.action
      if (f.model)     params.model     = f.model
      if (f.user)      params.user      = f.user
      if (f.date_from) params.date_from = f.date_from
      if (f.date_to)   params.date_to   = f.date_to
      if (f.search)    params.search    = f.search
      const r = await auditApi.list(params)
      setLogs(r.data.results ?? r.data)
      setCount(r.data.count ?? (r.data.results ?? r.data).length)
      setPage(p)
    } catch { /* silently */ }
    finally { setLoading(false) }
  }, [filters])

  useEffect(() => { load(1, filters) }, [])

  const setFilter = (key, val) => {
    const next = { ...filters, [key]: val }
    setFilters(next)
    load(1, next)
  }

  const totalPages = Math.ceil(count / 50)

  return (
    <div>
      {/* Header */}
      <div className="ph" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="ph-title">Log do Sistema</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
            {count.toLocaleString('pt-BR')} registro{count !== 1 ? 's' : ''} de auditoria
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={filters.search}
          onChange={e => setFilter('search', e.target.value)}
          placeholder="Buscar…"
          style={{ ...inp, width: 200 }}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'}
          onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
        />

        <select value={filters.action} onChange={e => setFilter('action', e.target.value)} style={{ ...inp }}>
          <option value="">Todas as ações</option>
          <option value="create">✦ Criado</option>
          <option value="update">✎ Atualizado</option>
          <option value="delete">✕ Apagado</option>
        </select>

        <select value={filters.model} onChange={e => setFilter('model', e.target.value)} style={{ ...inp }}>
          {MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <input
          value={filters.date_from}
          onChange={e => setFilter('date_from', e.target.value)}
          type="date"
          title="Data inicial"
          style={{ ...inp }}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'}
          onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
        />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>até</span>
        <input
          value={filters.date_to}
          onChange={e => setFilter('date_to', e.target.value)}
          type="date"
          title="Data final"
          style={{ ...inp }}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'}
          onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
        />

        {(filters.action || filters.model || filters.search || filters.date_from || filters.date_to) && (
          <button
            onClick={() => { const c = { action:'',model:'',user:'',date_from:'',date_to:'',search:'' }; setFilters(c); load(1, c) }}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Tabela */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0' }}>
                {['Data / Hora', 'Usuário', 'Ação', 'Tipo', 'Descrição', 'Campos', 'IP'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '48px 0', color: '#94a3b8', fontSize: 13 }}>
                  Carregando…
                </td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '48px 0' }}>
                  <p style={{ fontSize: 32, marginBottom: 8 }}>📋</p>
                  <p style={{ color: '#94a3b8', fontSize: 13 }}>Nenhum registro encontrado.</p>
                </td></tr>
              ) : logs.map(entry => (
                <LogRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {totalPages > 1 && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>
              Página {page} de {totalPages} · {count.toLocaleString('pt-BR')} registros
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button disabled={page <= 1} onClick={() => load(page - 1)}
                style={{ padding: '5px 12px', borderRadius: 7, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? .4 : 1, fontFamily: 'inherit' }}>
                ← Anterior
              </button>
              <button disabled={page >= totalPages} onClick={() => load(page + 1)}
                style={{ padding: '5px 12px', borderRadius: 7, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? .4 : 1, fontFamily: 'inherit' }}>
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
