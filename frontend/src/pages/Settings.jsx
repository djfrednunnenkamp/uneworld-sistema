import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { configApi } from '../api'

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

/* ── CsvButtons — reutilizável ── */
function CsvButtons({ items, filename, onAdd }) {
  const fileRef = useRef(null)
  const [importing, setImporting] = useState(false)

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImporting(true)
    try {
      const names = await readCsv(file)
      if (names.length === 0) { toast.error('CSV vazio ou inválido.'); return }
      let added = 0
      for (const name of names) {
        try { await onAdd(name); added++ } catch {}
      }
      toast.success(`${added} de ${names.length} item(s) importado(s).`)
    } catch { toast.error('Erro ao ler o arquivo.') }
    finally { setImporting(false) }
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        style={btnCsv('#059669')}
        onClick={() => exportCsv(items, filename)}
        title="Exportar lista como CSV"
      >
        ⬇ Exportar
      </button>
      <button
        style={btnCsv(importing ? '#94a3b8' : '#2e6db4')}
        onClick={() => fileRef.current?.click()}
        disabled={importing}
        title="Importar itens de um CSV"
      >
        ⬆ {importing ? 'Importando…' : 'Importar'}
      </button>
      <input ref={fileRef} type="file" accept=".csv,text/csv"
        style={{ display: 'none' }} onChange={handleImport} />
    </div>
  )
}

/* ── ItemList (Profissões / Idiomas) ── */
function ItemList({ items, loading, onDelete, onAdd, placeholder, filename }) {
  const [search, setSearch] = useState('')
  const [newVal, setNewVal] = useState('')
  const [adding, setAdding] = useState(false)

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
    <div>
      {/* Toolbar: busca + CSV */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
          style={{ ...inp, flex: 1, minWidth: 160 }}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'}
          onBlur={e  => e.target.style.borderColor = '#e2e8f0'} />
        <CsvButtons items={items} filename={filename} onAdd={onAdd} />
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
            <button onClick={() => onDelete(item.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 16, lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
              onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
              onMouseLeave={e => e.currentTarget.style.color = '#fca5a5'}
              title="Remover">×</button>
          </div>
        ))}
      </div>
    </div>
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
  const delBtn = { background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 14, lineHeight: 1, padding: '1px 3px', flexShrink: 0 }
  const addInp = { ...inp, flex: 1, fontSize: 12, padding: '7px 10px' }
  const addBtn = { ...btnPri, fontSize: 12, padding: '7px 10px' }

  const Col = ({ title, count, search, onSearch, newVal, onNew, onAdd, loading, children, placeholder, csvItems, csvFilename }) => (
    <div style={{ minWidth: 0 }}>
      {/* Header: título + CSV */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: 0, whiteSpace: 'nowrap' }}>
          {title}
          {count != null && <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400, marginLeft: 5 }}>({count})</span>}
        </h3>
        {csvItems && <CsvButtons items={csvItems} filename={csvFilename} onAdd={onAdd} />}
      </div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
        <input value={search} onChange={e => onSearch(e.target.value)} placeholder="Buscar…"
          style={{ ...addInp }} onFocus={e => e.target.style.borderColor = '#1a2d4f'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
      </div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
        <input value={newVal} onChange={e => onNew(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onAdd(newVal)}
          placeholder={placeholder} style={addInp}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
        <button onClick={() => onAdd(newVal)} disabled={!newVal.trim()} style={addBtn}>+</button>
      </div>
      <div style={colStyle}>
        {loading
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>Carregando…</p>
          : children}
      </div>
    </div>
  )

  return (
    <>
    <GeoCsvBar />
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
      {/* ── Países ── */}
      <Col title="Países" count={countries.length}
        search={searchC} onSearch={setSearchC}
        newVal={newCountry} onNew={setNewCountry} onAdd={addCountry}
        loading={loadingC} placeholder="Novo país…"
        csvItems={null} csvFilename={null}
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
              <button onClick={e => { e.stopPropagation(); delCountry(c.id) }} style={delBtn}
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
        csvItems={null} csvFilename={null}
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
              <button onClick={e => { e.stopPropagation(); delState(s.id) }} style={delBtn}
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
        csvItems={null} csvFilename={null}
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
              <button onClick={() => delCity(c.id)} style={delBtn}
                onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                onMouseLeave={e => e.currentTarget.style.color = '#fca5a5'}>×</button>
            </div>
          ))
        }
      </Col>
    </div>
    </>
  )
}

/* ── Página principal ── */
const TABS = ['Profissões', 'Idiomas', 'Países & Estados']

export default function Settings() {
  const [tab, setTab] = useState(0)
  const [professions, setProfessions] = useState([])
  const [languages,   setLanguages]   = useState([])
  const [loadingP,    setLoadingP]    = useState(true)
  const [loadingL,    setLoadingL]    = useState(true)

  useEffect(() => {
    configApi.professions().then(r => setProfessions(r.data)).catch(() => {}).finally(() => setLoadingP(false))
    configApi.languages().then(r => setLanguages(r.data)).catch(() => {}).finally(() => setLoadingL(false))
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

  return (
    <div>
      <div className="ph">
        <h1 className="ph-title">Configurações</h1>
      </div>

      <div style={{ display: 'flex', gap: 4, padding: '0 24px', borderBottom: '1px solid #e2e8f0', marginBottom: 24 }}>
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} style={{
            padding: '10px 16px', border: 'none', background: 'none',
            fontSize: 13, fontWeight: tab === i ? 700 : 500, cursor: 'pointer',
            color: tab === i ? '#1a2d4f' : '#64748b', fontFamily: 'inherit',
            borderBottom: tab === i ? '2px solid #1a2d4f' : '2px solid transparent',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ padding: '0 24px 40px' }}>
        {tab === 0 && <ItemList items={professions} loading={loadingP} onAdd={addProfession} onDelete={delProfession} placeholder="Nova profissão…" filename="profissoes.csv" />}
        {tab === 1 && <ItemList items={languages}   loading={loadingL} onAdd={addLanguage}   onDelete={delLanguage}   placeholder="Novo idioma…"    filename="idiomas.csv" />}
        {tab === 2 && <CountriesTab />}
      </div>
    </div>
  )
}
