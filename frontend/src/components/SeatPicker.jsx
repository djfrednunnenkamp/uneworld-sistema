import { useState, useRef } from 'react'
import { Ic } from './Icon'

/* ── Classes de voo ── */
const FLIGHT_CLASSES = [
  {
    id: 'economy',
    label: 'Classe Econômica',
    sub: 'Assentos padrão, serviço básico',
    icon: '🪑',
    color: '#64748b',
  },
  {
    id: 'premium_economy',
    label: 'Econômica Premium',
    sub: 'Mais espaço e conforto que a econômica',
    icon: '⭐',
    color: '#b45309',
  },
  {
    id: 'business',
    label: 'Classe Executiva',
    sub: 'Business — assento reclinável, serviço premium',
    icon: '💼',
    color: '#2e6db4',
  },
  {
    id: 'first',
    label: 'Primeira Classe',
    sub: 'Máximo conforto, suite privativa',
    icon: '👑',
    color: '#7c3aed',
  },
]

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
export default function SeatPicker({ seatType, seatPos, flightClass, onChangeSeatType, onChangeSeatPos, onChangeFlightClass }) {
  const [open,        setOpen]        = useState(false)
  const [classOpen,   setClassOpen]   = useState(false)
  const [draftType,   setDraftType]   = useState(seatType    || '')
  const [draftPos,    setDraftPos]    = useState(seatPos     || '')
  const [draftClass,  setDraftClass]  = useState(flightClass || '')
  const overlayRef  = useRef(null)
  const overlayRef2 = useRef(null)

  const openPicker = () => {
    setDraftType(seatType    || '')
    setDraftPos(seatPos      || '')
    setDraftClass(flightClass || '')
    setOpen(true)
  }

  const save = () => {
    onChangeSeatType(draftType)
    onChangeSeatPos(draftPos)
    onChangeFlightClass(draftClass)
    setOpen(false)
  }

  const handleOverlay  = (e) => { if (e.target === overlayRef.current)  save() }
  const handleOverlay2 = (e) => { if (e.target === overlayRef2.current) setClassOpen(false) }

  /* Label do campo */
  const classLabel = FLIGHT_CLASSES.find((c) => c.id === flightClass)?.label ?? ''
  const typeLabel  = SEAT_COLS.find((s) => s.id === seatType)?.label ?? ''
  const posLabel   = POSITIONS.find((p) => p.id === seatPos)?.label  ?? ''
  const fieldValue = [classLabel, typeLabel, posLabel].filter(Boolean).join(' · ') || ''

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

              {/* Classe de voo */}
              <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 7 }}>
                Classe de voo
              </p>
              <button
                type="button"
                onClick={() => setClassOpen(true)}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 8, marginBottom: 14,
                  border: `1.5px solid ${draftClass ? FLIGHT_CLASSES.find(c => c.id === draftClass)?.color : '#e2e8f0'}`,
                  background: draftClass ? `${FLIGHT_CLASSES.find(c => c.id === draftClass)?.color}12` : '#fff',
                  color: draftClass ? FLIGHT_CLASSES.find(c => c.id === draftClass)?.color : '#94a3b8',
                  fontSize: 13, fontWeight: draftClass ? 600 : 400,
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  transition: 'all .12s',
                }}
              >
                <span>
                  {draftClass
                    ? `${FLIGHT_CLASSES.find(c => c.id === draftClass)?.icon} ${FLIGHT_CLASSES.find(c => c.id === draftClass)?.label}`
                    : 'Selecionar classe de voo…'}
                </span>
                <span style={{ fontSize: 11, opacity: .6 }}>▼</span>
              </button>

              {/* Posição no avião */}
              <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 7 }}>
                Posição no avião
              </p>
              <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
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
                  <button type="button" onClick={() => setDraftPos('')}
                    style={{ padding: '7px 10px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#94a3b8', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                    ✕
                  </button>
                )}
              </div>

              {/* Tipo de assento — logo abaixo da posição */}
              <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 7 }}>
                Tipo de assento
              </p>
              <div style={{ display: 'flex', gap: 7 }}>
                {SEAT_COLS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setDraftType(draftType === s.id ? '' : s.id)}
                    style={{
                      flex: 1, padding: '7px 10px', borderRadius: 8,
                      border: `1.5px solid ${draftType === s.id ? s.color : '#e2e8f0'}`,
                      background: draftType === s.id ? `${s.color}15` : '#fff',
                      color: draftType === s.id ? s.color : '#64748b',
                      fontSize: 13, fontWeight: draftType === s.id ? 600 : 400,
                      cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'all .12s',
                    }}
                  >
                    {s.id === 'janela' ? '🪟 ' : s.id === 'meio' ? '↔ ' : '🚶 '}{s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mapa do avião — tudo centralizado */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

              {/* Cockpit */}
              <div style={{ marginBottom: 6 }}>
                <div style={{
                  padding: '4px 28px',
                  background: '#f8fafc', border: '1px solid #e2e8f0',
                  borderRadius: '50% 50% 0 0 / 100% 100% 0 0',
                  fontSize: 11, color: '#94a3b8', fontWeight: 600,
                }}>
                  ✈ Cockpit
                </div>
              </div>

              {/* Letras das colunas */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 4, marginLeft: 20 }}>
                {['A','B','C'].map((l) => (
                  <div key={l} style={{ width: 18, textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#94a3b8' }}>{l}</div>
                ))}
                <div style={{ width: 10 }} />
                {['D','E','F'].map((l) => (
                  <div key={l} style={{ width: 18, textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#94a3b8' }}>{l}</div>
                ))}
              </div>

              {/* Zonas com linhas */}
              {zones.map((zone) => (
                <div key={zone.id} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
              <div style={{ marginTop: 8 }}>
                <div style={{
                  padding: '4px 24px',
                  background: '#f8fafc', border: '1px solid #e2e8f0',
                  borderRadius: '0 0 50% 50% / 0 0 100% 100%',
                  fontSize: 11, color: '#94a3b8',
                }}>▼</div>
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

      {/* ── Segundo popup: seleção de classe ── */}
      {classOpen && (
        <div
          ref={overlayRef2}
          onClick={handleOverlay2}
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
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 420,
              boxShadow: '0 24px 64px rgba(0,0,0,.28)',
              animation: 'mIn .15s ease',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid #e2e8f0' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                Selecionar classe de voo
              </p>
            </div>

            {/* Classes */}
            <div style={{ padding: '8px 0' }}>
              {FLIGHT_CLASSES.map((c) => {
                const selected = draftClass === c.id
                return (
                  <div
                    key={c.id}
                    onClick={() => { setDraftClass(c.id); setClassOpen(false) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '13px 20px', cursor: 'pointer',
                      background: selected ? `${c.color}10` : 'transparent',
                      borderLeft: selected ? `3px solid ${c.color}` : '3px solid transparent',
                      transition: 'all .1s',
                    }}
                    onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = '#f8fafc' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = selected ? `${c.color}10` : 'transparent' }}
                  >
                    <span style={{ fontSize: 24, flexShrink: 0 }}>{c.icon}</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 13.5, fontWeight: selected ? 700 : 500, color: selected ? c.color : '#1e293b', margin: 0 }}>
                        {c.label}
                      </p>
                      <p style={{ fontSize: 12, color: '#94a3b8', margin: 0, marginTop: 2 }}>
                        {c.sub}
                      </p>
                    </div>
                    {selected && (
                      <span style={{ color: c.color, flexShrink: 0 }}><Ic n="check" s={16} /></span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between' }}>
              <button
                onClick={() => { setDraftClass(''); setClassOpen(false) }}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Limpar
              </button>
              <button
                onClick={() => setClassOpen(false)}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#2e6db4', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
