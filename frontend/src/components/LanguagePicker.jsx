import { useState, useRef, useEffect, useMemo } from 'react'
import { Ic } from './Icon'

const LANGUAGES = [
  'Afrikaans','Albanês','Alemão','Amárico','Árabe','Aramaico','Armênio',
  'Azerbaijano','Basco','Bengalês','Bielorrusso','Birmanês','Bósnio',
  'Búlgaro','Catalão','Cazaque','Chetxeno','Chinês (Cantonês)','Chinês (Mandarim)',
  'Cingalês','Coreano','Croata','Curdo','Dinamarquês','Eslovaco','Esloveno',
  'Espanhol','Estoniano','Filipino','Finlandês','Francês','Gaélico Escocês',
  'Galego','Georgiano','Grego','Gujarati','Hausa','Hebraico','Hindi',
  'Holandês','Húngaro','Igbo','Indonésio','Inglês','Islandês','Italiano',
  'Japonês','Javanês','Khmer','Laociano','Latim','Letão','Lituano',
  'Luxemburguês','Macedônio','Malaio','Malaiala','Malagasy','Maltês',
  'Maori','Marata','Mongol','Nepalês','Norueguês','Panjabi','Pastó',
  'Persa','Polonês','Português','Português (Portugal)','Punjabi',
  'Romeno','Russo','Servo-Croata','Sérvio','Sindhi','Somali','Sueco',
  'Suaíli','Sundanês','Tagalo','Tailandês','Tâmil','Tcheco','Télugu',
  'Tibetano','Tigrínia','Turco','Ucraniano','Urdu','Uzbeque',
  'Vietnamita','Xhosa','Iorubá','Zulu',
].sort((a, b) => a.localeCompare(b, 'pt'))

export default function LanguagePicker({ nativeLang, otherLangs, onChangeNative, onChangeOthers }) {
  const [open,    setOpen]    = useState(false)
  const [search,  setSearch]  = useState('')
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
      return [...prev, { name: lang, isNative: prev.length === 0 }]
    })
  }

  const setNative = (lang) => {
    setSelected(prev => prev.map(l => ({ ...l, isNative: l.name === lang })))
  }

  const moveUp = (lang) => {
    setSelected(prev => {
      const i = prev.findIndex(l => l.name === lang)
      if (i <= 0) return prev
      const arr = [...prev]
      ;[arr[i-1], arr[i]] = [arr[i], arr[i-1]]
      return arr
    })
  }

  const filtered = useMemo(() =>
    LANGUAGES.filter(l => l.toLowerCase().includes(search.toLowerCase()))
  , [search])

  const isSelected = (lang) => !!selected.find(l => l.name === lang)
  const isNative   = (lang) => !!selected.find(l => l.name === lang && l.isNative)

  /* Campo display */
  const displayParts = selected.map(l => l.isNative ? `${l.name} (nativa)` : l.name)
  const fieldValue   = displayParts.join(' · ')

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
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 500,
              boxShadow: '0 24px 64px rgba(0,0,0,.22)',
              display: 'flex', flexDirection: 'column',
              maxHeight: '88vh', animation: 'mIn .15s ease',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 10 }}>
                Idiomas falados
              </p>
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

            {/* Selecionados */}
            {selected.length > 0 && (
              <div style={{ padding: '10px 18px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                  Idiomas selecionados
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {selected.map((l, i) => (
                    <div key={l.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {/* Botão subir */}
                      <button
                        onClick={() => moveUp(l.name)}
                        disabled={i === 0}
                        style={{ fontSize: 10, color: i === 0 ? '#e2e8f0' : '#94a3b8', background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', padding: 2, flexShrink: 0 }}
                      >▲</button>

                      {/* Nome */}
                      <span style={{ flex: 1, fontSize: 13, color: '#1e293b', fontWeight: l.isNative ? 600 : 400 }}>
                        {l.name}
                      </span>

                      {/* Nativa toggle */}
                      <button
                        onClick={() => setNative(l.name)}
                        style={{
                          padding: '2px 8px', borderRadius: 10,
                          border: `1px solid ${l.isNative ? '#2e6db4' : '#e2e8f0'}`,
                          background: l.isNative ? '#2e6db4' : '#fff',
                          color: l.isNative ? '#fff' : '#94a3b8',
                          fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                          flexShrink: 0, transition: 'all .12s',
                        }}
                      >
                        {l.isNative ? '★ Nativa' : 'Nativa?'}
                      </button>

                      {/* Remover */}
                      <button
                        onClick={() => toggle(l.name)}
                        style={{ fontSize: 14, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                        title="Remover"
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lista */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filtered.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' }}>
                  Nenhum idioma encontrado
                </p>
              ) : filtered.map((lang) => {
                const sel  = isSelected(lang)
                const nat  = isNative(lang)
                return (
                  <div
                    key={lang}
                    onClick={() => toggle(lang)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 18px', cursor: 'pointer',
                      background: sel ? '#f0f6ff' : 'transparent',
                      transition: 'background .1s',
                    }}
                    onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = '#f8fafc' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = sel ? '#f0f6ff' : 'transparent' }}
                  >
                    <input type="checkbox" readOnly checked={sel} style={{ width: 15, height: 15, accentColor: '#2e6db4', flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13, color: sel ? '#2e6db4' : '#1e293b', fontWeight: sel ? 600 : 400 }}>
                      {lang}
                    </span>
                    {nat && <span style={{ fontSize: 11, color: '#2e6db4', fontWeight: 700 }}>★ nativa</span>}
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
              <button
                onClick={() => setSelected([])}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Limpar
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setOpen(false)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
                <button onClick={save} style={{ padding: '6px 18px', borderRadius: 6, border: 'none', background: '#2e6db4', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#275fa0'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#2e6db4'}
                >Salvar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
