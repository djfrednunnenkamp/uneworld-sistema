import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Ic } from './Icon'

/**
 * Dropdown — seletor estilizado de uma opção entre poucas, sem busca.
 * Substitui o <select> nativo (cuja lista de opções não pode ser
 * estilizada via CSS) por um popup próprio via createPortal + position:fixed
 * (necessário pra funcionar corretamente dentro de modais).
 *
 * Props:
 *   value       — valor selecionado
 *   onChange    — (value) => void
 *   options     — [{ value, label }]
 *   placeholder — texto quando nada selecionado
 *   disabled
 */
export default function Dropdown({ value, onChange, options, placeholder = '— Selecione —', disabled = false }) {
  const [open,      setOpen]      = useState(false)
  const [dropStyle, setDropStyle] = useState({})
  const btnRef = useRef(null)

  useEffect(() => {
    const h = e => {
      if (btnRef.current && !btnRef.current.contains(e.target) && !e.target.closest('[data-dropdown-panel]')) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const toggleOpen = () => {
    if (disabled) return
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setDropStyle({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    setOpen(o => !o)
  }

  const select = (v) => { onChange(v); setOpen(false) }
  const selected = options.find(o => o.value === value)

  return (
    <>
      <button type="button" ref={btnRef} onClick={toggleOpen} disabled={disabled}
        style={{
          width: '100%', padding: '8px 10px', border: `1px solid ${open ? '#2e6db4' : '#e2e8f0'}`,
          borderRadius: 6, background: disabled ? '#f8fafc' : '#fff', textAlign: 'left', fontSize: 13,
          color: selected ? '#1e293b' : '#94a3b8', cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8, boxShadow: open ? '0 0 0 3px rgba(46,109,180,.1)' : 'none', transition: 'border-color .12s, box-shadow .12s',
        }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected?.label ?? placeholder}</span>
        <span style={{ flexShrink: 0, color: '#94a3b8', display: 'flex', transform: 'rotate(90deg)' }}><Ic n="chevron" s={12} /></span>
      </button>

      {open && createPortal(
        <div data-dropdown-panel
          style={{
            position: 'fixed', ...dropStyle, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
            maxHeight: 260, overflowY: 'auto', zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,.14)',
          }}>
          {options.map(opt => {
            const sel = opt.value === value
            return (
              <div key={opt.value}
                onMouseDown={e => { e.preventDefault(); select(opt.value) }}
                style={{
                  padding: '9px 12px', cursor: 'pointer', fontSize: 13, color: sel ? '#2e6db4' : '#1e293b',
                  fontWeight: sel ? 600 : 400, background: sel ? '#f0f6ff' : '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  borderBottom: '1px solid #f8fafc',
                }}
                onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f8fafc' }}
                onMouseLeave={e => { e.currentTarget.style.background = sel ? '#f0f6ff' : '#fff' }}>
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
