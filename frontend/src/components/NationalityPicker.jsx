import { useState, useRef, useEffect, useMemo } from 'react'
import { configApi } from '../api'

let cachedCountries = null

async function getCountries() {
  if (cachedCountries) return cachedCountries
  const r = await configApi.countries()
  cachedCountries = r.data.map(c => ({ name: c.name, code: c.code }))
  return cachedCountries
}

const drop = {
  position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0,
  background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 300,
  maxHeight: 220, overflowY: 'auto',
}

function NatCombo({ value, exclude, placeholder, loading, countries, onSelect, onClear }) {
  const [query,       setQuery]       = useState('')
  const [open,        setOpen]        = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const wrapRef  = useRef(null)
  const inputRef = useRef(null)
  const listRef  = useRef(null)

  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => { setHighlighted(-1) }, [query])
  useEffect(() => {
    if (listRef.current && highlighted >= 0) {
      listRef.current.children[highlighted]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlighted])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return countries
      .filter(c => !exclude.includes(c.name) && (!q || c.name.toLowerCase().includes(q)))
      .slice(0, 80)
  }, [query, countries, exclude])

  const select = (name) => {
    onSelect(name)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          className="fi"
          value={open ? query : (value || '')}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { setQuery(''); setOpen(true) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)) }
            if (e.key === 'Enter' && filtered.length > 0) {
              e.preventDefault()
              select(highlighted >= 0 ? filtered[highlighted].name : filtered[0].name)
            }
          }}
          placeholder={placeholder}
          style={{ paddingRight: value ? 28 : undefined }}
        />
        {value && !open && (
          <button
            onMouseDown={(e) => { e.preventDefault(); onClear() }}
            style={{ position:'absolute', right:7, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:16, lineHeight:1, padding:2 }}
          >×</button>
        )}
      </div>

      {open && (
        <div style={drop}>
          {loading ? (
            <p style={{ padding:'12px 14px', fontSize:13, color:'#94a3b8', margin:0 }}>Carregando países…</p>
          ) : filtered.length === 0 ? (
            <p style={{ padding:'12px 14px', fontSize:13, color:'#94a3b8', margin:0 }}>Nenhuma nacionalidade encontrada</p>
          ) : (
            <div ref={listRef}>
              {filtered.map((c, idx) => {
                const isHl  = idx === highlighted
                const isSel = c.name === value
                return (
                  <div key={c.code}
                    onMouseDown={(e) => { e.preventDefault(); select(c.name) }}
                    onMouseEnter={() => setHighlighted(idx)}
                    onMouseLeave={() => setHighlighted(-1)}
                    style={{
                      padding:'8px 14px', cursor:'pointer', fontSize:13,
                      color: isSel ? '#2e6db4' : '#1e293b',
                      background: isHl ? '#e8f0fe' : isSel ? '#f0f6ff' : 'transparent',
                      fontWeight: isSel ? 600 : 400,
                      borderLeft: isSel ? '3px solid #2e6db4' : '3px solid transparent',
                    }}
                  >{c.name}</div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function NationalityPicker({ primary, others, onChangePrimary, onChangeOthers }) {
  const [countries, setCountries] = useState(cachedCountries ?? [])
  const [loading,   setLoading]   = useState(false)

  useEffect(() => {
    if (countries.length > 0) return
    setLoading(true)
    getCountries().then(setCountries).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const otherList = useMemo(
    () => others ? others.split(',').map(s => s.trim()).filter(Boolean) : [],
    [others]
  )

  const addOther = (name) => {
    if (!otherList.includes(name) && name !== primary) {
      onChangeOthers([...otherList, name].join(','))
    }
  }
  const removeOther = (name) => onChangeOthers(otherList.filter(n => n !== name).join(','))

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      {/* Nacionalidade principal */}
      <NatCombo
        value={primary}
        exclude={otherList}
        placeholder="Nacionalidade principal…"
        loading={loading}
        countries={countries}
        onSelect={onChangePrimary}
        onClear={() => onChangePrimary('')}
      />

      {/* Outras nacionalidades */}
      <div>
        {otherList.length > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:4 }}>
            {otherList.map(name => (
              <span key={name} style={{
                display:'inline-flex', alignItems:'center', gap:4,
                padding:'2px 8px', borderRadius:20,
                background:'#f0f6ff', border:'1px solid #bfdbfe',
                fontSize:12, color:'#2e6db4', fontWeight:500,
              }}>
                {name}
                <button
                  onMouseDown={(e) => { e.preventDefault(); removeOther(name) }}
                  style={{ background:'none', border:'none', cursor:'pointer', color:'#93c5fd', fontSize:14, lineHeight:1, padding:0 }}
                >×</button>
              </span>
            ))}
          </div>
        )}
        <NatCombo
          value={null}
          exclude={primary ? [primary, ...otherList] : otherList}
          placeholder="Adicionar outra nacionalidade…"
          loading={loading}
          countries={countries}
          onSelect={addOther}
          onClear={() => {}}
        />
      </div>
    </div>
  )
}
