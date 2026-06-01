import { useState, useRef, useEffect, useMemo } from 'react'

const LANGUAGES = [
  'Afrikaans','Albanês','Alemão','Amárico','Árabe','Aramaico','Armênio',
  'Azerbaijano','Basco','Bengalês','Bielorrusso','Birmanês','Bósnio',
  'Búlgaro','Catalão','Cazaque','Chinês (Cantonês)','Chinês (Mandarim)',
  'Cingalês','Coreano','Croata','Curdo','Dinamarquês','Eslovaco','Esloveno',
  'Espanhol','Estoniano','Filipino','Finlandês','Francês','Galego',
  'Georgiano','Grego','Gujarati','Hausa','Hebraico','Hindi','Holandês',
  'Húngaro','Igbo','Indonésio','Inglês','Islandês','Italiano','Japonês',
  'Javanês','Khmer','Laociano','Letão','Lituano','Macedônio','Malaio',
  'Malaiala','Maltês','Maori','Marata','Mongol','Nepalês','Norueguês',
  'Persa','Polonês','Português','Português (Portugal)','Romeno','Russo',
  'Sérvio','Somali','Sueco','Suaíli','Tagalo','Tailandês','Tâmil',
  'Tcheco','Télugu','Turco','Ucraniano','Urdu','Uzbeque','Vietnamita',
  'Xhosa','Iorubá','Zulu',
].sort((a, b) => a.localeCompare(b, 'pt'))

const drop = {
  position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0,
  background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 300,
  maxHeight: 200, overflowY: 'auto',
}

function LangCombo({ value, exclude, placeholder, onSelect, onClear }) {
  const [query,       setQuery]       = useState('')
  const [open,        setOpen]        = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const wrapRef  = useRef(null)
  const inputRef = useRef(null)
  const listRef  = useRef(null)

  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => { setHighlighted(-1) }, [query])
  useEffect(() => {
    if (listRef.current && highlighted >= 0) {
      listRef.current.children[highlighted]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlighted])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return LANGUAGES.filter(l =>
      !exclude.includes(l) &&
      (!q || l.toLowerCase().includes(q))
    ).slice(0, 60)
  }, [query, exclude])

  const select = (lang) => {
    onSelect(lang)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          className="fi"
          value={open ? query : (value || '')}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { setQuery(''); setOpen(true) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)) }
            if (e.key === 'Enter' && filtered.length > 0) {
              e.preventDefault()
              select(highlighted >= 0 ? filtered[highlighted] : filtered[0])
            }
          }}
          placeholder={placeholder}
          style={{ paddingRight: value ? 28 : undefined }}
        />
        {value && !open && (
          <button
            onMouseDown={(e) => { e.preventDefault(); onClear() }}
            style={{
              position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8',
              fontSize: 15, lineHeight: 1, padding: 2,
            }}
          >×</button>
        )}
      </div>
      {open && (
        <div style={drop}>
          {filtered.length === 0 ? (
            <p style={{ padding: '10px 14px', fontSize: 13, color: '#94a3b8', margin: 0 }}>Nenhum idioma encontrado</p>
          ) : <div ref={listRef}>{filtered.map((lang, idx) => {
            const isHl  = idx === highlighted
            const isSel = lang === value
            return (
              <div
                key={lang}
                onMouseDown={(e) => { e.preventDefault(); select(lang) }}
                onMouseEnter={() => setHighlighted(idx)}
                onMouseLeave={() => setHighlighted(-1)}
                style={{
                  padding: '8px 14px', cursor: 'pointer', fontSize: 13, color: isSel ? '#2e6db4' : '#1e293b',
                  borderLeft: isSel ? '3px solid #2e6db4' : '3px solid transparent',
                  background: isHl ? '#e8f0fe' : isSel ? '#f0f6ff' : 'transparent',
                  fontWeight: isSel ? 600 : 400,
                }}
              >
                {lang}
              </div>
            )
          })}</div>}
        </div>
      )}
    </div>
  )
}

export default function LanguagePicker({ nativeLang, otherLangs, onChangeNative, onChangeOthers }) {
  const others = useMemo(
    () => otherLangs ? otherLangs.split(',').map(s => s.trim()).filter(Boolean) : [],
    [otherLangs]
  )

  const addOther = (lang) => {
    if (!others.includes(lang) && lang !== nativeLang) {
      onChangeOthers([...others, lang].join(','))
    }
  }
  const removeOther = (lang) => {
    onChangeOthers(others.filter(l => l !== lang).join(','))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Idioma nativo */}
      <LangCombo
        value={nativeLang}
        exclude={others}
        placeholder="Idioma nativo…"
        onSelect={onChangeNative}
        onClear={() => onChangeNative('')}
      />

      {/* Outros idiomas — tags + combobox */}
      <div>
        {others.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
            {others.map(lang => (
              <span key={lang} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 20,
                background: '#f0f6ff', border: '1px solid #bfdbfe',
                fontSize: 12, color: '#2e6db4', fontWeight: 500,
              }}>
                {lang}
                <button
                  onMouseDown={(e) => { e.preventDefault(); removeOther(lang) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#93c5fd', fontSize: 14, lineHeight: 1, padding: 0 }}
                >×</button>
              </span>
            ))}
          </div>
        )}
        <LangCombo
          value={null}
          exclude={nativeLang ? [nativeLang, ...others] : others}
          placeholder="Adicionar outro idioma…"
          onSelect={addOther}
          onClear={() => {}}
        />
      </div>
    </div>
  )
}
