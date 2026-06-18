import { useState, useRef, useEffect } from 'react'
import DatePicker from './DatePicker'

const fmtShort = iso => iso ? `${iso.slice(8)}/${iso.slice(5, 7)}` : '…'

export default function DateRangeDrop({ label, from, to, onFrom, onTo }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const active = !!from || !!to

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const rangeLabel = from && to
    ? `: ${fmtShort(from)} – ${fmtShort(to)}`
    : from
      ? `: De ${fmtShort(from)}`
      : to
        ? `: Até ${fmtShort(to)}`
        : ''

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7,
          border: `1px solid ${active ? '#2e6db4' : '#e2e8f0'}`,
          background: active ? '#eff6ff' : '#fff',
          color: active ? '#2e6db4' : '#475569',
          fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit',
          whiteSpace: 'nowrap', transition: 'all .12s',
        }}>
        {label}{active ? rangeLabel : ''}
        <span style={{ fontSize: 9, opacity: .7 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 300,
          background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0',
          boxShadow: '0 8px 24px rgba(0,0,0,.10)', width: 230, padding: 12,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.04em', display:'block', marginBottom:5 }}>De</label>
            <DatePicker fixed value={from} onChange={onFrom} placeholder="DD/MM/AAAA" relatedDate={to || null} />
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.04em', display:'block', marginBottom:5 }}>Até</label>
            <DatePicker fixed value={to} onChange={onTo} placeholder="DD/MM/AAAA" relatedDate={from || null} />
          </div>
          {active && (
            <button type="button" onClick={() => { onFrom(''); onTo('') }}
              style={{ padding:'7px 10px', fontSize:12, fontWeight:600, color:'#dc2626', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:6, cursor:'pointer', fontFamily:'inherit' }}>
              ✕ Limpar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
