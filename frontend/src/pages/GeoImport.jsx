import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { configApi, auditApi } from '../api'
import ConfirmModal from '../components/ConfirmModal'

/* ── CSV parsing ── */
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (!lines.length) return []
  const header   = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/["""]/g, ''))
  const iCol     = (names) => header.findIndex(h => names.includes(h))
  const cPais    = iCol(['pais','país','country'])
  const cEstado  = iCol(['estado','state'])
  const cCidade  = iCol(['cidade','city'])
  const parseCell = (v='') => v.trim().replace(/^[""""]|[""""]$/g,'').replace(/""/g,'"').trim()

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim(); if (!line) continue
    const cells = []; let cur='', inQ=false
    for (const ch of line) {
      if (ch==='"'||ch==='"'||ch==='"') inQ=!inQ
      else if (ch===','&&!inQ) { cells.push(cur); cur='' }
      else cur+=ch
    }
    cells.push(cur)
    rows.push({
      id:     i,
      pais:   cPais  >=0 ? parseCell(cells[cPais])  : '',
      estado: cEstado>=0 ? parseCell(cells[cEstado]) : '',
      cidade: cCidade>=0 ? parseCell(cells[cCidade]) : '',
    })
  }
  return rows
}

const MODES = [
  { key:'merge',   label:'Somente adicionar',   desc:'Mantém os existentes, insere apenas os novos.' },
  { key:'replace', label:'Substituir lista',     desc:'Apaga quem não está no arquivo e insere os novos.' },
  { key:'delete',  label:'Apagar os importados', desc:'Apaga exatamente os registros listados no arquivo.' },
]

const pill = (bg,color) => ({ padding:'3px 10px', borderRadius:20, fontSize:12, fontWeight:600, background:bg, color, display:'inline-block', whiteSpace:'nowrap' })
const th   = { padding:'9px 14px', textAlign:'left', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1.5px solid #e2e8f0', background:'#f8fafc', whiteSpace:'nowrap' }

function Editable({ value, onChange, placeholder }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  const commit = () => { setEditing(false); if (val!==value) onChange(val.trim()) }
  if (editing) return (
    <input autoFocus value={val} onChange={e=>setVal(e.target.value)}
      onBlur={commit} onKeyDown={e=>{ if(e.key==='Enter') commit(); if(e.key==='Escape'){setVal(value);setEditing(false)} }}
      style={{ width:'100%', padding:'4px 8px', border:'1.5px solid #2e6db4', borderRadius:6, fontSize:13, outline:'none', fontFamily:'inherit' }}
    />
  )
  return (
    <span onClick={()=>{setVal(value);setEditing(true)}}
      style={{ cursor:'text', display:'block', minWidth:60, color: value?'#0f172a':'#94a3b8' }}
      title="Clique para editar">
      {value||<em style={{color:'#cbd5e1'}}>{placeholder||'—'}</em>}
    </span>
  )
}

function Spin() {
  return <span style={{display:'inline-block',width:14,height:14,border:'2px solid rgba(255,255,255,.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin .7s linear infinite'}}>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </span>
}

export default function GeoImport() {
  const navigate = useNavigate()
  const location = useLocation()
  const { csvText, filename } = location.state || {}

  const [rows,     setRows]     = useState([])
  const [mode,     setMode]     = useState('merge')
  const [phase,    setPhase]    = useState('upload')
  const [result,   setResult]   = useState(null)
  const [filter,   setFilter]   = useState('all')
  const [search,   setSearch]   = useState('')
  const [selected, setSelected] = useState(new Set())
  const [confirm,  setConfirm]  = useState(null)

  /* Carrega CSV do state do router ou mostra zona de upload */
  useEffect(() => {
    if (csvText) startAnalysis(csvText)
  }, [])

  const startAnalysis = async (text) => {
    const parsed = parseCsv(text)
    if (!parsed.length) return
    const annotated = parsed.map(r => ({ ...r, status:'pending', msg:'' }))
    setRows(annotated)
    setPhase('analyzing')

    const BATCH = 300
    const result = [...annotated]
    for (let i = 0; i < parsed.length; i += BATCH) {
      const batch = parsed.slice(i, i+BATCH).map(({pais,estado,cidade})=>({pais,estado,cidade}))
      try {
        const r = await configApi.geoAnalyze(batch)
        r.data.rows.forEach((res, j) => {
          result[i+j] = { ...result[i+j], status: res.status, msg: res.msg||'' }
        })
        setRows([...result])
      } catch {}
    }
    setPhase('review')
  }

  const editRow    = (id, field, val) =>
    setRows(prev => prev.map(r => r.id===id ? {...r, [field]:val, status:'pending', msg:''} : r))

  const removeRows = (ids) => { setRows(prev => prev.filter(r => !ids.has(r.id))); setSelected(new Set()); setConfirm(null) }
  const toggleRow  = (id) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const stats = useMemo(() => ({
    valid:     rows.filter(r=>r.status==='new').length,
    duplicate: rows.filter(r=>r.status==='exists').length,
    error:     rows.filter(r=>r.status==='error').length,
    pending:   rows.filter(r=>r.status==='pending').length,
  }), [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (filter==='valid')     list = list.filter(r=>r.status==='new')
    else if (filter==='duplicate') list = list.filter(r=>r.status==='exists')
    else if (filter==='error')     list = list.filter(r=>r.status==='error')
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

  const allFilteredSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id))
  const toggleAll = () => {
    if (allFilteredSelected) setSelected(p => { const n = new Set(p); filtered.forEach(r => n.delete(r.id)); return n })
    else                     setSelected(p => { const n = new Set(p); filtered.forEach(r => n.add(r.id));    return n })
  }

  const doConfirm = async () => {
    const toProcess = rows.filter(r=>r.status!=='error')
    if (!toProcess.length) return
    setPhase('importing')
    try {
      const r = await configApi.geoAction(mode, toProcess.map(({pais,estado,cidade})=>({pais,estado,cidade})))
      setResult({ mode, ...r.data })
      const modeLabel = mode === 'delete' ? 'Excluir' : mode === 'all' ? 'Substituir' : 'Adicionar'
      auditApi.logUpload({
        label: filename || 'geo_import.csv',
        model_label: 'Importação CSV — Países/Estados/Cidades',
        model_name: 'CsvImportGeo',
        summary: { Modo: modeLabel, ...r.data },
      }).catch(() => {})
      setPhase('done')
    } catch { setPhase('review') }
  }

  /* ── Zona de upload (sem arquivo no state) ── */
  if (phase==='upload') return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:48, background:'#f8fafc' }}>
      <div style={{ textAlign:'center', maxWidth:420 }}>
        <div style={{ fontSize:48, marginBottom:16 }}>📂</div>
        <h2 style={{ fontSize:18, fontWeight:700, color:'#1e293b', margin:'0 0 8px' }}>Selecione um arquivo CSV</h2>
        <p style={{ fontSize:13, color:'#64748b', margin:'0 0 24px' }}>Use o botão "Importar CSV" na página de Configurações para selecionar o arquivo.</p>
        <button onClick={()=>navigate('/configuracoes')}
          style={{ padding:'10px 24px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
          ← Voltar para Configurações
        </button>
      </div>
    </div>
  )

  /* ── Resultado ── */
  if (phase==='done' && result) return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:24, padding:48, background:'#f8fafc' }}>
      <div style={{ fontSize:56 }}>✅</div>
      <h2 style={{ fontSize:22, fontWeight:700, color:'#0f172a', margin:0 }}>Importação concluída!</h2>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', justifyContent:'center' }}>
        {['countries','states','cities'].map((k,i) => {
          const val = (result.created||{})[k]||0
          return val > 0 ? (
            <div key={k} style={{ textAlign:'center', padding:'16px 24px', background:'#dcfce7', borderRadius:12, border:'1px solid #bbf7d0' }}>
              <div style={{ fontSize:32, fontWeight:700, color:'#16a34a' }}>{val}</div>
              <div style={{ fontSize:12, color:'#15803d', marginTop:4 }}>{['países','estados','cidades'][i]} criados</div>
            </div>
          ) : null
        })}
        {result.mode!=='merge' && ['countries','states','cities'].map((k,i) => {
          const val = (result.deleted||{})[k]||0
          return val > 0 ? (
            <div key={`d${k}`} style={{ textAlign:'center', padding:'16px 24px', background:'#fee2e2', borderRadius:12, border:'1px solid #fecaca' }}>
              <div style={{ fontSize:32, fontWeight:700, color:'#dc2626' }}>{val}</div>
              <div style={{ fontSize:12, color:'#b91c1c', marginTop:4 }}>{['países','estados','cidades'][i]} apagados</div>
            </div>
          ) : null
        })}
      </div>
      <div style={{ display:'flex', gap:12 }}>
        <button onClick={()=>navigate('/configuracoes')}
          style={{ padding:'10px 24px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
          ← Voltar para Configurações
        </button>
      </div>
    </div>
  )

  /* ── Review / Analyzing ── */
  return (
    <div style={{ margin:'-26px -28px', background:'#f8fafc' }}>

      {/* Header */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'11px 28px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <button onClick={()=>navigate('/configuracoes')}
            style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:7, padding:'6px 12px', cursor:'pointer', color:'#475569', fontSize:13, fontFamily:'inherit' }}>
            ← Cancelar
          </button>
          <h1 style={{ fontSize:16, fontWeight:700, color:'#0f172a', margin:0 }}>
            Revisão de Importação — Países, Estados e Cidades
          </h1>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <span style={pill('#dcfce7','#16a34a')}>{stats.valid} novo{stats.valid!==1?'s':''}</span>
          <span style={pill('#fef9c3','#ca8a04')}>{stats.duplicate} duplicado{stats.duplicate!==1?'s':''}</span>
          <span style={pill('#fee2e2','#dc2626')}>{stats.error} com erro</span>
          {stats.pending>0 && <span style={pill('#f1f5f9','#64748b')}>{stats.pending} verificando…</span>}
        </div>
      </div>

      <div style={{ padding:'20px 28px', display:'flex', flexDirection:'column', gap:14 }}>

        {/* Info */}
        <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'10px 16px', display:'flex', gap:10 }}>
          <span style={{ fontSize:16 }}>ℹ️</span>
          <p style={{ fontSize:13, color:'#1e40af', margin:0 }}>
            Revise as linhas antes de confirmar. Você pode editar qualquer célula clicando nela.
          </p>
        </div>

        {/* Modo */}
        <div>
          <p style={{ fontSize:13, fontWeight:700, color:'#475569', margin:'0 0 10px', textTransform:'uppercase', letterSpacing:'.05em' }}>Modo de Importação:</p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
            {MODES.map(m => (
              <div key={m.key} onClick={()=>setMode(m.key)}
                style={{ border:`2px solid ${mode===m.key?'#2e6db4':'#e2e8f0'}`, borderRadius:10, padding:'14px 16px', cursor:'pointer',
                  background: mode===m.key?'#f0f6ff':'#fff', transition:'all .12s' }}>
                <p style={{ fontSize:14, fontWeight:700, color: mode===m.key?'#1a2d4f':'#1e293b', margin:'0 0 4px' }}>{m.label}</p>
                <p style={{ fontSize:12, color:'#64748b', margin:0 }}>{m.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder={`Buscar entre ${rows.length} linhas…`}
            style={{ padding:'7px 12px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', width:260 }}
            onFocus={e=>e.target.style.borderColor='#1a2d4f'}
            onBlur={e=>e.target.style.borderColor='#e2e8f0'} />
          {[
            {key:'all',       label:`Todos (${rows.length})`},
            {key:'valid',     label:`Novos (${stats.valid})`},
            {key:'duplicate', label:`Duplicados (${stats.duplicate})`},
            {key:'error',     label:`Com erro (${stats.error})`},
          ].map(f => (
            <button key={f.key} onClick={()=>setFilter(f.key)}
              style={{ padding:'6px 13px', borderRadius:20, border:'1.5px solid', fontFamily:'inherit',
                borderColor: filter===f.key?'#1a2d4f':'#e2e8f0',
                background:  filter===f.key?'#1a2d4f':'#fff',
                color:       filter===f.key?'#fff':'#475569',
                fontSize:12, fontWeight:500, cursor:'pointer' }}>
              {f.label}
            </button>
          ))}
          {selected.size > 0 && (
            <button onClick={() => setConfirm({ type:'bulk', count: selected.size })}
              style={{ marginLeft:'auto', padding:'6px 14px', borderRadius:8, border:'1px solid #fecaca', background:'#fef2f2', color:'#dc2626', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              Apagar {selected.size} selecionada{selected.size!==1?'s':''}
            </button>
          )}
        </div>

        {/* Tabela com scroll */}
        <div style={{ background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', overflow:'hidden' }}>
          <div style={{ overflowY:'auto', maxHeight:'calc(100vh - 520px)', minHeight:200 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr>
                <th style={{...th, width:44, textAlign:'center'}}>
                  <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} title="Selecionar todos visíveis" />
                </th>
                <th style={{...th, width:60}}>Linha</th>
                <th style={{...th, width:120}}>Status</th>
                <th style={th}>País</th>
                <th style={th}>Estado</th>
                <th style={th}>Cidade</th>
                <th style={{...th, width:70, textAlign:'center'}}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {phase==='analyzing' && filtered.length===0 ? (
                <tr><td colSpan={7} style={{textAlign:'center',padding:'36px 0',color:'#94a3b8',fontSize:13}}>Analisando…</td></tr>
              ) : filtered.length===0 ? (
                <tr><td colSpan={7} style={{textAlign:'center',padding:'36px 0',color:'#94a3b8',fontSize:13}}>
                  {search ? 'Nenhum resultado para a busca.' : 'Nenhuma linha.'}
                </td></tr>
              ) : filtered.map((row, idx) => {
                const isSel = selected.has(row.id)
                return (
                <tr key={row.id} style={{ borderTop:'1px solid #f1f5f9', background: isSel?'#f0f6ff':idx%2===0?'#fff':'#fafafa' }}>
                  <td style={{padding:'8px 12px', textAlign:'center'}}>
                    <input type="checkbox" checked={isSel} onChange={() => toggleRow(row.id)} />
                  </td>
                  <td style={{padding:'8px 12px', color:'#94a3b8', fontSize:12}}>{row.id}</td>
                  <td style={{padding:'8px 12px'}}>
                    {row.status==='new'     && <span style={pill('#dcfce7','#16a34a')}>Novo</span>}
                    {row.status==='exists'  && <span style={pill('#fef9c3','#ca8a04')}>Duplicado</span>}
                    {row.status==='error'   && <span style={pill('#fee2e2','#dc2626')}>Erro</span>}
                    {row.status==='pending' && <span style={pill('#f1f5f9','#94a3b8')}>…</span>}
                    {row.msg && <span style={{fontSize:11,color:'#dc2626',marginLeft:6}}>{row.msg}</span>}
                  </td>
                  <td style={{padding:'8px 12px'}}><Editable value={row.pais}   onChange={v=>editRow(row.id,'pais',v)}   placeholder="país" /></td>
                  <td style={{padding:'8px 12px'}}><Editable value={row.estado} onChange={v=>editRow(row.id,'estado',v)} placeholder="estado" /></td>
                  <td style={{padding:'8px 12px'}}><Editable value={row.cidade} onChange={v=>editRow(row.id,'cidade',v)} placeholder="cidade" /></td>
                  <td style={{padding:'8px 12px', textAlign:'center'}}>
                    <button onClick={() => setConfirm({ type:'single', id: row.id, label: [row.pais, row.estado, row.cidade].filter(Boolean).join(' › ') })}
                      style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:6,cursor:'pointer',color:'#dc2626',fontSize:13,padding:'4px 8px',fontFamily:'inherit'}}
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
        <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:10,padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:12,color:'#94a3b8'}}>{filtered.length} de {rows.length} linha{rows.length!==1?'s':''} exibidas</span>
          <div style={{display:'flex',gap:10}}>
            <button onClick={()=>navigate('/configuracoes')}
              style={{padding:'9px 20px',borderRadius:8,border:'1.5px solid #e2e8f0',background:'#fff',color:'#475569',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
              Cancelar
            </button>
            <button onClick={doConfirm}
              disabled={phase==='importing'||phase==='analyzing'||rows.filter(r=>r.status!=='error').length===0}
              style={{padding:'9px 22px',borderRadius:8,border:'none',background:'#1a2d4f',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:8,
                opacity: phase==='analyzing'||rows.filter(r=>r.status!=='error').length===0?.5:1}}>
              {phase==='importing' ? <><Spin/> Importando…</> : <>✓ Confirmar Importação</>}
            </button>
          </div>
        </div>

      </div>

      {confirm?.type==='bulk' && (
        <ConfirmModal
          message={`Remover ${confirm.count} linha${confirm.count!==1?'s':''} selecionada${confirm.count!==1?'s':''}?`}
          detail="Serão removidas apenas desta lista de revisão, não do banco de dados."
          okLabel="Remover"
          onOk={() => removeRows(selected)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.type==='single' && (
        <ConfirmModal
          message={`Remover a linha "${confirm.label}"?`}
          detail="Será removida apenas desta lista de revisão."
          okLabel="Remover"
          onOk={() => removeRows(new Set([confirm.id]))}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
