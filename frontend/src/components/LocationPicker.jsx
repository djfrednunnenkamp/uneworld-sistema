import { useState, useEffect, useRef, useMemo } from 'react'
import { configApi } from '../api'

const cache = {}
async function cached(key, fetcher) {
  if (cache[key]) return cache[key]
  const result = await fetcher()
  cache[key] = result
  return result
}

export default function LocationPicker({ value, onChange }) {
  const [open,       setOpen]       = useState(false)
  const [step,       setStep]       = useState('country')
  const [search,     setSearch]     = useState('')
  const [loading,    setLoading]    = useState(false)
  const [countries,  setCountries]  = useState([])
  const [states,     setStates]     = useState([])
  const [cities,     setCities]     = useState([])
  const [selCountry, setSelCountry] = useState(null)
  const [selState,   setSelState]   = useState(null)

  const [highlighted, setHighlighted] = useState(-1)
  const wrapRef   = useRef(null)
  const inputRef  = useRef(null)
  const listRef   = useRef(null)

  /* fecha ao clicar fora — usa fase de captura: ao escolher um item, o passo
     muda (ex.: estado → cidade) e a lista é re-renderizada antes da fase de
     bolha chegar ao document, removendo o elemento clicado do DOM e fazendo
     o "contains" abaixo retornar falso (fechando o popup por engano) */
  useEffect(() => {
    const h = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', h, true)
    return () => document.removeEventListener('mousedown', h, true)
  }, [])

  /* carrega países na primeira abertura */
  useEffect(() => {
    if (open && countries.length === 0) loadCountries()
  }, [open])

  const reset = () => {
    setStep('country'); setSearch('')
    setSelCountry(null); setSelState(null)
    setHighlighted(-1)
  }

  const loadCountries = async () => {
    setLoading(true)
    try {
      const data = await cached('countries_loc', async () => {
        const r = await configApi.countries()
        return r.data.map(c => ({ id: c.id, name_pt: c.name, name_en: c.name, code: c.code }))
      })
      setCountries(data)
    } finally { setLoading(false) }
  }

  const pickCountry = async (country) => {
    setSelCountry(country); setSelState(null)
    setSearch(''); setStep('state'); setLoading(true)
    try {
      const data = await cached(`states_loc_${country.id}`, async () => {
        const r = await configApi.states(country.id)
        return r.data.map(s => ({ id: s.id, name: s.name, code: s.code }))
      })
      setStates(data)
      if (data.length === 0) {
        onChange(country.name_pt)
        setOpen(false); reset()
      }
    } finally { setLoading(false) }
  }

  const pickState = async (state) => {
    setSelState(state)
    setSearch(''); setStep('city'); setLoading(true)
    try {
      const data = await cached(`cities_${state.id}`, async () => {
        const r = await configApi.cities(state.id)
        return r.data.map(c => c.name)
      })
      setCities(data)
      if (data.length === 0) {
        onChange([state.name, selCountry.name_pt].join(', '))
        setOpen(false); reset()
      }
    } finally { setLoading(false) }
  }

  const pickCity = (city) => {
    onChange([city, selState?.name, selCountry?.name_pt].filter(Boolean).join(', '))
    setOpen(false); reset()
  }

  const back = () => {
    setSearch('')
    if (step === 'city')  { setStep('state');   return }
    if (step === 'state') { setStep('country');  return }
  }

  const q = search.toLowerCase()
  const listCountries = useMemo(() =>
    countries.filter((c) => c.name_pt.toLowerCase().includes(q) || c.name_en.toLowerCase().includes(q))
  , [countries, q])
  const listStates = useMemo(() => states.filter((s) => s.name.toLowerCase().includes(q)), [states, q])
  const listCities = useMemo(() => cities.filter((c) => c.toLowerCase().includes(q)).slice(0, 120), [cities, q])

  const STEP_LABEL = { country: 'País', state: 'Estado / Região', city: 'Cidade' }

  const handleFocus = () => { setOpen(true); setSearch('') }
  const handleChange = (e) => { setOpen(true); setSearch(e.target.value); setHighlighted(-1) }

  const activeList = step === 'country' ? listCountries : step === 'state' ? listStates : listCities

  useEffect(() => { setHighlighted(-1) }, [search, step])
  useEffect(() => {
    if (listRef.current && highlighted >= 0) {
      listRef.current.children[highlighted]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlighted])

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {/* Campo editável */}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          className="fi"
          value={open ? search : (value || '')}
          onChange={handleChange}
          onFocus={handleFocus}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false) }
            if (e.key === 'Backspace' && !search && step !== 'country') back()
            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, activeList.length - 1)) }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)) }
            if (e.key === 'Enter' && activeList.length > 0) {
              e.preventDefault()
              const idx  = highlighted >= 0 ? highlighted : 0
              if (step === 'country') pickCountry(listCountries[idx])
              else if (step === 'state') pickState(listStates[idx])
              else if (step === 'city')  pickCity(listCities[idx])
            }
          }}
          placeholder="Digite para buscar…"
          style={{ paddingRight: value && !open ? 28 : undefined }}
        />
        {value && !open && (
          <button
            onMouseDown={(e) => { e.preventDefault(); onChange(''); reset() }}
            style={{
              position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#94a3b8', fontSize: 16, lineHeight: 1, padding: 2,
            }}
          >×</button>
        )}
      </div>

      {/* Dropdown inline */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0,
          background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 8,
          boxShadow: '0 8px 28px rgba(0,0,0,.14)', zIndex: 400,
          display: 'flex', flexDirection: 'column', maxHeight: 280,
        }}>
          {/* Breadcrumb */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 12px 5px', borderBottom: '1px solid #f1f5f9', flexShrink: 0,
          }}>
            {step !== 'country' && (
              <button
                onMouseDown={(e) => { e.preventDefault(); back() }}
                style={{
                  background: 'none', border: 'none', color: '#2e6db4',
                  fontSize: 12, cursor: 'pointer', padding: '1px 4px', borderRadius: 4,
                  fontFamily: 'inherit', fontWeight: 600,
                }}
              >← Voltar</button>
            )}
            {selCountry && (
              <span
                onMouseDown={(e) => { e.preventDefault(); setStep('country'); setSearch('') }}
                style={{ fontSize: 12, color: step === 'country' ? '#1e293b' : '#2e6db4', cursor: step !== 'country' ? 'pointer' : 'default', fontWeight: 500 }}
              >{selCountry.name_pt}</span>
            )}
            {selState && (
              <>
                <span style={{ color: '#cbd5e1', fontSize: 12 }}>›</span>
                <span
                  onMouseDown={(e) => { e.preventDefault(); setStep('state'); setSearch('') }}
                  style={{ fontSize: 12, color: step === 'state' ? '#1e293b' : '#2e6db4', cursor: step !== 'state' ? 'pointer' : 'default', fontWeight: 500 }}
                >{selState.name}</span>
              </>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              {STEP_LABEL[step]}
            </span>
          </div>

          {/* Lista */}
          <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 13, margin: 0 }}>Carregando…</p>
            ) : step === 'country' ? (
              listCountries.length === 0
                ? <p style={{ padding: '12px 14px', fontSize: 13, color: '#94a3b8', margin: 0 }}>Nenhum país encontrado</p>
                : listCountries.map((c, idx) => (
                  <div key={c.code}
                    onMouseDown={(e) => { e.preventDefault(); pickCountry(c) }}
                    onMouseEnter={() => setHighlighted(idx)}
                    onMouseLeave={() => setHighlighted(-1)}
                    style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13, color: '#1e293b', background: idx === highlighted ? '#e8f0fe' : 'transparent' }}
                  >
                    {c.name_pt}
                    {c.name_en !== c.name_pt && <span style={{ color: '#94a3b8', fontSize: 11.5, marginLeft: 6 }}>{c.name_en}</span>}
                  </div>
                ))
            ) : step === 'state' ? (
              listStates.length === 0
                ? <p style={{ padding: '12px 14px', fontSize: 13, color: '#94a3b8', margin: 0 }}>Nenhum estado encontrado</p>
                : listStates.map((s, idx) => (
                  <div key={s.code || s.name}
                    onMouseDown={(e) => { e.preventDefault(); pickState(s) }}
                    onMouseEnter={() => setHighlighted(idx)}
                    onMouseLeave={() => setHighlighted(-1)}
                    style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13, color: '#1e293b', background: idx === highlighted ? '#e8f0fe' : 'transparent' }}
                  >
                    {s.name}
                    {s.code && <span style={{ color: '#94a3b8', fontSize: 11.5, marginLeft: 6 }}>{s.code}</span>}
                  </div>
                ))
            ) : (
              listCities.length === 0
                ? <p style={{ padding: '12px 14px', fontSize: 13, color: '#94a3b8', margin: 0 }}>Nenhuma cidade encontrada</p>
                : listCities.map((city, idx) => (
                  <div key={city}
                    onMouseDown={(e) => { e.preventDefault(); pickCity(city) }}
                    onMouseEnter={() => setHighlighted(idx)}
                    onMouseLeave={() => setHighlighted(-1)}
                    style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13, color: '#1e293b', background: idx === highlighted ? '#e8f0fe' : 'transparent' }}
                  >
                    {city}
                  </div>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
