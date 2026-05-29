import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { Ic } from './Icon'

const IBGE  = 'https://servicodados.ibge.gov.br/api/v1/localidades'
const CNOW  = 'https://countriesnow.space/api/v0.1/countries'
const RCOUNTRIES = 'https://restcountries.com/v3.1/all?fields=name,cca2,translations'

/* Cache para evitar requests repetidas */
const cache = {}

async function cached(key, fetcher) {
  if (cache[key]) return cache[key]
  const result = await fetcher()
  cache[key] = result
  return result
}

export default function LocationPicker({ value, onChange }) {
  const [open,     setOpen]     = useState(false)
  const [step,     setStep]     = useState('country') // 'country' | 'state' | 'city'
  const [search,   setSearch]   = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [countries, setCountries] = useState([])
  const [states,    setStates]    = useState([])
  const [cities,    setCities]    = useState([])
  const [selCountry, setSelCountry] = useState(null)
  const [selState,   setSelState]   = useState(null)
  const overlayRef = useRef(null)
  const searchRef  = useRef(null)

  /* Foca na busca ao abrir */
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 80)
      if (countries.length === 0) loadCountries()
    }
  }, [open])

  /* ── Carrega países ── */
  const loadCountries = async () => {
    setLoading(true); setError('')
    try {
      const data = await cached('countries', async () => {
        const r = await axios.get(RCOUNTRIES)
        return r.data
          .map((c) => ({
            name_en: c.name.common,
            name_pt: c.translations?.por?.common || c.name.common,
            code: c.cca2,
          }))
          .sort((a, b) => a.name_pt.localeCompare(b.name_pt, 'pt'))
      })
      setCountries(data)
    } catch { setError('Erro ao carregar países.') }
    finally  { setLoading(false) }
  }

  /* ── Seleciona país → carrega estados ── */
  const pickCountry = async (country) => {
    setSelCountry(country); setSelState(null)
    setSearch(''); setStep('state'); setLoading(true); setError('')
    try {
      let data
      if (country.code === 'BR') {
        const r = await cached('BR_states', () =>
          axios.get(`${IBGE}/estados?orderBy=nome`).then((r) =>
            r.data.map((s) => ({ name: s.nome, code: s.sigla }))
          )
        )
        data = r
      } else {
        const r = await cached(`states_${country.name_en}`, () =>
          axios.post(`${CNOW}/states`, { country: country.name_en }).then((r) =>
            (r.data.data?.states ?? [])
              .map((s) => ({ name: s.name, code: s.state_code }))
              .sort((a, b) => a.name.localeCompare(b.name))
          )
        )
        data = r
      }
      setStates(data)
      if (data.length === 0) setError('Nenhum estado encontrado.')
    } catch { setError('Erro ao carregar estados.') }
    finally  { setLoading(false) }
  }

  /* ── Seleciona estado → carrega cidades ── */
  const pickState = async (state) => {
    setSelState(state)
    setSearch(''); setStep('city'); setLoading(true); setError('')
    try {
      let data
      if (selCountry.code === 'BR') {
        data = await cached(`BR_cities_${state.code}`, () =>
          axios.get(`${IBGE}/estados/${state.code}/municipios?orderBy=nome`)
            .then((r) => r.data.map((c) => c.nome))
        )
      } else {
        data = await cached(`cities_${selCountry.name_en}_${state.name}`, () =>
          axios.post(`${CNOW}/state/cities`, {
            country: selCountry.name_en,
            state:   state.name,
          }).then((r) => (r.data.data ?? []).sort())
        )
      }
      setCities(data)
      if (data.length === 0) setError('Nenhuma cidade encontrada.')
    } catch { setError('Erro ao carregar cidades.') }
    finally  { setLoading(false) }
  }

  /* ── Seleciona cidade → preenche campo ── */
  const pickCity = (city) => {
    const parts = [city, selState?.name, selCountry?.name_pt].filter(Boolean)
    onChange(parts.join(', '))
    setOpen(false)
    reset()
  }

  /* ── Navega de volta ── */
  const back = () => {
    setSearch(''); setError('')
    if (step === 'city')    { setStep('state');   return }
    if (step === 'state')   { setStep('country'); return }
  }

  const reset = () => {
    setStep('country'); setSearch(''); setError('')
    setSelCountry(null); setSelState(null)
  }

  /* ── Fecha ao clicar fora ── */
  const handleOverlay = (e) => {
    if (e.target === overlayRef.current) { setOpen(false); reset() }
  }

  /* ── Filtra lista atual ── */
  const q = search.toLowerCase()
  const listCountries = countries.filter(
    (c) => c.name_pt.toLowerCase().includes(q) || c.name_en.toLowerCase().includes(q)
  )
  const listStates = states.filter((s) => s.name.toLowerCase().includes(q))
  const listCities = cities.filter((c) => c.toLowerCase().includes(q))

  /* ── Labels do breadcrumb ── */
  const STEP_LABEL = { country: 'País', state: 'Estado / Região', city: 'Cidade' }

  return (
    <>
      {/* Campo — clicável */}
      <input
        className="fi"
        readOnly
        value={value || ''}
        placeholder="Clique para selecionar…"
        onClick={() => { setOpen(true) }}
        style={{ cursor: 'pointer', caretColor: 'transparent' }}
      />

      {open && (
        <div
          ref={overlayRef}
          onClick={handleOverlay}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15,23,42,.42)',
            backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 400, padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 480,
              boxShadow: '0 24px 64px rgba(0,0,0,.22)',
              display: 'flex', flexDirection: 'column',
              maxHeight: '82vh', animation: 'mIn .15s ease',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>

              {/* Breadcrumb */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                {step !== 'country' && (
                  <button
                    onClick={back}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      background: 'none', border: 'none', color: '#2e6db4',
                      fontSize: 13, cursor: 'pointer', padding: '2px 4px',
                      borderRadius: 4, fontFamily: 'inherit',
                    }}
                  >
                    <Ic n="logout" s={13} style={{ transform: 'rotate(180deg)' }} />
                    Voltar
                  </button>
                )}
                {step !== 'country' && <span style={{ color: '#cbd5e1', fontSize: 13 }}>·</span>}
                {selCountry && (
                  <>
                    <span
                      onClick={() => { setStep('country'); setSearch('') }}
                      style={{ fontSize: 13, color: step === 'country' ? '#1e293b' : '#2e6db4', cursor: step !== 'country' ? 'pointer' : 'default', fontWeight: 500 }}
                    >
                      {selCountry.name_pt}
                    </span>
                    {selState && <span style={{ color: '#cbd5e1' }}>›</span>}
                  </>
                )}
                {selState && (
                  <span
                    onClick={() => { setStep('state'); setSearch('') }}
                    style={{ fontSize: 13, color: step === 'state' ? '#1e293b' : '#2e6db4', cursor: step !== 'state' ? 'pointer' : 'default', fontWeight: 500 }}
                  >
                    {selState.name}
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {STEP_LABEL[step]}
                </span>
              </div>

              {/* Busca */}
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', display: 'flex' }}>
                  <Ic n="search" s={14} />
                </span>
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Buscar ${STEP_LABEL[step].toLowerCase()}…`}
                  style={{
                    width: '100%', padding: '7px 11px 7px 31px',
                    border: '1px solid #e2e8f0', borderRadius: 6,
                    fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b',
                    transition: 'border-color .12s',
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#2e6db4'}
                  onBlur={(e)  => e.target.style.borderColor = '#e2e8f0'}
                />
              </div>
            </div>

            {/* Lista */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8' }}>
                  <div style={{ width: 24, height: 24, border: '3px solid #e2e8f0', borderTopColor: '#2e6db4', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 8px' }} />
                  Carregando…
                </div>
              ) : error ? (
                <p style={{ textAlign: 'center', padding: '24px 0', color: '#dc2626', fontSize: 13 }}>{error}</p>
              ) : step === 'country' ? (
                listCountries.length === 0
                  ? <p style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 13 }}>Nenhum país encontrado</p>
                  : listCountries.map((c) => (
                    <Row
                      key={c.code}
                      label={c.name_pt}
                      sub={c.name_en !== c.name_pt ? c.name_en : ''}
                      hasArrow
                      onClick={() => pickCountry(c)}
                    />
                  ))
              ) : step === 'state' ? (
                listStates.length === 0
                  ? <p style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 13 }}>Nenhum estado encontrado</p>
                  : listStates.map((s) => (
                    <Row key={s.code || s.name} label={s.name} sub={s.code} hasArrow onClick={() => pickState(s)} />
                  ))
              ) : (
                listCities.length === 0
                  ? <p style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 13 }}>Nenhuma cidade encontrada</p>
                  : listCities.map((city) => (
                    <Row key={city} label={city} onClick={() => pickCity(city)} />
                  ))
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
              <button
                onClick={() => { setOpen(false); reset() }}
                style={{
                  padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0',
                  background: '#fff', color: '#475569', fontSize: 13,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  )
}

function Row({ label, sub, hasArrow, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 18px', cursor: 'pointer',
        background: hover ? '#f8fafc' : 'transparent',
        transition: 'background .1s',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, color: '#1e293b', margin: 0, fontWeight: 450 }}>{label}</p>
        {sub && <p style={{ fontSize: 11.5, color: '#94a3b8', margin: 0, marginTop: 1 }}>{sub}</p>}
      </div>
      {hasArrow && (
        <span style={{ color: '#cbd5e1', flexShrink: 0, transform: 'rotate(180deg)' }}>
          <Ic n="logout" s={14} />
        </span>
      )}
    </div>
  )
}
