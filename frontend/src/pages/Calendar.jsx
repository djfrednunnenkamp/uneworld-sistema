import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { agendaApi } from '../api'
import { Ic } from '../components/Icon'

const WEEKDAYS      = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const WEEKDAYS_FULL = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
const MONTHS        = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

const TYPE_CFG = {
  trip:     { label: 'Viagem',      bg: '#dbeafe', fg: '#1d4ed8' },
  deadline: { label: 'Prazo',       bg: '#fef3c7', fg: '#b45309' },
  birthday: { label: 'Aniversário', bg: '#ede9fe', fg: '#7c3aed' },
}
const TYPE_ORDER = { trip: 0, deadline: 1, birthday: 2 }

const pad   = (n) => String(n).padStart(2, '0')
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fmtBR = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
const startOfWeek = (d) => { const r = new Date(d); r.setDate(r.getDate() - r.getDay()); return r }
const addDays      = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }

function Toggle({ label, value, onChange }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', background:'#f8fafc', borderRadius:8, border:'1px solid #e2e8f0' }}>
      <span style={{ fontSize:13, color:'#1e293b', fontWeight:500 }}>{label}</span>
      <button type="button" onClick={() => onChange(!value)}
        style={{ position:'relative', width:44, height:24, borderRadius:12, border:'none', background: value ? '#1a2d4f' : '#cbd5e1', cursor:'pointer', transition:'background .2s', flexShrink:0, padding:0 }}>
        <span style={{ position:'absolute', top:2, left: value ? 22 : 2, width:20, height:20, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,.2)', transition:'left .2s', display:'block' }} />
      </button>
    </div>
  )
}

function EventChip({ ev, onClick }) {
  const cfg = TYPE_CFG[ev.type]
  return (
    <div onClick={onClick} title={ev.title}
      style={{ fontSize:11, padding:'2px 6px', borderRadius:4, marginBottom:2, background:cfg.bg, color:cfg.fg, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', cursor:'pointer', fontWeight:500 }}>
      {ev.title}
    </div>
  )
}

function EventRow({ ev, onClick }) {
  const cfg = TYPE_CFG[ev.type]
  return (
    <div onClick={onClick}
      style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:8, border:'1px solid #e2e8f0', cursor: onClick ? 'pointer' : 'default', marginBottom:8 }}>
      <span style={{ width:8, height:8, borderRadius:'50%', background:cfg.fg, flexShrink:0 }} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:500, color:'#1e293b', overflowWrap:'anywhere' }}>{ev.title}</div>
        {ev.subtitle && <div style={{ fontSize:12, color:'#64748b', overflowWrap:'anywhere' }}>{ev.subtitle}</div>}
      </div>
      {ev.type === 'trip' && (
        <span style={{ fontSize:11, color:'#94a3b8', whiteSpace:'nowrap' }}>{fmtBR(ev.start)} – {fmtBR(ev.end)}</span>
      )}
      <span style={{ fontSize:11, fontWeight:600, padding:'3px 9px', borderRadius:20, background:cfg.bg, color:cfg.fg, whiteSpace:'nowrap' }}>{cfg.label}</span>
    </div>
  )
}

function DayView({ events, onEvent }) {
  return (
    <div className="tcard">
      <div className="tcard-head">
        <span>{events.length} evento{events.length !== 1 ? 's' : ''}</span>
      </div>
      <div style={{ padding:16 }}>
        {events.length === 0 ? (
          <div className="empty-state"><p>Nenhum evento neste dia</p></div>
        ) : events.map(ev => (
          <EventRow key={ev.id} ev={ev} onClick={ev.url ? () => onEvent(ev) : undefined} />
        ))}
      </div>
    </div>
  )
}

export default function CalendarPage() {
  const navigate = useNavigate()
  const [anchor, setAnchor]       = useState(new Date())
  const [view, setView]           = useState('month')
  const [events, setEvents]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [dayModal, setDayModal]   = useState(null)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [prefs, setPrefs]         = useState(null)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [sending, setSending]     = useState(false)

  const todayISO = toISO(new Date())

  const range = useMemo(() => {
    if (view === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      const last  = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
      return { start: startOfWeek(first), end: addDays(startOfWeek(last), 6) }
    }
    if (view === 'week') {
      const s = startOfWeek(anchor)
      return { start: s, end: addDays(s, 6) }
    }
    return { start: anchor, end: anchor }
  }, [anchor, view])

  const startISO = toISO(range.start)
  const endISO   = toISO(range.end)

  useEffect(() => {
    setLoading(true)
    agendaApi.events(startISO, endISO)
      .then(r => setEvents(r.data.events || []))
      .catch(() => toast.error('Erro ao carregar eventos do calendário'))
      .finally(() => setLoading(false))
  }, [startISO, endISO])

  const days = useMemo(() => {
    const arr = []
    let d = new Date(range.start)
    while (toISO(d) <= toISO(range.end)) {
      arr.push(new Date(d))
      d = addDays(d, 1)
    }
    return arr
  }, [range])

  const eventsForDay = (iso) => events
    .filter(ev => ev.type === 'trip' ? (ev.start <= iso && iso <= ev.end) : ev.start === iso)
    .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type])

  const goPrev = () => {
    if (view === 'month') setAnchor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
    else if (view === 'week') setAnchor(d => addDays(d, -7))
    else setAnchor(d => addDays(d, -1))
  }
  const goNext = () => {
    if (view === 'month') setAnchor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
    else if (view === 'week') setAnchor(d => addDays(d, 7))
    else setAnchor(d => addDays(d, 1))
  }
  const goToday = () => setAnchor(new Date())

  const periodLabel = useMemo(() => {
    if (view === 'month') return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
    if (view === 'week') {
      const s = range.start, e = range.end
      if (s.getMonth() === e.getMonth()) return `${s.getDate()} – ${e.getDate()} de ${MONTHS[s.getMonth()]} ${s.getFullYear()}`
      return `${s.getDate()} de ${MONTHS[s.getMonth()]} – ${e.getDate()} de ${MONTHS[e.getMonth()]} de ${e.getFullYear()}`
    }
    return `${WEEKDAYS_FULL[anchor.getDay()]}, ${anchor.getDate()} de ${MONTHS[anchor.getMonth()]} de ${anchor.getFullYear()}`
  }, [anchor, view, range])

  const goToEvent = (ev) => {
    if (ev.url) navigate(ev.url)
  }

  const openPrefs = () => {
    setPrefsOpen(true)
    setPrefs(null)
    agendaApi.getPrefs()
      .then(r => setPrefs(r.data))
      .catch(() => toast.error('Erro ao carregar preferências'))
  }

  const savePrefs = () => {
    setSavingPrefs(true)
    agendaApi.updatePrefs(prefs)
      .then(r => { setPrefs(r.data); toast.success('Preferências salvas') })
      .catch(() => toast.error('Erro ao salvar preferências'))
      .finally(() => setSavingPrefs(false))
  }

  const sendNow = () => {
    setSending(true)
    agendaApi.sendNow()
      .then(() => toast.success('Resumo enviado para o seu e-mail!'))
      .catch(err => toast.error(err.response?.data?.detail || 'Erro ao enviar e-mail'))
      .finally(() => setSending(false))
  }

  return (
    <div>
      <div className="ph">
        <h1 className="ph-title">Calendário</h1>
        <div className="ph-actions">
          <button className="btn btn-outline" onClick={openPrefs}>
            <Ic n="settings" s={14}/> Notificações
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <button className="btn btn-outline" onClick={goPrev} style={{ padding:'7px 11px', fontSize:16, lineHeight:1 }}>‹</button>
          <button className="btn btn-outline" onClick={goToday}>Hoje</button>
          <button className="btn btn-outline" onClick={goNext} style={{ padding:'7px 11px', fontSize:16, lineHeight:1 }}>›</button>
          <span style={{ fontSize:16, fontWeight:600, color:'#1e293b', marginLeft:6, textTransform:'capitalize' }}>{periodLabel}</span>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <button className={`chip ${view === 'month' ? 'on' : ''}`} onClick={() => setView('month')}>Mês</button>
          <button className={`chip ${view === 'week' ? 'on' : ''}`} onClick={() => setView('week')}>Semana</button>
          <button className={`chip ${view === 'day' ? 'on' : ''}`} onClick={() => setView('day')}>Dia</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display:'flex', gap:16, marginBottom:14, fontSize:12.5, color:'#64748b' }}>
        {Object.entries(TYPE_CFG).map(([k, c]) => (
          <span key={k} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ width:10, height:10, borderRadius:3, background:c.fg, display:'inline-block' }} />
            {c.label}
          </span>
        ))}
      </div>

      {loading ? (
        <p style={{ color:'#94a3b8', fontSize:14 }}>Carregando…</p>
      ) : view === 'day' ? (
        <DayView events={eventsForDay(toISO(anchor))} onEvent={goToEvent} />
      ) : (
        <div className="tcard">
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', borderBottom:'1px solid #e2e8f0' }}>
            {WEEKDAYS.map(w => (
              <div key={w} style={{ padding:'10px', textAlign:'center', fontSize:12, fontWeight:600, color:'#64748b' }}>{w}</div>
            ))}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)' }}>
            {days.map(d => {
              const iso       = toISO(d)
              const dayEvents = eventsForDay(iso)
              const isToday   = iso === todayISO
              const inMonth   = view === 'week' || d.getMonth() === anchor.getMonth()
              const maxChips  = view === 'week' ? 6 : 3
              return (
                <div key={iso}
                  onClick={() => setDayModal(iso)}
                  style={{
                    minHeight: view === 'week' ? 220 : 100, minWidth:0, padding:6,
                    borderRight:'1px solid #f1f5f9', borderBottom:'1px solid #f1f5f9',
                    background: isToday ? '#eff6ff' : '#fff',
                    opacity: inMonth ? 1 : .4, cursor:'pointer', overflow:'hidden',
                  }}>
                  <div style={{ fontSize:12, fontWeight: isToday ? 700 : 500, color: isToday ? '#2e6db4' : '#1e293b', marginBottom:4 }}>
                    {view === 'week' && <span style={{ marginRight:4, color:'#94a3b8' }}>{WEEKDAYS[d.getDay()]}</span>}
                    {d.getDate()}
                  </div>
                  {dayEvents.slice(0, maxChips).map(ev => (
                    <EventChip key={ev.id} ev={ev} onClick={(e) => { e.stopPropagation(); goToEvent(ev) }} />
                  ))}
                  {dayEvents.length > maxChips && (
                    <div style={{ fontSize:11, color:'#94a3b8' }}>+{dayEvents.length - maxChips} mais</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Detalhe do dia */}
      {dayModal && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setDayModal(null) }}>
          <div className="mbox" style={{ maxWidth:480, width:'100%' }}>
            <div className="mhead">
              <span className="mtitle">{fmtBR(dayModal)}</span>
              <button className="mclose" onClick={() => setDayModal(null)}><Ic n="x" s={14}/></button>
            </div>
            <div className="mbody">
              {eventsForDay(dayModal).length === 0 ? (
                <div className="empty-state"><p>Nenhum evento neste dia</p></div>
              ) : eventsForDay(dayModal).map(ev => (
                <EventRow key={ev.id} ev={ev} onClick={ev.url ? () => goToEvent(ev) : undefined} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Preferências de notificação */}
      {prefsOpen && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setPrefsOpen(false) }}>
          <div className="mbox" style={{ maxWidth:440, width:'100%' }}>
            <div className="mhead">
              <span className="mtitle">Notificações do calendário</span>
              <button className="mclose" onClick={() => setPrefsOpen(false)}><Ic n="x" s={14}/></button>
            </div>
            <div className="mbody">
              {!prefs ? (
                <p style={{ color:'#94a3b8', fontSize:14 }}>Carregando…</p>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  <Toggle label="Resumo automático periódico" value={prefs.digest_enabled}
                    onChange={(v) => setPrefs({ ...prefs, digest_enabled: v })} />
                  {prefs.digest_enabled && (
                    <div className="ff">
                      <label className="fl">Frequência do resumo</label>
                      <select className="fs" value={prefs.digest_frequency}
                        onChange={e => setPrefs({ ...prefs, digest_frequency: e.target.value })}>
                        <option value="daily">Diário</option>
                        <option value="weekly">Semanal (segundas-feiras)</option>
                      </select>
                    </div>
                  )}

                  <Toggle label="Lembrete de prazos por e-mail" value={prefs.reminder_enabled}
                    onChange={(v) => setPrefs({ ...prefs, reminder_enabled: v })} />
                  {prefs.reminder_enabled && (
                    <div className="ff">
                      <label className="fl">Avisar com quantos dias de antecedência</label>
                      <input className="fi" type="number" min={1} max={30} value={prefs.reminder_days_before}
                        onChange={e => setPrefs({ ...prefs, reminder_days_before: Number(e.target.value) })} />
                    </div>
                  )}

                  <div style={{ borderTop:'1px solid #e2e8f0', paddingTop:12 }}>
                    <button className="btn btn-outline" onClick={sendNow} disabled={sending} style={{ width:'100%', justifyContent:'center' }}>
                      <Ic n="ul" s={14}/> {sending ? 'Enviando…' : 'Enviar resumo agora'}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="mfoot">
              <button className="btn btn-outline" onClick={() => setPrefsOpen(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={savePrefs} disabled={!prefs || savingPrefs}>
                {savingPrefs ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
