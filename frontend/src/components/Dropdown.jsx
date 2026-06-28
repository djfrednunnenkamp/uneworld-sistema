import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Ic } from './Icon'

/**
 * Dropdown — seletor estilizado de uma opção entre poucas, com busca por
 * digitação e navegação por teclado (ArrowUp/ArrowDown + Enter), igual aos
 * outros campos de autocomplete do sistema. Substitui o <select> nativo
 * (cuja lista de opções não pode ser estilizada via CSS) por um popup
 * próprio via createPortal + position:fixed (necessário pra funcionar
 * corretamente dentro de modais).
 *
 * Props:
 *   value       — valor selecionado
 *   onChange    — (value) => void
 *   options     — [{ value, label }]
 *   placeholder — texto quando nada selecionado
 *   disabled
 */
export default function Dropdown({ value, onChange, options, placeholder = '— Selecione —', disabled = false, clearable = true }) {
  const [open,        setOpen]        = useState(false)
  const [query,       setQuery]       = useState('')
  const [highlighted, setHighlighted] = useState(-1)
  const [dropStyle,   setDropStyle]   = useState({})
  const inputRef = useRef(null)

  useEffect(() => {
    const h = e => {
      if (inputRef.current && !inputRef.current.contains(e.target) && !e.target.closest('[data-dropdown-panel]')) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const selected = options.find(o => o.value === value)
  const filtered = options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))

  const openDrop = () => {
    if (disabled) return
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect()
      setDropStyle({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    setQuery('')
    setHighlighted(-1)
    setOpen(true)
  }

  const select = (v) => { onChange(v); setOpen(false); setQuery('') }

  const handleKeyDown = (e) => {
    if (disabled) return
    if (!open) { if (e.key !== 'Tab') openDrop(); return }
    if (e.key === 'Escape') setOpen(false)
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)) }
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault()
      select((highlighted >= 0 ? filtered[highlighted] : filtered[0]).value)
    }
  }

  return (
    <>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          value={open ? query : (selected?.label ?? '')}
          onChange={e => { setQuery(e.target.value); if (!open) openDrop(); else setHighlighted(-1) }}
          onFocus={openDrop}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={selected ? selected.label : placeholder}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '8px 56px 8px 10px',
            border: `1px solid ${open ? '#2e6db4' : '#e2e8f0'}`, borderRadius: 6, fontSize: 13,
            outline: 'none', fontFamily: 'inherit', color: disabled ? '#94a3b8' : '#1e293b',
            background: disabled ? '#f8fafc' : '#fff', cursor: disabled ? 'not-allowed' : 'text',
            boxShadow: open ? '0 0 0 3px rgba(46,109,180,.1)' : 'none', transition: 'border-color .12s, box-shadow .12s',
          }} />
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 4 }}>
          {selected && !disabled && clearable && (
            <span
              role="button"
              tabIndex={-1}
              onMouseDown={e => { e.preventDefault(); onChange(null); setQuery('') }}
              title="Limpar seleção"
              style={{ color: '#94a3b8', display: 'flex', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
              onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
            >
              <Ic n="x" s={12} />
            </span>
          )}
          <span style={{ color: '#94a3b8', display: 'flex', transform: 'rotate(90deg)' }}><Ic n="chevron" s={12} /></span>
        </span>
      </div>

      {open && createPortal(
        <div data-dropdown-panel
          style={{
            position: 'fixed', ...dropStyle, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
            maxHeight: 260, overflowY: 'auto', zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,.14)',
          }}>
          {filtered.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12.5, padding: '12px 0', margin: 0 }}>
              Nenhum resultado.
            </p>
          ) : filtered.map((opt, idx) => {
            const sel = opt.value === value
            const hl  = idx === highlighted
            return (
              <div key={opt.value}
                onMouseDown={e => { e.preventDefault(); select(opt.value) }}
                onMouseEnter={() => setHighlighted(idx)}
                style={{
                  padding: '9px 12px', cursor: 'pointer', fontSize: 13, color: sel ? '#2e6db4' : '#1e293b',
                  fontWeight: sel ? 600 : 400, background: hl ? '#e8f0fe' : (sel ? '#f0f6ff' : '#fff'),
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  borderBottom: '1px solid #f8fafc',
                }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                {sel && <span style={{ color: '#2e6db4', flexShrink: 0, display: 'flex' }}><Ic n="check" s={13} /></span>}
              </div>
            )
          })}
        </div>,
        document.body
      )}
    </>
  )
}
