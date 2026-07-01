import { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import { Ic } from './Icon'

const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades'

const statesCache = {}
const citiesCache = {}

async function fetchStates() {
  if (statesCache.data) return statesCache.data
  const r = await axios.get(`${IBGE}/estados?orderBy=nome`)
  statesCache.data = r.data.map(s => ({ name: s.nome, code: s.sigla }))
  return statesCache.data
}

async function fetchCities(uf) {
  if (citiesCache[uf]) return citiesCache[uf]
  const r = await axios.get(`${IBGE}/estados/${uf}/municipios?orderBy=nome`)
  citiesCache[uf] = r.data.map(c => c.nome)
  return citiesCache[uf]
}

/**
 * Picker Estado → Cidade (Brasil)
 * value: "Porto Alegre / RS"
 * onChange: (value) => void
 */
export default function BrazilCityPicker({ value, onChange }) {
  const [open,     setOpen]     = useState(false)
  const [step,     setStep]     = useState('state')  // 'state' | 'city'
  const [search,   setSearch]   = useState('')
  const [loading,  setLoading]  = useState(false)
  const [states,   setStates]   = useState([])
  const [cities,   setCities]   = useState([])
  const [selState, setSelState] = useState(null)
  const overlayRef = useRef(null)
  const searchRef  = useRef(null)

  useEffect(() => {
    if (open) {
      setStep('state'); setSearch(''); setSelState(null)
      setTimeout(() => searchRef.current?.focus(), 80)
      if (states.length === 0) {
        setLoading(true)
        fetchStates().then(setStates).catch(() => {}).finally(() => setLoading(false))
      }
    }
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 60)
  }, [step])

  const pickState = async (s) => {
    setSelState(s); setSearch(''); setStep('city'); setLoading(true)
    try {
      setCities(await fetchCities(s.code))
    } catch {} finally { setLoading(false) }
  }

  const pickCity = (city) => {
    onChange(`${city} / ${selState.code}`)
    setOpen(false)
  }

  const handleOverlay = (e) => { if (e.target === overlayRef.current) setOpen(false) }

  const q = search.toLowerCase()
  const listStates = states.filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
  const listCities = cities.filter(c => c.toLowerCase().includes(q))

  return (
    <>
      <input
        className="fi"
        readOnly
        value={value ?? ''}
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
            zIndex: 500, padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 400,
              boxShadow: '0 24px 64px rgba(0,0,0,.22)',
              display: 'flex', flexDirection: 'column',
              maxHeight: '80vh', animation: 'mIn .15s ease',
            }}
          >
            {/* Header */}
            <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                {step === 'city' && (
                  <button onClick={() => { setStep('state'); setSearch('') }}
                    style={{ fontSize: 13, color: '#2e6db4', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontFamily: 'inherit' }}>
                    ← Voltar
                  </button>
                )}
                {step === 'city' && selState && (
                  <>
                    <span style={{ color: '#cbd5e1' }}>·</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#1e293b' }}>{selState.name}</span>
                  </>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {step === 'state' ? 'Estado' : 'Cidade'}
                </span>
                <button type="button" onClick={() => setOpen(false)} title="Fechar" style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', padding:4, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, flexShrink:0 }}><Ic n="x" s={16}/></button>
              </div>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', display: 'flex' }}>
                  <Ic n="search" s={14} />
                </span>
                <input
                  ref={searchRef}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={step === 'state' ? 'Buscar estado…' : 'Buscar cidade…'}
                  style={{ width: '100%', padding: '7px 11px 7px 31px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b' }}
                  onFocus={e => e.target.style.borderColor = '#2e6db4'}
                  onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
                />
              </div>
            </div>

            {/* Lista */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '28px 0', color: '#94a3b8' }}>
                  <div style={{ width: 20, height: 20, border: '3px solid #e2e8f0', borderTopColor: '#2e6db4', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 8px' }} />
                  <p style={{ fontSize: 13 }}>Carregando…</p>
                </div>
              ) : step === 'state' ? (
                listStates.length === 0
                  ? <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' }}>Nenhum estado encontrado</p>
                  : listStates.map(s => (
                    <Row key={s.code} label={s.name} sub={s.code} hasArrow onClick={() => pickState(s)} />
                  ))
              ) : (
                listCities.length === 0
                  ? <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' }}>Nenhuma cidade encontrada</p>
                  : listCities.map(city => (
                    <Row key={city} label={city} onClick={() => pickCity(city)} />
                  ))
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 16px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
              <button onClick={() => setOpen(false)}
                style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
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

function Row({ label, sub, hasArrow, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer', background: hover ? '#f8fafc' : 'transparent', transition: 'background .1s' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, color: '#1e293b', fontWeight: 400, margin: 0 }}>{label}</p>
        {sub && <p style={{ fontSize: 11.5, color: '#94a3b8', margin: 0, marginTop: 1 }}>{sub}</p>}
      </div>
      {hasArrow && <span style={{ color: '#cbd5e1', fontSize: 14 }}>›</span>}
    </div>
  )
}
