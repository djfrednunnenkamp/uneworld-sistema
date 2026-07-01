import { useState, useRef } from 'react'
import { Ic } from './Icon'

const CNH_CLASSES = [
  { id: 'A',  label: 'A',  desc: 'Motocicletas, motonetas e ciclomotores' },
  { id: 'B',  label: 'B',  desc: 'Automóveis e veículos de até 3,5 toneladas' },
  { id: 'C',  label: 'C',  desc: 'Veículos de carga acima de 3,5 toneladas' },
  { id: 'D',  label: 'D',  desc: 'Ônibus, vans e veículos com mais de 8 lugares' },
  { id: 'E',  label: 'E',  desc: 'Combinações de veículos (articulados, bi-trens)' },
  { id: 'AB', label: 'AB', desc: 'Motocicletas + Automóveis' },
  { id: 'AC', label: 'AC', desc: 'Motocicletas + Veículos de carga' },
  { id: 'AD', label: 'AD', desc: 'Motocicletas + Ônibus / Passageiros' },
  { id: 'AE', label: 'AE', desc: 'Motocicletas + Articulados / bi-trens' },
]

export default function CnhClassPicker({ value, onChange }) {
  const [open,  setOpen]  = useState(false)
  const overlayRef = useRef(null)

  const pick = (id) => { onChange(id); setOpen(false) }

  return (
    <>
      <input
        className="fi"
        readOnly
        value={value ? `Categoria ${value}` : ''}
        placeholder="Clique para selecionar…"
        onClick={() => setOpen(true)}
        style={{ cursor: 'pointer', caretColor: 'transparent' }}
      />

      {open && (
        <div
          ref={overlayRef}
          onClick={(e) => { if (e.target === overlayRef.current) setOpen(false) }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15,23,42,.42)',
            backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 500, padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 400,
              boxShadow: '0 24px 64px rgba(0,0,0,.22)',
              animation: 'mIn .15s ease',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>
                    Categoria da CNH
                  </p>
                  <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                    Selecione a categoria habilitada
                  </p>
                </div>
                <button type="button" onClick={() => setOpen(false)} title="Fechar" style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', padding:4, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, flexShrink:0 }}><Ic n="x" s={16}/></button>
              </div>
            </div>

            {/* Lista */}
            <div style={{ padding: '8px 0', maxHeight: 360, overflowY: 'auto' }}>
              {CNH_CLASSES.map((c) => {
                const selected = value === c.id
                return (
                  <div
                    key={c.id}
                    onClick={() => pick(c.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '11px 18px', cursor: 'pointer',
                      background: selected ? '#f0f6ff' : 'transparent',
                      borderLeft: selected ? '3px solid #2e6db4' : '3px solid transparent',
                      transition: 'all .1s',
                    }}
                    onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = '#f8fafc' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = selected ? '#f0f6ff' : 'transparent' }}
                  >
                    {/* Badge da categoria */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: selected ? '#2e6db4' : '#f1f5f9',
                      color: selected ? '#fff' : '#475569',
                      fontWeight: 700, fontSize: 14, letterSpacing: '-.01em',
                      transition: 'all .12s',
                    }}>
                      {c.label}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: selected ? 600 : 500, color: selected ? '#2e6db4' : '#1e293b', margin: 0 }}>
                        Categoria {c.label}
                      </p>
                      <p style={{ fontSize: 11.5, color: '#94a3b8', margin: 0, marginTop: 2, lineHeight: 1.4 }}>
                        {c.desc}
                      </p>
                    </div>
                    {selected && <span style={{ color: '#2e6db4', flexShrink: 0, fontSize: 16 }}>✓</span>}
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setOpen(false)}
                style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
