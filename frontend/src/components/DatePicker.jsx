import { useState, useRef, useEffect } from 'react'

const MONTHS   = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const DAYS     = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']

const btnBase  = { background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', transition:'background .1s', borderRadius:6 }
const navStyle = { ...btnBase, fontSize:18, color:'#64748b', padding:'4px 10px', lineHeight:1 }

export default function DatePicker({ value, onChange, placeholder = 'DD/MM/AAAA', errStyle }) {
  const [open,        setOpen]        = useState(false)
  const [view,        setView]        = useState(null)         // { year, month }
  const [mode,        setMode]        = useState('days')       // 'days' | 'months' | 'years'
  const [decadeStart, setDecadeStart] = useState(null)         // início da década exibida
  const ref = useRef(null)

  const selected = value ? new Date(value + 'T00:00:00') : null
  const today    = new Date(); today.setHours(0,0,0,0)

  useEffect(() => {
    if (open) {
      const d = selected || today
      setView({ year: d.getFullYear(), month: d.getMonth() })
      setDecadeStart(Math.floor(d.getFullYear() / 10) * 10)
      setMode('days')
    }
  }, [open])

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const pick = (year, month, day) => {
    onChange(`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`)
    setOpen(false)
  }

  const prevM = () => setView(v => v.month === 0  ? { year:v.year-1, month:11 } : { ...v, month:v.month-1 })
  const nextM = () => setView(v => v.month === 11 ? { year:v.year+1, month:0  } : { ...v, month:v.month+1 })

  const cells = () => {
    if (!view) return []
    const first = new Date(view.year, view.month, 1).getDay()
    const total = new Date(view.year, view.month+1, 0).getDate()
    return [...Array(first).fill(null), ...Array.from({length:total},(_,i)=>i+1)]
  }

  const isSel   = d => selected && d === selected.getDate() && view.month === selected.getMonth() && view.year === selected.getFullYear()
  const isToday = d => d === today.getDate() && view.month === today.getMonth() && view.year === today.getFullYear()

  const display = selected
    ? selected.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})
    : ''

  /* Anos da década atual (12 anos: start-1 até start+10) para dar contexto */
  const decadeYears = decadeStart !== null
    ? Array.from({length:12}, (_,i) => decadeStart - 1 + i)
    : []

  const hov = (e, bg='#f1f5f9') => e.currentTarget.style.background = bg
  const unHov = (e, bg='transparent') => e.currentTarget.style.background = bg

  return (
    <div ref={ref} style={{position:'relative'}}>
      <input
        readOnly value={display} placeholder={placeholder}
        onClick={() => setOpen(o => !o)}
        className="fi"
        style={{cursor:'pointer', caretColor:'transparent', ...errStyle}}
      />

      {open && view && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position:'absolute', top:'calc(100% + 6px)', left:0, zIndex:350,
            background:'#fff', borderRadius:10, border:'1px solid #e2e8f0',
            boxShadow:'0 10px 32px rgba(0,0,0,.13)', width:272,
            overflow:'hidden', animation:'mIn .12s ease',
          }}
        >
          {/* ── HEADER ── */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 10px 10px',borderBottom:'1px solid #f1f5f9'}}>
            {/* prev */}
            <button style={navStyle}
              onClick={() => mode==='days' ? prevM() : mode==='years' ? setDecadeStart(d=>d-10) : null}
              onMouseEnter={e=>hov(e)} onMouseLeave={e=>unHov(e)}
            >‹</button>

            {/* Mês clicável → modo meses */}
            {mode !== 'years' && (
              <button
                style={{...btnBase,fontSize:13.5,fontWeight:600,color:'#1e293b',padding:'4px 8px'}}
                onClick={() => setMode(m => m==='days' ? 'months' : 'days')}
                onMouseEnter={e=>hov(e)} onMouseLeave={e=>unHov(e)}
              >
                {mode==='months' ? 'Mês' : MONTHS[view.month]}
              </button>
            )}

            {/* Ano clicável → modo anos */}
            {mode !== 'months' && (
              <button
                style={{...btnBase,fontSize:13.5,fontWeight:600,color: mode==='years' ? '#2e6db4' : '#1e293b',padding:'4px 8px'}}
                onClick={() => setMode(m => m==='years' ? 'days' : 'years')}
                onMouseEnter={e=>hov(e)} onMouseLeave={e=>unHov(e)}
              >
                {mode==='years' ? `${decadeStart}–${decadeStart+9}` : view.year}
              </button>
            )}

            {mode==='months' && (
              <button
                style={{...btnBase,fontSize:13.5,fontWeight:600,color:'#2e6db4',padding:'4px 8px'}}
                onClick={() => setMode('years')}
                onMouseEnter={e=>hov(e)} onMouseLeave={e=>unHov(e)}
              >{view.year}</button>
            )}

            {/* next */}
            <button style={navStyle}
              onClick={() => mode==='days' ? nextM() : mode==='years' ? setDecadeStart(d=>d+10) : null}
              onMouseEnter={e=>hov(e)} onMouseLeave={e=>unHov(e)}
            >›</button>
          </div>

          {/* ── MODO: ANOS (grade por década) ── */}
          {mode==='years' && (
            <div style={{padding:'10px 10px 6px'}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:4}}>
                {decadeYears.map(y => {
                  const sel     = y === view.year
                  const outside = y < decadeStart || y > decadeStart+9
                  return (
                    <button key={y}
                      onClick={() => { setView(v=>({...v,year:y})); setDecadeStart(Math.floor(y/10)*10); setMode('months') }}
                      style={{padding:'8px 2px', borderRadius:6, border:'none',
                        background: sel ? '#2e6db4' : 'transparent',
                        color: sel ? '#fff' : outside ? '#cbd5e1' : '#1e293b',
                        fontSize:13, fontWeight: sel ? 700 : 400,
                        cursor:'pointer', fontFamily:'inherit', transition:'background .1s'}}
                      onMouseEnter={e=>{ if(!sel) hov(e) }}
                      onMouseLeave={e=>{ if(!sel) unHov(e) }}
                    >{y}</button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── MODO: MESES ── */}
          {mode==='months' && (
            <div style={{padding:'10px 10px 6px'}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:4}}>
                {MONTHS.map((m,i) => {
                  const sel = i === view.month
                  return (
                    <button key={m}
                      onClick={() => { setView(v=>({...v,month:i})); setMode('days') }}
                      style={{padding:'9px 4px', borderRadius:6, border:'none',
                        background: sel ? '#2e6db4' : 'transparent',
                        color: sel ? '#fff' : '#1e293b',
                        fontSize:13, fontWeight: sel ? 600 : 400,
                        cursor:'pointer', fontFamily:'inherit', transition:'background .1s'}}
                      onMouseEnter={e=>{ if(!sel) hov(e) }}
                      onMouseLeave={e=>{ if(!sel) unHov(e) }}
                    >{m.slice(0,3)}</button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── MODO: DIAS ── */}
          {mode==='days' && (
            <div style={{padding:'8px 10px 6px'}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',marginBottom:4}}>
                {DAYS.map(d=>(
                  <div key={d} style={{textAlign:'center',fontSize:11,fontWeight:700,color:'#94a3b8',padding:'3px 0'}}>{d}</div>
                ))}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2}}>
                {cells().map((day,i) => {
                  if(!day) return <div key={`e${i}`}/>
                  const sel = isSel(day)
                  const tod = isToday(day)
                  return (
                    <button key={day}
                      onClick={() => pick(view.year, view.month, day)}
                      style={{padding:'6px 0', borderRadius:6, border: !sel && tod ? '1.5px solid #2e6db4' : 'none',
                        background: sel ? '#2e6db4' : 'transparent',
                        color: sel ? '#fff' : tod ? '#2e6db4' : '#1e293b',
                        fontSize:13, fontWeight: sel||tod ? 600 : 400,
                        cursor:'pointer', fontFamily:'inherit', transition:'background .1s'}}
                      onMouseEnter={e=>{ if(!sel) hov(e) }}
                      onMouseLeave={e=>{ if(!sel) unHov(e,'transparent') }}
                    >{day}</button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── RODAPÉ ── */}
          <div style={{display:'flex',gap:6,padding:'8px 10px',borderTop:'1px solid #f1f5f9'}}>
            <button
              onClick={() => { const t=today; pick(t.getFullYear(),t.getMonth(),t.getDate()) }}
              style={{flex:1,padding:'5px',border:'1px solid #e2e8f0',borderRadius:6,background:'#fff',color:'#2e6db4',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
            >Hoje</button>
            {value && (
              <button
                onClick={() => { onChange(''); setOpen(false) }}
                style={{flex:1,padding:'5px',border:'1px solid #e2e8f0',borderRadius:6,background:'#fff',color:'#94a3b8',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}
              >Limpar</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
