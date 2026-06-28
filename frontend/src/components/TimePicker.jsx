import { useState, useRef, useEffect } from 'react'
import { usePrefs } from '../context/PrefsContext'

const pad = n => String(n).padStart(2, '0')

const toDisplay = v => (!v ? '' : v.slice(0, 5))

const parseTime = str => {
  if (!str || str.length < 5) return null
  const [h, m] = str.split(':').map(Number)
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null
  return `${pad(h)}:${pad(m)}`
}

const btnBase = {
  display: 'block', width: '100%', padding: '7px 0',
  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
  fontSize: 14, fontVariantNumeric: 'tabular-nums', textAlign: 'center',
  background: 'transparent', transition: 'background .1s',
}

/* Seletor de horário no padrão do sistema (popup com colunas), respeitando a
 * preferência do usuário (24h ou 12h AM/PM). O valor trafega sempre em 24h
 * 'HH:MM'; só a exibição muda conforme a preferência. */
export default function TimePicker({ value, onChange, placeholder = 'HH:MM', fixed = false }) {
  const { timeFormat } = usePrefs()
  const is12 = timeFormat === '12h'

  const [open,     setOpen]     = useState(false)
  const [inputVal, setInputVal] = useState(toDisplay(value))   // só usado no modo 24h (editável)
  const [period,   setPeriod]   = useState('AM')               // AM/PM no modo 12h
  const [popupPos, setPopupPos] = useState({})
  const ref    = useRef(null)
  const inpRef = useRef(null)
  const hourRef = useRef(null)
  const minRef  = useRef(null)

  const valH = value ? parseInt(value.split(':')[0]) : null
  const valM = value ? parseInt(value.split(':')[1]) : null

  useEffect(() => { setInputVal(toDisplay(value)) }, [value])
  useEffect(() => { if (valH != null) setPeriod(valH < 12 ? 'AM' : 'PM') }, [valH])

  const fmtDisplay = (v) => {
    if (!v) return ''
    const [h, m] = v.split(':').map(Number)
    if (is12) { const p = h < 12 ? 'AM' : 'PM'; return `${h % 12 || 12}:${pad(m)} ${p}` }
    return `${pad(h)}:${pad(m)}`
  }

  // Hora/minuto "atuais" para destacar — vêm do valor (e do que se digita, no 24h).
  const typedH = !is12 && inputVal.length >= 2 ? parseInt(inputVal.slice(0, 2)) : null
  const typedM = !is12 && inputVal.length === 5 ? parseInt(inputVal.slice(3))   : null
  const curH = typedH != null && !isNaN(typedH) ? typedH : valH          // 0..23
  const curM = typedM != null && !isNaN(typedM) ? typedM : valM          // 0..59
  const curH12 = curH != null && !isNaN(curH) ? (curH % 12 || 12) : null

  useEffect(() => {
    if (!open) return
    if (fixed && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setPopupPos({ top: rect.bottom + 6, left: rect.left })
    }
    setTimeout(() => {
      const hIdx = is12 ? (curH12 != null ? curH12 : null) : curH    // coluna de horas começa em 1 (12h) ou 0 (24h)
      if (hourRef.current && hIdx != null && !isNaN(hIdx)) {
        const childIndex = is12 ? hIdx : hIdx + 1
        hourRef.current.children[childIndex]?.scrollIntoView({ block: 'center', behavior: 'instant' })
      }
      if (minRef.current && curM != null && !isNaN(curM)) {
        minRef.current.children[curM + 1]?.scrollIntoView({ block: 'center', behavior: 'instant' })
      }
    }, 20)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const handleChange = e => {   // só no modo 24h
    const raw = e.target.value.replace(/\D/g, '').slice(0, 4)
    let fmt = raw
    if (raw.length > 2) fmt = raw.slice(0, 2) + ':' + raw.slice(2)
    setInputVal(fmt)
    if (fmt.length === 5) { const valid = parseTime(fmt); if (valid) onChange(valid) }
    else if (fmt.length === 0) onChange('')
  }

  // Define o valor a partir de hora/min/período, em 24h.
  const emit = (h24, m) => {
    const v = `${pad(((h24 % 24) + 24) % 24)}:${pad(isNaN(m) || m == null ? 0 : m)}`
    onChange(v); setInputVal(v)
  }
  const to24 = (h12, per) => (per === 'PM' ? (h12 % 12) + 12 : (h12 % 12))
  const pickHour = (h) => {   // h: 0..23 (24h) ou 1..12 (12h)
    const m = curM != null && !isNaN(curM) ? curM : 0
    emit(is12 ? to24(h, period) : h, m)
  }
  const pickMin = (m) => {
    const baseH = is12 ? to24(curH12 != null ? curH12 : 12, period) : (curH != null && !isNaN(curH) ? curH : 0)
    emit(baseH, m)
  }
  const setPer = (per) => {
    setPeriod(per)
    if (curH12 != null) emit(to24(curH12, per), curM != null && !isNaN(curM) ? curM : 0)
  }

  const displayVal = is12 ? fmtDisplay(value) : inputVal

  const colLabel = txt => (
    <div style={{ padding:'8px 0 4px', fontSize:10, fontWeight:700, color:'#94a3b8', textAlign:'center', textTransform:'uppercase', letterSpacing:.8 }}>{txt}</div>
  )

  return (
    <div ref={ref} style={{ position:'relative', display:'flex', alignItems:'center' }}>
      <input
        ref={inpRef}
        value={displayVal}
        onChange={is12 ? undefined : handleChange}
        readOnly={is12}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === 'Tab') setOpen(false)
          if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur() }
        }}
        placeholder={is12 ? 'HH:MM AM/PM' : placeholder}
        className="fi"
        style={{ paddingRight:32, cursor: is12 ? 'pointer' : 'text' }}
      />

      <button type="button"
        onClick={() => { setOpen(o => !o); inpRef.current?.focus() }}
        style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', padding:'2px 4px', color:'#94a3b8', fontSize:14, lineHeight:1, borderRadius:4, transition:'color .12s' }}
        onMouseEnter={e => e.currentTarget.style.color = '#2e6db4'}
        onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
      >⏱</button>

      {open && (
        <div onClick={e => e.stopPropagation()}
          style={{ position: fixed ? 'fixed' : 'absolute', top: fixed ? popupPos.top : 'calc(100% + 6px)', left: fixed ? popupPos.left : 0, zIndex: 9999, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', boxShadow:'0 10px 32px rgba(0,0,0,.13)', width:200, overflow:'hidden' }}>
          {/* Display */}
          <div style={{ textAlign:'center', padding:'12px 10px 10px', borderBottom:'1px solid #f1f5f9' }}>
            <span style={{ fontSize:22, fontWeight:700, color:'#1e293b', letterSpacing:2, fontVariantNumeric:'tabular-nums' }}>
              {value ? fmtDisplay(value) : (
                <span style={{ color:'#cbd5e1' }}>{is12 ? '──:── --' : '──:──'}</span>
              )}
            </span>
          </div>

          {/* AM/PM (só no 12h) */}
          {is12 && (
            <div style={{ display:'flex', gap:6, padding:'8px 10px', borderBottom:'1px solid #f1f5f9' }}>
              {['AM', 'PM'].map(p => {
                const sel = period === p
                return (
                  <button key={p} type="button" onClick={() => setPer(p)}
                    style={{ flex:1, padding:'6px 0', borderRadius:7, border:`1.5px solid ${sel ? '#2e6db4' : '#e2e8f0'}`, background: sel ? '#eff6ff' : '#fff', color: sel ? '#1a2d4f' : '#64748b', fontSize:12.5, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>{p}</button>
                )
              })}
            </div>
          )}

          {/* Colunas */}
          <div style={{ display:'flex', height:196 }}>
            <div ref={hourRef} style={{ flex:1, overflowY:'auto', borderRight:'1px solid #f1f5f9', scrollbarWidth:'none' }}>
              {colLabel('Hora')}
              {Array.from({ length: is12 ? 12 : 24 }, (_, i) => {
                const h = is12 ? i + 1 : i            // 1..12 ou 0..23
                const sel = is12 ? (h === curH12) : (h === curH && !isNaN(curH))
                return (
                  <button key={h} type="button" onClick={() => pickHour(h)}
                    style={{ ...btnBase, background: sel ? '#2e6db4' : 'transparent', color: sel ? '#fff' : '#1e293b', fontWeight: sel ? 700 : 400 }}
                    onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f1f5f9' }}
                    onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent' }}
                  >{is12 ? h : pad(h)}</button>
                )
              })}
            </div>
            <div ref={minRef} style={{ flex:1, overflowY:'auto', scrollbarWidth:'none' }}>
              {colLabel('Min')}
              {Array.from({ length:60 }, (_, m) => {
                const sel = m === curM && !isNaN(curM)
                return (
                  <button key={m} type="button" onClick={() => pickMin(m)}
                    style={{ ...btnBase, background: sel ? '#2e6db4' : 'transparent', color: sel ? '#fff' : '#1e293b', fontWeight: sel ? 700 : 400 }}
                    onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f1f5f9' }}
                    onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent' }}
                  >{pad(m)}</button>
                )
              })}
            </div>
          </div>

          {value && (
            <div style={{ padding:'8px 10px', borderTop:'1px solid #f1f5f9' }}>
              <button onClick={() => { onChange(''); setInputVal(''); setOpen(false) }}
                style={{ width:'100%', padding:'5px', border:'1px solid #e2e8f0', borderRadius:6, background:'#fff', color:'#94a3b8', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>Limpar</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
