import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { configApi } from '../api'

/**
 * AirlinePicker — campo de busca de companhia aérea com dropdown via portal.
 * Suporta navegação por teclado (↑↓ Enter Esc).
 *
 * Props:
 *   value       — string (nome da companhia) ou null
 *   onChange    — (string) => void
 *   placeholder — texto quando vazio
 */
export default function AirlinePicker({ value, onChange, placeholder = 'Buscar companhia…' }) {
  const [query,       setQuery]       = useState(value || '')
  const [open,        setOpen]        = useState(false)
  const [options,     setOptions]     = useState([])
  const [highlighted, setHighlighted] = useState(-1)
  const [dropStyle,   setDropStyle]   = useState({})
  const inputRef = useRef(null)

  // Sincroniza quando o valor externo muda
  useEffect(() => { setQuery(value || '') }, [value])

  // Fecha ao clicar fora
  useEffect(() => {
    const h = e => {
      if (inputRef.current && !inputRef.current.contains(e.target) &&
          !e.target.closest('[data-airline-drop]')) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const openDrop = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect()
      setDropStyle({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 260) })
    }
    setOpen(true)
    setHighlighted(-1)
  }

  // Busca com debounce
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      configApi.airlines({ q: query }).then(r => {
        setOptions(r.data.results ?? r.data)
        setHighlighted(-1)
      }).catch(() => {})
    }, 180)
    return () => clearTimeout(t)
  }, [query, open])

  const select = (airline) => {
    onChange(airline.name)
    setQuery(airline.name)
    setOpen(false)
  }

  const handleKeyDown = (e) => {
    if (!open) { if (e.key !== 'Tab') openDrop(); return }
    if (e.key === 'Escape')    { setOpen(false) }
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
        value={query}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); if (!open) openDrop() }}
        onFocus={openDrop}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{ width:'100%', boxSizing:'border-box', padding:'7px 10px', border:'1px solid #e2e8f0', borderRadius:6, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b', background:'#fff', transition:'border-color .12s, box-shadow .12s' }}
        onBlur={e => { e.target.style.borderColor='#e2e8f0'; e.target.style.boxShadow='none' }}
      />
      {open && createPortal(
        <div data-airline-drop
          style={{ position:'fixed', ...dropStyle, background:'#fff', border:'1.5px solid #e2e8f0', borderRadius:8, maxHeight:240, overflowY:'auto', zIndex:9999, boxShadow:'0 8px 24px rgba(0,0,0,.14)' }}>
          {options.length === 0 ? (
            <p style={{ textAlign:'center', padding:'14px 0', color:'#94a3b8', fontSize:13, margin:0 }}>
              {query.length >= 1 ? 'Nenhuma companhia encontrada.' : 'Digite para buscar…'}
            </p>
          ) : options.map((a, idx) => (
            <div key={a.id}
              data-airline-drop
              onMouseDown={e => { e.preventDefault(); select(a) }}
              onMouseEnter={() => setHighlighted(idx)}
              style={{ padding:'9px 12px', cursor:'pointer', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid #f1f5f9', background: idx === highlighted ? '#e8f0fe' : '#fff' }}>
              {a.iata_code && (
                <span style={{ fontSize:11, fontWeight:700, color:'#1a2d4f', background:'#eff6ff', padding:'2px 6px', borderRadius:4, fontFamily:'monospace', flexShrink:0 }}>{a.iata_code}</span>
              )}
              <span style={{ fontSize:13, color:'#1e293b', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.name}</span>
              {a.country && (
                <span style={{ fontSize:11, color:'#94a3b8', flexShrink:0 }}>{a.country}</span>
              )}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}
