import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { configApi } from '../api'
import ConfirmModal from '../components/ConfirmModal'

function parseCsvNames(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const isHeader = (s) => ['nome','name','profissão','profissao','idioma','language']
    .includes(s.toLowerCase().replace(/["""]/g,'').trim())
  const start = lines.length > 0 && isHeader(lines[0]) ? 1 : 0
  return lines.slice(start)
    .map(l => l.trim().replace(/^[""""]|[""""]$/g,'').trim())
    .filter(Boolean)
}

const API_MAP = {
  professions: { add: (name) => configApi.addProfession(name), label: 'Profissões' },
  languages:   { add: (name) => configApi.addLanguage(name),   label: 'Idiomas'    },
  vaccines:    { add: (name) => configApi.addVaccine(name),    label: 'Vacinas'    },
}

const MODES = [
  { key:'new',    label:'Somente adicionar',   desc:'Mantém os existentes, insere apenas os novos.' },
  { key:'all',    label:'Substituir lista',     desc:'Apaga quem não está no arquivo e insere os novos.' },
  { key:'delete', label:'Apagar os importados', desc:'Apaga exatamente os registros listados no arquivo.' },
]

const pill = (bg, color) => ({
  padding:'3px 10px', borderRadius:20, fontSize:12, fontWeight:600,
  background:bg, color, display:'inline-block', whiteSpace:'nowrap',
})
const th = {
  padding:'9px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'#64748b',
  textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1.5px solid #e2e8f0',
  background:'#f8fafc', whiteSpace:'nowrap', position:'sticky', top:0, zIndex:1,
}

function Editable({ value, onChange }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  const commit = () => { setEditing(false); if (val.trim() !== value) onChange(val.trim()) }
  if (editing) return (
    <input autoFocus value={val} onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key==='Enter') commit(); if (e.key==='Escape') { setVal(value); setEditing(false) } }}
      style={{ width:'100%', padding:'4px 8px', border:'1.5px solid #2e6db4', borderRadius:6, fontSize:13, outline:'none', fontFamily:'inherit' }}
    />
  )
  return (
    <span onClick={() => { setVal(value); setEditing(true) }}
      style={{ cursor:'text', display:'block', minWidth:80 }}
      title="Clique para editar">
      {value || <em style={{ color:'#cbd5e1' }}>—</em>}
    </span>
  )
}

function Spin() {
  return (
    <>
      <span style={{ display:'inline-block', width:14, height:14, border:'2px solid rgba(255,255,255,.3)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  )
}

export default function FlatImport() {
  const navigate = useNavigate()
  const location = useLocation()
  const { csvText, filename, type, existingNames = [] } = location.state || {}
  const apiDef   = API_MAP[type] || API_MAP.professions
  const backPath = '/configuracoes'

  const [rows,       setRows]       = useState([])
  const [mode,       setMode]       = useState('new')
  const [phase,      setPhase]      = useState('review')
  const [result,     setResult]     = useState(null)
  const [filter,     setFilter]     = useState('all')
  const [search,     setSearch]     = useState('')
  const [selected,   setSelected]   = useState(new Set())
  const [confirm,    setConfirm]    = useState(null) // { type:'bulk'|'single', id?, count? }

  useEffect(() => {
    if (!csvText) { navigate(backPath); return }
    const names    = parseCsvNames(csvText)
    const existing = new Set(existingNames.map(n => n.toLowerCase()))
    setRows(names.map((name, i) => ({
      id: i + 1, name,
      status: !name.trim() ? 'error' : existing.has(name.toLowerCase()) ? 'duplicate' : 'valid',
    })))
  }, [])

  const existingSet = useMemo(() => new Set(existingNames.map(n => n.toLowerCase())), [existingNames])

  const editRow   = (id, name) => setRows(prev => prev.map(r => r.id === id
    ? { ...r, name, status: !name.trim() ? 'error' : existingSet.has(name.toLowerCase()) ? 'duplicate' : 'valid' }
    : r
  ))

  const removeRows = (ids) => {
    setRows(prev => prev.filter(r => !ids.has(r.id)))
    setSelected(new Set())
    setConfirm(null)
  }

  const stats = useMemo(() => ({
    valid:     rows.filter(r => r.status === 'valid').length,
    duplicate: rows.filter(r => r.status === 'duplicate').length,
    error:     rows.filter(r => r.status === 'error').length,
  }), [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (filter !== 'all') list = list.filter(r => r.status === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r => r.name.toLowerCase().includes(q))
    }
    return list
  }, [rows, filter, search])

  /* seleção */
  const allFilteredSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id))
  const toggleAll  = () => {
    if (allFilteredSelected) setSelected(p => { const n = new Set(p); filtered.forEach(r => n.delete(r.id)); return n })
    else                     setSelected(p => { const n = new Set(p); filtered.forEach(r => n.add(r.id));    return n })
  }
  const toggleRow  = (id) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const doConfirm = async () => {
    let toProcess = rows.filter(r => r.status !== 'error')
    if (mode === 'new') toProcess = toProcess.filter(r => r.status === 'valid')
    if (!toProcess.length) return
    setPhase('importing')
    let added = 0, skipped = 0
    for (const row of toProcess) {
      try { await apiDef.add(row.name); added++ } catch { skipped++ }
    }
    setResult({ added, skipped })
    setPhase('done')
  }

  if (phase === 'done' && result) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:24, padding:48 }}>
      <div style={{ fontSize:56 }}>✅</div>
      <h2 style={{ fontSize:22, fontWeight:700, color:'#0f172a', margin:0 }}>Importação concluída!</h2>
      <div style={{ display:'flex', gap:16 }}>
        <div style={{ textAlign:'center', padding:'20px 32px', background:'#dcfce7', borderRadius:12, border:'1px solid #bbf7d0' }}>
          <div style={{ fontSize:36, fontWeight:700, color:'#16a34a' }}>{result.added}</div>
          <div style={{ fontSize:13, color:'#15803d', marginTop:4 }}>adicionados</div>
        </div>
        {result.skipped > 0 && (
          <div style={{ textAlign:'center', padding:'20px 32px', background:'#fef9c3', borderRadius:12, border:'1px solid #fde68a' }}>
            <div style={{ fontSize:36, fontWeight:700, color:'#ca8a04' }}>{result.skipped}</div>
            <div style={{ fontSize:13, color:'#a16207', marginTop:4 }}>já existiam</div>
          </div>
        )}
      </div>
      <button onClick={() => navigate(backPath)}
        style={{ padding:'10px 28px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
        ← Voltar para Configurações
      </button>
    </div>
  )

  return (
    <div style={{ margin:'-26px -28px', background:'#f8fafc' }}>

      {/* Header */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'11px 28px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <button onClick={() => navigate(backPath)}
            style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:7, padding:'6px 12px', cursor:'pointer', color:'#475569', fontSize:13, fontFamily:'inherit' }}>
            ← Cancelar
          </button>
          <h1 style={{ fontSize:16, fontWeight:700, color:'#0f172a', margin:0 }}>
            Revisão de Importação — {apiDef.label}
          </h1>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <span style={pill('#dcfce7','#16a34a')}>{stats.valid} válido{stats.valid!==1?'s':''}</span>
          <span style={pill('#fef9c3','#ca8a04')}>{stats.duplicate} duplicado{stats.duplicate!==1?'s':''}</span>
          <span style={pill('#fee2e2','#dc2626')}>{stats.error} com erro</span>
        </div>
      </div>

      <div style={{ padding:'20px 28px', display:'flex', flexDirection:'column', gap:14 }}>

        {/* Info */}
        <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'10px 16px', display:'flex', gap:10 }}>
          <span style={{ fontSize:16 }}>ℹ️</span>
          <p style={{ fontSize:13, color:'#1e40af', margin:0 }}>
            Revise os itens antes de confirmar. Clique em qualquer nome para editar. Selecione e apague linhas indesejadas antes de importar.
          </p>
        </div>

        {/* Modo */}
        <div>
          <p style={{ fontSize:11, fontWeight:700, color:'#64748b', margin:'0 0 8px', textTransform:'uppercase', letterSpacing:'.06em' }}>Modo de Importação:</p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
            {MODES.map(m => (
              <div key={m.key} onClick={() => setMode(m.key)}
                style={{ border:`2px solid ${mode===m.key?'#2e6db4':'#e2e8f0'}`, borderRadius:10, padding:'12px 16px', cursor:'pointer',
                  background: mode===m.key?'#f0f6ff':'#fff', transition:'all .12s' }}>
                <p style={{ fontSize:14, fontWeight:700, color:mode===m.key?'#1a2d4f':'#1e293b', margin:'0 0 4px' }}>{m.label}</p>
                <p style={{ fontSize:12, color:'#64748b', margin:0 }}>{m.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Toolbar: busca + filtros + seleção */}
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={`Buscar entre ${rows.length} itens…`}
            style={{ padding:'7px 12px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', width:230 }}
            onFocus={e => e.target.style.borderColor='#1a2d4f'}
            onBlur={e  => e.target.style.borderColor='#e2e8f0'} />
          {[
            {key:'all',       label:`Todos (${rows.length})`},
            {key:'valid',     label:`Válidos (${stats.valid})`},
            {key:'duplicate', label:`Duplicados (${stats.duplicate})`},
            {key:'error',     label:`Com erro (${stats.error})`},
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{ padding:'6px 13px', borderRadius:20, border:'1.5px solid', fontFamily:'inherit',
                borderColor: filter===f.key?'#1a2d4f':'#e2e8f0',
                background:  filter===f.key?'#1a2d4f':'#fff',
                color:       filter===f.key?'#fff':'#475569',
                fontSize:12, fontWeight:500, cursor:'pointer' }}>
              {f.label}
            </button>
          ))}
          {selected.size > 0 && (
            <button
              onClick={() => setConfirm({ type:'bulk', count: selected.size })}
              style={{ marginLeft:'auto', padding:'6px 14px', borderRadius:8, border:'1px solid #fecaca', background:'#fef2f2', color:'#dc2626', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              Apagar {selected.size} selecionado{selected.size!==1?'s':''}
            </button>
          )}
        </div>

        {/* Tabela */}
        <div style={{ background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', overflow:'hidden' }}>
          <div style={{ overflowY:'auto', maxHeight:'calc(100vh - 520px)', minHeight:200 }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width:44, textAlign:'center' }}>
                    <input type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAll}
                      title={allFilteredSelected ? 'Desmarcar todos' : 'Selecionar todos visíveis'}
                    />
                  </th>
                  <th style={{...th, width:60}}>Linha</th>
                  <th style={{...th, width:130}}>Status</th>
                  <th style={th}>Nome</th>
                  <th style={{...th, width:80, textAlign:'center'}}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={5} style={{textAlign:'center',padding:'36px 0',color:'#94a3b8',fontSize:13}}>
                    {search ? 'Nenhum resultado para a busca.' : 'Nenhum item nesta categoria.'}
                  </td></tr>
                ) : filtered.map((row, idx) => {
                  const isSel = selected.has(row.id)
                  return (
                    <tr key={row.id} style={{ borderTop:'1px solid #f1f5f9', background: isSel ? '#f0f6ff' : idx%2===0 ? '#fff' : '#fafafa' }}>
                      <td style={{padding:'9px 12px', textAlign:'center'}}>
                        <input type="checkbox" checked={isSel} onChange={() => toggleRow(row.id)} />
                      </td>
                      <td style={{padding:'9px 12px', color:'#94a3b8', fontSize:12}}>{row.id}</td>
                      <td style={{padding:'9px 12px'}}>
                        {row.status==='valid'     && <span style={pill('#dcfce7','#16a34a')}>Válido</span>}
                        {row.status==='duplicate' && <span style={pill('#fef9c3','#ca8a04')}>Duplicado</span>}
                        {row.status==='error'     && <span style={pill('#fee2e2','#dc2626')}>Inválido</span>}
                      </td>
                      <td style={{padding:'9px 12px'}}>
                        <Editable value={row.name} onChange={v => editRow(row.id, v)} />
                      </td>
                      <td style={{padding:'9px 12px', textAlign:'center'}}>
                        <button
                          onClick={() => setConfirm({ type:'single', id: row.id, name: row.name })}
                          style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:6,cursor:'pointer',color:'#dc2626',fontSize:13,padding:'4px 9px',fontFamily:'inherit'}}
                          title="Remover linha">✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:12, color:'#94a3b8' }}>
            {filtered.length} de {rows.length} item{rows.length!==1?'s':''} · {selected.size > 0 && `${selected.size} selecionado${selected.size!==1?'s':''}`}
          </span>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => navigate(backPath)}
              style={{padding:'9px 20px',borderRadius:8,border:'1.5px solid #e2e8f0',background:'#fff',color:'#475569',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
              Cancelar
            </button>
            <button onClick={doConfirm}
              disabled={phase==='importing' || rows.filter(r=>r.status!=='error').length===0}
              style={{padding:'9px 22px',borderRadius:8,border:'none',background:'#1a2d4f',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:8,
                opacity: rows.filter(r=>r.status!=='error').length===0?.5:1}}>
              {phase==='importing' ? <><Spin/> Importando…</> : <>✓ Confirmar Importação</>}
            </button>
          </div>
        </div>

      </div>

      {/* Modal de confirmação */}
      {confirm?.type === 'bulk' && (
        <ConfirmModal
          message={`Remover ${confirm.count} linha${confirm.count!==1?'s':''} selecionada${confirm.count!==1?'s':''}?`}
          detail="As linhas serão removidas apenas desta lista de importação, não do banco de dados."
          okLabel="Remover"
          onOk={() => removeRows(selected)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.type === 'single' && (
        <ConfirmModal
          message={`Remover a linha "${confirm.name}"?`}
          detail="Será removida apenas desta lista de importação."
          okLabel="Remover"
          onOk={() => removeRows(new Set([confirm.id]))}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
