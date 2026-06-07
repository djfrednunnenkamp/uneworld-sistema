import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import usePersistedTab from '../hooks/usePersistedTab'
import toast from 'react-hot-toast'
import { configApi, listsApi } from '../api'
import ConfirmModal from '../components/ConfirmModal'
import DocTypesManager from '../components/DocTypesManager'
import AccommodationManager from '../components/AccommodationManager'

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
function CsvButtons({ items, filename, type }) {
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
      <button style={btnCsv('#2e6db4')} onClick={() => fileRef.current?.click()} title="Importar de CSV">
        ⬆ Importar
      </button>
      <input ref={fileRef} type="file" accept=".csv,text/csv"
        style={{ display: 'none' }} onChange={handleFileChosen} />
    </div>
  )
}

/* ── ItemList (Profissões / Idiomas) ── */
function ItemList({ items, loading, onDelete, onAdd, placeholder, filename, type }) {
  const [search,  setSearch]  = useState('')
  const [newVal,  setNewVal]  = useState('')
  const [adding,  setAdding]  = useState(false)
  const [confirm, setConfirm] = useState(null) // {id, name}

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return items.filter(i => i.name.toLowerCase().includes(q))
  }, [items, search])

  const handleAdd = async () => {
    const v = newVal.trim(); if (!v) return
    setAdding(true)
    try { await onAdd(v); setNewVal('') }
    finally { setAdding(false) }
  }

  return (
    <>
    <div>
      {/* Toolbar: busca + CSV */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
          style={{ ...inp, flex: 1, minWidth: 160 }}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'}
          onBlur={e  => e.target.style.borderColor = '#e2e8f0'} />
        <CsvButtons items={items} filename={filename} type={type} />
      </div>

      {/* Adicionar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input value={newVal} onChange={e => setNewVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder={placeholder} style={{ ...inp, flex: 1 }}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'}
          onBlur={e  => e.target.style.borderColor = '#e2e8f0'} />
        <button onClick={handleAdd} disabled={adding || !newVal.trim()} style={btnPri}>
          + Adicionar
        </button>
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
            <button onClick={() => setConfirm({ id: item.id, name: item.name })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 16, lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
              onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
              onMouseLeave={e => e.currentTarget.style.color = '#fca5a5'}
              title="Remover">×</button>
          </div>
        ))}
      </div>
    </div>
    {confirm && (
      <ConfirmModal
        message={`Remover "${confirm.name}"?`}
        onOk={() => { onDelete(confirm.id); setConfirm(null) }}
        onCancel={() => setConfirm(null)}
      />
    )}
  </>
  )
}

/* ── Barra de CSV global da aba Países & Estados ── */
function GeoCsvBar() {
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
      <button onClick={() => fileRef.current?.click()}
        style={btnCsv('#2e6db4')}>
        ⬆ Importar CSV
      </button>
      <input ref={fileRef} type="file" accept=".csv,text/csv"
        style={{ display: 'none' }} onChange={handleFileChosen} />
    </div>
  )
}

/* ── Estilos de coluna (módulo-level para não recriar a cada render) ── */
const colDelBtn = { background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 14, lineHeight: 1, padding: '1px 3px', flexShrink: 0 }
const colAddInp = { ...inp, flex: 1, fontSize: 12, padding: '7px 10px' }
const colAddBtn = { ...btnPri, fontSize: 12, padding: '7px 10px' }
const colBox    = { border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', maxHeight: 380, overflowY: 'auto' }

/* Col é um componente de módulo (nunca redefinido dentro de CountriesTab) */
function Col({ title, count, search, onSearch, newVal, onNew, onAdd, loading, children, placeholder }) {
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
      </div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
        <input value={newVal} onChange={e => onNew(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onAdd(newVal)}
          placeholder={placeholder} style={colAddInp}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'}
          onBlur={e  => e.target.style.borderColor = '#e2e8f0'} />
        <button onClick={() => onAdd(newVal)} disabled={!newVal.trim()} style={colAddBtn}>+</button>
      </div>
      <div style={colBox}>
        {loading
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>Carregando…</p>
          : children}
      </div>
    </div>
  )
}

/* ── CountriesTab ── */
function CountriesTab() {
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
  const [newCountry, setNewCountry] = useState('')
  const [newState,   setNewState]   = useState('')
  const [newCity,    setNewCity]    = useState('')

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
    try { await configApi.addCountry(name, ''); setNewCountry(''); loadCountries() }
    catch { toast.error('Erro ao adicionar país.') }
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
    try { await configApi.addState(selCountry.id, name, ''); setNewState(''); loadStates(selCountry) }
    catch { toast.error('Erro ao adicionar estado.') }
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
    try { await configApi.addCity(selState.id, name); setNewCity(''); loadCities(selState) }
    catch { toast.error('Erro ao adicionar cidade.') }
  }
  const delCity = async (id) => {
    try { await configApi.delCity(id); setCities(c => c.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover cidade.') }
  }

  const filteredC  = useMemo(() => { const q = searchC.toLowerCase();  return countries.filter(c => c.name.toLowerCase().includes(q)) }, [countries, searchC])
  const filteredS  = useMemo(() => { const q = searchS.toLowerCase();  return states.filter(s => s.name.toLowerCase().includes(q)) }, [states, searchS])
  const filteredCi = useMemo(() => { const q = searchCi.toLowerCase(); return cities.filter(c => c.name.toLowerCase().includes(q)) }, [cities, searchCi])

  const colStyle = { border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', maxHeight: 380, overflowY: 'auto' }
  const selRow = (sel) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '7px 10px', fontSize: 12, cursor: 'pointer',
    borderBottom: '1px solid #f1f5f9',
    background: sel ? '#f0f6ff' : '#fff',
    borderLeft: sel ? '3px solid #2e6db4' : '3px solid transparent',
  })
  const delBtn = colDelBtn

  return (
    <>
    <GeoCsvBar />
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
      {/* ── Países ── */}
      <Col title="Países" count={countries.length}
        search={searchC} onSearch={setSearchC}
        newVal={newCountry} onNew={setNewCountry} onAdd={addCountry}
        loading={loadingC} placeholder="Novo país…"
        
      >
        {filteredC.length === 0
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>Nenhum país.</p>
          : filteredC.map(c => (
            <div key={c.id} onClick={() => loadStates(c)} style={selRow(selCountry?.id === c.id)}
              onMouseEnter={e => { if (selCountry?.id !== c.id) e.currentTarget.style.background = '#f8fafc' }}
              onMouseLeave={e => { e.currentTarget.style.background = selCountry?.id === c.id ? '#f0f6ff' : '#fff' }}
            >
              <span style={{ fontWeight: selCountry?.id === c.id ? 600 : 400, color: selCountry?.id === c.id ? '#2e6db4' : '#0f172a', fontSize: 12 }}>
                {c.name}
                {c.state_count > 0 && <span style={{ color: '#94a3b8', marginLeft: 5 }}>{c.state_count}</span>}
              </span>
              <button onClick={e => { e.stopPropagation(); setConfirm({ action:'country', id:c.id, name:c.name }) }} style={delBtn}
                onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                onMouseLeave={e => e.currentTarget.style.color = '#fca5a5'}>×</button>
            </div>
          ))
        }
      </Col>

      {/* ── Estados ── */}
      <Col title={selCountry ? `${selCountry.name} — Estados` : 'Estados'}
        count={selCountry ? states.length : null}
        search={searchS} onSearch={setSearchS}
        newVal={newState} onNew={setNewState} onAdd={addState}
        loading={loadingS} placeholder="Novo estado…"
        
      >
        {!selCountry
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>← Selecione um país</p>
          : filteredS.length === 0
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>Nenhum estado.</p>
          : filteredS.map(s => (
            <div key={s.id} onClick={() => loadCities(s)} style={selRow(selState?.id === s.id)}
              onMouseEnter={e => { if (selState?.id !== s.id) e.currentTarget.style.background = '#f8fafc' }}
              onMouseLeave={e => { e.currentTarget.style.background = selState?.id === s.id ? '#f0f6ff' : '#fff' }}
            >
              <span style={{ fontWeight: selState?.id === s.id ? 600 : 400, color: selState?.id === s.id ? '#2e6db4' : '#0f172a', fontSize: 12 }}>
                {s.name}
                {s.code && <span style={{ color: '#94a3b8', marginLeft: 4 }}>{s.code}</span>}
                {s.city_count > 0 && <span style={{ color: '#94a3b8', marginLeft: 4 }}>{s.city_count}</span>}
              </span>
              <button onClick={e => { e.stopPropagation(); setConfirm({ action:'state', id:s.id, name:s.name }) }} style={delBtn}
                onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                onMouseLeave={e => e.currentTarget.style.color = '#fca5a5'}>×</button>
            </div>
          ))
        }
      </Col>

      {/* ── Cidades ── */}
      <Col title={selState ? `${selState.name} — Cidades` : 'Cidades'}
        count={selState ? cities.length : null}
        search={searchCi} onSearch={setSearchCi}
        newVal={newCity} onNew={setNewCity} onAdd={addCity}
        loading={loadingCi} placeholder="Nova cidade…"
        
      >
        {!selState
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>← Selecione um estado</p>
          : filteredCi.length === 0
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>Nenhuma cidade.</p>
          : filteredCi.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', fontSize: 12, color: '#0f172a', borderBottom: '1px solid #f1f5f9', background: '#fff' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}
            >
              <span>{c.name}</span>
              <button onClick={() => setConfirm({ action:'city', id:c.id, name:c.name })} style={delBtn}
                onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                onMouseLeave={e => e.currentTarget.style.color = '#fca5a5'}>×</button>
            </div>
          ))
        }
      </Col>
    </div>
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
/* Seção principal */
const SECTIONS = ['Listas', 'Tipos de Documento']
/* Sub-tabs da seção Listas */
const LIST_TABS = ['Profissões', 'Idiomas', 'Vacinas', 'Gêneros', 'Carteiras', 'Adicionais de Lista', 'Tipos de Acomodação', 'Categorias de Lista', 'Países & Estados']

export default function Settings() {
  const [section, setSection] = usePersistedTab('tab_settings_section', 0)
  const [tab,     setTab]     = usePersistedTab('tab_settings_list', 0)
  const [professions, setProfessions] = useState([])
  const [languages,   setLanguages]   = useState([])
  const [vaccines,    setVaccines]    = useState([])
  const [genders,    setGenders]    = useState([])
  const [listCats,   setListCats]   = useState([])
  const [profCards,    setProfCards]    = useState([])
  const [listAddits,   setListAddits]   = useState([])
  const [accoms,       setAccoms]       = useState([])
  const [loadingAc,    setLoadingAc]    = useState(true)
  const [loadingP,     setLoadingP]     = useState(true)
  const [loadingL,     setLoadingL]     = useState(true)
  const [loadingV,     setLoadingV]     = useState(true)
  const [loadingG,     setLoadingG]     = useState(true)
  const [loadingLC,    setLoadingLC]    = useState(true)
  const [loadingPC,    setLoadingPC]    = useState(true)
  const [loadingLA,    setLoadingLA]    = useState(true)

  useEffect(() => {
    configApi.professions().then(r => setProfessions(r.data)).catch(() => {}).finally(() => setLoadingP(false))
    configApi.languages().then(r => setLanguages(r.data)).catch(() => {}).finally(() => setLoadingL(false))
    configApi.vaccines().then(r => setVaccines(r.data)).catch(() => {}).finally(() => setLoadingV(false))
    configApi.genders().then(r => setGenders(r.data)).catch(() => {}).finally(() => setLoadingG(false))
    configApi.listCategories().then(r => setListCats(r.data)).catch(() => {}).finally(() => setLoadingLC(false))
    configApi.profCards().then(r => setProfCards(r.data)).catch(() => {}).finally(() => setLoadingPC(false))
    listsApi.listAdditionals().then(r => setListAddits(r.data.results ?? r.data)).catch(() => {}).finally(() => setLoadingLA(false))
    configApi.accommodations().then(r => setAccoms(r.data.results ?? r.data)).catch(() => {}).finally(() => setLoadingAc(false))
  }, [])

  const addProfession = async (name) => {
    try {
      const r = await configApi.addProfession(name)
      setProfessions(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar profissão.') }
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
  const delListAddit = async (id) => {
    try { await listsApi.removeAdditional(id); setListAddits(p => p.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover.') }
  }

  const tabStyle = (active) => ({
    padding: '10px 16px', border: 'none', background: 'none',
    fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer',
    color: active ? '#1a2d4f' : '#64748b', fontFamily: 'inherit',
    borderBottom: active ? '2px solid #1a2d4f' : '2px solid transparent',
  })

  return (
    <div>
      <div className="ph">
        <h1 className="ph-title">Configurações</h1>
      </div>

      {/* Seções principais */}
      <div style={{ display:'flex', gap:2, padding:'0 24px', borderBottom:'2px solid #e2e8f0', marginBottom:0 }}>
        {SECTIONS.map((s, i) => (
          <button key={s} onClick={() => setSection(i)} style={{
            padding:'10px 20px', border:'none', background:'none', cursor:'pointer',
            fontSize:14, fontWeight:section===i?700:500, fontFamily:'inherit',
            color:section===i?'#1a2d4f':'#64748b',
            borderBottom:section===i?'3px solid #1a2d4f':'3px solid transparent',
          }}>{s}</button>
        ))}
      </div>

      {/* ── Seção: Listas ── */}
      {section === 0 && (
        <>
          <div style={{ display:'flex', gap:4, padding:'0 24px', borderBottom:'1px solid #e2e8f0', marginBottom:24, background:'#f8fafc' }}>
            {LIST_TABS.map((t, i) => (
              <button key={t} onClick={() => setTab(i)} style={tabStyle(tab===i)}>{t}</button>
            ))}
          </div>
          <div style={{ padding:'0 24px 40px' }}>
            {tab===0 && <ItemList items={professions} loading={loadingP} onAdd={addProfession} onDelete={delProfession} placeholder="Nova profissão…" filename="profissoes.csv" type="professions" />}
            {tab===1 && <ItemList items={languages}   loading={loadingL} onAdd={addLanguage}   onDelete={delLanguage}   placeholder="Novo idioma…"    filename="idiomas.csv"   type="languages" />}
            {tab===2 && <ItemList items={vaccines}    loading={loadingV} onAdd={addVaccine}    onDelete={delVaccine}    placeholder="Nova vacina…"    filename="vacinas.csv"   type="vaccines" />}
            {tab===3 && <ItemList items={genders}    loading={loadingG}  onAdd={addGender}   onDelete={delGender}   placeholder="Novo gênero…"   filename="generos.csv"   type="genders" />}
            {tab===4 && <ItemList items={profCards}    loading={loadingPC} onAdd={addProfCard}  onDelete={delProfCard}  placeholder="Nova carteira…"  filename="carteiras.csv"  type="prof_cards" />}
            {tab===5 && <ItemList items={listAddits}   loading={loadingLA} onAdd={addListAddit} onDelete={delListAddit} placeholder="Novo adicional…"     filename="adicionais.csv"   type="list_addits" />}
            {tab===6 && <AccommodationManager items={accoms} loading={loadingAc} onRefresh={() => {
              setLoadingAc(true)
              configApi.accommodations().then(r => setAccoms(r.data.results ?? r.data)).catch(() => {}).finally(() => setLoadingAc(false))
            }} />}
            {tab===7 && <ItemList items={listCats} loading={loadingLC} onAdd={addListCategory} onDelete={delListCategory} placeholder="Nova categoria…" filename="categorias_lista.csv" type="list_categories" />}
            {tab===8 && <CountriesTab />}
          </div>
        </>
      )}

      {/* ── Seção: Tipos de Documento ── */}
      {section === 1 && (
        <div style={{ padding:'24px' }}>
          <DocTypesManager />
        </div>
      )}
    </div>
  )
}
