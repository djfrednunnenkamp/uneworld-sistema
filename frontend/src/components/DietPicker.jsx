import { useState, useRef, useEffect } from 'react'
import { Ic } from './Icon'

const DIET_OPTIONS = [
  { id: 'standard',       icon: '🍽️',  label: 'Padrão',               sub: 'Sem restrições alimentares' },
  { id: 'vegetarian',     icon: '🥗',  label: 'Vegetariano',           sub: 'Sem carnes, pode consumir derivados animais' },
  { id: 'vegan',          icon: '🌱',  label: 'Vegano',                sub: 'Sem produtos de origem animal' },
  { id: 'gluten_free',    icon: '🌾',  label: 'Sem glúten',            sub: 'Intolerância ou doença celíaca' },
  { id: 'lactose_free',   icon: '🥛',  label: 'Sem lactose',           sub: 'Intolerância à lactose' },
  { id: 'kosher',         icon: '✡️',  label: 'Kosher',               sub: 'Alimentação conforme lei judaica' },
  { id: 'halal',          icon: '☪️',  label: 'Halal',                sub: 'Alimentação conforme lei islâmica' },
  { id: 'low_sodium',     icon: '🧂',  label: 'Baixo teor de sódio',  sub: 'Restrição de sal' },
  { id: 'diabetic',       icon: '🩸',  label: 'Diabético',            sub: 'Baixo teor de açúcar' },
  { id: 'seafood_free',   icon: '🦞',  label: 'Sem frutos do mar',    sub: 'Alergia ou restrição a frutos do mar' },
  { id: 'nut_free',       icon: '🥜',  label: 'Sem oleaginosas',      sub: 'Alergia a nozes, amendoim, castanhas' },
  { id: 'low_fat',        icon: '🥦',  label: 'Baixo teor de gordura',sub: 'Dieta com restrição de gordura' },
  { id: 'raw',            icon: '🥬',  label: 'Crudívoro',            sub: 'Alimentação crua, sem processamento' },
]

export default function DietPicker({ value, notes, onChange, onChangeNotes }) {
  const [open,      setOpen]      = useState(false)
  const [draftVal,  setDraftVal]  = useState(value  || '')
  const [draftNotes,setDraftNotes]= useState(notes  || '')
  const overlayRef = useRef(null)
  const notesRef   = useRef(null)

  useEffect(() => {
    if (open) {
      setDraftVal(value  || '')
      setDraftNotes(notes || '')
    }
  }, [open])

  const save = () => {
    onChange(draftVal)
    onChangeNotes(draftNotes)
    setOpen(false)
  }

  const handleOverlay = (e) => {
    if (e.target === overlayRef.current) save()
  }

  /* Label do campo */
  const typeLabel = DIET_OPTIONS.find((d) => d.id === value)?.label ?? ''
  const fieldValue = [typeLabel, notes?.trim() ? `"${notes.trim().slice(0, 40)}${notes.length > 40 ? '…' : ''}"` : '']
    .filter(Boolean).join(' · ')

  return (
    <>
      <input
        className="fi"
        readOnly
        value={fieldValue}
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
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 460,
              boxShadow: '0 24px 64px rgba(0,0,0,.22)',
              display: 'flex', flexDirection: 'column',
              maxHeight: '85vh', animation: 'mIn .15s ease',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>
                Tipo de alimentação
              </p>
            </div>

            {/* Lista de dietas */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {DIET_OPTIONS.map((opt) => {
                const selected = draftVal === opt.id
                return (
                  <div
                    key={opt.id}
                    onClick={() => setDraftVal(draftVal === opt.id ? '' : opt.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '11px 18px', cursor: 'pointer',
                      background: selected ? '#f0f6ff' : 'transparent',
                      borderLeft: selected ? '3px solid #2e6db4' : '3px solid transparent',
                      transition: 'all .1s',
                    }}
                    onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = '#f8fafc' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = selected ? '#f0f6ff' : 'transparent' }}
                  >
                    <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>{opt.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: selected ? 600 : 500, color: selected ? '#2e6db4' : '#1e293b', margin: 0 }}>
                        {opt.label}
                      </p>
                      <p style={{ fontSize: 11.5, color: '#94a3b8', margin: 0, marginTop: 1 }}>
                        {opt.sub}
                      </p>
                    </div>
                    {selected && <span style={{ color: '#2e6db4', flexShrink: 0 }}><Ic n="check" s={15} /></span>}
                  </div>
                )
              })}
            </div>

            {/* Observações alimentares */}
            <div style={{ borderTop: '1px solid #e2e8f0', padding: '14px 18px', flexShrink: 0 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 7 }}>
                Observações alimentares
              </label>
              <textarea
                ref={notesRef}
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                rows={3}
                placeholder="Ex.: Alérgico a nozes e amendoim. Não consome frutos do mar. Prefere refeições sem pimenta..."
                style={{
                  width: '100%', padding: '8px 10px',
                  border: '1px solid #e2e8f0', borderRadius: 6,
                  fontSize: 13, fontFamily: 'inherit', color: '#1e293b',
                  outline: 'none', resize: 'vertical', lineHeight: 1.5,
                  transition: 'border-color .12s',
                }}
                onFocus={(e) => e.target.style.borderColor = '#2e6db4'}
                onBlur={(e)  => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>

            {/* Footer */}
            <div style={{
              padding: '12px 18px', borderTop: '1px solid #e2e8f0',
              display: 'flex', justifyContent: 'space-between', flexShrink: 0,
            }}>
              <button
                onClick={() => { setDraftVal(''); setDraftNotes('') }}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Limpar
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setOpen(false)}
                  style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={save}
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
