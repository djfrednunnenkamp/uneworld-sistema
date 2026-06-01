import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { configApi } from '../api'

/* ── Parse CSV (coluna "nome") ── */
function parseCsvNames(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const isHeader = (s) => ['nome', 'name', 'profissão', 'profissao', 'idioma', 'language']
    .includes(s.toLowerCase().replace(/["""]/g, '').trim())
  const start = lines.length > 0 && isHeader(lines[0]) ? 1 : 0
  return lines.slice(start)
    .map(l => l.trim().replace(/^[""""]|[""""]$/g, '').trim())
    .filter(Boolean)
}

const API_MAP = {
  professions: { add: (name) => configApi.addProfession(name), label: 'Profissões' },
  languages:   { add: (name) => configApi.addLanguage(name),   label: 'Idiomas'    },
}

const MODES = [
  { key: 'new',     label: 'Somente adicionar',   desc: 'Mantém os existentes, insere apenas os novos.' },
  { key: 'all',     label: 'Substituir lista',     desc: 'Apaga quem não está no arquivo e insere os novos.' },
  { key: 'delete',  label: 'Apagar os importados', desc: 'Apaga exatamente os registros listados no arquivo.' },
]

/* ── Estilos compartilhados ── */
const pill = (bg, color) => ({
  padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
  background: bg, color, display: 'inline-block', whiteSpace: 'nowrap',
})
const iconBtn = (color = '#94a3b8') => ({
  background: 'none', border: 'none', cursor: 'pointer', color,
  fontSize: 15, lineHeight: 1, padding: '4px 6px', borderRadius: 6,
  display: 'flex', alignItems: 'center',
})
const th = { padding: '9px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1.5px solid #e2e8f0', background: '#f8fafc', whiteSpace: 'nowrap' }

/* ── Célula editável inline ── */
function Editable({ value, onChange }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(value)
  const commit = () => { setEditing(false); if (val.trim() !== value) onChange(val.trim()) }
  if (editing) return (
    <input autoFocus value={val} onChange={e => setVal(e.target.value)}
      onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setVal(value); setEditing(false) } }}
      style={{ width: '100%', padding: '4px 8px', border: '1.5px solid #2e6db4', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
    />
  )
  return (
    <span onClick={() => { setVal(value); setEditing(true) }}
      style={{ cursor: 'text', display: 'block', minWidth: 80, color: value ? '#0f172a' : '#94a3b8' }}
      title="Clique para editar">
      {value || <em style={{ color: '#cbd5e1' }}>—</em>}
    </span>
  )
}

export default function FlatImport() {
  const navigate = useNavigate()
  const location = useLocation()
  const { csvText, filename, type, existingNames = [] } = location.state || {}
  const apiDef   = API_MAP[type] || API_MAP.professions
  const backPath = '/configuracoes'

  const [rows,    setRows]    = useState([])          // {id, name, status, removed}
  const [mode,    setMode]    = useState('new')       // new | all | delete
  const [phase,   setPhase]   = useState('review')   // review | importing | done
  const [result,  setResult]  = useState(null)
  const [filter,  setFilter]  = useState('all')       // all | valid | duplicate | error

  useEffect(() => {
    if (!csvText) { navigate(backPath); return }
    const names    = parseCsvNames(csvText)
    const existing = new Set(existingNames.map(n => n.toLowerCase()))
    setRows(names.map((name, i) => ({
      id:      i + 1,
      name,
      status:  existing.has(name.toLowerCase()) ? 'duplicate' : name.trim() ? 'valid' : 'error',
      removed: false,
    })))
  }, [])

  const editRow   = (id, name) => setRows(prev =>
    prev.map(r => r.id === id ? { ...r, name, status: name.trim() ? (existingNames.map(n=>n.toLowerCase()).includes(name.toLowerCase()) ? 'duplicate' : 'valid') : 'error' } : r)
  )
  const removeRow = (id) => setRows(prev => prev.filter(r => r.id !== id))

  const stats = useMemo(() => ({
    valid:     rows.filter(r => r.status === 'valid').length,
    duplicate: rows.filter(r => r.status === 'duplicate').length,
    error:     rows.filter(r => r.status === 'error').length,
  }), [rows])

  const filtered = useMemo(() => {
    if (filter === 'all') return rows
    return rows.filter(r => r.status === filter)
  }, [rows, filter])

  const doConfirm = async () => {
    let toProcess = rows.filter(r => r.status !== 'error')
    if (mode === 'new') toProcess = toProcess.filter(r => r.status === 'valid')
    if (toProcess.length === 0) return
    setPhase('importing')
    let added = 0, skipped = 0, deleted = 0

    if (mode === 'delete') {
      // TODO: batch delete — por ora remove individualmente
      for (const row of toProcess) {
        try { await configApi[type === 'professions' ? 'delProfession' : 'delLanguage']; skipped++ }
        catch { skipped++ }
      }
    } else {
      for (const row of toProcess) {
        try { await apiDef.add(row.name); added++ }
        catch { skipped++ }
      }
    }
    setResult({ added, skipped, deleted, total: toProcess.length, mode })
    setPhase('done')
  }

  /* ── Resultado ── */
  if (phase === 'done' && result) return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:24, padding:48, background:'#f8fafc' }}>
      <div style={{ fontSize:56 }}>✅</div>
      <h2 style={{ fontSize:22, fontWeight:700, color:'#0f172a', margin:0 }}>Importação concluída!</h2>
      <div style={{ display:'flex', gap:16 }}>
        <Stat label="adicionados" val={result.added}  color="#16a34a" bg="#dcfce7" border="#bbf7d0" />
        {result.skipped > 0 && <Stat label="já existiam" val={result.skipped} color="#ca8a04" bg="#fef9c3" border="#fde68a" />}
      </div>
      <button onClick={() => navigate(backPath)}
        style={{ padding:'10px 28px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
        ← Voltar para Configurações
      </button>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'#f8fafc' }}>

      {/* ── Header ── */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'11px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <button onClick={() => navigate(backPath)}
            style={{ ...iconBtn('#475569'), fontSize:13, gap:4, padding:'6px 10px', border:'1px solid #e2e8f0', borderRadius:7, background:'#fff' }}>
            ← Cancelar
          </button>
          <h1 style={{ fontSize:16, fontWeight:700, color:'#0f172a', margin:0 }}>
            Revisão de Importação — {apiDef.label}
          </h1>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <span style={pill('#dcfce7','#16a34a')}>{stats.valid} válido{stats.valid !== 1 ? 's' : ''}  </span>
          <span style={pill('#fef9c3','#ca8a04')}>{stats.duplicate} duplicado{stats.duplicate !== 1 ? 's' : ''}</span>
          <span style={pill('#fee2e2','#dc2626')}>{stats.error} com erro</span>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:16 }}>

        {/* ── Info banner ── */}
        <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'10px 16px', display:'flex', gap:10, alignItems:'flex-start' }}>
          <span style={{ fontSize:16, flexShrink:0 }}>ℹ️</span>
          <p style={{ fontSize:13, color:'#1e40af', margin:0, lineHeight:1.5 }}>
            Somente novos itens serão inseridos. Itens existentes não serão alterados (exceto os marcados como "Substituir lista").
          </p>
        </div>

        {/* ── Modo de importação ── */}
        <div>
          <p style={{ fontSize:13, fontWeight:700, color:'#475569', margin:'0 0 10px', textTransform:'uppercase', letterSpacing:'.05em' }}>Modo de Importação:</p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
            {MODES.map(m => (
              <div key={m.key} onClick={() => setMode(m.key)}
                style={{ border:`2px solid ${mode === m.key ? '#2e6db4' : '#e2e8f0'}`, borderRadius:10, padding:'14px 16px', cursor:'pointer',
                  background: mode === m.key ? '#f0f6ff' : '#fff', transition:'all .12s' }}>
                <p style={{ fontSize:14, fontWeight:700, color: mode === m.key ? '#1a2d4f' : '#1e293b', margin:'0 0 4px' }}>{m.label}</p>
                <p style={{ fontSize:12, color:'#64748b', margin:0 }}>{m.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Filtros ── */}
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {[
            { key:'all',       label:`Todos (${rows.length})` },
            { key:'valid',     label:`Válidos (${stats.valid})` },
            { key:'duplicate', label:`Duplicados (${stats.duplicate})` },
            { key:'error',     label:`Com erro (${stats.error})` },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{ padding:'5px 14px', borderRadius:20, border:'1.5px solid', fontFamily:'inherit',
                borderColor: filter === f.key ? '#1a2d4f' : '#e2e8f0',
                background:  filter === f.key ? '#1a2d4f' : '#fff',
                color:       filter === f.key ? '#fff' : '#475569',
                fontSize:12, fontWeight:500, cursor:'pointer' }}>
              {f.label}
            </button>
          ))}
        </div>

        {/* ── Tabela ── */}
        <div style={{ background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr>
                <th style={{ ...th, width:60 }}>Linha</th>
                <th style={{ ...th, width:130 }}>Status</th>
                <th style={th}>Nome</th>
                <th style={{ ...th, width:90, textAlign:'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign:'center', padding:'36px 0', color:'#94a3b8', fontSize:13 }}>Nenhum item.</td></tr>
              ) : filtered.map((row, idx) => (
                <tr key={row.id} style={{ borderTop:'1px solid #f1f5f9', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding:'9px 14px', color:'#94a3b8', fontSize:12 }}>{row.id}</td>
                  <td style={{ padding:'9px 14px' }}>
                    {row.status === 'valid'     && <span style={pill('#dcfce7','#16a34a')}>Válido</span>}
                    {row.status === 'duplicate' && <span style={pill('#fef9c3','#ca8a04')}>Duplicado</span>}
                    {row.status === 'error'     && <span style={pill('#fee2e2','#dc2626')}>Inválido</span>}
                  </td>
                  <td style={{ padding:'9px 14px' }}>
                    <Editable value={row.name} onChange={v => editRow(row.id, v)} />
                  </td>
                  <td style={{ padding:'9px 14px' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
                      <button onClick={() => removeRow(row.id)}
                        style={{ ...iconBtn('#dc2626'), background:'#fef2f2', border:'1px solid #fecaca', borderRadius:6 }}
                        title="Remover linha">
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ background:'#fff', borderTop:'1px solid #e2e8f0', padding:'12px 24px', display:'flex', justifyContent:'flex-end', gap:12, flexShrink:0 }}>
        <button onClick={() => navigate(backPath)}
          style={{ padding:'9px 20px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
          Cancelar
        </button>
        <button onClick={doConfirm} disabled={phase === 'importing' || rows.filter(r => r.status !== 'error').length === 0}
          style={{ padding:'9px 22px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:8, opacity: rows.filter(r=>r.status!=='error').length === 0 ? .5 : 1 }}>
          {phase === 'importing'
            ? <><Spin /> Importando…</>
            : <>✓ Confirmar Importação</>}
        </button>
      </div>
    </div>
  )
}

function Stat({ label, val, color, bg, border }) {
  return (
    <div style={{ textAlign:'center', padding:'20px 32px', background:bg, borderRadius:12, border:`1px solid ${border}` }}>
      <div style={{ fontSize:36, fontWeight:700, color }}>{val}</div>
      <div style={{ fontSize:13, color, marginTop:4 }}>{label}</div>
    </div>
  )
}

function Spin() {
  return <span style={{ display:'inline-block', width:14, height:14, border:'2px solid rgba(255,255,255,.3)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin .7s linear infinite' }}>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </span>
}
