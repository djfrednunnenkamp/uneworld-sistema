import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ic } from './Icon'

/* Picker genérico (popup com busca) para seleção única ou múltipla de
 * qualquer lista de itens — usado para Agência/Contratante/Hóspedes nos
 * contratos. Os itens já vêm normalizados pelo chamador: { id, label, sublabel }.
 *
 * multiple=false: clicar num item já seleciona e fecha (sem botão Salvar).
 * multiple=true:  comportamento de seleção em lote, igual ao AgencyPicker —
 *                 marca/desmarca e só confirma ao clicar em Salvar.
 */
export default function EntityPicker({
  items = [],
  selectedIds = [],
  onChange,
  multiple = false,
  placeholder = '— Selecionar —',
  title = 'Selecionar',
  searchPlaceholder = 'Buscar…',
  emptyLabel = 'Nenhum item encontrado',
  createLink = null, // { label, to }
}) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const [draft, setDraft]   = useState([])
  const overlayRef          = useRef(null)
  const navigate             = useNavigate()

  const openPicker = () => {
    setDraft([...selectedIds])
    setSearch('')
    setOpen(true)
  }

  const save = (ids) => {
    onChange(ids ?? draft)
    setOpen(false)
  }

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) {
      if (multiple) save()
      else setOpen(false)
    }
  }

  const toggle = (id) => {
    if (!multiple) { save([id]); return }
    setDraft((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const filtered = items.filter((it) =>
    (it.label || '').toLowerCase().includes(search.toLowerCase()) ||
    (it.sublabel || '').toLowerCase().includes(search.toLowerCase())
  )

  const selectedItems = items.filter((it) => selectedIds.includes(it.id))
  const btnLabel = selectedItems.length === 0
    ? placeholder
    : selectedItems.map((it) => it.label).join(', ')

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        style={{
          width: '100%', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 6,
          background: '#fff', textAlign: 'left', fontSize: 13,
          color: selectedItems.length ? '#1e293b' : '#94a3b8', cursor: 'pointer',
          fontFamily: 'inherit', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 8, transition: 'border-color .12s', overflow: 'hidden',
        }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = '#cbd5e1'}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = '#e2e8f0'}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{btnLabel}</span>
        <span style={{ flexShrink: 0, color: '#94a3b8' }}><Ic n="plus" s={13} /></span>
      </button>

      {open && (
        <div
          ref={overlayRef}
          onClick={handleOverlayClick}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,.4)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 460,
              boxShadow: '0 24px 64px rgba(0,0,0,.22)', display: 'flex', flexDirection: 'column',
              maxHeight: '80vh', animation: 'mIn .15s ease',
            }}
          >
            <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #e2e8f0' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 10 }}>{title}</p>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', display: 'flex' }}>
                  <Ic n="search" s={14} />
                </span>
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  style={{
                    width: '100%', padding: '7px 11px 7px 31px', border: '1px solid #e2e8f0', borderRadius: 6,
                    fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b',
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#2e6db4'}
                  onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
              {filtered.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' }}>{emptyLabel}</p>
              ) : filtered.map((it) => {
                const checked = multiple ? draft.includes(it.id) : selectedIds.includes(it.id)
                return (
                  <div
                    key={it.id}
                    onClick={() => toggle(it.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', cursor: 'pointer',
                      background: checked ? '#f0f6ff' : 'transparent', transition: 'background .1s',
                    }}
                    onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = '#f8fafc' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = checked ? '#f0f6ff' : 'transparent' }}
                  >
                    {multiple && (
                      <input type="checkbox" readOnly checked={checked}
                        style={{ width: 15, height: 15, accentColor: '#2e6db4', flexShrink: 0, pointerEvents: 'none' }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: checked ? 600 : 400, color: '#1e293b', margin: 0 }}>{it.label}</p>
                      {it.sublabel && <p style={{ fontSize: 11.5, color: '#94a3b8', margin: 0, marginTop: 1 }}>{it.sublabel}</p>}
                    </div>
                    {checked && <span style={{ color: '#2e6db4', flexShrink: 0 }}><Ic n="check" s={14} /></span>}
                  </div>
                )
              })}
            </div>

            <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              {createLink ? (
                <button type="button" onClick={() => { setOpen(false); navigate(createLink.to) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 13px', borderRadius: 6,
                    border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13,
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2e6db4'; e.currentTarget.style.color = '#2e6db4' }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#475569' }}
                >
                  <Ic n="plus" s={13} />
                  {createLink.label}
                </button>
              ) : <span />}

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setOpen(false)}
                  style={{ padding: '6px 13px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {multiple ? 'Cancelar' : 'Fechar'}
                </button>
                {multiple && (
                  <button type="button" onClick={() => save()}
                    style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#2e6db4', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'background .12s' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#275fa0'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#2e6db4'}>
                    Salvar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
