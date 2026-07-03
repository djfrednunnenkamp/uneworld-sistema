import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Ic } from './Icon'

// Níveis hierárquicos da seção "Continentes, Países, Estados e Cidades" —
// escolher um nível exporta ele e todos os anteriores (Cidades = Continentes
// + Países + Estados + Cidades; Países = Continentes + Países; etc.).
const GEO_LEVELS = [
  { key: 'continentes', label: 'Continentes', icon: 'globe'    },
  { key: 'paises',      label: 'Países',      icon: 'pin'      },
  { key: 'estados',     label: 'Estados',     icon: 'mapicon'  },
  { key: 'cidades',     label: 'Cidades',     icon: 'building' },
]

/**
 * Modal de seleção de seções para exportar o CSV global.
 *
 * Props:
 *   sections        – [{ key, label }] filtrado pelas permissões do usuário
 *   countries       – [{id, name}] lista de países (não usada mais — mantida
 *                     na assinatura por compatibilidade com quem chama)
 *   onClose()
 *   onExport({ selectedKeys: Set, geoLevel: 'paises'|'estados'|'cidades' })
 */
export default function CsvExportModal({ sections, countries = [], onClose, onExport }) {
  const [selected, setSelected]       = useState(() => new Set(sections.map(s => s.key)))
  const [geoLevel, setGeoLevel]       = useState('cidades')
  const [exporting, setExporting]     = useState(false)
  const [progress,  setProgress]      = useState(0)
  const [filterPopup, setFilterPopup] = useState(null)

  const toggle = (key) => setSelected(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const toggleAll = (val) => {
    setSelected(val ? new Set(sections.map(s => s.key)) : new Set())
  }

  const allChecked  = selected.size === sections.length
  const noneChecked = selected.size === 0

  const handleExport = async () => {
    if (noneChecked || exporting) return
    setExporting(true)
    setProgress(4)
    let p = 4
    const interval = setInterval(() => {
      p = p + (88 - p) * 0.12
      setProgress(Math.min(p, 88))
    }, 250)
    try {
      await onExport({ selectedKeys: selected, geoLevel })
      clearInterval(interval)
      setProgress(100)
      await new Promise(r => setTimeout(r, 380))
      onClose()
    } catch {
      clearInterval(interval)
      setExporting(false)
      setProgress(0)
    }
  }

  return (
    <div className="overlay" style={{ zIndex: 800 }}
      onMouseDown={e => { if (e.target === e.currentTarget && !exporting) onClose() }}>
      <div className="mbox" style={{ maxWidth: 500, width: '100%' }}>

        <div className="mhead">
          <span className="mtitle">Exportar CSV — selecionar seções</span>
          {!exporting && <button className="mclose" onClick={onClose}><Ic n="x" s={14}/></button>}
        </div>

        <div className="mbody" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {exporting ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:20, padding:'24px 0 8px' }}>
              <div style={{ color:'#059669' }}><Ic n="dl" s={40}/></div>
              <div style={{ textAlign:'center' }}>
                <p style={{ margin:'0 0 4px', fontSize:14, fontWeight:600, color:'#1e293b' }}>
                  {progress >= 100 ? 'Preparando download…' : 'Coletando dados…'}
                </p>
                <p style={{ margin:0, fontSize:12.5, color:'#64748b' }}>Aguarde enquanto geramos o arquivo.</p>
              </div>
              <div style={{ width:'100%', background:'#e2e8f0', borderRadius:99, height:8, overflow:'hidden' }}>
                <div style={{
                  height:'100%', borderRadius:99,
                  background: progress >= 100 ? '#22c55e' : '#059669',
                  width:`${Math.round(progress)}%`,
                  transition:'width .22s ease, background .3s ease',
                }}/>
              </div>
              <p style={{ margin:0, fontSize:13, fontWeight:700, color: progress >= 100 ? '#16a34a' : '#059669' }}>
                {Math.round(progress)}%
              </p>
            </div>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
                Escolha quais seções incluir no arquivo CSV baixado.
              </p>

              {/* Marcar / desmarcar tudo */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => toggleAll(true)}  disabled={allChecked}
                  style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', fontSize: 12, cursor: allChecked ? 'default' : 'pointer', color: '#475569', fontFamily: 'inherit', opacity: allChecked ? .5 : 1 }}>
                  Marcar tudo
                </button>
                <button onClick={() => toggleAll(false)} disabled={noneChecked}
                  style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', fontSize: 12, cursor: noneChecked ? 'default' : 'pointer', color: '#475569', fontFamily: 'inherit', opacity: noneChecked ? .5 : 1 }}>
                  Desmarcar tudo
                </button>
              </div>

              {/* Lista de seções */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: '6px 16px', background: '#f8fafc', borderRadius: 8, padding: '12px 14px', border: '1px solid #e2e8f0' }}>
                {sections.map(sec => {
                  const hasFilter = sec.key === 'countries' && selected.has(sec.key)
                  const filterActive = sec.key === 'countries' && geoLevel !== 'cidades'
                  const levelIdx = GEO_LEVELS.findIndex(l => l.key === geoLevel)
                  return (
                    <div key={sec.key} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 0' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13, color: '#1e293b', flex: 1, minWidth: 0 }}>
                        <input
                          type="checkbox"
                          checked={selected.has(sec.key)}
                          onChange={() => toggle(sec.key)}
                          style={{ accentColor: '#1a2d4f', width: 14, height: 14, flexShrink: 0 }} />
                        {sec.label}
                      </label>
                      {hasFilter && (
                        <button type="button"
                          onClick={() => setFilterPopup(sec.key)}
                          title={filterActive ? `Exportando até: ${GEO_LEVELS[levelIdx].label}` : 'Configurar níveis'}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 22, height: 22, borderRadius: 5, border: 'none', cursor: 'pointer', flexShrink: 0,
                            background: filterActive ? '#dbeafe' : 'transparent',
                            color: filterActive ? '#1d4ed8' : '#94a3b8',
                          }}>
                          <Ic n="filter" s={12} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

        </div>

        {!exporting && (
          <div className="mfoot" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={onClose}
              style={{ padding: '8px 18px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancelar
            </button>
            <button
              disabled={noneChecked}
              onClick={handleExport}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px', borderRadius: 7, border: 'none', background: noneChecked ? '#e2e8f0' : '#059669', color: noneChecked ? '#94a3b8' : '#fff', fontSize: 13, fontWeight: 600, cursor: noneChecked ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
              <Ic n="dl" s={14}/> Baixar CSV
            </button>
          </div>
        )}

      </div>

      {filterPopup === 'countries' && createPortal(
        <GeoLevelPopup geoLevel={geoLevel} onChoose={setGeoLevel} onClose={() => setFilterPopup(null)} />,
        document.body
      )}
    </div>
  )
}

/* Pop-up secundário (sua própria janela, com fundo escurecido e X de
   fechar) — não é um dropdown ancorado no ícone, é independente. */
function GeoLevelPopup({ geoLevel, onChoose, onClose }) {
  const levelIdx = GEO_LEVELS.findIndex(l => l.key === geoLevel)
  const lbl11 = { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
    }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: '#fff', borderRadius: 14, width: '100%', maxWidth: 400,
        boxShadow: '0 24px 64px rgba(0,0,0,.28)', padding: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ color: '#2563eb', display: 'flex' }}><Ic n="globe" s={14} /></span>
            <span style={{ ...lbl11, color: '#1d4ed8' }}>Continentes, Países, Estados e Cidades</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 2, display: 'flex' }}>
            <Ic n="x" s={15} />
          </button>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: '#64748b' }}>
          Esta seção tem quatro níveis. Escolha até onde detalhar a exportação.
        </p>
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 8,
          background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px 8px', marginBottom: 14,
        }}>
          {GEO_LEVELS.map((lvl, i) => (
            <div key={lvl.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {i > 0 && <span style={{ color: '#cbd5e1', marginTop: 18 }}><Ic n="chevron" s={14} /></span>}
              <button type="button" onClick={() => onChoose(lvl.key)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px 4px',
                  borderBottom: i === levelIdx ? '2px solid #2563eb' : '2px solid transparent',
                  fontFamily: 'inherit',
                }}>
                <span style={{
                  width: 36, height: 36, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: i <= levelIdx ? '#2563eb' : '#cbd5e1', color: '#fff', transition: 'background .12s',
                }}>
                  <Ic n={lvl.icon} s={16} />
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: i === levelIdx ? '#1d4ed8' : '#475569' }}>
                  {lvl.label}
                </span>
              </button>
            </div>
          ))}
        </div>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#2563eb', display: 'flex' }}><Ic n="check" s={13} /></span>
          Exportando <strong style={{ color: '#1d4ed8' }}>{GEO_LEVELS.slice(0, levelIdx + 1).map(l => l.label).join(' + ')}</strong>
        </p>
        <button onClick={onClose}
          style={{ width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          Confirmar
        </button>
      </div>
    </div>
  )
}
