import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'

/**
 * FormSelect — combobox para campos de formulário.
 * Digita para filtrar, ↑↓ para navegar, Enter para selecionar, Esc para fechar.
 * Abre para cima automaticamente quando não há espaço abaixo.
 *
 * Props:
 *   value         — valor selecionado
 *   onChange      — callback (value) => void
 *   options       — [{ value, label, icon? }]
 *   placeholder   — texto quando nada selecionado
 *   renderPreview — opcional: (option) => ReactNode | null — pré-visualização
 *                   flutuante exibida ao passar o mouse sobre uma opção
 */
export default function FormSelect({ value, onChange, options = [], placeholder = 'Selecione…', renderPreview }) {
  const [open,        setOpen]        = useState(false)
  const [query,       setQuery]       = useState('')
  const [highlighted, setHighlighted] = useState(-1)
  const [hoverRect,   setHoverRect]   = useState(null)
  // top XOR bottom — quando abre pra cima usa bottom para grudar no input
  const [pos, setPos] = useState({ top: 'auto', bottom: 'auto', left: 0, width: 0 })
  const wrapRef  = useRef(null)
  const inputRef = useRef(null)
  const listRef  = useRef(null)
  const dropRef  = useRef(null)
  const selected = options.find(o => o.value === value)

  /* Fecha ao clicar fora */
  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])


  /* Scroll automático do item destacado */
  useEffect(() => {
    if (listRef.current && highlighted >= 0)
      listRef.current.children[highlighted]?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  /* Reset highlight ao mudar query */
  useEffect(() => { setHighlighted(-1) }, [query])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return options.filter(o => !q || o.label.toLowerCase().includes(q))
  }, [query, options])

  const openDrop = () => {
    if (open) return
    const rect = inputRef.current?.getBoundingClientRect()
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom - 8
      if (spaceBelow >= 180) {
        // Espaço suficiente abaixo → top do dropdown cola na parte inferior do input
        setPos({ top: rect.bottom + 4, bottom: 'auto', left: rect.left, width: rect.width })
      } else {
        // Sem espaço abaixo → bottom do dropdown cola na parte superior do input
        // Independente do tamanho da lista, fica sempre grudado no input
        setPos({ top: 'auto', bottom: window.innerHeight - rect.top + 4, left: rect.left, width: rect.width })
      }
    }
    setQuery('')
    setHighlighted(-1)
    setOpen(true)
  }

  const select = (val) => {
    onChange(val)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const handleKeyDown = (e) => {
    if (!open) { if (e.key !== 'Tab') openDrop(); return }
    if (e.key === 'Escape')    { setOpen(false); inputRef.current?.blur() }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)) }
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault()
      select(highlighted >= 0 ? filtered[highlighted].value : filtered[0].value)
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          value={open ? query : (selected?.label ?? '')}
          onChange={e => { setQuery(e.target.value); if (!open) setOpen(true) }}
          onFocus={openDrop}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{
            width: '100%', padding: '8px 28px 8px 12px',
            border: `1.5px solid ${open ? '#1a2d4f' : '#e2e8f0'}`,
            borderRadius: 8, background: '#fff', cursor: 'text',
            fontFamily: 'inherit', fontSize: 13, color: '#0f172a',
            outline: 'none', transition: 'border-color .12s', boxSizing: 'border-box',
          }}
        />
        {/* Seta indicativa */}
        <span style={{
          position: 'absolute', right: 10, top: '50%', transform: `translateY(-50%) rotate(${open ? '180deg' : '0deg'})`,
          fontSize: 10, color: '#94a3b8', pointerEvents: 'none',
          transition: 'transform .15s', display: 'inline-block',
        }}>▼</span>
      </div>

      {/* Lista — position:fixed para escapar de overflow do modal */}
      {open && (
        <div ref={dropRef} style={{
          position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: Math.max(pos.width, 180),
          background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 8,
          boxShadow: '0 8px 28px rgba(0,0,0,.12)', zIndex: 9999,
          maxHeight: 280, overflowY: 'auto',
        }}>
          {filtered.length === 0 ? (
            <p style={{ padding: '10px 14px', fontSize: 13, color: '#94a3b8', margin: 0 }}>Nenhum resultado</p>
          ) : (
            <div ref={listRef}>
              {filtered.map((opt, idx) => {
                const isHl  = idx === highlighted
                const isSel = opt.value === value
                return (
                  <div key={opt.value}
                    onMouseDown={e => { e.preventDefault(); select(opt.value) }}
                    onMouseEnter={e => { setHighlighted(idx); if (renderPreview) setHoverRect(e.currentTarget.getBoundingClientRect()) }}
                    onMouseLeave={() => { setHighlighted(-1); if (renderPreview) setHoverRect(null) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '10px 14px', cursor: 'pointer', fontSize: 13,
                      background: isHl ? '#e8f0fe' : isSel ? '#f0f4ff' : '#fff',
                      borderBottom: '1px solid #f8fafc',
                      borderLeft: isSel ? '3px solid #1a2d4f' : '3px solid transparent',
                      color: isSel ? '#1a2d4f' : '#1e293b',
                      fontWeight: isSel ? 600 : 400,
                    }}
                  >
                    {opt.icon && <span style={{ fontSize: 16, flexShrink: 0 }}>{opt.icon}</span>}
                    <span style={{ flex: 1 }}>{opt.label}</span>
                    {isSel && <span style={{ color: '#1a2d4f', fontSize: 13, fontWeight: 700 }}>✓</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Pré-visualização flutuante da opção em destaque */}
      {open && renderPreview && hoverRect && highlighted >= 0 && filtered[highlighted] && (
        <OptionPreview anchorRect={hoverRect} dropRect={dropRef.current?.getBoundingClientRect()}>
          {renderPreview(filtered[highlighted])}
        </OptionPreview>
      )}
    </div>
  )
}

/* ── Pré-visualização flutuante ao lado do dropdown — escapa do modal via portal ── */
function OptionPreview({ anchorRect, dropRect, children }) {
  if (!children || !dropRect) return null
  const maxWidth   = 480
  const spaceRight = window.innerWidth - dropRect.right - 12
  const placeRight = spaceRight >= 220
  const left = placeRight
    ? dropRect.right + 8
    : Math.max(12, dropRect.left - 8 - maxWidth)
  const top = Math.min(Math.max(anchorRect.top, 12), window.innerHeight - 12)

  return createPortal(
    <div style={{
      position: 'fixed', top, left, width: 'max-content', maxWidth, zIndex: 9999,
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
      boxShadow: '0 12px 32px rgba(15,23,42,.18)', padding: '12px 16px',
      maxHeight: window.innerHeight - top - 12, overflowY: 'auto',
      pointerEvents: 'none',
    }}>
      {children}
    </div>,
    document.body
  )
}
