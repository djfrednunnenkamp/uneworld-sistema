import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { configApi } from '../api'

function parseCsvNames(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const isHeader = (s) => ['nome', 'name', 'profissão', 'profissao', 'idioma', 'language'].includes(s.toLowerCase().trim())
  const start = lines.length > 0 && isHeader(lines[0].replace(/["""]/g, '').trim()) ? 1 : 0
  return lines.slice(start)
    .map(l => l.trim().replace(/^["""]|["""]$/g, '').replace(/""/g, '"').trim())
    .filter(Boolean)
}

const BADGE = {
  new:    { bg: '#dcfce7', color: '#16a34a', label: '✓ Novo'      },
  exists: { bg: '#fef9c3', color: '#ca8a04', label: '⚠ Já existe' },
}

const API_MAP = {
  professions: { add: (name) => configApi.addProfession(name), label: 'Profissões' },
  languages:   { add: (name) => configApi.addLanguage(name),   label: 'Idiomas'    },
}

export default function FlatImport() {
  const navigate = useNavigate()
  const location = useLocation()
  const { csvText, filename, type, existingNames = [] } = location.state || {}

  const apiDef   = API_MAP[type] || API_MAP.professions
  const backPath = '/configuracoes'

  const [rows,     setRows]     = useState([])
  const [selected, setSelected] = useState(new Set()) // indices removidos
  const [phase,    setPhase]    = useState('review')  // review | importing | done
  const [result,   setResult]   = useState(null)
  const [search,   setSearch]   = useState('')
  const [filter,   setFilter]   = useState('all')

  useEffect(() => {
    if (!csvText) { navigate(backPath); return }
    const names    = parseCsvNames(csvText)
    const existing = new Set(existingNames.map(n => n.toLowerCase()))
    setRows(names.map((name, i) => ({
      id:     i,
      name,
      status: existing.has(name.toLowerCase()) ? 'exists' : 'new',
    })))
  }, [])

  const filtered = useMemo(() => {
    let list = rows
    if (filter !== 'all') list = list.filter(r => r.status === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r => r.name.toLowerCase().includes(q))
    }
    return list
  }, [rows, filter, search])

  const stats = useMemo(() => ({
    total:  rows.length,
    neww:   rows.filter(r => r.status === 'new').length,
    exists: rows.filter(r => r.status === 'exists').length,
    active: rows.filter(r => !selected.has(r.id)).length,
  }), [rows, selected])

  const toggleRow  = (id) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll  = () => {
    const ids = filtered.map(r => r.id)
    if (ids.every(id => selected.has(id))) {
      setSelected(p => { const n = new Set(p); ids.forEach(id => n.delete(id)); return n })
    } else {
      setSelected(p => { const n = new Set(p); ids.forEach(id => n.add(id)); return n })
    }
  }

  const doImport = async (onlyNew) => {
    const toImport = rows.filter(r => !selected.has(r.id) && (!onlyNew || r.status === 'new'))
    if (toImport.length === 0) { toast.error('Nenhum item selecionado.'); return }
    setPhase('importing')
    let added = 0, skipped = 0
    for (const row of toImport) {
      try { await apiDef.add(row.name); added++ }
      catch { skipped++ }
    }
    setResult({ added, skipped, total: toImport.length })
    setPhase('done')
  }

  /* ── Tela de resultado ── */
  if (phase === 'done' && result) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: 48 }}>
        <div style={{ fontSize: 56 }}>✅</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: 0 }}>
          Importação concluída
        </h2>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ textAlign: 'center', padding: '20px 32px', background: '#dcfce7', borderRadius: 12, border: '1px solid #bbf7d0' }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: '#16a34a' }}>{result.added}</div>
            <div style={{ fontSize: 13, color: '#15803d', marginTop: 4 }}>itens adicionados</div>
          </div>
          {result.skipped > 0 && (
            <div style={{ textAlign: 'center', padding: '20px 32px', background: '#fef9c3', borderRadius: 12, border: '1px solid #fde68a' }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: '#ca8a04' }}>{result.skipped}</div>
              <div style={{ fontSize: 13, color: '#a16207', marginTop: 4 }}>já existiam</div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => navigate(backPath, { state: { tab: type === 'professions' ? 0 : 1 } })}
            style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            ← Voltar para Configurações
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px', borderBottom: '1px solid #e2e8f0', background: '#fff', flexShrink: 0 }}>
        <button onClick={() => navigate(backPath)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 13, fontFamily: 'inherit' }}>
          ← Voltar
        </button>
        <div style={{ width: 1, height: 18, background: '#e2e8f0' }} />
        <h1 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
          Importar {apiDef.label}
        </h1>
        <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 4 }}>{filename}</span>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 16, padding: '10px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
        {[
          { label: 'Total no CSV', val: stats.total,  color: '#475569' },
          { label: '✓ Novos',      val: stats.neww,   color: '#16a34a' },
          { label: '⚠ Já existem', val: stats.exists, color: '#ca8a04' },
        ].map(s => (
          <span key={s.label} style={{ fontSize: 13, color: s.color, fontWeight: 600 }}>
            {s.val} <span style={{ fontWeight: 400, color: '#94a3b8' }}>{s.label}</span>
          </span>
        ))}
        {selected.size > 0 && (
          <span style={{ fontSize: 13, color: '#dc2626', fontWeight: 600, marginLeft: 'auto' }}>
            {selected.size} removido{selected.size !== 1 ? 's' : ''} da lista
          </span>
        )}
      </div>

      {/* Botões de ação */}
      <div style={{ display: 'flex', gap: 10, padding: '12px 24px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => doImport(true)} disabled={phase === 'importing' || stats.neww === 0}
          style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: stats.neww === 0 ? .5 : 1 }}>
          ⬆ Importar somente novos ({stats.neww})
        </button>
        <button onClick={() => doImport(false)} disabled={phase === 'importing'}
          style={{ padding: '9px 20px', borderRadius: 8, border: '1.5px solid #1a2d4f', background: '#fff', color: '#1a2d4f', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Importar tudo ({stats.active})
        </button>
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())}
            style={{ padding: '9px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            Restaurar removidos
          </button>
        )}
        {phase === 'importing' && (
          <span style={{ fontSize: 13, color: '#64748b', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #e2e8f0', borderTopColor: '#2e6db4', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            Importando…
          </span>
        )}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 24px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, alignItems: 'center' }}>
        {[
          { key: 'all',    label: `Todos (${stats.total})` },
          { key: 'new',    label: `Novos (${stats.neww})` },
          { key: 'exists', label: `Já existem (${stats.exists})` },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            style={{ padding: '5px 12px', borderRadius: 20, border: '1.5px solid', fontFamily: 'inherit',
              borderColor: filter === f.key ? '#1a2d4f' : '#e2e8f0',
              background:  filter === f.key ? '#1a2d4f' : '#fff',
              color:       filter === f.key ? '#fff' : '#475569',
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}>
            {f.label}
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
          style={{ marginLeft: 'auto', padding: '6px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 12, outline: 'none', fontFamily: 'inherit', width: 220 }}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'}
          onBlur={e  => e.target.style.borderColor = '#e2e8f0'} />
      </div>

      {/* Tabela */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc', position: 'sticky', top: 0, zIndex: 10 }}>
              <th style={{ width: 40, padding: '9px 12px', textAlign: 'center', borderBottom: '1px solid #e2e8f0' }}>
                <input type="checkbox"
                  checked={filtered.length > 0 && filtered.every(r => selected.has(r.id))}
                  onChange={toggleAll}
                  title="Marcar/desmarcar todos visíveis"
                />
              </th>
              <th style={{ padding: '9px 16px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid #e2e8f0' }}>
                Nome
              </th>
              <th style={{ padding: '9px 16px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid #e2e8f0', width: 140 }}>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={3} style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: 13 }}>Nenhum resultado.</td></tr>
            ) : filtered.map(row => {
              const removed = selected.has(row.id)
              const badge   = BADGE[row.status]
              return (
                <tr key={row.id}
                  style={{ background: removed ? '#fef2f2' : '#fff', borderBottom: '1px solid #f1f5f9', opacity: removed ? 0.5 : 1 }}
                  onMouseEnter={e => { if (!removed) e.currentTarget.style.background = '#fafafa' }}
                  onMouseLeave={e => { e.currentTarget.style.background = removed ? '#fef2f2' : '#fff' }}
                >
                  <td style={{ padding: '7px 12px', textAlign: 'center' }}>
                    <input type="checkbox" checked={removed} onChange={() => toggleRow(row.id)}
                      title={removed ? 'Restaurar' : 'Remover da importação'} />
                  </td>
                  <td style={{ padding: '7px 16px', color: removed ? '#94a3b8' : '#0f172a', textDecoration: removed ? 'line-through' : 'none' }}>
                    {row.name}
                  </td>
                  <td style={{ padding: '7px 16px' }}>
                    {removed ? (
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>— removido</span>
                    ) : (
                      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: badge.bg, color: badge.color }}>
                        {badge.label}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
