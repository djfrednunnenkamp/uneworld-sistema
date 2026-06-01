import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { configApi } from '../api'

/* ── CSV parsing ── */
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (lines.length === 0) return []

  // Detecta colunas do cabeçalho
  const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/["""]/g, ''))
  const iCol = (names) => header.findIndex(h => names.includes(h))
  const cPais   = iCol(['pais', 'país', 'country'])
  const cEstado = iCol(['estado', 'state'])
  const cCidade = iCol(['cidade', 'city'])

  const parseCell = (v = '') => v.trim().replace(/^[""]|[""]$/g, '').replace(/""/g, '"').replace(/[""]/g, '"')

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    // split respeitando aspas
    const cells = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"' || ch === '“' || ch === '”') { inQ = !inQ }
      else if (ch === ',' && !inQ) { cells.push(cur); cur = '' }
      else cur += ch
    }
    cells.push(cur)
    rows.push({
      id:     i,
      pais:   cPais   >= 0 ? parseCell(cells[cPais])   : '',
      estado: cEstado >= 0 ? parseCell(cells[cEstado]) : '',
      cidade: cCidade >= 0 ? parseCell(cells[cCidade]) : '',
      status: 'pending',
      msg:    '',
    })
  }
  return rows
}

/* ── Badge ── */
const BADGE = {
  pending: { bg: '#f1f5f9', color: '#64748b', label: 'Verificando…' },
  new:     { bg: '#dcfce7', color: '#16a34a', label: '✓ Novo'       },
  exists:  { bg: '#fef9c3', color: '#ca8a04', label: '⚠ Já existe'  },
  error:   { bg: '#fee2e2', color: '#dc2626', label: '✗ Erro'       },
}
function Badge({ status }) {
  const s = BADGE[status] || BADGE.pending
  return (
    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

/* ── Célula editável ── */
function EditCell({ value, onChange, placeholder }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  const commit = () => { setEditing(false); if (val !== value) onChange(val) }
  if (editing) {
    return (
      <input autoFocus value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setVal(value); setEditing(false) } }}
        style={{ width: '100%', padding: '2px 6px', border: '1.5px solid #2e6db4', borderRadius: 4, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
      />
    )
  }
  return (
    <span
      onClick={() => { setVal(value); setEditing(true) }}
      title="Clique para editar"
      style={{ cursor: 'text', display: 'block', padding: '2px 4px', borderRadius: 4, minWidth: 40, color: value ? '#0f172a' : '#94a3b8' }}
    >
      {value || <em style={{ color: '#cbd5e1' }}>{placeholder}</em>}
    </span>
  )
}

/* ── Página principal ── */
export default function GeoImport() {
  const navigate   = useNavigate()
  const location   = useLocation()
  const dropRef    = useRef(null)
  const fileRef    = useRef(null)

  const [phase,    setPhase]    = useState('upload')   // upload | analyzing | review | acting | done
  const [rows,     setRows]     = useState([])
  const [filter,   setFilter]   = useState('all')      // all | new | exists | error
  const [search,   setSearch]   = useState('')
  const [selected, setSelected] = useState(new Set())  // ids selecionados
  const [result,   setResult]   = useState(null)
  const [dragging, setDragging] = useState(false)

  /* ── Se veio do Settings com CSV já selecionado, analisa automaticamente ── */
  useEffect(() => {
    const { csvText, filename } = location.state || {}
    if (csvText) {
      const file = new File([csvText], filename || 'import.csv', { type: 'text/csv' })
      loadFile(file)
      // Limpa o state para não re-analisar ao voltar para a página
      window.history.replaceState({}, '')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── Carregar arquivo ── */
  const loadFile = useCallback(async (file) => {
    if (!file) return
    const text = await file.text()
    const parsed = parseCsv(text)
    if (parsed.length === 0) { toast.error('CSV vazio ou sem linhas válidas.'); return }
    setRows(parsed)
    setPhase('analyzing')
    setSelected(new Set())
    setFilter('all')
    setSearch('')

    // Analisa em lotes de 500 para não sobrecarregar a API
    const BATCH = 500
    const annotated = [...parsed]
    for (let i = 0; i < parsed.length; i += BATCH) {
      const batch = parsed.slice(i, i + BATCH)
      try {
        const r = await configApi.geoAnalyze(batch.map(({ pais, estado, cidade }) => ({ pais, estado, cidade })))
        r.data.rows.forEach((res, j) => {
          annotated[i + j] = { ...annotated[i + j], status: res.status, msg: res.msg || '' }
        })
        setRows([...annotated])
      } catch { /* continua */ }
    }
    setPhase('review')
  }, [])

  /* ── Drag & drop ── */
  const onDrop = (e) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) loadFile(file)
  }

  /* ── Editar célula ── */
  const editRow = (id, field, value) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value, status: 'pending', msg: '' } : r))
    // Re-analisa a linha editada
    configApi.geoAnalyze([{ pais: '', estado: '', cidade: '' }]).catch(() => {})
    const row = rows.find(r => r.id === id)
    if (row) {
      const updated = { ...row, [field]: value }
      configApi.geoAnalyze([{ pais: updated.pais, estado: updated.estado, cidade: updated.cidade }])
        .then(r => {
          const res = r.data.rows[0]
          setRows(prev => prev.map(row => row.id === id ? { ...row, status: res.status, msg: res.msg || '' } : row))
        }).catch(() => {})
    }
  }

  /* ── Seleção ── */
  const toggleAll = (filtered) => {
    if (filtered.every(r => selected.has(r.id))) {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(r => n.delete(r.id)); return n })
    } else {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(r => n.add(r.id)); return n })
    }
  }
  const toggle = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const removeSelected = () => {
    setRows(prev => prev.filter(r => !selected.has(r.id)))
    setSelected(new Set())
  }

  /* ── Ação ── */
  const act = async (mode) => {
    const activeRows = rows.filter(r => !selected.has(r.id) && r.status !== 'error')
    if (activeRows.length === 0) { toast.error('Nenhuma linha válida para importar.'); return }
    setPhase('acting')
    try {
      const r = await configApi.geoAction(mode, activeRows.map(({ pais, estado, cidade }) => ({ pais, estado, cidade })))
      setResult({ mode, ...r.data })
      setPhase('done')
    } catch { toast.error('Erro ao executar.'); setPhase('review') }
  }

  /* ── Filtro ── */
  const filtered = useMemo(() => {
    let list = rows
    if (filter !== 'all') list = list.filter(r => r.status === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.pais.toLowerCase().includes(q) ||
        r.estado.toLowerCase().includes(q) ||
        r.cidade.toLowerCase().includes(q)
      )
    }
    return list
  }, [rows, filter, search])

  /* ── Stats ── */
  const stats = useMemo(() => ({
    total:  rows.length,
    neww:   rows.filter(r => r.status === 'new').length,
    exists: rows.filter(r => r.status === 'exists').length,
    errors: rows.filter(r => r.status === 'error').length,
    paises: new Set(rows.map(r => r.pais).filter(Boolean)).size,
  }), [rows])

  /* ── Styles ── */
  const MODE_LABELS = {
    merge:   'Importar tudo',
    replace: 'Importar e apagar outros',
    delete:  'Apagar do banco',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '14px 24px', borderBottom: '1px solid #e2e8f0',
        background: '#fff', flexShrink: 0,
      }}>
        <button onClick={() => navigate('/configuracoes')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 13, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
          ← Voltar
        </button>
        <div style={{ width: 1, height: 18, background: '#e2e8f0' }} />
        <h1 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
          Importação CSV — Países, Estados e Cidades
        </h1>
        {phase === 'review' && (
          <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 'auto' }}>
            {stats.total.toLocaleString('pt-BR')} linhas · {stats.paises} países
          </span>
        )}
      </div>

      {/* ── Upload ── */}
      {phase === 'upload' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <div
            ref={dropRef}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            style={{
              width: '100%', maxWidth: 480, padding: '48px 32px',
              border: `2px dashed ${dragging ? '#2e6db4' : '#e2e8f0'}`,
              borderRadius: 16, textAlign: 'center', cursor: 'pointer',
              background: dragging ? '#f0f6ff' : '#fafafa',
              transition: 'all .15s',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 16 }}>📂</div>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', margin: '0 0 8px' }}>
              Arraste o arquivo CSV aqui
            </p>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 20px' }}>
              ou clique para selecionar
            </p>
            <div style={{ background: '#1a2d4f', color: '#fff', padding: '9px 20px', borderRadius: 8, display: 'inline-block', fontSize: 13, fontWeight: 600 }}>
              Selecionar arquivo
            </div>
            <p style={{ fontSize: 11, color: '#cbd5e1', marginTop: 20 }}>
              Colunas esperadas: <strong>pais, estado, cidade</strong>
            </p>
          </div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = '' }} />
        </div>
      )}

      {/* ── Analyzing ── */}
      {phase === 'analyzing' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <div style={{ width: 40, height: 40, border: '4px solid #e2e8f0', borderTopColor: '#2e6db4', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ fontSize: 14, color: '#64748b', fontWeight: 500 }}>
            Verificando {rows.filter(r => r.status !== 'pending').length} de {rows.length} linhas…
          </p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* ── Done ── */}
      {phase === 'done' && result && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: 40 }}>
          <div style={{ fontSize: 56 }}>✅</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: 0 }}>
            {MODE_LABELS[result.mode]} concluído
          </h2>
          <div style={{ display: 'flex', gap: 16 }}>
            {['countries', 'states', 'cities'].map((k, i) => (
              <div key={k} style={{ textAlign: 'center', padding: '16px 24px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#1a2d4f' }}>
                  {((result.created || {})[k] || 0).toLocaleString('pt-BR')}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                  {['países', 'estados', 'cidades'][i]} criados
                </div>
              </div>
            ))}
            {result.mode !== 'merge' && (
              ['countries', 'states', 'cities'].map((k, i) => (
                <div key={`d${k}`} style={{ textAlign: 'center', padding: '16px 24px', background: '#fef2f2', borderRadius: 10, border: '1px solid #fecaca' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#dc2626' }}>
                    {((result.deleted || {})[k] || 0).toLocaleString('pt-BR')}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                    {['países', 'estados', 'cidades'][i]} apagados
                  </div>
                </div>
              ))
            )}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => { setPhase('upload'); setRows([]); setResult(null) }}
              style={{ padding: '10px 20px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Nova importação
            </button>
            <button onClick={() => navigate('/configuracoes')}
              style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Ir para Configurações
            </button>
          </div>
        </div>
      )}

      {/* ── Review ── */}
      {(phase === 'review' || phase === 'acting') && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Barra de stats */}
          <div style={{ display: 'flex', gap: 12, padding: '10px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
            {[
              { label: 'Total', val: stats.total, color: '#475569' },
              { label: '✓ Novos', val: stats.neww, color: '#16a34a' },
              { label: '⚠ Já existem', val: stats.exists, color: '#ca8a04' },
              { label: '✗ Erros', val: stats.errors, color: '#dc2626' },
            ].map(s => (
              <div key={s.label} style={{ fontSize: 13, color: s.color, fontWeight: 600 }}>
                {s.val.toLocaleString('pt-BR')} <span style={{ fontWeight: 400, color: '#94a3b8' }}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* Botões de ação */}
          <div style={{ display: 'flex', gap: 10, padding: '12px 24px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => act('merge')} disabled={phase === 'acting'}
              style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: phase === 'acting' ? .6 : 1 }}>
              ⬆ Importar tudo
            </button>
            <button onClick={() => act('replace')} disabled={phase === 'acting'}
              style={{ padding: '9px 18px', borderRadius: 8, border: '1.5px solid #f59e0b', background: '#fffbeb', color: '#92400e', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: phase === 'acting' ? .6 : 1 }}>
              🔄 Importar e apagar outros
            </button>
            <button onClick={() => act('delete')} disabled={phase === 'acting'}
              style={{ padding: '9px 18px', borderRadius: 8, border: '1.5px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: phase === 'acting' ? .6 : 1 }}>
              🗑 Apagar do banco
            </button>
            {selected.size > 0 && (
              <>
                <div style={{ width: 1, height: 24, background: '#e2e8f0', margin: '0 4px' }} />
                <button onClick={removeSelected}
                  style={{ padding: '9px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Remover {selected.size} selecionado{selected.size !== 1 ? 's' : ''}
                </button>
              </>
            )}
            {phase === 'acting' && (
              <span style={{ fontSize: 13, color: '#64748b', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid #e2e8f0', borderTopColor: '#2e6db4', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                Processando…
              </span>
            )}
          </div>

          {/* Filtros */}
          <div style={{ display: 'flex', gap: 8, padding: '10px 24px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, alignItems: 'center' }}>
            {[
              { key: 'all',    label: `Todos (${stats.total})` },
              { key: 'new',    label: `Novos (${stats.neww})` },
              { key: 'exists', label: `Já existem (${stats.exists})` },
              { key: 'error',  label: `Erros (${stats.errors})` },
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                style={{
                  padding: '5px 12px', borderRadius: 20, border: '1.5px solid',
                  borderColor: filter === f.key ? '#1a2d4f' : '#e2e8f0',
                  background: filter === f.key ? '#1a2d4f' : '#fff',
                  color: filter === f.key ? '#fff' : '#475569',
                  fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {f.label}
              </button>
            ))}
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
              style={{ marginLeft: 'auto', padding: '6px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 12, outline: 'none', fontFamily: 'inherit', width: 200 }}
              onFocus={e => e.target.style.borderColor = '#1a2d4f'}
              onBlur={e  => e.target.style.borderColor = '#e2e8f0'} />
          </div>

          {/* Tabela */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', position: 'sticky', top: 0, zIndex: 10 }}>
                  <th style={{ width: 36, padding: '9px 12px', textAlign: 'center', borderBottom: '1px solid #e2e8f0' }}>
                    <input type="checkbox"
                      checked={filtered.length > 0 && filtered.every(r => selected.has(r.id))}
                      onChange={() => toggleAll(filtered)}
                    />
                  </th>
                  {['País', 'Estado', 'Cidade', 'Status'].map(h => (
                    <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid #e2e8f0' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: 13 }}>Nenhuma linha encontrada.</td></tr>
                ) : filtered.map(row => (
                  <tr key={row.id}
                    style={{
                      background: selected.has(row.id) ? '#f0f6ff' : row.status === 'error' ? '#fef2f2' : '#fff',
                      borderBottom: '1px solid #f1f5f9',
                    }}
                    onMouseEnter={e => { if (!selected.has(row.id) && row.status !== 'error') e.currentTarget.style.background = '#fafafa' }}
                    onMouseLeave={e => { e.currentTarget.style.background = selected.has(row.id) ? '#f0f6ff' : row.status === 'error' ? '#fef2f2' : '#fff' }}
                  >
                    <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                      <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                    </td>
                    <td style={{ padding: '6px 8px', minWidth: 120 }}>
                      <EditCell value={row.pais}   onChange={v => editRow(row.id, 'pais',   v)} placeholder="país" />
                    </td>
                    <td style={{ padding: '6px 8px', minWidth: 120 }}>
                      <EditCell value={row.estado} onChange={v => editRow(row.id, 'estado', v)} placeholder="estado" />
                    </td>
                    <td style={{ padding: '6px 8px', minWidth: 140 }}>
                      <EditCell value={row.cidade} onChange={v => editRow(row.id, 'cidade', v)} placeholder="cidade" />
                    </td>
                    <td style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
                      <Badge status={row.status} />
                      {row.msg && <span style={{ fontSize: 11, color: '#dc2626', marginLeft: 6 }}>{row.msg}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}
    </div>
  )
}
