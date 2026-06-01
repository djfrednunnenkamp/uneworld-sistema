import { useState, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'
import { configApi } from '../api'
import { Ic } from '../components/Icon'

/* ── Estilos compartilhados ── */
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
const btnSec = {
  padding: '8px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0',
  background: '#fff', color: '#475569', fontSize: 13, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'inherit',
}

/* ── Lista genérica (Profissões / Idiomas) ── */
function SimpleList({ items, loading, onDelete, onAdd, onImport, importing, placeholder }) {
  const [search, setSearch] = useState('')
  const [newVal, setNewVal] = useState('')
  const [adding, setAdding] = useState(false)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return items.filter(i => i.name.toLowerCase().includes(q))
  }, [items, search])

  const handleAdd = async () => {
    const v = newVal.trim()
    if (!v) return
    setAdding(true)
    try {
      await onAdd(v)
      setNewVal('')
    } finally { setAdding(false) }
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar…"
          style={{ ...inp, flex: 1, minWidth: 180 }}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'}
          onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
        />
        <button
          onClick={onImport}
          disabled={importing}
          style={{ ...btnSec, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Ic n="dl" s={13} />
          {importing ? 'Importando…' : 'Importar padrão'}
        </button>
      </div>

      {/* Adicionar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={newVal}
          onChange={e => setNewVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder={placeholder}
          style={{ ...inp, flex: 1 }}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'}
          onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
        />
        <button onClick={handleAdd} disabled={adding || !newVal.trim()} style={btnPri}>
          + Adicionar
        </button>
      </div>

      {/* Contagem */}
      <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px' }}>
        {loading ? 'Carregando…' : `${filtered.length} de ${items.length} item${items.length !== 1 ? 's' : ''}`}
      </p>

      {/* Lista */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', maxHeight: 460, overflowY: 'auto' }}>
        {loading ? (
          <p style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 13 }}>Carregando…</p>
        ) : filtered.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 13 }}>
            {items.length === 0 ? 'Nenhum item ainda. Clique em "Importar padrão" para começar.' : 'Nenhum resultado.'}
          </p>
        ) : filtered.map((item, idx) => (
          <div key={item.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '9px 14px', fontSize: 13, color: '#0f172a',
            borderBottom: idx < filtered.length - 1 ? '1px solid #f1f5f9' : 'none',
            background: '#fff',
          }}
            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
            onMouseLeave={e => e.currentTarget.style.background = '#fff'}
          >
            <span>{item.name}</span>
            <button
              onClick={() => onDelete(item.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 16, lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
              onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
              onMouseLeave={e => e.currentTarget.style.color = '#fca5a5'}
              title="Remover"
            >×</button>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Aba de Países com gerenciamento de Estados ── */
function CountriesTab() {
  const [countries,    setCountries]    = useState([])
  const [selCountry,   setSelCountry]   = useState(null)
  const [states,       setStates]       = useState([])
  const [loadingC,     setLoadingC]     = useState(true)
  const [loadingS,     setLoadingS]     = useState(false)
  const [importingC,   setImportingC]   = useState(false)
  const [importingS,   setImportingS]   = useState(false)
  const [searchC,      setSearchC]      = useState('')
  const [searchS,      setSearchS]      = useState('')
  const [newCountry,   setNewCountry]   = useState('')
  const [newState,     setNewState]     = useState('')

  const loadCountries = () => {
    setLoadingC(true)
    configApi.countries().then(r => setCountries(r.data)).catch(() => {}).finally(() => setLoadingC(false))
  }

  const loadStates = (country) => {
    setSelCountry(country); setStates([]); setLoadingS(true)
    configApi.states(country.id).then(r => setStates(r.data)).catch(() => {}).finally(() => setLoadingS(false))
  }

  useEffect(() => { loadCountries() }, [])

  const importCountries = async () => {
    setImportingC(true)
    try {
      const r = await configApi.importCountries()
      toast.success(`${r.data.created} país(es) adicionado(s). Total: ${r.data.total}`)
      loadCountries()
    } catch { toast.error('Erro ao importar países.') }
    finally { setImportingC(false) }
  }

  const importStates = async () => {
    if (!selCountry) return
    setImportingS(true)
    try {
      const r = await configApi.importStates(selCountry.id)
      toast.success(`${r.data.created} estado(s) adicionado(s). Total: ${r.data.total}`)
      loadStates(selCountry)
    } catch { toast.error('Erro ao importar estados.') }
    finally { setImportingS(false) }
  }

  const addCountry = async () => {
    const name = newCountry.trim()
    if (!name) return
    try {
      await configApi.addCountry(name, '')
      setNewCountry('')
      loadCountries()
    } catch { toast.error('Erro ao adicionar país.') }
  }

  const delCountry = async (id) => {
    try {
      await configApi.delCountry(id)
      if (selCountry?.id === id) { setSelCountry(null); setStates([]) }
      loadCountries()
    } catch { toast.error('Erro ao remover país.') }
  }

  const addState = async () => {
    const name = newState.trim()
    if (!name || !selCountry) return
    try {
      await configApi.addState(selCountry.id, name, '')
      setNewState('')
      loadStates(selCountry)
    } catch { toast.error('Erro ao adicionar estado.') }
  }

  const delState = async (id) => {
    try {
      await configApi.delState(id)
      setStates(s => s.filter(x => x.id !== id))
    } catch { toast.error('Erro ao remover estado.') }
  }

  const filteredC = useMemo(() => {
    const q = searchC.toLowerCase()
    return countries.filter(c => c.name.toLowerCase().includes(q))
  }, [countries, searchC])

  const filteredS = useMemo(() => {
    const q = searchS.toLowerCase()
    return states.filter(s => s.name.toLowerCase().includes(q))
  }, [states, searchS])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      {/* Países */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>
            Países <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400 }}>({countries.length})</span>
          </h3>
          <button onClick={importCountries} disabled={importingC} style={{ ...btnSec, fontSize: 12, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Ic n="dl" s={12} />{importingC ? 'Importando…' : 'Importar padrão'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input value={searchC} onChange={e => setSearchC(e.target.value)} placeholder="Buscar país…" style={{ ...inp, flex: 1, fontSize: 12 }}
            onFocus={e => e.target.style.borderColor = '#1a2d4f'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input value={newCountry} onChange={e => setNewCountry(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCountry()}
            placeholder="Nome do país…" style={{ ...inp, flex: 1, fontSize: 12 }}
            onFocus={e => e.target.style.borderColor = '#1a2d4f'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
          <button onClick={addCountry} disabled={!newCountry.trim()} style={{ ...btnPri, fontSize: 12, padding: '7px 12px' }}>+</button>
        </div>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', maxHeight: 420, overflowY: 'auto' }}>
          {loadingC ? (
            <p style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 13 }}>Carregando…</p>
          ) : filteredC.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 12 }}>
              {countries.length === 0 ? 'Clique em "Importar padrão".' : 'Nenhum resultado.'}
            </p>
          ) : filteredC.map((c, idx) => (
            <div key={c.id}
              onClick={() => loadStates(c)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                borderBottom: idx < filteredC.length - 1 ? '1px solid #f1f5f9' : 'none',
                background: selCountry?.id === c.id ? '#f0f6ff' : '#fff',
                borderLeft: selCountry?.id === c.id ? '3px solid #2e6db4' : '3px solid transparent',
              }}
              onMouseEnter={e => { if (selCountry?.id !== c.id) e.currentTarget.style.background = '#f8fafc' }}
              onMouseLeave={e => { e.currentTarget.style.background = selCountry?.id === c.id ? '#f0f6ff' : '#fff' }}
            >
              <span style={{ fontWeight: selCountry?.id === c.id ? 600 : 400, color: selCountry?.id === c.id ? '#2e6db4' : '#0f172a' }}>
                {c.name}
                {c.state_count > 0 && <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>{c.state_count} estados</span>}
              </span>
              <button onClick={e => { e.stopPropagation(); delCountry(c.id) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 15, lineHeight: 1, padding: '2px 4px' }}
                onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                onMouseLeave={e => e.currentTarget.style.color = '#fca5a5'}
              >×</button>
            </div>
          ))}
        </div>
      </div>

      {/* Estados */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>
            {selCountry ? <>Estados — <span style={{ color: '#2e6db4' }}>{selCountry.name}</span></> : 'Estados'}
            {selCountry && <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400, marginLeft: 6 }}>({states.length})</span>}
          </h3>
          {selCountry && (
            <button onClick={importStates} disabled={importingS} style={{ ...btnSec, fontSize: 12, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Ic n="dl" s={12} />{importingS ? 'Importando…' : 'Importar estados'}
            </button>
          )}
        </div>
        {!selCountry ? (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '40px 0', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: '#94a3b8' }}>← Selecione um país para ver os estados</p>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input value={searchS} onChange={e => setSearchS(e.target.value)} placeholder="Buscar estado…" style={{ ...inp, flex: 1, fontSize: 12 }}
                onFocus={e => e.target.style.borderColor = '#1a2d4f'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <input value={newState} onChange={e => setNewState(e.target.value)} onKeyDown={e => e.key === 'Enter' && addState()}
                placeholder="Nome do estado…" style={{ ...inp, flex: 1, fontSize: 12 }}
                onFocus={e => e.target.style.borderColor = '#1a2d4f'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
              <button onClick={addState} disabled={!newState.trim()} style={{ ...btnPri, fontSize: 12, padding: '7px 12px' }}>+</button>
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', maxHeight: 360, overflowY: 'auto' }}>
              {loadingS ? (
                <p style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 13 }}>Carregando…</p>
              ) : filteredS.length === 0 ? (
                <p style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 12 }}>
                  {states.length === 0 ? 'Clique em "Importar estados".' : 'Nenhum resultado.'}
                </p>
              ) : filteredS.map((s, idx) => (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', fontSize: 13, color: '#0f172a',
                  borderBottom: idx < filteredS.length - 1 ? '1px solid #f1f5f9' : 'none', background: '#fff',
                }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                >
                  <span>{s.name}{s.code && <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>{s.code}</span>}</span>
                  <button onClick={() => delState(s.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 15, lineHeight: 1, padding: '2px 4px' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                    onMouseLeave={e => e.currentTarget.style.color = '#fca5a5'}
                  >×</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ── Página principal ── */
const TABS = ['Profissões', 'Idiomas', 'Países & Estados']

export default function Settings() {
  const [tab, setTab] = useState(0)

  const [professions,  setProfessions]  = useState([])
  const [languages,    setLanguages]    = useState([])
  const [loadingP,     setLoadingP]     = useState(true)
  const [loadingL,     setLoadingL]     = useState(true)
  const [importingP,   setImportingP]   = useState(false)
  const [importingL,   setImportingL]   = useState(false)

  useEffect(() => {
    configApi.professions().then(r => setProfessions(r.data)).finally(() => setLoadingP(false))
    configApi.languages().then(r => setLanguages(r.data)).finally(() => setLoadingL(false))
  }, [])

  const importProfessions = async () => {
    setImportingP(true)
    try {
      const r = await configApi.importProfessions()
      toast.success(`${r.data.created} profissão(ões) adicionada(s). Total: ${r.data.total}`)
      const fresh = await configApi.professions()
      setProfessions(fresh.data)
    } catch { toast.error('Erro ao importar. Verifique sua conexão.') }
    finally { setImportingP(false) }
  }

  const importLanguages = async () => {
    setImportingL(true)
    try {
      const r = await configApi.importLanguages()
      toast.success(`${r.data.created} idioma(s) adicionado(s). Total: ${r.data.total}`)
      const fresh = await configApi.languages()
      setLanguages(fresh.data)
    } catch { toast.error('Erro ao importar idiomas.') }
    finally { setImportingL(false) }
  }

  const addProfession = async (name) => {
    try {
      const r = await configApi.addProfession(name)
      setProfessions(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar profissão.') }
  }

  const delProfession = async (id) => {
    try {
      await configApi.delProfession(id)
      setProfessions(p => p.filter(x => x.id !== id))
    } catch { toast.error('Erro ao remover profissão.') }
  }

  const addLanguage = async (name) => {
    try {
      const r = await configApi.addLanguage(name)
      setLanguages(l => [...l, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar idioma.') }
  }

  const delLanguage = async (id) => {
    try {
      await configApi.delLanguage(id)
      setLanguages(l => l.filter(x => x.id !== id))
    } catch { toast.error('Erro ao remover idioma.') }
  }

  return (
    <div>
      {/* Header */}
      <div className="ph">
        <h1 className="ph-title">Configurações</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '0 24px', borderBottom: '1px solid #e2e8f0', marginBottom: 24 }}>
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} style={{
            padding: '10px 16px', border: 'none', background: 'none',
            fontSize: 13, fontWeight: tab === i ? 700 : 500, cursor: 'pointer',
            color: tab === i ? '#1a2d4f' : '#64748b', fontFamily: 'inherit',
            borderBottom: tab === i ? '2px solid #1a2d4f' : '2px solid transparent',
            transition: 'color .15s',
          }}>{t}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '0 24px 40px' }}>
        {tab === 0 && (
          <SimpleList
            items={professions}
            loading={loadingP}
            onAdd={addProfession}
            onDelete={delProfession}
            onImport={importProfessions}
            importing={importingP}
            placeholder="Nova profissão…"
          />
        )}
        {tab === 1 && (
          <SimpleList
            items={languages}
            loading={loadingL}
            onAdd={addLanguage}
            onDelete={delLanguage}
            onImport={importLanguages}
            importing={importingL}
            placeholder="Novo idioma…"
          />
        )}
        {tab === 2 && <CountriesTab />}
      </div>
    </div>
  )
}
