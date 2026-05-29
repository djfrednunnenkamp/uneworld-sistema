import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { Ic } from './Icon'

const RCOUNTRIES = 'https://restcountries.com/v3.1/all?fields=name,cca2,translations'
const IBGE       = 'https://servicodados.ibge.gov.br/api/v1/localidades'
const CNOW       = 'https://countriesnow.space/api/v0.1/countries'

const cache = {}
async function cached(key, fetcher) {
  if (cache[key]) return cache[key]
  cache[key] = await fetcher()
  return cache[key]
}

export default function CountryStatePicker({ country, state, onChangeCountry, onChangeState }) {
  const [open,     setOpen]     = useState(false)
  const [step,     setStep]     = useState('country')
  const [search,   setSearch]   = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [countries, setCountries] = useState([])
  const [states,    setStates]    = useState([])
  const [selCountry, setSelCountry] = useState(null)
  const overlayRef = useRef(null)
  const searchRef  = useRef(null)

  useEffect(() => {
    if (open) {
      setStep('country'); setSearch(''); setError('')
      setSelCountry(null)
      setTimeout(() => searchRef.current?.focus(), 80)
      if (countries.length === 0) loadCountries()
    }
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 60)
  }, [step])

  const loadCountries = async () => {
    setLoading(true); setError('')
    try {
      const data = await cached('countries_csp', async () => {
        const r = await axios.get(RCOUNTRIES)
        return r.data
          .map((c) => ({
            name_pt: c.translations?.por?.common || c.name.common,
            name_en: c.name.common,
            code: c.cca2,
          }))
          .sort((a, b) => a.name_pt.localeCompare(b.name_pt, 'pt'))
      })
      setCountries(data)
    } catch { setError('Erro ao carregar países.') }
    finally  { setLoading(false) }
  }

  const pickCountry = async (c) => {
    setSelCountry(c)
    setSearch(''); setStep('state'); setLoading(true); setError('')
    try {
      let data
      if (c.code === 'BR') {
        data = await cached('BR_states_csp', () =>
          axios.get(`${IBGE}/estados?orderBy=nome`).then((r) =>
            r.data.map((s) => ({ name: s.nome, code: s.sigla }))
          )
        )
      } else {
        data = await cached(`states_csp_${c.name_en}`, () =>
          axios.post(`${CNOW}/states`, { country: c.name_en }).then((r) =>
            (r.data.data?.states ?? [])
              .map((s) => ({ name: s.name, code: s.state_code || '' }))
              .sort((a, b) => a.name.localeCompare(b.name))
          )
        )
      }
      setStates(data)
      if (data.length === 0) setError('Nenhum estado encontrado.')
    } catch { setError('Erro ao carregar estados.') }
    finally  { setLoading(false) }
  }

  const pickState = (s) => {
    onChangeCountry(selCountry.name_pt)
    onChangeState(selCountry.code === 'BR' ? s.code : s.name)
    setOpen(false)
  }

  const handleOverlay = (e) => {
    if (e.target === overlayRef.current) setOpen(false)
  }

  const q = search.toLowerCase()
  const listCountries = countries.filter(
    (c) => c.name_pt.toLowerCase().includes(q) || c.name_en.toLowerCase().includes(q)
  )
  const listStates = states.filter((s) => s.name.toLowerCase().includes(q))

  const fieldValue = [country, state].filter(Boolean).join(' · ')

  return (
    <>
      <input
        className="fi"
        readOnly
        value={fieldValue}
        placeholder="Clique para selecionar…"
        onClick={() => setOpen(true)}
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
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 460,
              boxShadow: '0 24px 64px rgba(0,0,0,.22)',
              display: 'flex', flexDirection: 'column',
              maxHeight: '82vh', animation: 'mIn .15s ease',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>

              {/* Breadcrumb + step label */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                {step === 'state' && (
                  <button
                    onClick={() => { setStep('country'); setSearch('') }}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#2e6db4', fontSize: 13, cursor: 'pointer', padding: '2px 4px', borderRadius: 4, fontFamily: 'inherit' }}
                  >
                    ← Voltar
                  </button>
                )}
                {step === 'state' && selCountry && (
                  <>
                    <span style={{ color: '#cbd5e1', fontSize: 13 }}>·</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#1e293b' }}>{selCountry.name_pt}</span>
                  </>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {step === 'country' ? 'País' : 'Estado / Região'}
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
                  placeholder={step === 'country' ? 'Buscar país…' : 'Buscar estado…'}
                  style={{
                    width: '100%', padding: '7px 11px 7px 31px',
                    border: '1px solid #e2e8f0', borderRadius: 6,
                    fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b',
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
                  <div style={{ width: 22, height: 22, border: '3px solid #e2e8f0', borderTopColor: '#2e6db4', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 8px' }} />
                  <p style={{ fontSize: 13 }}>Carregando…</p>
                </div>
              ) : error ? (
                <p style={{ textAlign: 'center', color: '#dc2626', fontSize: 13, padding: '24px 0' }}>{error}</p>
              ) : step === 'country' ? (
                listCountries.length === 0
                  ? <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '24px 0' }}>Nenhum país encontrado</p>
                  : listCountries.map((c) => (
                    <Row
                      key={c.code}
                      label={c.name_pt}
                      sub={c.name_en !== c.name_pt ? c.name_en : ''}
                      selected={country === c.name_pt}
                      hasArrow
                      onClick={() => pickCountry(c)}
                    />
                  ))
              ) : (
                listStates.length === 0
                  ? <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '24px 0' }}>Nenhum estado encontrado</p>
                  : listStates.map((s) => (
                    <Row
                      key={s.code || s.name}
                      label={s.name}
                      sub={s.code}
                      selected={state === s.code || state === s.name}
                      onClick={() => pickState(s)}
                    />
                  ))
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
              <button
                onClick={() => setOpen(false)}
                style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  )
}

function Row({ label, sub, selected, hasArrow, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 18px', cursor: 'pointer',
        background: selected ? '#f0f6ff' : hover ? '#f8fafc' : 'transparent',
        transition: 'background .1s',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, color: selected ? '#2e6db4' : '#1e293b', fontWeight: selected ? 600 : 400, margin: 0 }}>{label}</p>
        {sub && <p style={{ fontSize: 11.5, color: '#94a3b8', margin: 0, marginTop: 1 }}>{sub}</p>}
      </div>
      {selected && <span style={{ color: '#2e6db4', flexShrink: 0 }}><Ic n="check" s={14} /></span>}
      {!selected && hasArrow && <span style={{ color: '#cbd5e1', flexShrink: 0, fontSize: 12 }}>›</span>}
    </div>
  )
}
