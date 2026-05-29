import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { agenciesApi } from '../api'
import { Ic } from './Icon'

export default function AgencyPicker({ selectedIds = [], onChange }) {
  const [open, setOpen]         = useState(false)
  const [allAgencies, setAll]   = useState([])
  const [search, setSearch]     = useState('')
  const [draft, setDraft]       = useState([])  // IDs selecionados enquanto o popup está aberto
  const overlayRef              = useRef(null)
  const navigate                = useNavigate()

  /* Carrega agências uma vez */
  useEffect(() => {
    agenciesApi.list()
      .then((r) => setAll(r.data.results ?? r.data))
      .catch(() => {})
  }, [])

  const openPicker = () => {
    setDraft([...selectedIds])
    setSearch('')
    setOpen(true)
  }

  const save = () => {
    onChange(draft)
    setOpen(false)
  }

  /* Clique fora → salva e fecha */
  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) save()
  }

  const toggleAgency = (id) => {
    setDraft((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const filtered = allAgencies.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase())
  )

  /* Label do botão */
  const selectedAgencies = allAgencies.filter((a) => selectedIds.includes(a.id))
  const btnLabel = selectedAgencies.length === 0
    ? '— Selecionar agências —'
    : selectedAgencies.map((a) => a.name).join(', ')

  return (
    <>
      {/* Botão que abre o picker */}
      <button
        type="button"
        onClick={openPicker}
        style={{
          width: '100%',
          padding: '7px 10px',
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          background: '#fff',
          textAlign: 'left',
          fontSize: 13,
          color: selectedAgencies.length ? '#1e293b' : '#94a3b8',
          cursor: 'pointer',
          fontFamily: 'inherit',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          transition: 'border-color .12s',
          overflow: 'hidden',
        }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = '#cbd5e1'}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = '#e2e8f0'}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {btnLabel}
        </span>
        <span style={{ flexShrink: 0, color: '#94a3b8' }}>
          <Ic n="plus" s={13} />
        </span>
      </button>

      {/* Popup */}
      {open && (
        <div
          ref={overlayRef}
          onClick={handleOverlayClick}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15,23,42,.4)',
            backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 400, padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 12,
              width: '100%', maxWidth: 460,
              boxShadow: '0 24px 64px rgba(0,0,0,.22)',
              display: 'flex', flexDirection: 'column',
              maxHeight: '80vh',
              animation: 'mIn .15s ease',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #e2e8f0' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 10 }}>
                Selecionar agências
              </p>
              {/* Barra de busca */}
              <div style={{ position: 'relative' }}>
                <span style={{
                  position: 'absolute', left: 9, top: '50%',
                  transform: 'translateY(-50%)', color: '#94a3b8', display: 'flex',
                }}>
                  <Ic n="search" s={14} />
                </span>
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar agência…"
                  style={{
                    width: '100%', padding: '7px 11px 7px 31px',
                    border: '1px solid #e2e8f0', borderRadius: 6,
                    fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b',
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#2e6db4'}
                  onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                />
              </div>
            </div>

            {/* Lista de agências */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
              {filtered.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' }}>
                  Nenhuma agência encontrada
                </p>
              ) : filtered.map((a) => {
                const checked = draft.includes(a.id)
                return (
                  <label
                    key={a.id}
                    onClick={() => toggleAgency(a.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 18px', cursor: 'pointer',
                      background: checked ? '#f0f6ff' : 'transparent',
                      transition: 'background .1s',
                    }}
                    onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = '#f8fafc' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = checked ? '#f0f6ff' : 'transparent' }}
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={checked}
                      style={{ width: 15, height: 15, accentColor: '#2e6db4', flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: checked ? 600 : 400, color: '#1e293b', margin: 0 }}>
                        {a.name}
                      </p>
                      {a.email && (
                        <p style={{ fontSize: 11.5, color: '#94a3b8', margin: 0, marginTop: 1 }}>{a.email}</p>
                      )}
                    </div>
                    {checked && (
                      <span style={{ color: '#2e6db4', flexShrink: 0 }}>
                        <Ic n="check" s={14} />
                      </span>
                    )}
                  </label>
                )
              })}
            </div>

            {/* Footer */}
            <div style={{
              padding: '12px 18px',
              borderTop: '1px solid #e2e8f0',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            }}>
              <button
                type="button"
                onClick={() => { save(); navigate('/agencias') }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 13px', borderRadius: 6, border: '1px solid #e2e8f0',
                  background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer',
                  fontFamily: 'inherit', transition: 'all .12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2e6db4'; e.currentTarget.style.color = '#2e6db4' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#475569' }}
              >
                <Ic n="plus" s={13} />
                Adicionar nova agência
              </button>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{
                    padding: '6px 13px', borderRadius: 6, border: '1px solid #e2e8f0',
                    background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={save}
                  style={{
                    padding: '6px 16px', borderRadius: 6, border: 'none',
                    background: '#2e6db4', color: '#fff', fontSize: 13,
                    fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'background .12s',
                  }}
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
