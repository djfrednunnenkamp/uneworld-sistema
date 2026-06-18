import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { configApi, listsApi } from '../api'
import ConfirmModal from '../components/ConfirmModal'
import { useAuth } from '../context/AuthContext'
import { useWebSocket } from '../hooks/useWebSocket'
import DocTypesManager from '../components/DocTypesManager'
import AccommodationManager from '../components/AccommodationManager'
import AirportsManager from '../components/AirportsManager'
import AirlinesManager from '../components/AirlinesManager'
import BusMapsManager from '../components/BusMapsManager'
import { Ic } from '../components/Icon'
import { PermPresetBar, PermAccordionItem } from '../components/PermAccordion'
import { PERM_GROUPS, EMPTY_PERMISSIONS, sanitizePerms, applyPermChanges } from '../utils/permGroups'

/* ── CSV global: Países → Estados → Cidades ── */
async function handleGeoExport() {
  try {
    const r = await configApi.geoExport()
    const url = URL.createObjectURL(r.data)
    const a = document.createElement('a')
    a.href = url; a.download = 'paises_estados_cidades.csv'; a.click()
    URL.revokeObjectURL(url)
  } catch { toast.error('Erro ao exportar.') }
}

async function handleGeoImport(file, onDone) {
  const fd = new FormData()
  fd.append('file', file)
  try {
    const r = await configApi.geoImport(fd)
    const { countries, states, cities, rows } = r.data
    toast.success(`${rows} linhas lidas — ${countries} países, ${states} estados, ${cities} cidades criados.`)
    onDone()
  } catch { toast.error('Erro ao importar CSV.') }
}

/* ── CSV helpers ── */
function exportCsv(items, filename) {
  const rows = ['nome', ...items.map(i => `"${i.name.replace(/"/g, '""')}"`)]
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function splitCsvLineSettings(line) {
  const out = []; let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) { if (c === '"') { if (line[i+1]==='"'){cur+='"';i++}else inQ=false } else cur+=c }
    else { if (c==='"') inQ=true; else if (c===','){out.push(cur);cur=''}else cur+=c }
  }
  out.push(cur); return out.map(s=>s.trim())
}

/* CSV combinado — inclui listas simples + acomodações + países + estados + cidades
   Formato: lista,nome,pessoas,casal,pais,estado,codigo */
function exportCombinedCsvFull(simpleGroups, accoms, countries, states, cities, filename) {
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`
  const rows = ['lista,nome,pessoas,casal,pais,estado,codigo']
  simpleGroups.forEach(({ label, items }) => {
    items.forEach(i => rows.push(`${q(label)},${q(i.name)},,,,,`))
  })
  accoms.forEach(a => {
    rows.push(`${q('Acomodações')},${q(a.name)},${a.capacity},${a.is_couple ? 'sim' : 'não'},,,`)
  })
  countries.forEach(c => {
    rows.push(`${q('Países')},${q(c.name)},,,,,${q(c.code || '')}`)
  })
  states.forEach(s => {
    rows.push(`${q('Estados')},${q(s.name)},,,${q(s.country_name || '')},,${q(s.code || '')}`)
  })
  cities.forEach(c => {
    rows.push(`${q('Cidades')},${q(c.name)},,,${q(c.country)},${q(c.state)},`)
  })
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function readCsv(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = (e) => {
      const lines = e.target.result.split(/\r?\n/)
      // pula a primeira linha se for cabeçalho "nome"
      const start = lines[0]?.trim().toLowerCase() === 'nome' ? 1 : 0
      const names = lines.slice(start)
        .map(l => l.trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
        .filter(Boolean)
      resolve(names)
    }
    reader.readAsText(file, 'utf-8')
  })
}

/* ── Shared styles ── */
const inp = {
  padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8,
  fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#0f172a',
  background: '#fff', transition: 'border-color .15s',
}
const btnPri = {
  padding: '8px 16px', borderRadius: 8, border: 'none',
  background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
}
const btnCsv = (color) => ({
  padding: '6px 11px', borderRadius: 7, border: `1.5px solid ${color}20`,
  background: `${color}10`, color, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
})

/* ── CsvButtons — abre página de revisão antes de importar ── */
function CsvButtons({ items, filename, type, showImport = true }) {
  const navigate = useNavigate()
  const fileRef  = useRef(null)

  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const csvText = await file.text()
    navigate('/configuracoes/import', {
      state: {
        csvText,
        filename:      file.name,
        type,
        existingNames: items.map(i => i.name),
      }
    })
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button style={btnCsv('#059669')} onClick={() => exportCsv(items, filename)} title="Exportar como CSV">
        ⬇ Exportar
      </button>
      {showImport && (
        <button style={btnCsv('#2e6db4')} onClick={() => fileRef.current?.click()} title="Importar de CSV">
          ⬆ Importar
        </button>
      )}
      {showImport && (
        <input ref={fileRef} type="file" accept=".csv,text/csv"
          style={{ display: 'none' }} onChange={handleFileChosen} />
      )}
    </div>
  )
}

/* ── ItemList (Profissões / Idiomas) ── */
function ItemList({ items, loading, onDelete, onAdd, onUpdate, placeholder, addTitle, editTitle, filename, type }) {
  const [search,  setSearch]  = useState('')
  const [confirm, setConfirm] = useState(null) // {id, name}
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null) // {id, name}

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return items.filter(i => i.name.toLowerCase().includes(q))
  }, [items, search])

  return (
    <>
    <div>
      {/* Toolbar: busca + adicionar + CSV */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
          style={{ ...inp, flex: 1, minWidth: 160 }}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'}
          onBlur={e  => e.target.style.borderColor = '#e2e8f0'} />
        {onAdd && <button onClick={() => setShowAdd(true)} style={btnPri}>+ Adicionar</button>}
        <CsvButtons items={items} filename={filename} type={type} showImport={!!onAdd} />
      </div>

      <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px' }}>
        {loading ? 'Carregando…' : `${filtered.length} de ${items.length} ${items.length !== 1 ? 'itens' : 'item'}`}
      </p>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', maxHeight: 460, overflowY: 'auto' }}>
        {loading ? (
          <p style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 13 }}>Carregando…</p>
        ) : filtered.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 13 }}>
            {items.length === 0 ? 'Nenhum item.' : 'Nenhum resultado.'}
          </p>
        ) : filtered.map((item, idx) => (
          <div key={item.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '9px 14px', fontSize: 13, color: '#0f172a',
            borderBottom: idx < filtered.length - 1 ? '1px solid #f1f5f9' : 'none', background: '#fff',
          }}
            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
            onMouseLeave={e => e.currentTarget.style.background = '#fff'}
          >
            <span>{item.name}</span>
            {(onUpdate || onDelete) && (
              <div className="r-acts">
                {onUpdate && <button className="r-btn edit" title="Editar" onClick={() => setEditing({ id: item.id, name: item.name })}><Ic n="edit" s={13}/></button>}
                {onDelete && <button className="r-btn del"  title="Excluir" onClick={() => setConfirm({ id: item.id, name: item.name })}><Ic n="trash" s={13}/></button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
    {confirm && onDelete && (
      <ConfirmModal
        message={`Remover "${confirm.name}"?`}
        onOk={() => { onDelete(confirm.id); setConfirm(null) }}
        onCancel={() => setConfirm(null)}
      />
    )}
    {showAdd && onAdd && (
      <AddItemModal
        title={addTitle || 'Adicionar item'}
        placeholder={placeholder}
        onAdd={onAdd}
        onClose={() => setShowAdd(false)}
      />
    )}
    {editing && onUpdate && (
      <NameFormModal
        title={editTitle || 'Editar item'}
        placeholder={placeholder}
        initial={editing.name}
        onSave={(name) => onUpdate(editing.id, name)}
        onClose={() => setEditing(null)}
      />
    )}
  </>
  )
}

/* ── Pop-up para adicionar um item com campo de texto ── */
function AddItemModal({ title, placeholder, onAdd, onClose }) {
  const [val,    setVal]    = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  const handleSave = async () => {
    const v = val.trim(); if (!v) return
    setSaving(true)
    try { await onAdd(v); onClose() }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:600, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:380, boxShadow:'0 32px 80px rgba(0,0,0,.25)' }}>
        <div style={{ padding:'18px 22px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>{title}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>
        <div style={{ padding:'18px 22px' }}>
          <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder={placeholder} style={{ ...inp, width:'100%' }}
            onFocus={e => e.target.style.borderColor = '#1a2d4f'}
            onBlur={e  => e.target.style.borderColor = '#e2e8f0'} />
        </div>
        <div style={{ padding:'14px 22px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'flex-end', gap:8 }}>
          <button onClick={onClose}
            style={{ padding:'8px 16px', borderRadius:8, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !val.trim()} style={{ ...btnPri, opacity: (saving || !val.trim()) ? .6 : 1 }}>
            {saving ? 'Adicionando…' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Pop-up genérico para exibir o conteúdo de uma lista ── */
function ListDetailModal({ title, onClose, wide, children }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:500, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth: wide ? 980 : 540, maxHeight:'88vh', display:'flex', flexDirection:'column', boxShadow:'0 32px 80px rgba(0,0,0,.25)' }}>
        <div style={{ padding:'18px 24px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'#0f172a' }}>{title}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

/* ── Barra de CSV global da aba Países & Estados ── */
function GeoCsvBar({ canEdit = true }) {
  const navigate   = useNavigate()
  const fileRef    = useRef(null)
  const [exporting, setExporting] = useState(false)

  const doExport = async () => {
    setExporting(true)
    await handleGeoExport()
    setExporting(false)
  }

  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const csvText = await file.text()
    // Navega para a página de revisão passando o conteúdo do CSV
    navigate('/configuracoes/geo-import', { state: { csvText, filename: file.name } })
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', padding: '10px 14px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
      <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600, flex: 1 }}>
        CSV unificado — <span style={{ fontWeight: 400, color: '#94a3b8' }}>colunas: pais, estado, cidade</span>
      </span>
      <button onClick={doExport} disabled={exporting}
        style={{ ...btnCsv('#059669'), opacity: exporting ? .6 : 1 }}>
        ⬇ {exporting ? 'Exportando…' : 'Exportar tudo'}
      </button>
      {canEdit && (
        <button onClick={() => fileRef.current?.click()} style={btnCsv('#2e6db4')}>
          ⬆ Importar CSV
        </button>
      )}
      {canEdit && <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFileChosen} />}
    </div>
  )
}

/* ── Estilos de coluna (módulo-level para não recriar a cada render) ── */
const colAddInp = { ...inp, flex: 1, fontSize: 12, padding: '7px 10px' }
const colAddBtn = { ...btnPri, fontSize: 12, padding: '7px 10px', whiteSpace: 'nowrap' }
const colBox    = { border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', maxHeight: 380, overflowY: 'auto' }

/* Pop-up para criar/editar um nome simples (país, estado, cidade) — mesmo padrão do sistema */
function NameFormModal({ title, placeholder, initial, onSave, onClose }) {
  const [val,    setVal]    = useState(initial ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  const handleSave = async () => {
    const v = val.trim(); if (!v) return
    setSaving(true)
    try { await onSave(v); onClose() }
    finally { setSaving(false) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="mbox" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">{title}</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="mbody">
          <div className="ff" style={{ marginBottom: 0 }}>
            <input ref={inputRef} className="fi" value={val} onChange={e => setVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder={placeholder} />
          </div>
        </div>
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !val.trim()}>
            {saving ? 'Salvando…' : (initial != null ? 'Salvar' : '+ Adicionar')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* Col é um componente de módulo (nunca redefinido dentro de CountriesTab) */
function Col({ title, count, search, onSearch, onAddClick, addDisabled, loading, canEdit = true, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: 0, whiteSpace: 'nowrap' }}>
          {title}
          {count != null && <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400, marginLeft: 5 }}>({count})</span>}
        </h3>
      </div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
        <input value={search} onChange={e => onSearch(e.target.value)} placeholder="Buscar…"
          style={{ ...colAddInp }}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'}
          onBlur={e  => e.target.style.borderColor = '#e2e8f0'} />
        {canEdit && (
          <button onClick={onAddClick} disabled={addDisabled} style={{ ...colAddBtn, opacity: addDisabled ? .5 : 1, cursor: addDisabled ? 'default' : 'pointer' }}>
            + Adicionar
          </button>
        )}
      </div>
      <div style={colBox}>
        {loading
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>Carregando…</p>
          : children}
      </div>
    </div>
  )
}

/* Linha de país/estado/cidade — com ações de editar/excluir no padrão do sistema */
function GeoRow({ label, extra, selected, onClick, onEdit, onDelete, canEdit = true, canDelete = true }) {
  return (
    <div onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        padding: '6px 6px 6px 10px', fontSize: 12, cursor: onClick ? 'pointer' : 'default',
        borderBottom: '1px solid #f1f5f9',
        background: selected ? '#f0f6ff' : '#fff',
        borderLeft: selected ? '3px solid #2e6db4' : '3px solid transparent',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#f8fafc' }}
      onMouseLeave={e => { e.currentTarget.style.background = selected ? '#f0f6ff' : '#fff' }}
    >
      <span style={{ fontWeight: selected ? 600 : 400, color: selected ? '#2e6db4' : '#0f172a', fontSize: 12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
        {label}
        {extra != null && <span style={{ color: '#94a3b8', marginLeft: 5, fontWeight: 400 }}>{extra}</span>}
      </span>
      {(canEdit || canDelete) && (
        <div style={{ display:'flex', gap:3, flexShrink:0 }} onClick={e => e.stopPropagation()}>
          {canEdit   && <button className="r-btn edit" title="Editar"  style={{ width:24, height:24 }} onClick={onEdit}><Ic n="edit"  s={11}/></button>}
          {canDelete && <button className="r-btn del"  title="Excluir" style={{ width:24, height:24 }} onClick={onDelete}><Ic n="trash" s={11}/></button>}
        </div>
      )}
    </div>
  )
}

/* ── CountriesTab ── */
function CountriesTab({ canEdit = true, canDelete = true }) {
  const [countries,  setCountries]  = useState([])
  const [selCountry, setSelCountry] = useState(null)
  const [states,     setStates]     = useState([])
  const [selState,   setSelState]   = useState(null)
  const [cities,     setCities]     = useState([])
  const [loadingC,   setLoadingC]   = useState(true)
  const [loadingS,   setLoadingS]   = useState(false)
  const [loadingCi,  setLoadingCi]  = useState(false)
  const [searchC,    setSearchC]    = useState('')
  const [searchS,    setSearchS]    = useState('')
  const [searchCi,   setSearchCi]   = useState('')
  const [confirm,    setConfirm]    = useState(null) // {action, id, name}
  const [form,       setForm]       = useState(null) // {kind:'country'|'state'|'city', item?}

  const loadCountries = () => {
    setLoadingC(true)
    configApi.countries().then(r => setCountries(r.data)).catch(() => {}).finally(() => setLoadingC(false))
  }
  const loadStates = (country) => {
    setSelCountry(country); setSelState(null); setCities([])
    setStates([]); setLoadingS(true)
    configApi.states(country.id).then(r => setStates(r.data)).catch(() => {}).finally(() => setLoadingS(false))
  }
  const loadCities = (state) => {
    setSelState(state); setCities([]); setLoadingCi(true)
    configApi.cities(state.id).then(r => setCities(r.data)).catch(() => {}).finally(() => setLoadingCi(false))
  }

  useEffect(() => { loadCountries() }, [])

  const addCountry = async (name) => {
    try { await configApi.addCountry(name, ''); loadCountries() }
    catch { toast.error('Erro ao adicionar país.') }
  }
  const updateCountry = async (id, name) => {
    try {
      await configApi.updateCountry(id, name)
      if (selCountry?.id === id) setSelCountry(c => ({ ...c, name }))
      loadCountries()
    } catch { toast.error('Erro ao salvar país.') }
  }
  const delCountry = async (id) => {
    try {
      await configApi.delCountry(id)
      if (selCountry?.id === id) { setSelCountry(null); setStates([]); setSelState(null); setCities([]) }
      loadCountries()
    } catch { toast.error('Erro ao remover país.') }
  }
  const addState = async (name) => {
    if (!selCountry) return
    try { await configApi.addState(selCountry.id, name, ''); loadStates(selCountry) }
    catch { toast.error('Erro ao adicionar estado.') }
  }
  const updateState = async (id, name) => {
    try {
      await configApi.updateState(id, name)
      if (selState?.id === id) setSelState(s => ({ ...s, name }))
      if (selCountry) loadStates(selCountry)
    } catch { toast.error('Erro ao salvar estado.') }
  }
  const delState = async (id) => {
    try {
      await configApi.delState(id)
      if (selState?.id === id) { setSelState(null); setCities([]) }
      setStates(s => s.filter(x => x.id !== id))
    } catch { toast.error('Erro ao remover estado.') }
  }
  const addCity = async (name) => {
    if (!selState) return
    try { await configApi.addCity(selState.id, name); loadCities(selState) }
    catch { toast.error('Erro ao adicionar cidade.') }
  }
  const updateCity = async (id, name) => {
    try { await configApi.updateCity(id, name); if (selState) loadCities(selState) }
    catch { toast.error('Erro ao salvar cidade.') }
  }
  const delCity = async (id) => {
    try { await configApi.delCity(id); setCities(c => c.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover cidade.') }
  }

  const filteredC  = useMemo(() => { const q = searchC.toLowerCase();  return countries.filter(c => c.name.toLowerCase().includes(q)) }, [countries, searchC])
  const filteredS  = useMemo(() => { const q = searchS.toLowerCase();  return states.filter(s => s.name.toLowerCase().includes(q)) }, [states, searchS])
  const filteredCi = useMemo(() => { const q = searchCi.toLowerCase(); return cities.filter(c => c.name.toLowerCase().includes(q)) }, [cities, searchCi])

  const formSave = async (name) => {
    if (form.kind === 'country') return form.item ? updateCountry(form.item.id, name) : addCountry(name)
    if (form.kind === 'state')   return form.item ? updateState(form.item.id, name)   : addState(name)
    if (form.kind === 'city')    return form.item ? updateCity(form.item.id, name)    : addCity(name)
  }
  const formTitles = {
    country: form?.item ? 'Editar país'   : 'Novo país',
    state:   form?.item ? 'Editar estado' : 'Novo estado',
    city:    form?.item ? 'Editar cidade' : 'Nova cidade',
  }
  const formPlaceholders = { country: 'Nome do país…', state: 'Nome do estado…', city: 'Nome da cidade…' }

  return (
    <>
    <GeoCsvBar canEdit={canEdit} />
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
      {/* ── Países ── */}
      <Col title="Países" count={countries.length}
        search={searchC} onSearch={setSearchC}
        onAddClick={() => setForm({ kind:'country' })}
        loading={loadingC} canEdit={canEdit}
      >
        {filteredC.length === 0
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>Nenhum país.</p>
          : filteredC.map(c => (
            <GeoRow key={c.id}
              label={c.name}
              extra={c.state_count > 0 ? c.state_count : null}
              selected={selCountry?.id === c.id}
              onClick={() => loadStates(c)}
              onEdit={() => setForm({ kind:'country', item:c })}
              onDelete={() => setConfirm({ action:'country', id:c.id, name:c.name })}
              canEdit={canEdit} canDelete={canDelete}
            />
          ))
        }
      </Col>

      {/* ── Estados ── */}
      <Col title={selCountry ? `${selCountry.name} — Estados` : 'Estados'}
        count={selCountry ? states.length : null}
        search={searchS} onSearch={setSearchS}
        onAddClick={() => setForm({ kind:'state' })}
        addDisabled={!selCountry}
        loading={loadingS} canEdit={canEdit}
      >
        {!selCountry
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>← Selecione um país</p>
          : filteredS.length === 0
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>Nenhum estado.</p>
          : filteredS.map(s => (
            <GeoRow key={s.id}
              label={s.name}
              extra={[s.code, s.city_count > 0 ? s.city_count : null].filter(Boolean).join(' · ') || null}
              selected={selState?.id === s.id}
              onClick={() => loadCities(s)}
              onEdit={() => setForm({ kind:'state', item:s })}
              onDelete={() => setConfirm({ action:'state', id:s.id, name:s.name })}
              canEdit={canEdit} canDelete={canDelete}
            />
          ))
        }
      </Col>

      {/* ── Cidades ── */}
      <Col title={selState ? `${selState.name} — Cidades` : 'Cidades'}
        count={selState ? cities.length : null}
        search={searchCi} onSearch={setSearchCi}
        onAddClick={() => setForm({ kind:'city' })}
        addDisabled={!selState}
        loading={loadingCi} canEdit={canEdit}
      >
        {!selState
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>← Selecione um estado</p>
          : filteredCi.length === 0
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>Nenhuma cidade.</p>
          : filteredCi.map(c => (
            <GeoRow key={c.id}
              label={c.name}
              selected={false}
              onEdit={() => setForm({ kind:'city', item:c })}
              onDelete={() => setConfirm({ action:'city', id:c.id, name:c.name })}
              canEdit={canEdit} canDelete={canDelete}
            />
          ))
        }
      </Col>
    </div>
    {canEdit && form && (
      <NameFormModal
        title={formTitles[form.kind]}
        placeholder={formPlaceholders[form.kind]}
        initial={form.item ? form.item.name : null}
        onSave={formSave}
        onClose={() => setForm(null)}
      />
    )}
    {confirm && (
      <ConfirmModal
        message={`Remover "${confirm.name}"?`}
        onOk={() => {
          if (confirm.action === 'country') delCountry(confirm.id)
          if (confirm.action === 'state')   delState(confirm.id)
          if (confirm.action === 'city')    delCity(confirm.id)
          setConfirm(null)
        }}
        onCancel={() => setConfirm(null)}
      />
    )}
    </>
  )
}

/* ── Página principal ── */
/* Listas configuráveis */
const LIST_DEFS = [
  { key:'doc_types',        label:'Documentos',               perm:'settings_doc_types' },
  { key:'perm_profiles',    label:'Perfis de permissão',      perm:'settings_user_profiles' },
  { key:'professions',      label:'Profissões',               perm:'settings_professions' },
  { key:'languages',        label:'Idiomas',                  perm:'settings_languages' },
  { key:'vaccines',         label:'Vacinas',                  perm:'settings_vaccines' },
  { key:'genders',          label:'Gêneros',                  perm:'settings_genders' },
  { key:'prof_cards',       label:'Carteiras',                perm:'settings_prof_cards' },
  { key:'list_addits',      label:'Adicionais de Lista',      perm:'settings_list_additionals' },
  { key:'crew_roles',       label:'Equipe técnica',           perm:'settings_crew_roles' },
  { key:'accommodations',   label:'Tipos de Acomodação',      perm:'settings_accommodations' },
  { key:'list_categories',  label:'Categoria de Acomodações', perm:'settings_list_categories' },
  { key:'countries',        label:'Países & Estados',         perm:'settings_countries' },
  { key:'airports',         label:'Aeroportos',               perm:'settings_airports' },
  { key:'airlines',         label:'Companhias Aéreas',        perm:'settings_airlines' },
  { key:'bus_maps',         label:'Mapas de Ônibus',          perm:'settings_bus_maps' },
]
const WIDE_LISTS = ['doc_types', 'perm_profiles', 'accommodations', 'countries', 'airports', 'airlines', 'bus_maps']

function exportEmailsCsv(emails) {
  const rows = ['email', ...emails.map(e => `"${e.replace(/"/g, '""')}"`)]
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = 'emails_automaticos.csv'; a.click()
  URL.revokeObjectURL(url)
}

/* ── Gerenciador de Perfis de Permissão ─────────────────────────────────────── */

function ProfileModal({ profile, onClose, onSaved }) {
  const isEdit = !!profile
  const [name,    setName]    = useState(profile?.name ?? '')
  const [perms,   setPerms]   = useState(sanitizePerms({ ...EMPTY_PERMISSIONS, ...(profile?.permissions ?? {}) }))
  const [saving,  setSaving]  = useState(false)

  const setPerm    = (key, val)  => setPerms(p => applyPermChanges(p, { [key]: val }))
  const setPermAll = (keys, val) => setPerms(p => applyPermChanges(p, Object.fromEntries(keys.map(k => [k, val]))))
  const setFormForBar = fn => {
    const prev = { permissions: perms }
    const next = fn(prev)
    setPerms(next.permissions)
  }

  const save = async () => {
    if (!name.trim()) { toast.error('Informe um nome para o perfil.'); return }
    setSaving(true)
    try {
      if (isEdit) {
        await configApi.updatePermissionProfile(profile.id, { name: name.trim(), permissions: perms })
        toast.success('Perfil atualizado.')
      } else {
        await configApi.addPermissionProfile({ name: name.trim(), permissions: perms })
        toast.success('Perfil criado.')
      }
      onSaved()
    } catch (e) { toast.error(e.response?.data?.name?.[0] ?? e.response?.data?.error ?? 'Erro ao salvar.') }
    finally { setSaving(false) }
  }

  const lbl = { fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em', display:'block', marginBottom:5 }
  const inp = { width:'100%', padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:6, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b', boxSizing:'border-box' }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:500, padding:20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:760, maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 64px rgba(0,0,0,.24)', animation:'mIn .15s ease' }}>
        <div style={{ padding:'16px 20px 14px', borderBottom:'1px solid #e2e8f0', flexShrink:0 }}>
          <p style={{ fontSize:14, fontWeight:600, color:'#1e293b', margin:0 }}>
            {isEdit ? 'Editar perfil' : 'Novo perfil de permissão'}
            {isEdit && <span style={{ fontSize:12, fontWeight:400, color:'#94a3b8', marginLeft:8 }}>{profile.name}</span>}
          </p>
        </div>
        <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:14, overflowY:'auto' }}>
          <div>
            <label style={lbl}>Nome do perfil</label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Vendedor, Atendente…" />
          </div>
          <div style={{ borderTop:'1px solid #f1f5f9', paddingTop:12, display:'flex', flexDirection:'column', gap:6 }}>
            <PermPresetBar setForm={setFormForBar} />
            {PERM_GROUPS.map(g => (
              <PermAccordionItem key={g.title} group={g} permissions={perms} onToggle={setPerm} onToggleAll={setPermAll} />
            ))}
          </div>
        </div>
        <div style={{ padding:'12px 20px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'space-between' }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding:'8px 16px', borderRadius:7, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
          <button onClick={save} disabled={saving}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 18px', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            <Ic n="check" s={13}/>{saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar perfil'}
          </button>
        </div>
      </div>
    </div>
  )
}

function exportProfilesCsv(profiles) {
  const rows = ['nome,permissoes']
  for (const p of profiles) {
    const active = Object.entries(p.permissions ?? {}).filter(([, v]) => v).map(([k]) => k).join('|')
    rows.push(`"${p.name.replace(/"/g, '""')}","${active}"`)
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a'); a.href = url; a.download = 'perfis_permissao.csv'; a.click()
  URL.revokeObjectURL(url)
}

function PermissionProfilesManager({ canEdit = true, canDelete = true }) {
  const [profiles, setProfiles] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [modal,    setModal]    = useState(null)
  const [delItem,  setDelItem]  = useState(null)
  const fileRef = useRef(null)

  const load = useCallback(() => {
    setLoading(true)
    configApi.permissionProfiles()
      .then(r => setProfiles(r.data))
      .catch(() => toast.error('Erro ao carregar perfis.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const handleDelete = async () => {
    try { await configApi.delPermissionProfile(delItem.id); load() }
    catch { toast.error('Erro ao excluir perfil.') }
    finally { setDelItem(null) }
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''
    const text = await file.text()
    const lines = text.split(/\r?\n/).filter(Boolean)
    if (lines.length < 2) { toast.error('CSV vazio ou inválido.'); return }
    let ok = 0, skip = 0
    for (const line of lines.slice(1)) {
      const m = line.match(/^"?([^",]*(?:""[^",]*)*)"?,"?([^"]*)"?$/)
      if (!m) { skip++; continue }
      const name  = m[1].replace(/""/g, '"').trim()
      const keys  = m[2].split('|').filter(Boolean)
      if (!name) { skip++; continue }
      const permissions = Object.fromEntries(keys.map(k => [k, true]))
      const existing = profiles.find(p => p.name.toLowerCase() === name.toLowerCase())
      try {
        if (existing) await configApi.updatePermissionProfile(existing.id, { name, permissions })
        else          await configApi.addPermissionProfile({ name, permissions })
        ok++
      } catch { skip++ }
    }
    toast.success(`${ok} perfil${ok !== 1 ? 's' : ''} importado${ok !== 1 ? 's' : ''}.${skip ? ` ${skip} ignorado${skip !== 1 ? 's' : ''}.` : ''}`)
    load()
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return profiles.filter(p => p.name.toLowerCase().includes(q))
  }, [profiles, search])

  return (
    <>
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center', flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
          style={{ ...inp, flex:1, minWidth:160 }}
          onFocus={e => e.target.style.borderColor='#1a2d4f'}
          onBlur={e  => e.target.style.borderColor='#e2e8f0'} />
        {canEdit && <button onClick={() => setModal('new')} style={btnPri}>+ Adicionar</button>}
        <div style={{ display:'flex', gap:6 }}>
          <button style={btnCsv('#059669')} onClick={() => exportProfilesCsv(profiles)} title="Exportar como CSV">⬇ Exportar</button>
          {canEdit && <button style={btnCsv('#2e6db4')} onClick={() => fileRef.current?.click()} title="Importar de CSV">⬆ Importar</button>}
          {canEdit && <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display:'none' }} onChange={handleImport} />}
        </div>
      </div>

      <p style={{ fontSize:12, color:'#94a3b8', margin:'0 0 8px' }}>
        {loading ? 'Carregando…' : `${filtered.length} de ${profiles.length} ${profiles.length !== 1 ? 'perfis' : 'perfil'}`}
      </p>

      <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden', maxHeight:460, overflowY:'auto' }}>
        {loading ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
        ) : filtered.length === 0 ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>
            {profiles.length === 0 ? 'Nenhum perfil criado ainda.' : 'Nenhum resultado.'}
          </p>
        ) : filtered.map((p, idx) => {
          const count = Object.values(p.permissions ?? {}).filter(Boolean).length
          return (
            <div key={p.id} style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'9px 14px', fontSize:13, color:'#0f172a',
              borderBottom: idx < filtered.length - 1 ? '1px solid #f1f5f9' : 'none', background:'#fff',
            }}
              onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
              onMouseLeave={e => e.currentTarget.style.background='#fff'}>
              <div>
                <span style={{ fontWeight:500 }}>{p.name}</span>
                <span style={{ marginLeft:10, fontSize:12, color:'#94a3b8' }}>{count} permiss{count !== 1 ? 'ões' : 'ão'}</span>
              </div>
              {(canEdit || canDelete) && (
                <div className="r-acts">
                  {canEdit   && <button className="r-btn edit" title="Editar"  onClick={() => setModal(p)}><Ic n="edit"  s={13}/></button>}
                  {canDelete && <button className="r-btn del"  title="Excluir" onClick={() => setDelItem(p)}><Ic n="trash" s={13}/></button>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
    {modal && (
      <ProfileModal
        profile={modal === 'new' ? null : modal}
        onClose={() => setModal(null)}
        onSaved={() => { setModal(null); load() }}
      />
    )}
    {delItem && (
      <ConfirmModal
        message={`Excluir o perfil "${delItem.name}"? Usuários que o têm aplicado não serão alterados.`}
        onOk={handleDelete}
        onCancel={() => setDelItem(null)}
      />
    )}
    </>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isSu = !!user?.is_superuser
  const myP  = user?.permissions ?? {}
  const can  = (permBase, action) => {
    if (isSu || myP.manage_settings) return true
    if (action === 'view')   return !!(myP[`${permBase}_view`]   || myP[permBase])
    if (action === 'edit')   return !!(myP[`${permBase}_edit`]   || myP[permBase])
    if (action === 'delete') return !!(myP[`${permBase}_delete`] || myP[permBase])
    return false
  }
  const canCsvExport = isSu || !!myP.manage_settings || !!myP.settings_csv_export
  const canCsvImport = isSu || !!myP.manage_settings || !!myP.settings_csv_import

  const fileAllRef = useRef(null)
  const [listSearch, setListSearch] = useState('')
  const [activeList, setActiveList] = useState(null)
  const [professions, setProfessions] = useState([])
  const [languages,   setLanguages]   = useState([])
  const [vaccines,    setVaccines]    = useState([])
  const [genders,    setGenders]    = useState([])
  const [listCats,   setListCats]   = useState([])
  const [profCards,    setProfCards]    = useState([])
  const [listAddits,   setListAddits]   = useState([])
  const [crewRoles,    setCrewRoles]    = useState([])
  const [accoms,       setAccoms]       = useState([])
  const [loadingAc,    setLoadingAc]    = useState(true)
  const [loadingP,     setLoadingP]     = useState(true)
  const [loadingL,     setLoadingL]     = useState(true)
  const [loadingV,     setLoadingV]     = useState(true)
  const [loadingG,     setLoadingG]     = useState(true)
  const [loadingLC,    setLoadingLC]    = useState(true)
  const [loadingPC,    setLoadingPC]    = useState(true)
  const [loadingLA,    setLoadingLA]    = useState(true)
  const [loadingCR,    setLoadingCR]    = useState(true)

  useEffect(() => {
    configApi.professions().then(r => setProfessions(r.data)).catch(() => {}).finally(() => setLoadingP(false))
    configApi.languages().then(r => setLanguages(r.data)).catch(() => {}).finally(() => setLoadingL(false))
    configApi.vaccines().then(r => setVaccines(r.data)).catch(() => {}).finally(() => setLoadingV(false))
    configApi.genders().then(r => setGenders(r.data)).catch(() => {}).finally(() => setLoadingG(false))
    configApi.listCategories().then(r => setListCats(r.data)).catch(() => {}).finally(() => setLoadingLC(false))
    configApi.profCards().then(r => setProfCards(r.data)).catch(() => {}).finally(() => setLoadingPC(false))
    listsApi.listAdditionals().then(r => setListAddits(r.data.results ?? r.data)).catch(() => {}).finally(() => setLoadingLA(false))
    listsApi.listCrewRoles().then(r => setCrewRoles(r.data.results ?? r.data)).catch(() => {}).finally(() => setLoadingCR(false))
    configApi.accommodations().then(r => setAccoms(r.data.results ?? r.data)).catch(() => {}).finally(() => setLoadingAc(false))
  }, [])

  const silentReloadConfig = useCallback(() => {
    configApi.professions().then(r => setProfessions(r.data)).catch(() => {})
    configApi.languages().then(r => setLanguages(r.data)).catch(() => {})
    configApi.vaccines().then(r => setVaccines(r.data)).catch(() => {})
    configApi.genders().then(r => setGenders(r.data)).catch(() => {})
    configApi.listCategories().then(r => setListCats(r.data)).catch(() => {})
    configApi.profCards().then(r => setProfCards(r.data)).catch(() => {})
    listsApi.listAdditionals().then(r => setListAddits(r.data.results ?? r.data)).catch(() => {})
    listsApi.listCrewRoles().then(r => setCrewRoles(r.data.results ?? r.data)).catch(() => {})
    configApi.accommodations().then(r => setAccoms(r.data.results ?? r.data)).catch(() => {})
  }, [])

  const wsUrl = user ? `ws://${window.location.hostname}:8000/ws/dashboard/` : null
  useWebSocket(wsUrl, useCallback(({ scope }) => {
    if (scope === 'config' || scope === 'all') silentReloadConfig()
  }, [silentReloadConfig]))

  const addProfession = async (name) => {
    try {
      const r = await configApi.addProfession(name)
      setProfessions(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar profissão.') }
  }
  const updateProfession = async (id, name) => {
    try {
      const r = await configApi.updateProfession(id, name)
      setProfessions(p => p.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar profissão.') }
  }
  const delProfession = async (id) => {
    try { await configApi.delProfession(id); setProfessions(p => p.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover profissão.') }
  }
  const addLanguage = async (name) => {
    try {
      const r = await configApi.addLanguage(name)
      setLanguages(l => [...l, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar idioma.') }
  }
  const updateLanguage = async (id, name) => {
    try {
      const r = await configApi.updateLanguage(id, name)
      setLanguages(l => l.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar idioma.') }
  }
  const delLanguage = async (id) => {
    try { await configApi.delLanguage(id); setLanguages(l => l.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover idioma.') }
  }
  const addVaccine = async (name) => {
    try {
      const r = await configApi.addVaccine(name)
      setVaccines(v => [...v, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar vacina.') }
  }
  const updateVaccine = async (id, name) => {
    try {
      const r = await configApi.updateVaccine(id, name)
      setVaccines(v => v.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar vacina.') }
  }
  const delVaccine = async (id) => {
    try { await configApi.delVaccine(id); setVaccines(v => v.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover vacina.') }
  }
  const addGender = async (name) => {
    try {
      const r = await configApi.addGender(name)
      setGenders(g => [...g, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar gênero.') }
  }
  const updateGender = async (id, name) => {
    try {
      const r = await configApi.updateGender(id, name)
      setGenders(g => g.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar gênero.') }
  }
  const delGender = async (id) => {
    try { await configApi.delGender(id); setGenders(g => g.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover gênero.') }
  }
  const addListCategory = async (name) => {
    try {
      const r = await configApi.addListCategory(name)
      setListCats(c => [...c, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar categoria.') }
  }
  const updateListCategory = async (id, name) => {
    try {
      const r = await configApi.updateListCategory(id, name)
      setListCats(c => c.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar categoria.') }
  }
  const delListCategory = async (id) => {
    try { await configApi.delListCategory(id); setListCats(c => c.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover categoria.') }
  }
  const addProfCard = async (name) => {
    try {
      const r = await configApi.addProfCard(name)
      setProfCards(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar carteira.') }
  }
  const updateProfCard = async (id, name) => {
    try {
      const r = await configApi.updateProfCard(id, name)
      setProfCards(p => p.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar carteira.') }
  }
  const delProfCard = async (id) => {
    try { await configApi.delProfCard(id); setProfCards(p => p.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover carteira.') }
  }

  const addAccom = async (name) => {
    try {
      const r = await configApi.addAccommodation(name)
      setAccoms(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar.') }
  }
  const delAccom = async (id) => {
    try { await configApi.delAccommodation(id); setAccoms(p => p.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover.') }
  }

  const addListAddit = async (name) => {
    try {
      const r = await listsApi.addAdditional(name)
      setListAddits(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar.') }
  }
  const updateListAddit = async (id, name) => {
    try {
      const r = await listsApi.updateAdditional(id, name)
      setListAddits(p => p.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar adicional.') }
  }
  const delListAddit = async (id) => {
    try { await listsApi.removeAdditional(id); setListAddits(p => p.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover.') }
  }

  const addCrewRole = async (name) => {
    try {
      const r = await listsApi.addCrewRole(name)
      setCrewRoles(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar.') }
  }
  const updateCrewRole = async (id, name) => {
    try {
      const r = await listsApi.updateCrewRole(id, name)
      setCrewRoles(p => p.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar função.') }
  }
  const delCrewRole = async (id) => {
    try { await listsApi.removeCrewRole(id); setCrewRoles(p => p.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover.') }
  }

  /* ── CSV combinado: exporta/importa todas as listas simples (nome único) de uma vez ── */
  const SIMPLE_LIST_GROUPS = [
    { key:'professions',     label:'Profissões',             items: professions },
    { key:'languages',       label:'Idiomas',                items: languages   },
    { key:'vaccines',        label:'Vacinas',                items: vaccines    },
    { key:'genders',         label:'Gêneros',                items: genders     },
    { key:'prof_cards',      label:'Carteiras',              items: profCards   },
    { key:'list_addits',     label:'Adicionais de Lista',    items: listAddits  },
    { key:'crew_roles',      label:'Equipe técnica',         items: crewRoles   },
    { key:'list_categories', label:'Categoria de Acomodações', items: listCats  },
  ]

  const handleExportAll = async () => {
    try {
      const [cRes, sRes, geoRes] = await Promise.all([
        configApi.countries(),
        configApi.allStates(),
        configApi.geoExport(),
      ])
      // Extrai apenas linhas com cidade a partir do geo CSV
      const geoText = await geoRes.data.text()
      const cities = geoText.split(/\r?\n/).slice(1).map(l => splitCsvLineSettings(l)).filter(c => c[2]).map(c => ({ country: c[0], state: c[1], name: c[2] }))
      exportCombinedCsvFull(SIMPLE_LIST_GROUPS, accoms, cRes.data, sRes.data, cities, 'todas_as_listas.csv')
    } catch { toast.error('Erro ao exportar.') }
  }

  const handleImportAllFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const csvText = await file.text()
    let allCountries = []
    try { allCountries = (await configApi.countries()).data } catch {}
    navigate('/configuracoes/import', {
      state: {
        csvText, filename: file.name, type: 'all',
        existingByType: {
          ...Object.fromEntries(SIMPLE_LIST_GROUPS.map(g => [g.key, g.items.map(i => i.name)])),
          accommodations: accoms.map(a => a.name),
          countries: allCountries.map(c => c.name),
        },
        allCountries,
      }
    })
  }

  const filteredListDefs = LIST_DEFS
    .filter(d => can(d.perm, 'view'))
    .filter(d => d.label.toLowerCase().includes(listSearch.trim().toLowerCase()))
  const activeDef = LIST_DEFS.find(d => d.key === activeList)

  return (
    <div>
      <div className="ph">
        <h1 className="ph-title">Configurações</h1>
      </div>

      <div style={{ padding:'24px' }}>
        <div className="search-row">
          <div className="search-wrap">
            <span className="search-ico"><Ic n="search" s={14}/></span>
            <input className="search-in" placeholder="Buscar lista…"
              value={listSearch} onChange={e => setListSearch(e.target.value)} />
          </div>
          <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
            {canCsvExport && (
              <button style={btnCsv('#059669')} onClick={handleExportAll} title="Baixar CSV com todas as listas">
                ⬇ Exportar tudo
              </button>
            )}
            {canCsvImport && (
              <button style={btnCsv('#2e6db4')} onClick={() => fileAllRef.current?.click()} title="Importar CSV com todas as listas">
                ⬆ Importar tudo
              </button>
            )}
            <input ref={fileAllRef} type="file" accept=".csv,text/csv"
              style={{ display:'none' }} onChange={handleImportAllFile} />
          </div>
        </div>

        <div className="tcard">
          {filteredListDefs.length === 0 ? (
            <div className="empty-state">
              <div style={{ color:'#cbd5e1' }}><Ic n="search" s={28}/></div>
              <p>Nenhuma lista encontrada</p>
            </div>
          ) : filteredListDefs.map((d, idx) => (
            <div key={d.key} onClick={() => setActiveList(d.key)}
              style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'13px 16px', fontSize:13, fontWeight:500, color:'#1e293b', cursor:'pointer',
                borderBottom: idx < filteredListDefs.length - 1 ? '1px solid #f1f5f9' : 'none',
                background:'#fff', transition:'background .1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}
            >
              <span className="t-name">{d.label}</span>
              <span style={{ color:'#cbd5e1', fontSize:17 }}>›</span>
            </div>
          ))}
        </div>
      </div>

      {activeDef && (
        <ListDetailModal title={activeDef.label} onClose={() => setActiveList(null)} wide={WIDE_LISTS.includes(activeDef.key)}>
          {activeDef.key === 'doc_types'       && <DocTypesManager canEdit={can('settings_doc_types','edit')} canDelete={can('settings_doc_types','delete')} />}
          {activeDef.key === 'perm_profiles'   && <PermissionProfilesManager canEdit={can('settings_user_profiles','edit')} canDelete={can('settings_user_profiles','delete')} />}
          {activeDef.key === 'professions'     && <ItemList items={professions} loading={loadingP}  onAdd={can('settings_professions','edit') ? addProfession : undefined}       onUpdate={can('settings_professions','edit') ? updateProfession : undefined}       onDelete={can('settings_professions','delete') ? delProfession : undefined}       placeholder="Nome da profissão…"  addTitle="Nova profissão"  editTitle="Editar profissão"  filename="profissoes.csv"       type="professions" />}
          {activeDef.key === 'languages'       && <ItemList items={languages}   loading={loadingL}  onAdd={can('settings_languages','edit') ? addLanguage : undefined}           onUpdate={can('settings_languages','edit') ? updateLanguage : undefined}           onDelete={can('settings_languages','delete') ? delLanguage : undefined}           placeholder="Nome do idioma…"     addTitle="Novo idioma"     editTitle="Editar idioma"     filename="idiomas.csv"          type="languages" />}
          {activeDef.key === 'vaccines'        && <ItemList items={vaccines}    loading={loadingV}  onAdd={can('settings_vaccines','edit') ? addVaccine : undefined}             onUpdate={can('settings_vaccines','edit') ? updateVaccine : undefined}             onDelete={can('settings_vaccines','delete') ? delVaccine : undefined}             placeholder="Nome da vacina…"     addTitle="Nova vacina"     editTitle="Editar vacina"     filename="vacinas.csv"          type="vaccines" />}
          {activeDef.key === 'genders'         && <ItemList items={genders}     loading={loadingG}  onAdd={can('settings_genders','edit') ? addGender : undefined}               onUpdate={can('settings_genders','edit') ? updateGender : undefined}               onDelete={can('settings_genders','delete') ? delGender : undefined}               placeholder="Nome do gênero…"     addTitle="Novo gênero"     editTitle="Editar gênero"     filename="generos.csv"          type="genders" />}
          {activeDef.key === 'prof_cards'      && <ItemList items={profCards}   loading={loadingPC} onAdd={can('settings_prof_cards','edit') ? addProfCard : undefined}          onUpdate={can('settings_prof_cards','edit') ? updateProfCard : undefined}          onDelete={can('settings_prof_cards','delete') ? delProfCard : undefined}          placeholder="Nome da carteira…"   addTitle="Nova carteira"   editTitle="Editar carteira"   filename="carteiras.csv"        type="prof_cards" />}
          {activeDef.key === 'list_addits'     && <ItemList items={listAddits}  loading={loadingLA} onAdd={can('settings_list_additionals','edit') ? addListAddit : undefined}   onUpdate={can('settings_list_additionals','edit') ? updateListAddit : undefined}   onDelete={can('settings_list_additionals','delete') ? delListAddit : undefined}   placeholder="Nome do adicional…"  addTitle="Novo adicional"  editTitle="Editar adicional"  filename="adicionais.csv"       type="list_addits" />}
          {activeDef.key === 'crew_roles'      && <ItemList items={crewRoles}   loading={loadingCR} onAdd={can('settings_crew_roles','edit') ? addCrewRole : undefined}          onUpdate={can('settings_crew_roles','edit') ? updateCrewRole : undefined}          onDelete={can('settings_crew_roles','delete') ? delCrewRole : undefined}          placeholder="Nome da função…"     addTitle="Nova função"     editTitle="Editar função"     filename="equipe_tecnica.csv"   type="crew_roles" />}
          {activeDef.key === 'accommodations'  && <AccommodationManager canEdit={can('settings_accommodations','edit')} canDelete={can('settings_accommodations','delete')} items={accoms} loading={loadingAc} onRefresh={() => {
            setLoadingAc(true)
            configApi.accommodations().then(r => setAccoms(r.data.results ?? r.data)).catch(() => {}).finally(() => setLoadingAc(false))
          }} />}
          {activeDef.key === 'list_categories' && <ItemList items={listCats}    loading={loadingLC} onAdd={can('settings_list_categories','edit') ? addListCategory : undefined} onUpdate={can('settings_list_categories','edit') ? updateListCategory : undefined} onDelete={can('settings_list_categories','delete') ? delListCategory : undefined} placeholder="Nome da categoria…" addTitle="Nova categoria" editTitle="Editar categoria" filename="categorias_lista.csv" type="list_categories" />}
          {activeDef.key === 'countries'       && <CountriesTab canEdit={can('settings_countries','edit')} canDelete={can('settings_countries','delete')} />}
          {activeDef.key === 'airports'        && <AirportsManager canEdit={can('settings_airports','edit')} canDelete={can('settings_airports','delete')} />}
          {activeDef.key === 'airlines'        && <AirlinesManager canEdit={can('settings_airlines','edit')} canDelete={can('settings_airlines','delete')} />}
          {activeDef.key === 'bus_maps'        && <BusMapsManager canEdit={can('settings_bus_maps','edit')} canDelete={can('settings_bus_maps','delete')} />}
        </ListDetailModal>
      )}
    </div>
  )
}
