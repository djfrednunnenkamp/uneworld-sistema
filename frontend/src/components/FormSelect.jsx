import { useState, useRef, useEffect, useCallback } from 'react'

/**
 * FormSelect — dropdown estilizado e inteligente para campos de formulário.
 * Abre para cima automaticamente quando não há espaço abaixo.
 *
 * Props:
 *   value       — valor selecionado
 *   onChange    — callback (value) => void
 *   options     — [{ value, label, icon? }]
 *   placeholder — texto quando nada selecionado
 */
export default function FormSelect({ value, onChange, options = [], placeholder = 'Selecione…' }) {
  const [open,   setOpen]   = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const ref      = useRef(null)
  const trigRef  = useRef(null)
  const selected = options.find(o => o.value === value)

  /* Fecha ao clicar fora */
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  /* Abre calculando se há espaço abaixo */
  const handleOpen = useCallback(() => {
    if (!open && trigRef.current) {
      const rect       = trigRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const dropHeight = Math.min(options.length * 42 + 8, 280)
      setOpenUp(spaceBelow < dropHeight + 12)
    }
    setOpen(o => !o)
  }, [open, options.length])

  const listPos = openUp
    ? { bottom: 'calc(100% + 4px)', top: 'auto' }
    : { top:    'calc(100% + 4px)', bottom: 'auto' }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        ref={trigRef}
        type="button"
        onMouseDown={e => { e.preventDefault(); handleOpen() }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '8px 12px',
          border: `1.5px solid ${open ? '#1a2d4f' : '#e2e8f0'}`,
          borderRadius: 8, background: '#fff', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 13,
          color: selected ? '#0f172a' : '#94a3b8',
          transition: 'border-color .12s', textAlign: 'left',
        }}
      >
        {selected?.icon && <span style={{ fontSize: 16, flexShrink: 0 }}>{selected.icon}</span>}
        <span style={{ flex: 1 }}>{selected ? selected.label : placeholder}</span>
        <span style={{
          fontSize: 10, color: '#94a3b8', flexShrink: 0,
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform .15s',
          display: 'inline-block',
        }}>▼</span>
      </button>

      {/* Lista — abre para cima ou para baixo automaticamente */}
      {open && (
        <div style={{
          position: 'absolute', left: 0, right: 0, ...listPos,
          background: '#fff', border: '1.5px solid #e2e8f0',
          borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,.12)',
          zIndex: 9999, overflow: 'hidden',
          maxHeight: 280, overflowY: 'auto',
        }}>
          {options.map(opt => {
            const isSel = opt.value === value
            return (
              <div key={opt.value}
                onMouseDown={e => { e.preventDefault(); onChange(opt.value); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', cursor: 'pointer', fontSize: 13,
                  background: isSel ? '#f0f4ff' : '#fff',
                  borderBottom: '1px solid #f8fafc',
                  borderLeft: isSel ? '3px solid #1a2d4f' : '3px solid transparent',
                  color: isSel ? '#1a2d4f' : '#1e293b',
                  fontWeight: isSel ? 600 : 400,
                }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = '#f8fafc' }}
                onMouseLeave={e => { e.currentTarget.style.background = isSel ? '#f0f4ff' : '#fff' }}
              >
                {opt.icon && <span style={{ fontSize: 16, flexShrink: 0 }}>{opt.icon}</span>}
                <span style={{ flex: 1 }}>{opt.label}</span>
                {isSel && <span style={{ color: '#1a2d4f', fontSize: 14, fontWeight: 700 }}>✓</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
