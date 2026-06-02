import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { auditApi } from '../api'
import DatePicker from '../components/DatePicker'

/* ── Estilos de ação ── */
const ACTION_STYLE = {
  create: { label: '✦ Criado',     bg: '#dcfce7', color: '#16a34a', border: '#bbf7d0' },
  update: { label: '✎ Atualizado', bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  delete: { label: '✕ Apagado',    bg: '#fee2e2', color: '#dc2626', border: '#fecaca' },
}

const MODEL_OPTS = [
  { value: '',                  label: 'Todos os tipos'    },
  { value: 'Passenger',         label: 'Passageiro'        },
  { value: 'PassengerDocument', label: 'Documento'         },
  { value: 'Agency',            label: 'Agência'           },
  { value: 'Trip',              label: 'Viagem'            },
  { value: 'Meeting',           label: 'Reunião'           },
  { value: 'User',              label: 'Usuário'           },
  { value: 'CustomDocType',     label: 'Tipo de documento' },
  { value: 'ConfigProfession',  label: 'Profissão'         },
  { value: 'ConfigLanguage',    label: 'Idioma'            },
  { value: 'ConfigCountry',     label: 'País'              },
  { value: 'ConfigVaccine',     label: 'Vacina'            },
  { value: 'ConfigGender',      label: 'Gênero'            },
]

const ACTION_OPTS = [
  { value: '',       label: 'Todas as ações' },
  { value: 'create', label: '✦ Criado'       },
  { value: 'update', label: '✎ Atualizado'   },
  { value: 'delete', label: '✕ Apagado'      },
]

/* ── Dropdown de filtro estilo Passageiros ── */
function FDrop({ label, value, onChange, options }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const active = value !== options[0].value
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7,
          border: `1px solid ${active ? '#2e6db4' : '#e2e8f0'}`,
          background: active ? '#eff6ff' : '#fff',
          color: active ? '#2e6db4' : '#475569',
          fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit',
          whiteSpace: 'nowrap', transition: 'all .12s',
        }}>
        {label}{active && selected ? `: ${selected.label}` : ''}
        <span style={{ fontSize: 9, opacity: .7 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 300,
          background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0',
          boxShadow: '0 8px 24px rgba(0,0,0,.10)', minWidth: 180, overflow: 'hidden',
        }}>
          {options.map(opt => {
            const sel = value === opt.value
            return (
              <button key={opt.value} type="button"
                onClick={() => { onChange(opt.value); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '9px 14px', gap: 10,
                  background: sel ? '#eff6ff' : 'transparent', border: 'none',
                  borderBottom: '1px solid #f8fafc', color: sel ? '#2e6db4' : '#1e293b',
                  fontSize: 13, fontWeight: sel ? 600 : 400, cursor: 'pointer',
                  fontFamily: 'inherit', textAlign: 'left',
                }}
                onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f8fafc' }}
                onMouseLeave={e => { if (!sel) e.currentTarget.style.background = sel ? '#eff6ff' : 'transparent' }}
              >
                <span>{opt.label}</span>
                {sel && <span style={{ color: '#2e6db4' }}>✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* Formata valores ISO de data/hora para formato legível */
function fmtVal(val) {
  if (val === null || val === undefined) return '—'
  const s = String(val)
  // Detecta ISO datetime: 2026-06-02T02:00:33... ou 2026-06-02T...+00:00
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    try {
      const d = new Date(s)
      return d.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    } catch { return s }
  }
  // Detecta ISO date: 2026-06-02
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-')
    return `${d}/${m}/${y}`
  }
  return s
}

/* ── Popup de detalhe de um evento ── */
function LogDetailPopup({ entry, onClose }) {
  const style = ACTION_STYLE[entry.action] ?? ACTION_STYLE.update
  const changes = entry.changes ?? {}
  const hasChanges = Object.keys(changes).length > 0
  const isUpdate = entry.action === 'update'

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 20,
    }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: '#fff', borderRadius: 14, width: '100%', maxWidth: 680,
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 32px 80px rgba(0,0,0,.25)',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: style.bg, color: style.color, border: `1px solid ${style.border}` }}>
                  {style.label}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{entry.model_label}</span>
              </div>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>{entry.object_repr}</p>
              <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#64748b' }}>
                <span>🕐 {entry.timestamp_br}</span>
                <span>👤 {entry.user_display || 'Sistema'}</span>
                {entry.ip_address && <span>🌐 {entry.ip_address}</span>}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 22, lineHeight: 1, padding: 2, flexShrink: 0 }}>×</button>
          </div>
        </div>

        {/* Conteúdo */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {!hasChanges ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Sem detalhes registrados.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {Object.entries(changes).map(([field, val]) => {
                const isUpdateField = val && typeof val === 'object' && 'antes' in val
                return (
                  <div key={field} style={{
                    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px',
                  }}>
                    <p style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 8px' }}>
                      {field}
                    </p>
                    {isUpdateField ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {val.antes !== null && val.antes !== '' && val.antes !== undefined && (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', background: '#fee2e2', padding: '2px 6px', borderRadius: 4, flexShrink: 0, marginTop: 1 }}>antes</span>
                            <span style={{ fontSize: 13, color: '#dc2626', textDecoration: 'line-through', wordBreak: 'break-word', opacity: .8 }}>{fmtVal(val.antes)}</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '2px 6px', borderRadius: 4, flexShrink: 0, marginTop: 1 }}>depois</span>
                          <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600, wordBreak: 'break-word' }}>{fmtVal(val.depois)}</span>
                        </div>
                      </div>
                    ) : (
                      <span style={{ fontSize: 13, color: '#1e293b', wordBreak: 'break-word' }}>{fmtVal(val)}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose}
            style={{ padding: '8px 20px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Linha da tabela ── */
function LogRow({ entry, onClick }) {
  const style = ACTION_STYLE[entry.action] ?? ACTION_STYLE.update
  const changesCount = Object.keys(entry.changes ?? {}).length

  return (
    <tr onClick={onClick} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', transition: 'background .1s' }}
      onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
      onMouseLeave={e => e.currentTarget.style.background = '#fff'}
    >
      <td style={{ padding: '12px 16px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', textAlign: 'center' }}>
        {entry.timestamp_br}
      </td>
      <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500, color: '#1e293b', textAlign: 'center' }}>
        {entry.user_display || '—'}
      </td>
      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
        <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: style.bg, color: style.color, border: `1px solid ${style.border}`, whiteSpace: 'nowrap' }}>
          {style.label}
        </span>
      </td>
      <td style={{ padding: '12px 16px', fontSize: 13, color: '#475569', textAlign: 'center' }}>
        {entry.model_label}
      </td>
      <td style={{ padding: '12px 16px', fontSize: 13, color: '#1e293b', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
        {entry.object_repr}
      </td>
      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
        {changesCount > 0
          ? <span style={{ fontSize: 12, color: '#2e6db4', background: '#eff6ff', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
              {changesCount} campo{changesCount !== 1 ? 's' : ''}
            </span>
          : <span style={{ fontSize: 12, color: '#cbd5e1' }}>—</span>}
      </td>
      <td style={{ padding: '12px 16px', fontSize: 11, color: '#cbd5e1', textAlign: 'center' }}>
        {entry.ip_address ?? '—'}
      </td>
    </tr>
  )
}

const TH = ({ children }) => (
  <th style={{ padding: '11px 16px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap', background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0' }}>
    {children}
  </th>
)

// Mapeia model_name → rótulo e rota de volta
const MODEL_CONTEXT = {
  Passenger: { label: 'Passageiros', back: '/passageiros' },
  Agency:    { label: 'Agências',    back: '/agencias'    },
}

/* ── Página principal ── */
export default function AuditLog() {
  const navigate       = useNavigate()
  const [searchParams] = useSearchParams()
  const initModel      = searchParams.get('model') || ''

  const [logs,     setLogs]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [count,    setCount]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [selected, setSelected] = useState(null)
  const [filters,  setFilters]  = useState({ action: '', model: initModel, search: '', date_from: '', date_to: '' })

  const load = useCallback(async (p = 1, f = filters) => {
    setLoading(true)
    try {
      const params = { page: p, page_size: 50 }
      if (f.action)    params.action    = f.action
      if (f.model)     params.model     = f.model
      if (f.search)    params.search    = f.search
      if (f.date_from) params.date_from = f.date_from
      if (f.date_to)   params.date_to   = f.date_to
      const r = await auditApi.list(params)
      setLogs(r.data.results ?? r.data)
      setCount(r.data.count ?? (r.data.results ?? r.data).length)
      setPage(p)
    } catch {}
    finally { setLoading(false) }
  }, [filters])

  useEffect(() => { load(1, filters) }, [])

  const setFilter = (key, val) => {
    const next = { ...filters, [key]: val }
    setFilters(next)
    load(1, next)
  }

  const hasFilter = filters.action || filters.model || filters.search || filters.date_from || filters.date_to
  const totalPages = Math.ceil(count / 50)

  const ctx = MODEL_CONTEXT[filters.model] || null

  return (
    <div>
      {/* Header */}
      <div className="ph" style={{ marginBottom: 20 }}>
        <div>
          {ctx && (
            <button onClick={() => navigate(ctx.back)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 12, fontFamily: 'inherit', padding: 0 }}
              onMouseEnter={e => e.currentTarget.style.color = '#1a2d4f'}
              onMouseLeave={e => e.currentTarget.style.color = '#64748b'}>
              ← Voltar para {ctx.label}
            </button>
          )}
          <h1 className="ph-title">
            {ctx ? `Log de ${ctx.label}` : 'Log do Sistema'}
          </h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
            {count.toLocaleString('pt-BR')} evento{count !== 1 ? 's' : ''} registrado{count !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Filtros estilo Passageiros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Busca */}
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none', fontSize: 14 }}>🔍</span>
          <input
            value={filters.search}
            onChange={e => setFilter('search', e.target.value)}
            placeholder="Buscar por usuário ou descrição…"
            style={{ paddingLeft: 30, paddingRight: 12, paddingTop: 7, paddingBottom: 7, border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b', background: '#fff', width: 250 }}
            onFocus={e => e.target.style.borderColor = '#2e6db4'}
            onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
          />
        </div>

        <FDrop label="Ação"  value={filters.action} onChange={v => setFilter('action', v)} options={ACTION_OPTS} />
        <FDrop label="Tipo"  value={filters.model}  onChange={v => setFilter('model',  v)} options={MODEL_OPTS} />

        {/* Datas — usa o DatePicker customizado (DD/MM/AAAA com calendário) */}
        <div style={{ width: 150 }}>
          <DatePicker
            value={filters.date_from}
            onChange={v => setFilter('date_from', v)}
            placeholder="De: DD/MM/AAAA"
          />
        </div>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>até</span>
        <div style={{ width: 150 }}>
          <DatePicker
            value={filters.date_to}
            onChange={v => setFilter('date_to', v)}
            placeholder="Até: DD/MM/AAAA"
          />
        </div>

        {hasFilter && (
          <button onClick={() => { const c = { action:'',model:'',search:'',date_from:'',date_to:'' }; setFilters(c); load(1,c) }}
            style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            ✕ Limpar
          </button>
        )}
      </div>

      {/* Tabela */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <TH>Data / Hora</TH>
                <TH>Usuário</TH>
                <TH>Ação</TH>
                <TH>Tipo</TH>
                <TH>Descrição</TH>
                <TH>Campos</TH>
                <TH>IP</TH>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '56px 0', color: '#94a3b8', fontSize: 13 }}>
                  Carregando…
                </td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '56px 0' }}>
                  <p style={{ fontSize: 36, marginBottom: 10 }}>📋</p>
                  <p style={{ color: '#94a3b8', fontSize: 14, fontWeight: 500 }}>Nenhum evento encontrado.</p>
                  {hasFilter && <p style={{ color: '#cbd5e1', fontSize: 12, marginTop: 4 }}>Tente ajustar os filtros.</p>}
                </td></tr>
              ) : logs.map(entry => (
                <LogRow key={entry.id} entry={entry} onClick={() => setSelected(entry)} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {totalPages > 1 && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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

      {/* Popup de detalhe */}
      {selected && <LogDetailPopup entry={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
