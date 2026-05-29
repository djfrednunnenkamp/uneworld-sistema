import { useState, useRef, useEffect, useMemo } from 'react'
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
  const [open,        setOpen]       = useState(false)
  const [notesOpen,   setNotesOpen]  = useState(false)
  const [draftVal,    setDraftVal]   = useState(value || '')
  const [draftNotes,  setDraftNotes] = useState(notes || '')
  const [search,      setSearch]     = useState('')
  const overlayRef  = useRef(null)
  const overlay2Ref = useRef(null)
  const notesRef    = useRef(null)
  const bigNotesRef = useRef(null)

  const filtered = useMemo(() =>
    search.trim()
      ? DIET_OPTIONS.filter((d) =>
          d.label.toLowerCase().includes(search.toLowerCase()) ||
          d.sub.toLowerCase().includes(search.toLowerCase()))
      : DIET_OPTIONS
  , [search])

  useEffect(() => {
    if (open) {
      setDraftVal(value  || '')
      setDraftNotes(notes || '')
      setSearch('')
      setTimeout(() => notesRef.current?.focus(), 80)
    }
  }, [open])

  useEffect(() => {
    if (notesOpen) setTimeout(() => bigNotesRef.current?.focus(), 80)
  }, [notesOpen])

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
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 12 }}>
                Tipo de alimentação
              </p>

              {/* Observações — no topo */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  Observações alimentares
                </label>
                <button
                  type="button"
                  onClick={() => setNotesOpen(true)}
                  title="Expandir campo de observações"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '3px 9px', borderRadius: 6,
                    border: '1px solid #e2e8f0', background: '#f8fafc',
                    color: '#64748b', fontSize: 11.5, cursor: 'pointer',
                    fontFamily: 'inherit', transition: 'all .12s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2e6db4'; e.currentTarget.style.color = '#2e6db4' }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#64748b' }}
                >
                  <Ic n="edit" s={12} /> Expandir
                </button>
              </div>
              <textarea
                ref={notesRef}
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                rows={2}
                placeholder="Ex.: Alérgico a nozes, não come frutos do mar, sem pimenta…"
                style={{
                  width: '100%', padding: '7px 10px',
                  border: '1px solid #e2e8f0', borderRadius: 6,
                  fontSize: 13, fontFamily: 'inherit', color: '#1e293b',
                  outline: 'none', resize: 'none', lineHeight: 1.5,
                  transition: 'border-color .12s', marginBottom: 12,
                }}
                onFocus={(e) => e.target.style.borderColor = '#2e6db4'}
                onBlur={(e)  => e.target.style.borderColor = '#e2e8f0'}
              />

              {/* Busca de dieta */}
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', display: 'flex' }}>
                  <Ic n="search" s={14} />
                </span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar tipo de dieta…"
                  style={{
                    width: '100%', padding: '7px 11px 7px 31px',
                    border: '1px solid #e2e8f0', borderRadius: 6,
                    fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b',
                    transition: 'border-color .12s',
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#2e6db4'}
                  onBlur={(e)  => e.target.style.borderColor = '#e2e8f0'}
                />
              </div>
            </div>

            {/* Lista de dietas */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filtered.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' }}>
                  Nenhum tipo encontrado
                </p>
              ) : filtered.map((opt) => {
                const selected = draftVal === opt.id
                return (
                  <div
                    key={opt.id}
                    onClick={() => setDraftVal(draftVal === opt.id ? '' : opt.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 18px', cursor: 'pointer',
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

      {/* ── Segundo popup: observações expandidas ── */}
      {notesOpen && (
        <div
          ref={overlay2Ref}
          onClick={(e) => { if (e.target === overlay2Ref.current) setNotesOpen(false) }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15,23,42,.55)',
            backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 500, padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 500,
              boxShadow: '0 24px 64px rgba(0,0,0,.28)',
              animation: 'mIn .15s ease',
            }}
          >
            <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid #e2e8f0' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>
                Observações alimentares
              </p>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                Descreva restrições, alergias ou preferências específicas
              </p>
            </div>

            <div style={{ padding: '16px 18px' }}>
              <textarea
                ref={bigNotesRef}
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                rows={8}
                placeholder="Ex.: Alérgico a nozes e amendoim (reação grave). Não consome frutos do mar. Intolerante a lactose. Prefere refeições sem pimenta e sem temperos fortes..."
                style={{
                  width: '100%', padding: '10px 12px',
                  border: '1px solid #e2e8f0', borderRadius: 8,
                  fontSize: 13, fontFamily: 'inherit', color: '#1e293b',
                  outline: 'none', resize: 'vertical', lineHeight: 1.6,
                  transition: 'border-color .12s',
                }}
                onFocus={(e) => e.target.style.borderColor = '#2e6db4'}
                onBlur={(e)  => e.target.style.borderColor = '#e2e8f0'}
              />
              <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, textAlign: 'right' }}>
                {draftNotes.length} caractere{draftNotes.length !== 1 ? 's' : ''}
              </p>
            </div>

            <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setNotesOpen(false)}
                style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancelar
              </button>
              <button
                onClick={() => setNotesOpen(false)}
                style={{ padding: '7px 20px', borderRadius: 6, border: 'none', background: '#2e6db4', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#275fa0'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#2e6db4'}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
