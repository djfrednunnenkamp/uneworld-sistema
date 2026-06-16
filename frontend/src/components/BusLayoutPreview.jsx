import { createPortal } from 'react-dom'

/* ── Pré-visualização visual do mapa de assentos ──
   A numeração de cada assento é definida manualmente (left_labels/right_labels),
   pois a convenção de numeração varia de ônibus para ônibus.
   Em modo `editable`, cada assento vira um campo de texto editável. */
export function BusLayoutPreview({ rows, seatSize = 30, editable = false, onLabelChange, getSeatInfo }) {
  if (!rows || rows.length === 0) {
    return (
      <p style={{ fontSize:12, color:'#94a3b8', textAlign:'center', padding:'24px 0', margin:0 }}>
        Nenhuma fileira configurada.
      </p>
    )
  }

  const maxLeft  = Math.max(0, ...rows.map(r => r.left_seats))
  const maxRight = Math.max(0, ...rows.map(r => r.right_seats))
  const gap      = Math.max(3, Math.round(seatSize * 0.13))
  const aisle    = Math.max(12, Math.round(seatSize * 0.7))
  const fontSize = Math.max(9, Math.round(seatSize * 0.36))

  const seatStyle = {
    width:seatSize, height:seatSize, borderRadius:6, background:'#e8f0fb', border:'1px solid #bfdbfe',
    color:'#2e6db4', fontSize, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center',
    boxSizing:'border-box', fontFamily:'inherit', textAlign:'center', padding:0,
  }

  return (
    <div style={{ display:'inline-flex', flexDirection:'column', gap, padding:14, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:12 }}>
      <div style={{ textAlign:'center', fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:2 }}>
        Frente
      </div>
      {rows.map((row, ri) => {
        const cells = []
        for (let i = 0; i < maxLeft; i++) {
          cells.push(i < row.left_seats ? { key:`l${i}`, side:'left', i, label: row.left_labels?.[i] ?? '' } : { key:`l${i}`, empty:true })
        }
        cells.push({ key:'aisle', aisle:true })
        for (let i = 0; i < maxRight; i++) {
          cells.push(i < row.right_seats ? { key:`r${i}`, side:'right', i, label: row.right_labels?.[i] ?? '' } : { key:`r${i}`, empty:true })
        }
        return (
          <div key={ri} style={{ display:'grid', gap, gridTemplateColumns:`repeat(${maxLeft}, ${seatSize}px) ${aisle}px repeat(${maxRight}, ${seatSize}px)` }}>
            {cells.map(c => {
              if (c.aisle) return <div key={c.key} />
              if (c.empty)  return <div key={c.key} style={{ width:seatSize, height:seatSize }} />
              if (editable) {
                const hasLabel = !!c.label
                return (
                  <input key={c.key} value={c.label} maxLength={4}
                    onChange={e => onLabelChange(ri, c.side, c.i, e.target.value)}
                    style={{
                      ...seatStyle, cursor:'text', outline:'none',
                      background: hasLabel ? '#e8f0fb' : '#f8fafc',
                      border: `1px ${hasLabel ? 'solid #bfdbfe' : 'dashed #cbd5e1'}`,
                      color: hasLabel ? '#2e6db4' : '#94a3b8',
                    }}
                    onFocus={e => { e.target.style.borderColor = '#2e6db4'; e.target.style.background = '#dbeafe' }}
                    onBlur={e  => {
                      const v = !!e.target.value
                      e.target.style.borderColor = v ? '#bfdbfe' : '#cbd5e1'
                      e.target.style.background  = v ? '#e8f0fb' : '#f8fafc'
                    }} />
                )
              }
              const info = getSeatInfo ? (getSeatInfo(c.label) || {}) : {}
              return (
                <div key={c.key} title={info.title}
                  onClick={info.onClick}
                  style={{
                    ...seatStyle,
                    background: info.background ?? seatStyle.background,
                    border:     info.border     ?? seatStyle.border,
                    color:      info.color      ?? seatStyle.color,
                    cursor:     info.onClick ? 'pointer' : 'default',
                    transition: 'transform .1s, box-shadow .1s',
                  }}
                  onMouseEnter={e => {
                    if (info.onClick) { e.currentTarget.style.transform='scale(1.08)'; e.currentTarget.style.boxShadow='0 2px 6px rgba(0,0,0,.18)' }
                    info.onMouseEnter?.(e)
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='none'
                    info.onMouseLeave?.(e)
                  }}>
                  {c.label}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/* ── Tooltip flutuante de pré-visualização — aparece ao passar o mouse sobre um mapa ── */
export function MapPreviewTooltip({ busMap, anchorRect }) {
  if (!anchorRect) return null
  const twoDecks = busMap.deck_count === 2
  const maxWidth = twoDecks ? 480 : 260
  const top  = Math.min(anchorRect.bottom + 6, window.innerHeight - 12)
  const left = Math.min(Math.max(anchorRect.left, 12), window.innerWidth - maxWidth - 12)
  const rowsDeck1 = (busMap.rows ?? []).filter(r => (r.deck ?? 1) === 1)
  const rowsDeck2 = (busMap.rows ?? []).filter(r => r.deck === 2)
  const deckLabel = { fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.06em', margin:'0 0 6px' }

  return createPortal(
    <div style={{
      position:'fixed', top, left, width:'max-content', maxWidth, zIndex:9999,
      background:'#fff', border:'1px solid #e2e8f0', borderRadius:10,
      boxShadow:'0 12px 32px rgba(15,23,42,.18)', padding:'12px 16px',
      maxHeight: window.innerHeight - top - 12, overflowY:'auto',
      pointerEvents:'none',
    }}>
      <p style={{ fontSize:11, fontWeight:700, color:'#1a2d4f', textTransform:'uppercase', letterSpacing:'.04em', margin:'0 0 10px' }}>
        {busMap.label}
      </p>
      {twoDecks ? (
        <div style={{ display:'flex', gap:16 }}>
          <div><p style={deckLabel}>1º andar</p><BusLayoutPreview rows={rowsDeck1} seatSize={22} /></div>
          <div><p style={deckLabel}>2º andar</p><BusLayoutPreview rows={rowsDeck2} seatSize={22} /></div>
        </div>
      ) : (
        <BusLayoutPreview rows={rowsDeck1} seatSize={22} />
      )}
    </div>,
    document.body
  )
}
