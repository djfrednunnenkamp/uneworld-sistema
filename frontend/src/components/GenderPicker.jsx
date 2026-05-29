import { useState, useRef, useEffect } from 'react'
import { Ic } from './Icon'

const OPTIONS = [
  { val: 'F', label: 'Feminino'  },
  { val: 'M', label: 'Masculino' },
  { val: 'O', label: 'Outro'     },
]

const DISPLAY = { F: 'Feminino', M: 'Masculino' }

export default function GenderPicker({ value, customValue, onChange }) {
  const [open,   setOpen]   = useState(false)
  const [draft,  setDraft]  = useState(value || '')
  const [custom, setCustom] = useState(customValue || '')
  const overlayRef = useRef(null)
  const customRef  = useRef(null)

  useEffect(() => {
    if (open) {
      setDraft(value || '')
      setCustom(customValue || '')
    }
  }, [open])

  useEffect(() => {
    if (draft === 'O') setTimeout(() => customRef.current?.focus(), 60)
  }, [draft])

  const save = () => {
    onChange(draft, draft === 'O' ? custom : '')
    setOpen(false)
  }

  const handleOverlay = (e) => {
    if (e.target === overlayRef.current) save()
  }

  /* Label exibida no campo */
  const displayLabel = value === 'O'
    ? (customValue?.trim() || 'Outro')
    : (DISPLAY[value] || '')

  return (
    <>
      <input
        className="fi"
        readOnly
        value={displayLabel}
        placeholder="Clique para selecionar…"
        onClick={() => setOpen(true)}
        style={{ cursor: 'pointer', caretColor: 'transparent' }}
      />

      {open && (
        <div
          ref={overlayRef}
          onClick={handleOverlay}
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
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 380,
              boxShadow: '0 24px 64px rgba(0,0,0,.22)',
              animation: 'mIn .15s ease',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid #e2e8f0' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>
                Selecionar gênero
              </p>
            </div>

            {/* Opções */}
            <div style={{ padding: '6px 0' }}>
              {OPTIONS.map(({ val, label }) => {
                const selected = draft === val
                return (
                  <div
                    key={val}
                    onClick={() => setDraft(val)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '11px 18px', cursor: 'pointer',
                      background: selected ? '#f0f6ff' : 'transparent',
                      transition: 'background .1s',
                    }}
                    onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = '#f8fafc' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = selected ? '#f0f6ff' : 'transparent' }}
                  >
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${selected ? '#2e6db4' : '#e2e8f0'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'border-color .12s',
                    }}>
                      {selected && (
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2e6db4' }} />
                      )}
                    </div>
                    <span style={{ fontSize: 13, color: '#1e293b', fontWeight: selected ? 600 : 400 }}>
                      {label}
                    </span>
                    {selected && val !== 'O' && (
                      <span style={{ marginLeft: 'auto', color: '#2e6db4' }}><Ic n="check" s={14} /></span>
                    )}
                  </div>
                )
              })}

              {/* Campo livre quando "Outro" está selecionado */}
              {draft === 'O' && (
                <div style={{ padding: '4px 18px 10px' }}>
                  <input
                    ref={customRef}
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    placeholder="Digite o gênero…"
                    style={{
                      width: '100%', padding: '7px 10px',
                      border: '1px solid #e2e8f0', borderRadius: 6,
                      fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b',
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#2e6db4'}
                    onBlur={(e)  => e.target.style.borderColor = '#e2e8f0'}
                    onKeyDown={(e) => e.key === 'Enter' && save()}
                  />
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '12px 18px', borderTop: '1px solid #e2e8f0',
              display: 'flex', justifyContent: 'flex-end', gap: 8,
            }}>
              <button
                onClick={() => setOpen(false)}
                style={{
                  padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0',
                  background: '#fff', color: '#475569', fontSize: 13,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={save}
                style={{
                  padding: '6px 16px', borderRadius: 6, border: 'none',
                  background: '#2e6db4', color: '#fff', fontSize: 13,
                  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#275fa0'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#2e6db4'}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
