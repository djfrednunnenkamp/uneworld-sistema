import { useState, useRef, useEffect } from 'react'

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const DAYS   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']

const NAV = {
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 18, color: '#64748b', padding: '4px 10px',
  borderRadius: 6, fontFamily: 'inherit', lineHeight: 1,
  transition: 'background .1s',
}

/**
 * DatePicker customizado.
 * Props:
 *   value      – ISO date string (YYYY-MM-DD) ou ''
 *   onChange   – (YYYY-MM-DD | '') => void
 *   placeholder
 *   errStyle   – estilo opcional de erro (objeto CSS)
 */
export default function DatePicker({ value, onChange, placeholder = 'DD/MM/AAAA', errStyle }) {
  const [open,    setOpen]    = useState(false)
  const [view,    setView]    = useState(null)   // { year, month }
  const [mode,    setMode]    = useState('days') // 'days' | 'months' | 'years'
  const ref = useRef(null)

  const selected = value ? new Date(value + 'T00:00:00') : null
  const today    = new Date(); today.setHours(0,0,0,0)

  /* Inicializa view ao abrir */
  useEffect(() => {
    if (open) {
      const d = selected || today
      setView({ year: d.getFullYear(), month: d.getMonth() })
      setMode('days')
    }
  }, [open])

  /* Fecha ao clicar fora */
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const pick = (year, month, day) => {
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    onChange(iso); setOpen(false)
  }

  const prevM = () => setView(v => v.month === 0  ? { year: v.year-1, month: 11 } : { ...v, month: v.month-1 })
  const nextM = () => setView(v => v.month === 11 ? { year: v.year+1, month: 0  } : { ...v, month: v.month+1 })

  /* Células do calendário */
  const cells = () => {
    if (!view) return []
    const first = new Date(view.year, view.month, 1).getDay()
    const total = new Date(view.year, view.month+1, 0).getDate()
    const arr = Array(first).fill(null)
    for (let d = 1; d <= total; d++) arr.push(d)
    return arr
  }

  const isSel   = (d) => selected && d === selected.getDate() && view.month === selected.getMonth() && view.year === selected.getFullYear()
  const isToday = (d) => { const t = today; return d === t.getDate() && view.month === t.getMonth() && view.year === t.getFullYear() }

  /* Display em pt-BR */
  const display = selected
    ? selected.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' })
    : ''

  /* Anos para o seletor de ano */
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 101 }, (_, i) => currentYear - 80 + i)  // -80 a +20 do ano atual

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        readOnly
        value={display}
        placeholder={placeholder}
        onClick={() => setOpen(o => !o)}
        className="fi"
        style={{ cursor: 'pointer', caretColor: 'transparent', ...errStyle }}
      />

      {open && view && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 350,
            background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
            boxShadow: '0 10px 32px rgba(0,0,0,.13)',
            width: 272, overflow: 'hidden',
            animation: 'mIn .12s ease',
          }}
        >
          {/* ── Header ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 12px 10px', borderBottom: '1px solid #f1f5f9' }}>
            {mode === 'days' && <button style={NAV} onClick={prevM} onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='none'}>‹</button>}

            <button
              onClick={() => setMode(m => m === 'days' ? 'months' : 'days')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#1e293b', fontFamily: 'inherit', borderRadius: 6, padding: '4px 8px', transition: 'background .1s', flex: mode !== 'days' ? 1 : 'initial' }}
              onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'}
              onMouseLeave={e=>e.currentTarget.style.background='none'}
            >
              {MONTHS[view.month]} {view.year}
            </button>

            {mode === 'days' && <button style={NAV} onClick={nextM} onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='none'}>›</button>}
          </div>

          {/* ── Seletor de mês ── */}
          {mode === 'months' && (
            <div style={{ padding: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 8 }}>
                {MONTHS.map((m, i) => {
                  const sel = i === view.month
                  return (
                    <button key={m}
                      onClick={() => { setView(v => ({ ...v, month: i })); setMode('days') }}
                      style={{ padding: '7px 4px', borderRadius: 6, border: 'none', background: sel ? '#2e6db4' : 'transparent', color: sel ? '#fff' : '#1e293b', fontSize: 12.5, fontWeight: sel ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', transition: 'background .1s' }}
                      onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background='#f1f5f9' }}
                      onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background='transparent' }}
                    >{m.slice(0,3)}</button>
                  )
                })}
              </div>
              {/* Seletor de ano inline */}
              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Ano</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3, maxHeight: 128, overflowY: 'auto' }}>
                  {years.map(y => {
                    const sel = y === view.year
                    return (
                      <button key={y}
                        onClick={() => setView(v => ({ ...v, year: y }))}
                        style={{ padding: '5px 2px', borderRadius: 5, border: 'none', background: sel ? '#2e6db4' : 'transparent', color: sel ? '#fff' : '#1e293b', fontSize: 12, fontWeight: sel ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', transition: 'background .1s' }}
                        onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background='#f1f5f9' }}
                        onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background='transparent' }}
                      >{y}</button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── Grade de dias ── */}
          {mode === 'days' && (
            <div style={{ padding: '8px 10px 10px' }}>
              {/* Labels dias da semana */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
                {DAYS.map(d => (
                  <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#94a3b8', padding: '3px 0' }}>{d}</div>
                ))}
              </div>
              {/* Células */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                {cells().map((day, i) => {
                  if (!day) return <div key={`e-${i}`} />
                  const sel = isSel(day)
                  const tod = isToday(day)
                  return (
                    <button key={day}
                      onClick={() => pick(view.year, view.month, day)}
                      style={{
                        padding: '6px 0', borderRadius: 6, border: sel ? 'none' : tod ? '1.5px solid #2e6db4' : 'none',
                        background: sel ? '#2e6db4' : 'transparent',
                        color: sel ? '#fff' : tod ? '#2e6db4' : '#1e293b',
                        fontSize: 13, fontWeight: sel || tod ? 600 : 400,
                        cursor: 'pointer', fontFamily: 'inherit', transition: 'background .1s',
                      }}
                      onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background='#f1f5f9' }}
                      onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background='transparent' }}
                    >{day}</button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Rodapé: Hoje + Limpar ── */}
          <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderTop: '1px solid #f1f5f9' }}>
            <button
              onClick={() => { const t = today; pick(t.getFullYear(), t.getMonth(), t.getDate()) }}
              style={{ flex: 1, padding: '5px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', color: '#2e6db4', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Hoje
            </button>
            {value && (
              <button
                onClick={() => { onChange(''); setOpen(false) }}
                style={{ flex: 1, padding: '5px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', color: '#94a3b8', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Limpar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
