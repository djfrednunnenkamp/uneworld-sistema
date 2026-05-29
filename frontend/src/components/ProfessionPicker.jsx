import { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import { Ic } from './Icon'

const URL_CSV  = 'https://raw.githubusercontent.com/okfn-brasil/datasets-br-cbo/master/data/lista_canonicos.csv'
const URL_JSON = 'https://raw.githubusercontent.com/lucassmacedo/cbo-brasil/master/json/CBO2002%20-%20Ocupacao.json'
let cachedProfessions = null

async function loadProfessions() {
  if (cachedProfessions) return cachedProfessions

  const [csvRes, jsonRes] = await Promise.allSettled([
    axios.get(URL_CSV),
    axios.get(URL_JSON),
  ])

  const names = new Set()

  // Fonte 1 — CSV (2.445 ocupações)
  if (csvRes.status === 'fulfilled') {
    csvRes.value.data.split('\n').slice(1).forEach((l) => {
      l = l.trim()
      if (!l) return
      const comma = l.indexOf(',')
      const name = l.substring(comma + 1).replace(/\r/g, '').trim()
      if (name) names.add(name)
    })
  }

  // Fonte 2 — JSON (2.614 ocupações)
  if (jsonRes.status === 'fulfilled') {
    jsonRes.value.data.forEach((item) => {
      if (item.name) names.add(item.name.trim())
    })
  }

  cachedProfessions = [...names].sort((a, b) => a.localeCompare(b, 'pt'))
  return cachedProfessions
}

export default function ProfessionPicker({ value, onChange }) {
  const [open,        setOpen]        = useState(false)
  const [professions, setProfessions] = useState([])
  const [search,      setSearch]      = useState('')
  const [loading,     setLoading]     = useState(false)
  const overlayRef = useRef(null)
  const searchRef  = useRef(null)

  useEffect(() => {
    if (open) {
      setSearch('')
      setTimeout(() => searchRef.current?.focus(), 80)
      if (professions.length === 0) {
        setLoading(true)
        loadProfessions()
          .then(setProfessions)
          .catch(() => {})
          .finally(() => setLoading(false))
      }
    }
  }, [open])

  const pick = (prof) => {
    onChange(prof)
    setOpen(false)
  }

  const handleOverlay = (e) => {
    if (e.target === overlayRef.current) setOpen(false)
  }

  const filtered = search.trim()
    ? professions.filter((p) => p.toLowerCase().includes(search.toLowerCase()))
    : professions

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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>
                  Selecionar profissão
                </p>
                {!loading && professions.length > 0 && (
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {professions.length.toLocaleString('pt-BR')} ocupações (CBO)
                  </span>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', display: 'flex' }}>
                  <Ic n="search" s={14} />
                </span>
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Digite para buscar entre as ocupações…"
                  style={{
                    width: '100%', padding: '7px 11px 7px 31px',
                    border: '1px solid #e2e8f0', borderRadius: 6,
                    fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b',
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#2e6db4'}
                  onBlur={(e)  => e.target.style.borderColor = '#e2e8f0'}
                />
              </div>
              {search.length === 1 && (
                <p style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 6 }}>
                  Continue digitando para filtrar…
                </p>
              )}
            </div>

            {/* Lista */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '36px 0', color: '#94a3b8' }}>
                  <div style={{
                    width: 24, height: 24,
                    border: '3px solid #e2e8f0', borderTopColor: '#2e6db4',
                    borderRadius: '50%', animation: 'spin 0.7s linear infinite',
                    margin: '0 auto 10px',
                  }} />
                  <p style={{ fontSize: 13 }}>Carregando ocupações da CBO…</p>
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 18px' }}>
                  <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 10 }}>
                    Nenhuma ocupação encontrada para "{search}"
                  </p>
                  <button
                    onClick={() => pick(search)}
                    style={{
                      padding: '6px 14px', borderRadius: 6,
                      border: '1px solid #2e6db4', background: '#fff',
                      color: '#2e6db4', fontSize: 13, cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Usar "{search}" mesmo assim
                  </button>
                </div>
              ) : (
                <>
                  {filtered.map((prof) => (
                    <ProfRow
                      key={prof}
                      label={prof}
                      selected={value === prof}
                      onClick={() => pick(prof)}
                    />
                  ))}
                </>
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

function ProfRow({ label, selected, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '9px 18px', cursor: 'pointer',
        background: selected ? '#f0f6ff' : hover ? '#f8fafc' : 'transparent',
        transition: 'background .1s',
      }}
    >
      <span style={{ fontSize: 13, color: '#1e293b', fontWeight: selected ? 600 : 400 }}>
        {label}
      </span>
      {selected && <span style={{ color: '#2e6db4', flexShrink: 0 }}><Ic n="check" s={14} /></span>}
    </div>
  )
}
