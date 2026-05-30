import { useState, useRef, useEffect, useMemo } from 'react'
import { Ic } from './Icon'

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

export default function LanguagePicker({ nativeLang, otherLangs, onChangeNative, onChangeOthers }) {
  const [open,     setOpen]     = useState(false)
  const [search,   setSearch]   = useState('')
  const [selected, setSelected] = useState([])  // [{name, isNative}]
  const overlayRef = useRef(null)
  const searchRef  = useRef(null)

  useEffect(() => {
    if (open) {
      const others = otherLangs ? otherLangs.split(',').map(s => s.trim()).filter(Boolean) : []
      const all = []
      if (nativeLang) all.push({ name: nativeLang, isNative: true })
      others.forEach(l => { if (l !== nativeLang) all.push({ name: l, isNative: false }) })
      setSelected(all)
      setSearch('')
      setTimeout(() => searchRef.current?.focus(), 80)
    }
  }, [open])

  const save = () => {
    const native = selected.find(l => l.isNative)?.name ?? ''
    const others = selected.filter(l => !l.isNative).map(l => l.name).join(',')
    onChangeNative(native)
    onChangeOthers(others)
    setOpen(false)
  }

  const toggle = (lang) => {
    setSelected(prev => {
      const exists = prev.find(l => l.name === lang)
      if (exists) return prev.filter(l => l.name !== lang)
      const isFirst = prev.length === 0
      return [...prev, { name: lang, isNative: isFirst }]
    })
  }

  const setNative = (e, lang) => {
    e.stopPropagation()
    setSelected(prev => prev.map(l => ({ ...l, isNative: l.name === lang })))
  }

  const isSelected = (lang) => !!selected.find(l => l.name === lang)
  const isNative   = (lang) => !!selected.find(l => l.name === lang && l.isNative)

  /* Lista: selecionados no topo, depois restantes filtrados */
  const list = useMemo(() => {
    const q = search.toLowerCase()
    const sel  = selected.map(l => l.name).filter(n => !q || n.toLowerCase().includes(q))
    const rest = LANGUAGES.filter(l => !isSelected(l) && (!q || l.toLowerCase().includes(q)))
    return { sel, rest }
  }, [search, selected])

  const fieldValue = selected.map(l => l.isNative ? `${l.name} ★` : l.name).join(' · ')

  return (
    <>
      <input
        className="fi"
        readOnly
        value={fieldValue}
        placeholder="Clique para selecionar idiomas…"
        onClick={() => setOpen(true)}
        style={{ cursor: 'pointer', caretColor: 'transparent' }}
      />

      {open && (
        <div
          ref={overlayRef}
          onClick={(e) => { if (e.target === overlayRef.current) save() }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15,23,42,.42)',
            backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 400, padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 460,
              boxShadow: '0 24px 64px rgba(0,0,0,.22)',
              display: 'flex', flexDirection: 'column',
              maxHeight: '85vh', animation: 'mIn .15s ease',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>
                  Idiomas falados
                </p>
                {selected.length > 0 && (
                  <span style={{ fontSize: 12, color: '#2e6db4', fontWeight: 600 }}>
                    {selected.length} selecionado{selected.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', display: 'flex' }}>
                  <Ic n="search" s={14} />
                </span>
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar idioma…"
                  style={{
                    width: '100%', padding: '7px 11px 7px 31px',
                    border: '1px solid #e2e8f0', borderRadius: 6,
                    fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b',
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#2e6db4'}
                  onBlur={(e)  => e.target.style.borderColor = '#e2e8f0'}
                />
              </div>
            </div>

            {/* Lista */}
            <div style={{ flex: 1, overflowY: 'auto' }}>

              {/* Selecionados no topo */}
              {list.sel.length > 0 && (
                <>
                  {list.sel.map((lang) => (
                    <LangRow
                      key={lang}
                      lang={lang}
                      selected
                      native={isNative(lang)}
                      onToggle={() => toggle(lang)}
                      onSetNative={(e) => setNative(e, lang)}
                    />
                  ))}
                  {list.rest.length > 0 && (
                    <div style={{ height: 1, background: '#f1f5f9', margin: '4px 0' }} />
                  )}
                </>
              )}

              {/* Não selecionados */}
              {list.rest.map((lang) => (
                <LangRow
                  key={lang}
                  lang={lang}
                  selected={false}
                  native={false}
                  onToggle={() => toggle(lang)}
                  onSetNative={null}
                />
              ))}

              {list.sel.length === 0 && list.rest.length === 0 && (
                <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' }}>
                  Nenhum idioma encontrado
                </p>
              )}
            </div>

            {/* Dica */}
            {selected.length > 0 && (
              <div style={{ padding: '8px 18px', background: '#f8fafc', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
                <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>
                  Clique em ★ para marcar como língua materna
                </p>
              </div>
            )}

            {/* Footer */}
            <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
              <button
                onClick={() => setSelected([])}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Limpar
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setOpen(false)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancelar
                </button>
                <button onClick={save}
                  style={{ padding: '6px 18px', borderRadius: 6, border: 'none', background: '#2e6db4', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#275fa0'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#2e6db4'}
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function LangRow({ lang, selected, native, onToggle, onSetNative }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 18px', cursor: 'pointer',
        background: selected ? '#f0f6ff' : hover ? '#f8fafc' : 'transparent',
        transition: 'background .1s',
      }}
    >
      <input
        type="checkbox"
        readOnly
        checked={selected}
        style={{ width: 15, height: 15, accentColor: '#2e6db4', flexShrink: 0 }}
      />
      <span style={{ flex: 1, fontSize: 13, color: selected ? '#2e6db4' : '#1e293b', fontWeight: selected ? 600 : 400 }}>
        {lang}
      </span>
      {selected && onSetNative && (
        <button
          onClick={onSetNative}
          title={native ? 'Língua materna' : 'Marcar como materna'}
          style={{
            fontSize: 16, lineHeight: 1,
            background: 'none', border: 'none',
            color: native ? '#f59e0b' : '#d1d5db',
            cursor: 'pointer', padding: '0 2px',
            transition: 'color .15s', flexShrink: 0,
          }}
          onMouseEnter={(e) => { if (!native) e.currentTarget.style.color = '#fbbf24' }}
          onMouseLeave={(e) => { if (!native) e.currentTarget.style.color = '#d1d5db' }}
        >
          ★
        </button>
      )}
    </div>
  )
}
