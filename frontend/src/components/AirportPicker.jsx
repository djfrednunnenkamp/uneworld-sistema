import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { configApi } from '../api'

/**
 * AirportPicker — campo de busca de aeroporto com dropdown via portal.
 * Navegável por teclado (ArrowUp/ArrowDown + Enter), igual aos outros
 * campos de autocomplete do sistema.
 *
 * Props:
 *   value       — objeto airport { id, name, iata_code, city, country } ou null
 *   onChange    — (airportObject | null) => void
 *   placeholder — texto do campo vazio
 */
export default function AirportPicker({ value, onChange, placeholder = 'Buscar aeroporto…' }) {
  const [query,       setQuery]       = useState('')
  const [open,        setOpen]        = useState(false)
  const [options,     setOptions]     = useState([])
  const [dropStyle,   setDropStyle]   = useState({})
  const [highlighted, setHighlighted] = useState(-1)
  const inputRef = useRef(null)

  // Fecha ao clicar fora
  useEffect(() => {
    const h = e => {
      if (inputRef.current && !inputRef.current.contains(e.target) &&
          !e.target.closest('[data-airport-drop]')) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const openDrop = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect()
      setDropStyle({ top: r.bottom + 2, left: r.left, width: r.width })
    }
    setQuery('')
    setOpen(true)
    setHighlighted(-1)
  }

  // Busca com debounce — sem texto digitado, mostra só os favoritos
  // (marcados em Configurações > Aeroportos); com texto, busca em todos.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      const params = query ? { q: query } : { favorites: 1 }
      configApi.airports(params).then(r => { setOptions(r.data.results ?? r.data); setHighlighted(-1) }).catch(() => {})
    }, 200)
    return () => clearTimeout(t)
  }, [query, open])

  const display = value ? `${value.iata_code ? value.iata_code + ' — ' : ''}${value.name}` : ''

  const select = (a) => { onChange(a); setOpen(false); setQuery('') }

  const handleKeyDown = (e) => {
    if (!open) { if (e.key !== 'Tab') openDrop(); return }
    if (e.key === 'Escape') { setOpen(false) }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, options.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)) }
    if (e.key === 'Enter' && options.length > 0) {
      e.preventDefault()
      select(highlighted >= 0 ? options[highlighted] : options[0])
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        value={open ? query : display}
        onChange={e => { setQuery(e.target.value); if (!open) openDrop() }}
        onFocus={openDrop}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{ width:'100%', boxSizing:'border-box', padding:'8px 11px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b', background:'#fff' }}
      />
      {open && createPortal(
        <div data-airport-drop
          style={{ position:'fixed', ...dropStyle, background:'#fff', border:'1.5px solid #e2e8f0', borderRadius:8, maxHeight:240, overflowY:'auto', zIndex:9999, boxShadow:'0 8px 24px rgba(0,0,0,.14)' }}>
          {!query && options.length > 0 && (
            <p style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.05em', padding:'8px 12px 4px', margin:0 }}>
              ★ Favoritos
            </p>
          )}
          {options.length === 0 ? (
            <p style={{ textAlign:'center', padding:'14px 0', color:'#94a3b8', fontSize:13, margin:0 }}>
              {query.length >= 1 ? 'Nenhum aeroporto encontrado.' : 'Nenhum favorito ainda — digite para buscar outro aeroporto.'}
            </p>
          ) : options.map((a, idx) => (
            <div key={a.id}
              data-airport-drop
              onMouseDown={e => { e.preventDefault(); select(a) }}
              onMouseEnter={() => setHighlighted(idx)}
              style={{ padding:'9px 12px', cursor:'pointer', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid #f1f5f9', background: idx === highlighted ? '#e8f0fe' : '#fff' }}>
              {a.is_favorite && <span style={{ fontSize:12, color:'#f59e0b', flexShrink:0 }}>★</span>}
              {a.iata_code && (
                <span style={{ fontSize:12, fontWeight:700, color:'#1a2d4f', background:'#eff6ff', padding:'2px 7px', borderRadius:5, fontFamily:'monospace', flexShrink:0 }}>{a.iata_code}</span>
              )}
              <span style={{ fontSize:13, color:'#1e293b', fontWeight:500, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.name}</span>
              {(a.city || a.country) && (
                <span style={{ fontSize:11, color:'#94a3b8', flexShrink:0 }}>{[a.city, a.country].filter(Boolean).join(', ')}</span>
              )}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}
