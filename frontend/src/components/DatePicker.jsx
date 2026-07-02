import { useState, useRef, useEffect, useLayoutEffect } from 'react'

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const DAYS   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']

const btnBase = { background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', transition:'background .1s', borderRadius:6 }
const navStyle = { ...btnBase, fontSize:18, color:'#64748b', padding:'4px 10px', lineHeight:1 }

const hov   = (e, bg='#f1f5f9') => e.currentTarget.style.background = bg
const unHov = (e, bg='transparent') => e.currentTarget.style.background = bg

/* ISO → DD/MM/AAAA */
const isoToDisplay = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/* DD/MM/AAAA → ISO (retorna null se inválida) */
const displayToIso = (str) => {
  if (str.length !== 10) return null
  const [d, m, y] = str.split('/')
  const dd = parseInt(d), mm = parseInt(m), yyyy = parseInt(y)
  if (isNaN(dd)||isNaN(mm)||isNaN(yyyy)) return null
  if (mm < 1||mm > 12||dd < 1||dd > 31||yyyy < 1000) return null
  const date = new Date(yyyy, mm-1, dd)
  if (date.getDate()!==dd||date.getMonth()!==mm-1||date.getFullYear()!==yyyy) return null
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
}

export default function DatePicker({ value, onChange, placeholder = 'DD/MM/AAAA', errStyle, fixed = false, relatedDate = null }) {
  const [open,        setOpen]        = useState(false)
  const [inputVal,    setInputVal]    = useState(isoToDisplay(value))
  const [view,        setView]        = useState(null)
  const [mode,        setMode]        = useState('days')
  const [decadeStart, setDecadeStart] = useState(null)
  const [popupPos,    setPopupPos]    = useState({})
  const [hoverDay,    setHoverDay]    = useState(null)
  const ref       = useRef(null)
  const inpRef    = useRef(null)
  const popupRef  = useRef(null)

  const selected = value ? new Date(value + 'T00:00:00') : null
  const related  = relatedDate ? new Date(relatedDate + 'T00:00:00') : null
  const today    = new Date(); today.setHours(0,0,0,0)

  /* Sync inputVal quando value muda externamente */
  useEffect(() => { setInputVal(isoToDisplay(value)) }, [value])

  /* Inicializa view ao abrir */
  useEffect(() => {
    if (open) {
      const d = related || selected || today
      setView({ year: d.getFullYear(), month: d.getMonth() })
      setDecadeStart(Math.floor(d.getFullYear() / 10) * 10)
      setMode('days')
      setHoverDay(null)
    }
  }, [open])

  /* Posição do popup fixed — usa a altura REAL do popup já renderizado (não
   * uma estimativa, que deixava espaço sobrando quando abria pra cima).
   * Recalcula ao abrir, ao trocar de modo (dias/meses/anos muda a altura) e
   * enquanto a página/modal faz scroll ou a janela é redimensionada; abre
   * pra cima se não houver espaço suficiente embaixo do campo. */
  const reposition = () => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const popupH = popupRef.current?.offsetHeight || 360
    const spaceBelow = window.innerHeight - rect.bottom
    const flipUp = spaceBelow < popupH && rect.top > spaceBelow
    setPopupPos({
      top: flipUp ? Math.max(8, rect.top - popupH - 6) : rect.bottom + 6,
      left: rect.left,
    })
  }

  useLayoutEffect(() => {
    if (open && fixed) reposition()
  }, [open, fixed, mode, view])

  useEffect(() => {
    if (!open || !fixed) return
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, fixed])

  /* Fecha ao clicar fora */
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  /* Digitação com máscara DD/MM/AAAA */
  const handleChange = (e) => {
    const raw = e.target.value.replace(/\D/g,'').slice(0, 8)
    let fmt = raw
    if (raw.length > 2) fmt = raw.slice(0,2) + '/' + raw.slice(2)
    if (raw.length > 4) fmt = raw.slice(0,2) + '/' + raw.slice(2,4) + '/' + raw.slice(4)
    setInputVal(fmt)

    if (raw.length >= 4 && view) {
      const mm = parseInt(raw.slice(2,4))
      if (mm >= 1 && mm <= 12) setView(v => ({ ...v, month: mm-1 }))
    }
    if (raw.length === 8 && view) {
      const yyyy = parseInt(raw.slice(4))
      if (yyyy >= 1000 && yyyy <= 9999) {
        setView(v => ({ ...v, year: yyyy }))
        setDecadeStart(Math.floor(yyyy/10)*10)
      }
    }

    if (fmt.length === 10) {
      const iso = displayToIso(fmt)
      if (iso) onChange(iso)
    } else if (fmt.length === 0) {
      onChange('')
    }
  }

  /* Seleciona um dia; clicar no dia já selecionado limpa o campo. Em ambos os
   * casos o popup fecha automaticamente após a escolha (clicou numa data → fecha). */
  const pick = (year, month, day) => {
    if (selected && day === selected.getDate() && month === selected.getMonth() && year === selected.getFullYear()) {
      onChange('')
      setInputVal('')
      setOpen(false)
      return
    }
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    onChange(iso)
    setInputVal(isoToDisplay(iso))
    setOpen(false)
  }

  const prevM = () => setView(v => v.month===0 ? {year:v.year-1,month:11} : {...v,month:v.month-1})
  const nextM = () => setView(v => v.month===11? {year:v.year+1,month:0}  : {...v,month:v.month+1})

  const cells = () => {
    if (!view) return []
    const first = new Date(view.year, view.month, 1).getDay()
    const total = new Date(view.year, view.month+1, 0).getDate()
    return [...Array(first).fill(null), ...Array.from({length:total},(_,i)=>i+1)]
  }

  const isSel     = d => selected && d===selected.getDate() && view.month===selected.getMonth() && view.year===selected.getFullYear()
  const isToday   = d => d===today.getDate() && view.month===today.getMonth() && view.year===today.getFullYear()
  const isRelated = d => related && d===related.getDate() && view.month===related.getMonth() && view.year===related.getFullYear()

  /* Duração em dias: estática quando ambas datas definidas, dinâmica no hover caso contrário */
  let hoverDuration = null
  if (related && view) {
    if (selected) {
      hoverDuration = Math.round(Math.abs(selected - related) / 86400000) + 1
    } else if (hoverDay != null) {
      hoverDuration = Math.round(Math.abs(new Date(view.year, view.month, hoverDay) - related) / 86400000) + 1
    }
  }

  /* Computa estilo de cada célula de dia, incluindo range */
  const cellStyle = (day) => {
    const sel = isSel(day)
    const tod = isToday(day)
    const rel = !sel && isRelated(day)

    let inRange = false
    let isHovEndpoint = false

    if (!sel && !rel && related) {
      const cellTs = new Date(view.year, view.month, day).getTime()
      const relTs  = related.getTime()

      if (hoverDay != null) {
        // Hover em progresso: range candidato entre anchor e cursor
        const hovTs = new Date(view.year, view.month, hoverDay).getTime()
        inRange = cellTs >= Math.min(relTs, hovTs) && cellTs <= Math.max(relTs, hovTs)
        isHovEndpoint = day === hoverDay
      } else if (selected) {
        // Sem hover, mas ambas datas definidas: range persistente
        const selTs = selected.getTime()
        inRange = cellTs >= Math.min(relTs, selTs) && cellTs <= Math.max(relTs, selTs)
      }
    }

    if (sel)            return { bg:'#2e6db4', color:'#fff',    border:'none',                fw:600 }
    if (rel)            return { bg:'#dcfce7', color:'#15803d', border:'1.5px solid #86efac', fw:600 }
    if (isHovEndpoint)  return { bg:'#bfdbfe', color:'#1e40af', border:'none',                fw:600 }
    if (inRange)        return { bg:'#eff6ff', color:'#1d4ed8', border:'none',                fw:400 }
    if (day===hoverDay) return { bg:'#f1f5f9', color:'#1e293b', border:'none',                fw:400 }
    return {
      bg:'transparent',
      color: tod ? '#2e6db4' : '#1e293b',
      border: tod ? '1.5px solid #2e6db4' : 'none',
      fw: tod ? 600 : 400,
    }
  }

  const decadeYears = decadeStart!==null ? Array.from({length:12},(_,i)=>decadeStart-1+i) : []

  return (
    <div ref={ref} style={{position:'relative', display:'flex', alignItems:'center', gap:0}}>
      {/* Input editável */}
      <input
        ref={inpRef}
        value={inputVal}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const iso = displayToIso(inputVal)
            if (iso) onChange(iso)
            setOpen(false)
          } else if (e.key === 'Tab') {
            setOpen(false)
          } else if (e.key === 'Escape') {
            setOpen(false)
            e.currentTarget.blur()
          }
        }}
        placeholder={placeholder}
        className="fi"
        style={{ paddingRight:32, cursor:'text', ...errStyle }}
      />

      {/* Ícone de calendário */}
      <button
        type="button"
        onClick={() => { setOpen(o=>!o); inpRef.current?.focus() }}
        style={{
          position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
          background:'none', border:'none', cursor:'pointer', padding:'2px 4px',
          color:'#94a3b8', fontSize:15, lineHeight:1, borderRadius:4,
          transition:'color .12s',
        }}
        onMouseEnter={e=>e.currentTarget.style.color='#2e6db4'}
        onMouseLeave={e=>e.currentTarget.style.color='#94a3b8'}
      >
        📅
      </button>

      {/* Popup calendário */}
      {open && view && (
        <div
          ref={popupRef}
          onClick={e=>e.stopPropagation()}
          style={{
            position: fixed ? 'fixed' : 'absolute',
            top:  fixed ? popupPos.top  : 'calc(100% + 6px)',
            left: fixed ? popupPos.left : 0,
            zIndex: fixed ? 9999 : 600,
            background:'#fff', borderRadius:10, border:'1px solid #e2e8f0',
            boxShadow:'0 10px 32px rgba(0,0,0,.13)', width:272,
            overflow:'hidden', animation:'mIn .12s ease',
          }}
        >
          {/* Header */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 10px 10px',borderBottom:'1px solid #f1f5f9'}}>
            <button style={navStyle}
              onClick={() => mode==='days' ? prevM() : mode==='years' ? setDecadeStart(d=>d-10) : null}
              onMouseEnter={e=>hov(e)} onMouseLeave={e=>unHov(e)}>‹</button>

            {mode!=='years' && (
              <button style={{...btnBase,fontSize:13.5,fontWeight:600,color:'#1e293b',padding:'4px 8px'}}
                onClick={() => setMode(m=>m==='days'?'months':'days')}
                onMouseEnter={e=>hov(e)} onMouseLeave={e=>unHov(e)}>
                {mode==='months' ? 'Mês' : MONTHS[view.month]}
              </button>
            )}

            {mode!=='months' && (
              <button style={{...btnBase,fontSize:13.5,fontWeight:600,color:mode==='years'?'#2e6db4':'#1e293b',padding:'4px 8px'}}
                onClick={() => setMode(m=>m==='years'?'days':'years')}
                onMouseEnter={e=>hov(e)} onMouseLeave={e=>unHov(e)}>
                {mode==='years' ? `${decadeStart}–${decadeStart+9}` : view.year}
              </button>
            )}
            {mode==='months' && (
              <button style={{...btnBase,fontSize:13.5,fontWeight:600,color:'#2e6db4',padding:'4px 8px'}}
                onClick={() => setMode('years')}
                onMouseEnter={e=>hov(e)} onMouseLeave={e=>unHov(e)}>{view.year}</button>
            )}

            <button style={navStyle}
              onClick={() => mode==='days' ? nextM() : mode==='years' ? setDecadeStart(d=>d+10) : null}
              onMouseEnter={e=>hov(e)} onMouseLeave={e=>unHov(e)}>›</button>
          </div>

          {/* Anos */}
          {mode==='years' && (
            <div style={{padding:'10px 10px 6px'}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:4}}>
                {decadeYears.map(y=>{
                  const sel=y===view.year, outside=y<decadeStart||y>decadeStart+9
                  return (
                    <button key={y}
                      onClick={()=>{setView(v=>({...v,year:y}));setDecadeStart(Math.floor(y/10)*10);setMode('months')}}
                      style={{padding:'8px 2px',borderRadius:6,border:'none',
                        background:sel?'#2e6db4':'transparent',
                        color:sel?'#fff':outside?'#cbd5e1':'#1e293b',
                        fontSize:13,fontWeight:sel?700:400,cursor:'pointer',fontFamily:'inherit',transition:'background .1s'}}
                      onMouseEnter={e=>{if(!sel)hov(e)}} onMouseLeave={e=>{if(!sel)unHov(e)}}
                    >{y}</button>)
                })}
              </div>
            </div>
          )}

          {/* Meses */}
          {mode==='months' && (
            <div style={{padding:'10px 10px 6px'}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:4}}>
                {MONTHS.map((m,i)=>{
                  const sel=i===view.month
                  return (
                    <button key={m}
                      onClick={()=>{setView(v=>({...v,month:i}));setMode('days')}}
                      style={{padding:'9px 4px',borderRadius:6,border:'none',
                        background:sel?'#2e6db4':'transparent',color:sel?'#fff':'#1e293b',
                        fontSize:13,fontWeight:sel?600:400,cursor:'pointer',fontFamily:'inherit',transition:'background .1s'}}
                      onMouseEnter={e=>{if(!sel)hov(e)}} onMouseLeave={e=>{if(!sel)unHov(e)}}
                    >{m.slice(0,3)}</button>)
                })}
              </div>
            </div>
          )}

          {/* Dias */}
          {mode==='days' && (
            <div style={{padding:'8px 10px 6px'}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',marginBottom:4}}>
                {DAYS.map(d=>(
                  <div key={d} style={{textAlign:'center',fontSize:11,fontWeight:700,color:'#94a3b8',padding:'3px 0'}}>{d}</div>
                ))}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2}}>
                {cells().map((day,i)=>{
                  if(!day) return <div key={`e${i}`}/>
                  const { bg, color, border, fw } = cellStyle(day)
                  return (
                    <button key={day}
                      onClick={()=>pick(view.year,view.month,day)}
                      onMouseEnter={()=>setHoverDay(day)}
                      onMouseLeave={()=>setHoverDay(null)}
                      style={{
                        padding:'6px 0', borderRadius:6, cursor:'pointer', fontFamily:'inherit',
                        transition:'background .08s',
                        border, background:bg, color, fontSize:13, fontWeight:fw,
                      }}
                    >{day}</button>)
                })}
              </div>
            </div>
          )}

          {/* Barra de duração — só exibida quando relatedDate está definida */}
          {related && mode==='days' && (
            <div style={{
              padding:'5px 10px', borderTop:'1px solid #f1f5f9',
              fontSize:11.5, textAlign:'center',
              color: hoverDuration != null ? '#475569' : '#cbd5e1',
              minHeight:26, display:'flex', alignItems:'center', justifyContent:'center',
            }}>
              {hoverDuration != null
                ? (hoverDuration === 1 ? '1 dia de viagem' : `${hoverDuration} dias de viagem`)
                : 'Passe o mouse para ver a duração'
              }
            </div>
          )}

          {/* Rodapé — só mostra quando há valor para limpar */}
          {value && (
            <div style={{display:'flex',gap:6,padding:'8px 10px',borderTop:'1px solid #f1f5f9'}}>
              <button
                onClick={()=>{onChange('');setInputVal('');setOpen(false)}}
                style={{flex:1,padding:'5px',border:'1px solid #e2e8f0',borderRadius:6,background:'#fff',color:'#94a3b8',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}
              >Limpar</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
