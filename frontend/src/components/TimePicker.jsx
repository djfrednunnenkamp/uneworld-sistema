import { useState, useRef, useEffect } from 'react'

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

export default function TimePicker({ value, onChange, placeholder = 'HH:MM', fixed = false }) {
  const [open,     setOpen]     = useState(false)
  const [inputVal, setInputVal] = useState(toDisplay(value))
  const [popupPos, setPopupPos] = useState({})
  const ref    = useRef(null)
  const inpRef = useRef(null)
  const hourRef = useRef(null)
  const minRef  = useRef(null)

  const parsedH = value ? parseInt(value.split(':')[0]) : null
  const parsedM = value ? parseInt(value.split(':')[1]) : null

  useEffect(() => { setInputVal(toDisplay(value)) }, [value])

  useEffect(() => {
    if (!open) return
    if (fixed && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setPopupPos({ top: rect.bottom + 6, left: rect.left })
    }
    setTimeout(() => {
      if (hourRef.current && parsedH !== null) {
        const el = hourRef.current.children[parsedH + 1]
        el?.scrollIntoView({ block: 'center', behavior: 'instant' })
      }
      if (minRef.current && parsedM !== null) {
        const el = minRef.current.children[parsedM + 1]
        el?.scrollIntoView({ block: 'center', behavior: 'instant' })
      }
    }, 20)
  }, [open])

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const handleChange = e => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 4)
    let fmt = raw
    if (raw.length > 2) fmt = raw.slice(0, 2) + ':' + raw.slice(2)
    setInputVal(fmt)
    if (fmt.length === 5) {
      const valid = parseTime(fmt)
      if (valid) onChange(valid)
    } else if (fmt.length === 0) {
      onChange('')
    }
  }

  const curH = inputVal.length >= 2 ? parseInt(inputVal.slice(0, 2)) : parsedH
  const curM = inputVal.length === 5 ? parseInt(inputVal.slice(3))   : parsedM

  const pick = (h, m) => {
    const v = `${pad(isNaN(h) || h === null ? 0 : h)}:${pad(isNaN(m) || m === null ? 0 : m)}`
    onChange(v)
    setInputVal(v)
    setOpen(false)
  }

  const colLabel = txt => (
    <div style={{ padding:'8px 0 4px', fontSize:10, fontWeight:700, color:'#94a3b8',
      textAlign:'center', textTransform:'uppercase', letterSpacing:.8 }}>
      {txt}
    </div>
  )

  return (
    <div ref={ref} style={{ position:'relative', display:'flex', alignItems:'center' }}>
      <input
        ref={inpRef}
        value={inputVal}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === 'Tab') setOpen(false)
          if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur() }
        }}
        placeholder={placeholder}
        className="fi"
        style={{ paddingRight:32, cursor:'text' }}
      />

      {/* Clock icon */}
      <button type="button"
        onClick={() => { setOpen(o => !o); inpRef.current?.focus() }}
        style={{
          position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
          background:'none', border:'none', cursor:'pointer', padding:'2px 4px',
          color:'#94a3b8', fontSize:14, lineHeight:1, borderRadius:4, transition:'color .12s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#2e6db4'}
        onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
      >⏱</button>

      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: fixed ? 'fixed' : 'absolute',
            top:  fixed ? popupPos.top  : 'calc(100% + 6px)',
            left: fixed ? popupPos.left : 0,
            zIndex: 9999,
            background:'#fff', borderRadius:10, border:'1px solid #e2e8f0',
            boxShadow:'0 10px 32px rgba(0,0,0,.13)', width:190,
            overflow:'hidden',
          }}
        >
          {/* Time display */}
          <div style={{ textAlign:'center', padding:'12px 10px 10px', borderBottom:'1px solid #f1f5f9' }}>
            <span style={{ fontSize:24, fontWeight:700, color:'#1e293b',
              letterSpacing:3, fontVariantNumeric:'tabular-nums' }}>
              {inputVal.length === 5 ? inputVal : (
                <span>
                  <span style={{ color: curH !== null && !isNaN(curH) ? '#1e293b' : '#cbd5e1' }}>
                    {curH !== null && !isNaN(curH) ? pad(curH) : '──'}
                  </span>
                  <span style={{ color:'#cbd5e1' }}>:</span>
                  <span style={{ color: curM !== null && !isNaN(curM) ? '#1e293b' : '#cbd5e1' }}>
                    {curM !== null && !isNaN(curM) ? pad(curM) : '──'}
                  </span>
                </span>
              )}
            </span>
          </div>

          {/* Two columns */}
          <div style={{ display:'flex', height:196 }}>
            {/* Hours */}
            <div ref={hourRef} style={{ flex:1, overflowY:'auto', borderRight:'1px solid #f1f5f9',
              scrollbarWidth:'none' }}>
              {colLabel('Hora')}
              {Array.from({ length:24 }, (_, h) => {
                const sel = h === curH && !isNaN(curH)
                return (
                  <button key={h} type="button"
                    onClick={() => pick(h, curM !== null && !isNaN(curM) ? curM : 0)}
                    style={{
                      ...btnBase,
                      background: sel ? '#2e6db4' : 'transparent',
                      color:      sel ? '#fff' : '#1e293b',
                      fontWeight: sel ? 700 : 400,
                    }}
                    onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f1f5f9' }}
                    onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent' }}
                  >{pad(h)}</button>
                )
              })}
            </div>

            {/* Minutes */}
            <div ref={minRef} style={{ flex:1, overflowY:'auto', scrollbarWidth:'none' }}>
              {colLabel('Min')}
              {Array.from({ length:60 }, (_, m) => {
                const sel = m === curM && !isNaN(curM)
                return (
                  <button key={m} type="button"
                    onClick={() => pick(curH !== null && !isNaN(curH) ? curH : 0, m)}
                    style={{
                      ...btnBase,
                      background: sel ? '#2e6db4' : 'transparent',
                      color:      sel ? '#fff' : '#1e293b',
                      fontWeight: sel ? 700 : 400,
                    }}
                    onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f1f5f9' }}
                    onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent' }}
                  >{pad(m)}</button>
                )
              })}
            </div>
          </div>

          {/* Footer */}
          {value && (
            <div style={{ padding:'8px 10px', borderTop:'1px solid #f1f5f9' }}>
              <button
                onClick={() => { onChange(''); setInputVal(''); setOpen(false) }}
                style={{ width:'100%', padding:'5px', border:'1px solid #e2e8f0', borderRadius:6,
                  background:'#fff', color:'#94a3b8', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}
              >Limpar</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
