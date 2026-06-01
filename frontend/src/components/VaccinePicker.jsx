import { useState, useRef, useEffect, useMemo } from 'react'
import { configApi } from '../api'

let cachedVaccines = null

const drop = {
  position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0,
  background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 300,
  maxHeight: 220, overflowY: 'auto',
}

/**
 * VaccinePicker — combobox com lista de vacinas do banco.
 * Permite digitar livremente (valor não precisa estar na lista).
 * Props: value (string), onChange (v: string) => void
 */
export default function VaccinePicker({ value, onChange }) {
  const [vaccines,    setVaccines]    = useState(cachedVaccines ?? [])
  const [query,       setQuery]       = useState('')
  const [open,        setOpen]        = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const wrapRef  = useRef(null)
  const inputRef = useRef(null)
  const listRef  = useRef(null)

  // Carrega vacinas do banco
  useEffect(() => {
    if (cachedVaccines) return
    configApi.vaccines().then(r => {
      cachedVaccines = r.data.map(v => v.name)
      setVaccines(cachedVaccines)
    }).catch(() => {})
  }, [])

  // Fecha ao clicar fora
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
    return vaccines.filter(v => !q || v.toLowerCase().includes(q)).slice(0, 60)
  }, [query, vaccines])

  const select = (name) => {
    onChange(name)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)) }
    if (e.key === 'Enter') {
      if (filtered.length > 0 && (highlighted >= 0 || filtered.length === 1)) {
        e.preventDefault()
        select(highlighted >= 0 ? filtered[highlighted] : filtered[0])
      }
      // Se não há match exato na lista, mantém o texto livre digitado
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          className="fi"
          value={open ? query : (value || '')}
          onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true) }}
          onFocus={() => { setQuery(''); setOpen(true) }}
          onKeyDown={handleKeyDown}
          placeholder="Digite ou selecione a vacina…"
          style={{ paddingRight: value && !open ? 28 : undefined }}
        />
        {value && !open && (
          <button
            onMouseDown={e => { e.preventDefault(); onChange('') }}
            style={{ position:'absolute', right:7, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:16, lineHeight:1, padding:2 }}
          >×</button>
        )}
      </div>

      {open && (
        <div style={drop}>
          {filtered.length === 0 ? (
            <p style={{ padding:'10px 14px', fontSize:13, color:'#94a3b8', margin:0 }}>
              {query ? `Nenhuma vacina encontrada. O texto "${query}" será salvo assim mesmo.` : 'Carregando…'}
            </p>
          ) : (
            <div ref={listRef}>
              {filtered.map((name, idx) => {
                const isHl  = idx === highlighted
                const isSel = name === value
                return (
                  <div key={name}
                    onMouseDown={e => { e.preventDefault(); select(name) }}
                    onMouseEnter={() => setHighlighted(idx)}
                    onMouseLeave={() => setHighlighted(-1)}
                    style={{
                      padding:'8px 14px', cursor:'pointer', fontSize:13,
                      color: isSel ? '#2e6db4' : '#1e293b',
                      background: isHl ? '#e8f0fe' : isSel ? '#f0f6ff' : 'transparent',
                      fontWeight: isSel ? 600 : 400,
                      borderLeft: isSel ? '3px solid #2e6db4' : '3px solid transparent',
                    }}
                  >
                    {name}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
