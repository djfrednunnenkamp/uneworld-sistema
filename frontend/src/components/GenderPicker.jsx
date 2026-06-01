import { useState, useRef, useEffect, useMemo } from 'react'
import { configApi } from '../api'

let cachedGenders = null

const drop = {
  position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0,
  background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 300,
  maxHeight: 220, overflowY: 'auto',
}

// Fallback estático caso o banco ainda não tenha sido configurado
const FALLBACK = ['Feminino', 'Masculino', 'Não-binário', 'Outro']

/**
 * GenderPicker — combobox com lista de gêneros do banco.
 * Permite texto livre. ↑↓ + Enter para navegar.
 * Props: value (string), onChange (v: string) => void
 * (customValue/onChange with 2 args mantidos por compatibilidade)
 */
export default function GenderPicker({ value, customValue, onChange }) {
  const [genders,     setGenders]     = useState(cachedGenders ?? FALLBACK)
  const [query,       setQuery]       = useState('')
  const [open,        setOpen]        = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const wrapRef  = useRef(null)
  const inputRef = useRef(null)
  const listRef  = useRef(null)

  // Carrega lista do banco
  useEffect(() => {
    if (cachedGenders) return
    configApi.genders().then(r => {
      cachedGenders = r.data.map(g => g.name)
      setGenders(cachedGenders)
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
    if (listRef.current && highlighted >= 0)
      listRef.current.children[highlighted]?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  // Valor de exibição — compatibilidade com armazenamento legado (F/M/NB)
  const LEGACY = { F: 'Feminino', M: 'Masculino', NB: 'Não-binário', O: customValue?.trim() || 'Outro' }
  const displayValue = LEGACY[value] || value || ''

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return genders.filter(g => !q || g.toLowerCase().includes(q)).slice(0, 40)
  }, [query, genders])

  const select = (name) => {
    // Chama onChange com novo valor; para compatibilidade, passa ('', '') como segundo arg se for Outro
    if (typeof onChange === 'function') onChange(name, '')
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)) }
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault()
      select(highlighted >= 0 ? filtered[highlighted] : filtered[0])
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          className="fi"
          value={open ? query : displayValue}
          onChange={e => { setQuery(e.target.value); onChange(e.target.value, ''); setOpen(true) }}
          onFocus={() => { setQuery(''); setOpen(true) }}
          onKeyDown={handleKeyDown}
          placeholder="Digite para buscar…"
          style={{ paddingRight: value && !open ? 28 : undefined }}
        />
        {value && !open && (
          <button
            onMouseDown={e => { e.preventDefault(); onChange('', '') }}
            style={{ position:'absolute', right:7, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:16, lineHeight:1, padding:2 }}
          >×</button>
        )}
      </div>

      {open && (
        <div style={drop}>
          {filtered.length === 0 ? (
            <p style={{ padding:'10px 14px', fontSize:13, color:'#94a3b8', margin:0 }}>Nenhum resultado</p>
          ) : (
            <div ref={listRef}>
              {filtered.map((name, idx) => {
                const isHl  = idx === highlighted
                const isSel = displayValue === name
                return (
                  <div key={name}
                    onMouseDown={e => { e.preventDefault(); select(name) }}
                    onMouseEnter={() => setHighlighted(idx)}
                    onMouseLeave={() => setHighlighted(-1)}
                    style={{
                      padding:'9px 14px', cursor:'pointer', fontSize:13,
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
