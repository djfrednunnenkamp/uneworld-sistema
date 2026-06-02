import { useState, useRef, useEffect } from 'react'

/**
 * FormSelect — dropdown estilizado para campos de formulário.
 * Substitui <select className="fs"> com aparência elegante.
 *
 * Props:
 *   value     — valor selecionado
 *   onChange  — callback (value) => void
 *   options   — [{ value, label, icon? }]
 *   placeholder — texto quando nada selecionado
 */
export default function FormSelect({ value, onChange, options = [], placeholder = 'Selecione…' }) {
  const [open, setOpen] = useState(false)
  const ref  = useRef(null)
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '8px 12px',
          border: `1.5px solid ${open ? '#1a2d4f' : '#e2e8f0'}`,
          borderRadius: 8, background: '#fff', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 13, color: selected ? '#0f172a' : '#94a3b8',
          transition: 'border-color .12s', textAlign: 'left',
        }}
      >
        {selected?.icon && <span style={{ fontSize: 16, flexShrink: 0 }}>{selected.icon}</span>}
        <span style={{ flex: 1 }}>{selected ? selected.label : placeholder}</span>
        <span style={{
          fontSize: 10, color: '#94a3b8', flexShrink: 0,
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform .15s',
        }}>▼</span>
      </button>

      {/* Lista */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 8,
          boxShadow: '0 8px 28px rgba(0,0,0,.12)', zIndex: 300, overflow: 'hidden',
        }}>
          {options.map(opt => {
            const isSel = opt.value === value
            return (
              <div key={opt.value}
                onMouseDown={e => { e.preventDefault(); onChange(opt.value); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 14px', cursor: 'pointer', fontSize: 13,
                  background: isSel ? '#f0f4ff' : '#fff',
                  borderBottom: '1px solid #f8fafc',
                  borderLeft: isSel ? '3px solid #1a2d4f' : '3px solid transparent',
                  color: isSel ? '#1a2d4f' : '#1e293b',
                  fontWeight: isSel ? 600 : 400,
                  transition: 'background .1s',
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
