import { useState, useRef, useEffect, useMemo } from 'react'
import { configApi } from '../api'

let cachedLanguages = null

/**
 * LanguageSelectPicker — combobox single-select de idioma.
 * Usado em campos de documento (diferente do LanguagePicker do passageiro
 * que é multi-select com idioma nativo + outros).
 * Props: value (string), onChange (v: string) => void
 */
export default function LanguageSelectPicker({ value, onChange }) {
  const [languages,   setLanguages]   = useState(cachedLanguages ?? [])
  const [query,       setQuery]       = useState('')
  const [open,        setOpen]        = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const wrapRef  = useRef(null)
  const inputRef = useRef(null)
  const listRef  = useRef(null)

  useEffect(() => {
    if (cachedLanguages) return
    configApi.languages().then(r => {
      cachedLanguages = r.data.map(l => l.name)
      setLanguages(cachedLanguages)
    }).catch(() => {})
  }, [])

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

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return languages.filter(l => !q || l.toLowerCase().includes(q)).slice(0, 60)
  }, [query, languages])

  const select = (name) => {
    onChange(name); setQuery(''); setOpen(false); inputRef.current?.blur()
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input ref={inputRef} className="fi"
          value={open ? query : (value || '')}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { setQuery(''); setOpen(true) }}
          onKeyDown={e => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h+1, filtered.length-1)) }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h-1, -1)) }
            if (e.key === 'Enter' && filtered.length > 0) { e.preventDefault(); select(highlighted>=0?filtered[highlighted]:filtered[0]) }
          }}
          placeholder="Selecione ou digite o idioma…"
          style={{ paddingRight: value && !open ? 28 : undefined }}
        />
        {value && !open && (
          <button onMouseDown={e => { e.preventDefault(); onChange('') }}
            style={{ position:'absolute', right:7, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:16, lineHeight:1, padding:2 }}>×</button>
        )}
      </div>
      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 3px)', left:0, right:0, background:'#fff', border:'1.5px solid #e2e8f0', borderRadius:8, boxShadow:'0 8px 24px rgba(0,0,0,.12)', zIndex:300, maxHeight:220, overflowY:'auto' }}>
          {filtered.length === 0
            ? <p style={{ padding:'10px 14px', fontSize:13, color:'#94a3b8', margin:0 }}>Nenhum idioma encontrado</p>
            : <div ref={listRef}>
                {filtered.map((lang, idx) => {
                  const isHl = idx === highlighted; const isSel = lang === value
                  return (
                    <div key={lang} onMouseDown={e=>{e.preventDefault();select(lang)}} onMouseEnter={()=>setHighlighted(idx)} onMouseLeave={()=>setHighlighted(-1)}
                      style={{ padding:'8px 14px', cursor:'pointer', fontSize:13, color:isSel?'#2e6db4':'#1e293b', background:isHl?'#e8f0fe':isSel?'#f0f6ff':'transparent', borderLeft:isSel?'3px solid #2e6db4':'3px solid transparent', fontWeight:isSel?600:400 }}>
                      {lang}
                    </div>
                  )
                })}
              </div>
          }
        </div>
      )}
    </div>
  )
}
