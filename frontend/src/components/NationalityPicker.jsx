import { useState, useRef, useEffect, useMemo } from 'react'
import axios from 'axios'
import { Ic } from './Icon'

const RCOUNTRIES = 'https://restcountries.com/v3.1/all?fields=name,cca2,translations'
let cachedCountries = null

async function getCountries() {
  if (cachedCountries) return cachedCountries
  const r = await axios.get(RCOUNTRIES)
  cachedCountries = r.data
    .map((c) => ({
      name: c.translations?.por?.common || c.name.common,
      code: c.cca2,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
  return cachedCountries
}

export default function NationalityPicker({ primary, others, onChangePrimary, onChangeOthers }) {
  const [open,     setOpen]     = useState(false)
  const [search,   setSearch]   = useState('')
  const [loading,  setLoading]  = useState(false)
  const [countries, setCountries] = useState([])
  const [selected, setSelected] = useState([]) // [{name, isPrimary}]
  const overlayRef = useRef(null)
  const searchRef  = useRef(null)

  useEffect(() => {
    if (open) {
      const otherList = others ? others.split(',').map(s => s.trim()).filter(Boolean) : []
      const all = []
      if (primary) all.push({ name: primary, isPrimary: true })
      otherList.forEach(n => { if (n !== primary) all.push({ name: n, isPrimary: false }) })
      setSelected(all)
      setSearch('')
      setTimeout(() => searchRef.current?.focus(), 80)
      if (countries.length === 0) {
        setLoading(true)
        getCountries().then(setCountries).catch(() => {}).finally(() => setLoading(false))
      }
    }
  }, [open])

  const save = () => {
    const prim  = selected.find(s => s.isPrimary)?.name ?? ''
    const rest  = selected.filter(s => !s.isPrimary).map(s => s.name).join(',')
    onChangePrimary(prim)
    onChangeOthers(rest)
    setOpen(false)
  }

  const toggle = (name) => {
    setSelected(prev => {
      const exists = prev.find(s => s.name === name)
      if (exists) return prev.filter(s => s.name !== name)
      return [...prev, { name, isPrimary: prev.length === 0 }]
    })
  }

  const setPrimary = (e, name) => {
    e.stopPropagation()
    setSelected(prev => {
      const updated = prev.map(s => ({ ...s, isPrimary: s.name === name }))
      const prim = updated.find(s => s.isPrimary)
      const rest = updated.filter(s => !s.isPrimary)
      return prim ? [prim, ...rest] : updated
    })
  }

  const isSelected  = (name) => !!selected.find(s => s.name === name)
  const isPrimary   = (name) => !!selected.find(s => s.name === name && s.isPrimary)

  const list = useMemo(() => {
    const q   = search.toLowerCase()
    const sel = selected.map(s => s.name).filter(n => !q || n.toLowerCase().includes(q))
    const rest = countries
      .map(c => c.name)
      .filter(n => !isSelected(n) && (!q || n.toLowerCase().includes(q)))
    return { sel, rest }
  }, [search, selected, countries])

  const fieldValue = selected.map(s => s.isPrimary ? `${s.name} ★` : s.name).join(' · ')

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
          onClick={(e) => { if (e.target === overlayRef.current) save() }}
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
              maxHeight: '85vh', animation: 'mIn .15s ease',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>
                  Nacionalidade
                </p>
                {selected.length > 0 && (
                  <span style={{ fontSize: 12, color: '#2e6db4', fontWeight: 600 }}>
                    {selected.length} selecionada{selected.length !== 1 ? 's' : ''}
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
                  placeholder="Buscar país / nacionalidade…"
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
                  <p style={{ fontSize: 13 }}>Carregando países…</p>
                </div>
              ) : (
                <>
                  {/* Selecionados no topo */}
                  {list.sel.map(name => (
                    <NatRow
                      key={name}
                      name={name}
                      selected
                      primary={isPrimary(name)}
                      onToggle={() => toggle(name)}
                      onSetPrimary={(e) => setPrimary(e, name)}
                    />
                  ))}

                  {list.sel.length > 0 && list.rest.length > 0 && (
                    <div style={{ height: 1, background: '#f1f5f9', margin: '4px 0' }} />
                  )}

                  {/* Restantes */}
                  {list.rest.map(name => (
                    <NatRow
                      key={name}
                      name={name}
                      selected={false}
                      primary={false}
                      onToggle={() => toggle(name)}
                      onSetPrimary={null}
                    />
                  ))}

                  {list.sel.length === 0 && list.rest.length === 0 && (
                    <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' }}>
                      Nenhum país encontrado
                    </p>
                  )}
                </>
              )}
            </div>

            {selected.length > 0 && (
              <div style={{ padding: '7px 18px', background: '#f8fafc', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
                <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>
                  Clique em ★ para definir a nacionalidade principal
                </p>
              </div>
            )}

            {/* Footer */}
            <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
              <button onClick={() => setSelected([])}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                Limpar
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setOpen(false)}
                  style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancelar
                </button>
                <button onClick={save}
                  style={{ padding: '6px 18px', borderRadius: 6, border: 'none', background: '#2e6db4', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#275fa0'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#2e6db4'}>
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  )
}

function NatRow({ name, selected, primary, onToggle, onSetPrimary }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 18px', cursor: 'pointer',
        background: selected ? '#f0f6ff' : hover ? '#f8fafc' : 'transparent',
        transition: 'background .1s',
      }}
    >
      <input type="checkbox" readOnly checked={selected}
        style={{ width: 15, height: 15, accentColor: '#2e6db4', flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13, color: selected ? '#2e6db4' : '#1e293b', fontWeight: selected ? 600 : 400 }}>
        {name}
      </span>
      {selected && onSetPrimary && (
        <button
          onClick={onSetPrimary}
          title={primary ? 'Nacionalidade principal' : 'Definir como principal'}
          style={{
            fontSize: 16, lineHeight: 1, background: 'none', border: 'none',
            color: primary ? '#f59e0b' : '#d1d5db',
            cursor: 'pointer', padding: '0 2px', transition: 'color .15s', flexShrink: 0,
          }}
          onMouseEnter={(e) => { if (!primary) e.currentTarget.style.color = '#fbbf24' }}
          onMouseLeave={(e) => { if (!primary) e.currentTarget.style.color = '#d1d5db' }}
        >★</button>
      )}
    </div>
  )
}
