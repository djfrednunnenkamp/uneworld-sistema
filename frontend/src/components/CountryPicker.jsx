import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { Ic } from './Icon'

const RCOUNTRIES = 'https://restcountries.com/v3.1/all?fields=name,cca2,translations'
let cachedCountries = null

async function getCountries() {
  if (cachedCountries) return cachedCountries
  const r = await axios.get(RCOUNTRIES)
  cachedCountries = r.data
    .map((c) => ({
      name_pt: c.translations?.por?.common || c.name.common,
      name_en: c.name.common,
      code:    c.cca2,
    }))
    .sort((a, b) => a.name_pt.localeCompare(b.name_pt, 'pt'))
  return cachedCountries
}

/**
 * Campo de nacionalidade:
 *  - digitável diretamente
 *  - ícone de busca abre popup para escolher o país
 */
export default function CountryPicker({ value, onChange }) {
  const [open,      setOpen]      = useState(false)
  const [countries, setCountries] = useState([])
  const [search,    setSearch]    = useState('')
  const [loading,   setLoading]   = useState(false)
  const overlayRef  = useRef(null)
  const searchRef   = useRef(null)

  useEffect(() => {
    if (open) {
      setSearch('')
      setTimeout(() => searchRef.current?.focus(), 80)
      if (countries.length === 0) {
        setLoading(true)
        getCountries()
          .then(setCountries)
          .catch(() => {})
          .finally(() => setLoading(false))
      }
    }
  }, [open])

  const pick = (country) => {
    onChange(country.name_pt)
    setOpen(false)
  }

  const handleOverlay = (e) => {
    if (e.target === overlayRef.current) setOpen(false)
  }

  const filtered = countries.filter((c) => {
    const q = search.toLowerCase()
    return c.name_pt.toLowerCase().includes(q) || c.name_en.toLowerCase().includes(q)
  })

  return (
    <>
      {/* Input editável + botão de busca */}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className="fi"
          style={{ flex: 1 }}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ex.: BRASILEIRA"
        />
        <button
          type="button"
          title="Buscar país"
          onClick={() => setOpen(true)}
          style={{
            height: 34, width: 34, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid #e2e8f0', borderRadius: 6,
            background: '#fff', color: '#64748b', cursor: 'pointer',
            transition: 'all .12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2e6db4'; e.currentTarget.style.color = '#2e6db4' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#64748b' }}
        >
          <Ic n="globe" s={14} />
        </button>
      </div>

      {/* Popup */}
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
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 440,
              boxShadow: '0 24px 64px rgba(0,0,0,.22)',
              display: 'flex', flexDirection: 'column',
              maxHeight: '80vh', animation: 'mIn .15s ease',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 10 }}>
                Selecionar nacionalidade
              </p>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', display: 'flex' }}>
                  <Ic n="search" s={14} />
                </span>
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar país…"
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
                <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 13 }}>
                  <div style={{ width: 22, height: 22, border: '3px solid #e2e8f0', borderTopColor: '#2e6db4', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 8px' }} />
                  Carregando países…
                </div>
              ) : filtered.length === 0 ? (
                <p style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 13 }}>Nenhum país encontrado</p>
              ) : (
                filtered.map((c) => (
                  <CountryRow
                    key={c.code}
                    country={c}
                    selected={value === c.name_pt}
                    onClick={() => pick(c)}
                  />
                ))
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
              <button
                onClick={() => setOpen(false)}
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

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  )
}

function CountryRow({ country, selected, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 18px', cursor: 'pointer',
        background: selected ? '#f0f6ff' : hover ? '#f8fafc' : 'transparent',
        transition: 'background .1s',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, color: '#1e293b', margin: 0, fontWeight: selected ? 600 : 400 }}>
          {country.name_pt}
        </p>
        {country.name_en !== country.name_pt && (
          <p style={{ fontSize: 11.5, color: '#94a3b8', margin: 0, marginTop: 1 }}>{country.name_en}</p>
        )}
      </div>
      {selected && <span style={{ color: '#2e6db4', flexShrink: 0 }}><Ic n="check" s={14} /></span>}
    </div>
  )
}
