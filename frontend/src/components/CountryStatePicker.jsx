import { useState, useEffect, useRef, useMemo } from 'react'
import { configApi } from '../api'

const cache = {}
async function cached(key, fetcher) {
  if (cache[key]) return cache[key]
  cache[key] = await fetcher()
  return cache[key]
}

export default function CountryStatePicker({ country, state, onChangeCountry, onChangeState }) {
  const [open,       setOpen]       = useState(false)
  const [step,       setStep]       = useState('country')
  const [search,     setSearch]     = useState('')
  const [loading,    setLoading]    = useState(false)
  const [countries,  setCountries]  = useState([])
  const [states,     setStates]     = useState([])
  const [selCountry, setSelCountry] = useState(null)
  const [highlighted, setHighlighted] = useState(-1)

  const wrapRef  = useRef(null)
  const inputRef = useRef(null)
  const listRef  = useRef(null)

  /* fecha ao clicar fora */
  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => { setHighlighted(-1) }, [search, step])
  useEffect(() => {
    if (listRef.current && highlighted >= 0) {
      listRef.current.children[highlighted]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlighted])

  /* carrega países na primeira abertura */
  useEffect(() => {
    if (open && countries.length === 0) loadCountries()
  }, [open])

  const loadCountries = async () => {
    setLoading(true)
    try {
      const data = await cached('countries_csp', async () => {
        const r = await configApi.countries()
        return r.data.map(c => ({ id: c.id, name_pt: c.name, name_en: c.name, code: c.code }))
      })
      setCountries(data)
    } finally { setLoading(false) }
  }

  const pickCountry = async (c) => {
    setSelCountry(c)
    setSearch(''); setStep('state'); setLoading(true)
    try {
      const data = await cached(`states_csp_${c.id}`, async () => {
        const r = await configApi.states(c.id)
        return r.data.map(s => ({ name: s.name, code: s.code }))
      })
      setStates(data)
      if (data.length === 0) {
        onChangeCountry(c.name_pt); onChangeState('')
        setOpen(false); setStep('country')
      }
    } finally { setLoading(false) }
  }

  const pickState = (s) => {
    onChangeCountry(selCountry.name_pt)
    onChangeState(s.code || s.name)
    setOpen(false); setStep('country')
  }

  const back = () => { setSearch(''); setStep('country') }

  const q = search.toLowerCase()
  const listCountries = useMemo(
    () => countries.filter(c => c.name_pt.toLowerCase().includes(q) || c.name_en.toLowerCase().includes(q)),
    [countries, q]
  )
  const listStates = useMemo(
    () => states.filter(s => s.name.toLowerCase().includes(q)),
    [states, q]
  )

  const activeList = step === 'country' ? listCountries : listStates
  const fieldValue = [country, state].filter(Boolean).join(' · ')

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') setOpen(false)
    if (e.key === 'Backspace' && !search && step === 'state') back()
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, activeList.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)) }
    if (e.key === 'Enter' && activeList.length > 0) {
      e.preventDefault()
      const idx = highlighted >= 0 ? highlighted : 0
      if (step === 'country') pickCountry(listCountries[idx])
      else                    pickState(listStates[idx])
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          className="fi"
          value={open ? search : fieldValue}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); setHighlighted(-1) }}
          onFocus={() => { setSearch(''); setOpen(true) }}
          onKeyDown={handleKeyDown}
          placeholder="Digite o país…"
          style={{ paddingRight: fieldValue && !open ? 28 : undefined }}
        />
        {fieldValue && !open && (
          <button
            onMouseDown={(e) => { e.preventDefault(); onChangeCountry(''); onChangeState('') }}
            style={{ position:'absolute', right:7, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:16, lineHeight:1, padding:2 }}
          >×</button>
        )}
      </div>

      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 3px)', left:0, right:0,
          background:'#fff', border:'1.5px solid #e2e8f0', borderRadius:8,
          boxShadow:'0 8px 28px rgba(0,0,0,.14)', zIndex:400,
          display:'flex', flexDirection:'column', maxHeight:280,
        }}>
          {/* Breadcrumb */}
          <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px 5px', borderBottom:'1px solid #f1f5f9', flexShrink:0 }}>
            {step === 'state' && (
              <button
                onMouseDown={(e) => { e.preventDefault(); back() }}
                style={{ background:'none', border:'none', color:'#2e6db4', fontSize:12, cursor:'pointer', padding:'1px 4px', borderRadius:4, fontFamily:'inherit', fontWeight:600 }}
              >← Voltar</button>
            )}
            {selCountry && step === 'state' && (
              <span style={{ fontSize:12, color:'#1e293b', fontWeight:500 }}>{selCountry.name_pt}</span>
            )}
            <span style={{ marginLeft:'auto', fontSize:11, color:'#94a3b8', fontWeight:600, textTransform:'uppercase', letterSpacing:'.05em' }}>
              {step === 'country' ? 'País' : 'Estado / Região'}
            </span>
          </div>

          {/* Lista */}
          <div ref={listRef} style={{ overflowY:'auto', flex:1 }}>
            {loading ? (
              <p style={{ textAlign:'center', padding:'20px 0', color:'#94a3b8', fontSize:13, margin:0 }}>Carregando…</p>
            ) : step === 'country' ? (
              listCountries.length === 0
                ? <p style={{ padding:'12px 14px', fontSize:13, color:'#94a3b8', margin:0 }}>Nenhum país encontrado</p>
                : listCountries.map((c, idx) => (
                  <div key={c.code}
                    onMouseDown={(e) => { e.preventDefault(); pickCountry(c) }}
                    onMouseEnter={() => setHighlighted(idx)}
                    onMouseLeave={() => setHighlighted(-1)}
                    style={{ padding:'8px 14px', cursor:'pointer', fontSize:13, color:'#1e293b', background: idx === highlighted ? '#e8f0fe' : c.name_pt === country ? '#f0f6ff' : 'transparent' }}
                  >
                    {c.name_pt}
                    {c.name_en !== c.name_pt && <span style={{ color:'#94a3b8', fontSize:11.5, marginLeft:6 }}>{c.name_en}</span>}
                  </div>
                ))
            ) : (
              listStates.length === 0
                ? <p style={{ padding:'12px 14px', fontSize:13, color:'#94a3b8', margin:0 }}>Nenhum estado encontrado</p>
                : listStates.map((s, idx) => (
                  <div key={s.code || s.name}
                    onMouseDown={(e) => { e.preventDefault(); pickState(s) }}
                    onMouseEnter={() => setHighlighted(idx)}
                    onMouseLeave={() => setHighlighted(-1)}
                    style={{ padding:'8px 14px', cursor:'pointer', fontSize:13, color:'#1e293b', background: idx === highlighted ? '#e8f0fe' : s.name === state ? '#f0f6ff' : 'transparent' }}
                  >
                    {s.name}
                    {s.code && <span style={{ color:'#94a3b8', fontSize:11.5, marginLeft:6 }}>{s.code}</span>}
                  </div>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
