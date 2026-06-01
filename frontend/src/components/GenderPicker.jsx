import { useState, useRef, useEffect } from 'react'

const OPTIONS = [
  { val: 'F', label: 'Feminino'  },
  { val: 'M', label: 'Masculino' },
  { val: 'NB', label: 'Não-binário' },
  { val: 'O',  label: 'Outro'    },
]

const LABEL = { F: 'Feminino', M: 'Masculino', NB: 'Não-binário' }

const drop = {
  position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0,
  background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 300, overflow: 'hidden',
}

export default function GenderPicker({ value, customValue, onChange }) {
  const [query,       setQuery]       = useState('')
  const [open,        setOpen]        = useState(false)
  const [custom,      setCustom]      = useState(customValue || '')
  const [highlighted, setHighlighted] = useState(-1)
  const wrapRef   = useRef(null)
  const inputRef  = useRef(null)
  const listRef   = useRef(null)

  /* fecha ao clicar fora */
  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  /* sincroniza custom quando prop muda */
  useEffect(() => { setCustom(customValue || '') }, [customValue])

  /* reset highlight ao mudar query */
  useEffect(() => { setHighlighted(-1) }, [query])

  /* scroll automático do item destacado */
  useEffect(() => {
    if (listRef.current && highlighted >= 0) {
      listRef.current.children[highlighted]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlighted])

  const displayLabel = value === 'O'
    ? (customValue?.trim() || 'Outro')
    : (LABEL[value] || '')

  const filtered = OPTIONS.filter(o =>
    !query.trim() || o.label.toLowerCase().includes(query.toLowerCase())
  )

  const select = (val) => {
    if (val === 'O') {
      onChange('O', custom)
    } else {
      onChange(val, '')
      setOpen(false)
      setQuery('')
    }
  }

  const handleFocus = () => { setQuery(''); setOpen(true) }
  const handleChange = (e) => { setQuery(e.target.value); setOpen(true) }
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)) }
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault()
      select(highlighted >= 0 ? filtered[highlighted].val : filtered[0].val)
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        className="fi"
        value={open ? query : displayLabel}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder="Digite para buscar…"
      />

      {open && (
        <div style={drop}>
          {filtered.length === 0 ? (
            <p style={{ padding: '10px 14px', fontSize: 13, color: '#94a3b8', margin: 0 }}>Nenhum resultado</p>
          ) : <div ref={listRef}>{filtered.map((opt, idx) => {
            const isHl  = idx === highlighted
            const isSel = value === opt.val
            return (
              <div
                key={opt.val}
                onMouseDown={(e) => { e.preventDefault(); select(opt.val) }}
                onMouseEnter={() => setHighlighted(idx)}
                onMouseLeave={() => setHighlighted(-1)}
                style={{
                  padding: '9px 14px', cursor: 'pointer', fontSize: 13,
                  color: isSel ? '#2e6db4' : '#1e293b',
                  background: isHl ? '#e8f0fe' : isSel ? '#f0f6ff' : 'transparent',
                  fontWeight: isSel ? 600 : 400,
                  borderLeft: isSel ? '3px solid #2e6db4' : '3px solid transparent',
                }}
              >
                {opt.label}
              </div>
            )
          })}</div>}

          {/* Campo livre quando Outro está selecionado */}
          {value === 'O' && (
            <div style={{ padding: '6px 10px 10px', borderTop: '1px solid #f1f5f9' }}>
              <input
                value={custom}
                onChange={(e) => { setCustom(e.target.value); onChange('O', e.target.value) }}
                placeholder="Especifique o gênero…"
                style={{
                  width: '100%', padding: '6px 10px', border: '1px solid #e2e8f0',
                  borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit',
                  color: '#1e293b', boxSizing: 'border-box',
                }}
                onFocus={(e) => e.target.style.borderColor = '#2e6db4'}
                onBlur={(e)  => e.target.style.borderColor = '#e2e8f0'}
                onKeyDown={(e) => { if (e.key === 'Enter') { setOpen(false) } }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
