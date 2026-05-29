import { useState, useRef } from 'react'
import { Ic } from './Icon'

/* ── Configuração do avião ── */
const ROWS        = 30
const FRONT_END   = 10   // linhas 1-10  = frente
const MIDDLE_END  = 20   // linhas 11-20 = meio
// linhas 21-30 = fundo

const SEAT_COLS = [
  { id: 'janela',   cols: [0, 5], label: 'Janela',   color: '#2e6db4' },
  { id: 'meio',     cols: [1, 4], label: 'Meio',     color: '#7c3aed' },
  { id: 'corredor', cols: [2, 3], label: 'Corredor', color: '#059669' },
]

const POSITIONS = [
  { id: 'frente', label: 'Frente', emoji: '🔼' },
  { id: 'meio',   label: 'Meio',   emoji: '↔️' },
  { id: 'fundo',  label: 'Fundo',  emoji: '🔽' },
]

/* col index → seat type */
const COL_TYPE = ['janela', 'meio', 'corredor', 'corredor', 'meio', 'janela']
const COL_LETTER = ['A', 'B', 'C', 'D', 'E', 'F']

function zoneOf(row) {
  if (row <= FRONT_END)  return 'frente'
  if (row <= MIDDLE_END) return 'meio'
  return 'fundo'
}

function seatColor(rowNum, colIdx, seatType, seatPos) {
  const inZone    = seatPos  ? zoneOf(rowNum) === seatPos  : true
  const inColType = seatType ? COL_TYPE[colIdx] === seatType : true

  if (seatType && COL_TYPE[colIdx] === seatType && seatPos && zoneOf(rowNum) === seatPos)
    return '#1d4ed8'   // ambos batem — azul forte
  if (seatType && COL_TYPE[colIdx] === seatType)
    return SEAT_COLS.find((s) => s.id === seatType)?.color ?? '#2e6db4'
  if (seatPos && zoneOf(rowNum) === seatPos)
    return '#bfdbfe'   // só zona — azul claro
  return '#e2e8f0'     // neutro
}

/* ── Airplane Row ── */
function SeatRow({ rowNum, seatType, seatPos, onSelectType }) {
  const zone = zoneOf(rowNum)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, margin: '2px 0' }}>
      <span style={{ fontSize: 10, color: '#cbd5e1', width: 20, textAlign: 'right', flexShrink: 0 }}>
        {rowNum}
      </span>
      {[0, 1, 2].map((col) => (
        <div
          key={col}
          title={`${COL_LETTER[col]} — ${COL_TYPE[col]}`}
          onClick={() => onSelectType(COL_TYPE[col])}
          style={{
            width: 18, height: 16, borderRadius: 3, cursor: 'pointer',
            background: seatColor(rowNum, col, seatType, seatPos),
            transition: 'background .15s',
            border: '1px solid rgba(0,0,0,.08)',
          }}
        />
      ))}
      {/* corredor */}
      <div style={{ width: 10 }} />
      {[3, 4, 5].map((col) => (
        <div
          key={col}
          title={`${COL_LETTER[col]} — ${COL_TYPE[col]}`}
          onClick={() => onSelectType(COL_TYPE[col])}
          style={{
            width: 18, height: 16, borderRadius: 3, cursor: 'pointer',
            background: seatColor(rowNum, col, seatType, seatPos),
            transition: 'background .15s',
            border: '1px solid rgba(0,0,0,.08)',
          }}
        />
      ))}
    </div>
  )
}

/* ── Zone divider ── */
function ZoneDivider({ label, active }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      margin: '8px 0 4px',
    }}>
      <div style={{ flex: 1, height: 1, background: active ? '#bfdbfe' : '#f1f5f9' }} />
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
        color: active ? '#2e6db4' : '#94a3b8', textTransform: 'uppercase',
      }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: active ? '#bfdbfe' : '#f1f5f9' }} />
    </div>
  )
}

/* ── Main component ── */
export default function SeatPicker({ seatType, seatPos, onChangeSeatType, onChangeSeatPos }) {
  const [open, setOpen] = useState(false)
  const [draftType, setDraftType] = useState(seatType || '')
  const [draftPos,  setDraftPos]  = useState(seatPos  || '')
  const overlayRef = useRef(null)

  const openPicker = () => {
    setDraftType(seatType || '')
    setDraftPos(seatPos   || '')
    setOpen(true)
  }

  const save = () => {
    onChangeSeatType(draftType)
    onChangeSeatPos(draftPos)
    setOpen(false)
  }

  const handleOverlay = (e) => {
    if (e.target === overlayRef.current) save()
  }

  /* Label do campo */
  const typeLabel = SEAT_COLS.find((s) => s.id === seatType)?.label ?? ''
  const posLabel  = POSITIONS.find((p) => p.id  === seatPos)?.label  ?? ''
  const fieldValue = [typeLabel, posLabel].filter(Boolean).join(' · ') || ''

  const zones = [
    { id: 'frente', label: 'Frente',  rows: Array.from({ length: FRONT_END }, (_, i) => i + 1) },
    { id: 'meio',   label: 'Meio',    rows: Array.from({ length: MIDDLE_END - FRONT_END }, (_, i) => FRONT_END + i + 1) },
    { id: 'fundo',  label: 'Fundo',   rows: Array.from({ length: ROWS - MIDDLE_END }, (_, i) => MIDDLE_END + i + 1) },
  ]

  return (
    <>
      {/* Campo clicável */}
      <input
        className="fi"
        readOnly
        value={fieldValue}
        placeholder="Clique para selecionar…"
        onClick={openPicker}
        style={{ cursor: 'pointer', caretColor: 'transparent' }}
      />

      {open && (
        <div
          ref={overlayRef}
          onClick={handleOverlay}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15,23,42,.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 400, padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 520,
              boxShadow: '0 24px 64px rgba(0,0,0,.22)',
              display: 'flex', flexDirection: 'column',
              maxHeight: '90vh', animation: 'mIn .15s ease',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 12 }}>
                Preferência de assento
              </p>

              {/* Posição no avião */}
              <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 7 }}>
                Posição no avião
              </p>
              <div style={{ display: 'flex', gap: 7 }}>
                {POSITIONS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setDraftPos(draftPos === p.id ? '' : p.id)}
                    style={{
                      flex: 1, padding: '7px 10px', borderRadius: 8,
                      border: `1.5px solid ${draftPos === p.id ? '#2e6db4' : '#e2e8f0'}`,
                      background: draftPos === p.id ? '#eff6ff' : '#fff',
                      color: draftPos === p.id ? '#2e6db4' : '#64748b',
                      fontSize: 13, fontWeight: draftPos === p.id ? 600 : 400,
                      cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'all .12s',
                    }}
                  >
                    {p.emoji} {p.label}
                  </button>
                ))}
                {draftPos && (
                  <button
                    type="button"
                    onClick={() => setDraftPos('')}
                    style={{
                      padding: '7px 10px', borderRadius: 8,
                      border: '1.5px solid #e2e8f0', background: '#fff',
                      color: '#94a3b8', fontSize: 12, cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >✕</button>
                )}
              </div>
            </div>

            {/* Mapa do avião */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>

              {/* Coluna header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 6, marginLeft: 23 }}>
                {['A','B','C'].map((l) => (
                  <div key={l} style={{ width: 18, textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#94a3b8' }}>{l}</div>
                ))}
                <div style={{ width: 10 }} />
                {['D','E','F'].map((l) => (
                  <div key={l} style={{ width: 18, textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#94a3b8' }}>{l}</div>
                ))}
              </div>

              {/* Cockpit */}
              <div style={{ textAlign: 'center', marginBottom: 8 }}>
                <div style={{
                  display: 'inline-block', padding: '4px 24px',
                  background: '#f8fafc', border: '1px solid #e2e8f0',
                  borderRadius: '50% 50% 0 0 / 100% 100% 0 0',
                  fontSize: 11, color: '#94a3b8', fontWeight: 600,
                }}>
                  ✈ Cockpit
                </div>
              </div>

              {/* Zonas com linhas */}
              {zones.map((zone) => (
                <div key={zone.id}>
                  <ZoneDivider label={zone.label} active={draftPos === zone.id} />
                  {zone.rows.map((rowNum) => (
                    <SeatRow
                      key={rowNum}
                      rowNum={rowNum}
                      seatType={draftType}
                      seatPos={draftPos}
                      onSelectType={(type) => setDraftType(draftType === type ? '' : type)}
                    />
                  ))}
                </div>
              ))}

              {/* Cauda */}
              <div style={{ textAlign: 'center', marginTop: 8 }}>
                <div style={{
                  display: 'inline-block', padding: '4px 20px',
                  background: '#f8fafc', border: '1px solid #e2e8f0',
                  borderRadius: '0 0 50% 50% / 0 0 100% 100%',
                  fontSize: 11, color: '#94a3b8',
                }}>
                  ▼
                </div>
              </div>
            </div>

            {/* Legenda de tipo */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                Tipo de assento — clique no mapa ou escolha:
              </p>
              <div style={{ display: 'flex', gap: 7 }}>
                {SEAT_COLS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setDraftType(draftType === s.id ? '' : s.id)}
                    style={{
                      flex: 1, padding: '7px 6px', borderRadius: 8,
                      border: `1.5px solid ${draftType === s.id ? s.color : '#e2e8f0'}`,
                      background: draftType === s.id ? `${s.color}15` : '#fff',
                      color: draftType === s.id ? s.color : '#64748b',
                      fontSize: 13, fontWeight: draftType === s.id ? 600 : 400,
                      cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'all .12s',
                    }}
                  >
                    {s.id === 'janela'   && '🪟 '}
                    {s.id === 'meio'     && '↔ '}
                    {s.id === 'corredor' && '🚶 '}
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div style={{
              padding: '12px 20px', borderTop: '1px solid #e2e8f0',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <button
                type="button"
                onClick={() => { setDraftType(''); setDraftPos('') }}
                style={{
                  padding: '6px 12px', borderRadius: 6,
                  border: '1px solid #e2e8f0', background: '#fff',
                  color: '#94a3b8', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Limpar
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{
                    padding: '6px 14px', borderRadius: 6,
                    border: '1px solid #e2e8f0', background: '#fff',
                    color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={save}
                  style={{
                    padding: '6px 18px', borderRadius: 6, border: 'none',
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
        </div>
      )}
    </>
  )
}
