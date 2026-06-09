import React, { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import FormSelect from '../components/FormSelect'
import PassengerPreviewModal from '../components/PassengerPreviewModal'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { listsApi, passengersApi, agenciesApi, configApi, documentsApi } from '../api'
import DatePicker from '../components/DatePicker'
import TimePicker from '../components/TimePicker'
import ListModal from '../components/ListModal'
import usePersistedTab from '../hooks/usePersistedTab'
import ConfirmModal from '../components/ConfirmModal'
import { Ic } from '../components/Icon'
import AirlinePicker from '../components/AirlinePicker'
import CpfInput from '../components/CpfInput'
import PhoneInput from '../components/PhoneInput'

// Encontra o tipo pelo nome mais longo que bate como prefixo — evita "Duplo" engolir "Duplo Casal"
const findAccomType = (types, roomName) =>
  [...types].sort((a, b) => b.name.length - a.name.length)
    .find(t => roomName === t.name || roomName.startsWith(t.name + ' '))

function calcAge(birthDate) {
  if (!birthDate) return null
  const today = new Date()
  const b     = new Date(birthDate + 'T00:00:00')
  let age = today.getFullYear() - b.getFullYear()
  if (today.getMonth() < b.getMonth() || (today.getMonth() === b.getMonth() && today.getDate() < b.getDate())) age--
  return age
}

const TYPE_LABEL = {
  aereo:'Via Aéreo', terrestre:'Via Terrestre',
}

const fmt = (d) => {
  if (!d) return '—'
  const [y,m,dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

// Retorna o número do dia da viagem em que cai o aniversário (1-based), ou null
function getBirthdayInTrip(birthDate, startDate, endDate) {
  if (!birthDate || !startDate || !endDate) return null
  const [,bm,bd] = birthDate.split('-').map(Number)
  const start = new Date(startDate + 'T00:00:00')
  const end   = new Date(endDate   + 'T00:00:00')
  const cur = new Date(start)
  let day = 1
  while (cur <= end) {
    if (cur.getMonth() + 1 === bm && cur.getDate() === bd) return day
    cur.setDate(cur.getDate() + 1)
    day++
  }
  return null
}

const ordinal = n => `${n}º`

/* ── Chip de info ── */
function Chip({ label, value }) {
  if (!value) return null
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
      <span style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.05em' }}>{label}</span>
      <span style={{ fontSize:13, color:'#1e293b', fontWeight:500 }}>{value}</span>
    </div>
  )
}

/* ── Selo de status da lista — clicável, abre dropdown para alterar ── */
const LIST_STATUS_OPTS = [
  { value:'aberta',  label:'Aberta',  bg:'#dcfce7', color:'#16a34a' },
  { value:'fechada', label:'Fechada', bg:'#f1f5f9', color:'#64748b' },
]

function TripPhaseBadge({ startDate, endDate }) {
  const today = new Date(); today.setHours(0,0,0,0)
  const start = startDate ? new Date(startDate + 'T00:00:00') : null
  const end   = endDate   ? new Date(endDate   + 'T00:00:00') : null

  let label, bg, color, dot
  if (!start || today < start) {
    label = 'Em criação';    bg = '#eff6ff'; color = '#2563eb'; dot = '#93c5fd'
  } else if (!end || today <= end) {
    label = 'Em andamento';  bg = '#f0fdf4'; color = '#16a34a'; dot = '#86efac'
  } else {
    label = 'Finalizada';    bg = '#f1f5f9'; color = '#64748b'; dot = '#cbd5e1'
  }

  return (
    <span style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, fontWeight:700, padding:'6px 14px', borderRadius:20, background:bg, color, userSelect:'none' }}>
      <span style={{ width:7, height:7, borderRadius:'50%', background:dot, flexShrink:0,
        boxShadow: label === 'Em andamento' ? `0 0 0 3px ${dot}55` : 'none' }}/>
      {label}
    </span>
  )
}

function ListStatusBadge({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = LIST_STATUS_OPTS.find(o => o.value === value) || LIST_STATUS_OPTS[1]

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} style={{ position:'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, fontWeight:700, padding:'6px 14px', borderRadius:20, border:'none', cursor:'pointer', fontFamily:'inherit', background:current.bg, color:current.color }}>
        {current.label}
        <span style={{ fontSize:9, opacity:.7 }}>▼</span>
      </button>
      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 6px)', right:0, zIndex:200, background:'#fff',
          borderRadius:8, border:'1px solid #e2e8f0', boxShadow:'0 8px 24px rgba(0,0,0,.10)',
          minWidth:140, overflow:'hidden', animation:'mIn .12s ease' }}>
          {LIST_STATUS_OPTS.map(opt => {
            const sel = value === opt.value
            return (
              <button key={opt.value} type="button"
                onClick={() => { setOpen(false); if (!sel) onChange(opt.value) }}
                style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%',
                  padding:'9px 14px', gap:10, background:sel?'#eff6ff':'transparent',
                  border:'none', borderBottom:'1px solid #f8fafc',
                  color:sel?'#2e6db4':'#1e293b', fontSize:13, fontWeight:sel?600:400,
                  cursor:'pointer', fontFamily:'inherit', textAlign:'left', transition:'background .1s' }}
                onMouseEnter={e => { if(!sel) e.currentTarget.style.background='#f8fafc' }}
                onMouseLeave={e => { if(!sel) e.currentTarget.style.background='transparent' }}>
                <span style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:opt.color }} />
                  {opt.label}
                </span>
                {sel && <span style={{ color:'#2e6db4' }}>✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Status dot ── */
const STATUS_DOT = {
  confirmado: { bg:'#16a34a', title:'Confirmado' },
  pendente:   { bg:'#f59e0b', title:'Pendente'   },
  reservado:  { bg:'#94a3b8', title:'Reservado'  },
  cancelado:  { bg:'#dc2626', title:'Cancelado'  },
}

const ENROLLMENT_STATUS_OPTS = [
  { value:'reservado',  label:'Reservado',  color:'#64748b' },
  { value:'pendente',   label:'Pendente',   color:'#f59e0b' },
  { value:'confirmado', label:'Confirmado', color:'#16a34a' },
  { value:'cancelado',  label:'Cancelado',  color:'#dc2626' },
]

/* ── Botão de status do passageiro na lista — clique abre popup para trocar ── */
function EnrollmentStatusDot({ value, onClick }) {
  const dot = STATUS_DOT[value] || STATUS_DOT.pendente
  return (
    <button type="button" onClick={(ev) => { ev.stopPropagation(); onClick() }}
      title={`Status: ${dot.title} — clique para alterar`}
      style={{ width:18, height:18, display:'flex', alignItems:'center', justifyContent:'center', border:'none', background:'transparent', cursor:'pointer', padding:0, margin:'0 auto' }}>
      <div style={{ width:10, height:10, borderRadius:'50%', background:dot.bg, boxShadow:`0 0 0 2px ${dot.bg}30` }} />
    </button>
  )
}

/* ── Popup para alterar o status do passageiro — ao cancelar, pede observação ── */
function EnrollmentStatusModal({ enrollment, onSave, onClose }) {
  const [status, setStatus] = useState(enrollment.enrollment_status)
  const [note,   setNote]   = useState(enrollment.notes || '')
  const [saving, setSaving] = useState(false)

  const name  = enrollment.passenger_name || enrollment.block_agency || 'Passageiro'
  const dirty = status !== enrollment.enrollment_status || (status === 'cancelado' && note !== (enrollment.notes || ''))

  const handleSave = async () => {
    setSaving(true)
    try { await onSave(status, note); onClose() }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:750, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:420, boxShadow:'0 32px 80px rgba(0,0,0,.25)' }}>

        {/* Header */}
        <div style={{ padding:'18px 22px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ minWidth:0 }}>
            <p style={{ margin:0, fontSize:15, fontWeight:700, color:'#0f172a' }}>Status do passageiro</p>
            <p title={name} style={{ margin:'2px 0 0', fontSize:12, color:'#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2, flexShrink:0 }}>×</button>
        </div>

        <div style={{ padding:'16px 22px 20px', display:'flex', flexDirection:'column', gap:14 }}>
          <div>
            <label style={LBL}>Selecione o status</label>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {ENROLLMENT_STATUS_OPTS.map(opt => {
                const sel = status === opt.value
                return (
                  <button key={opt.value} type="button" onClick={() => setStatus(opt.value)}
                    style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%',
                      padding:'10px 14px', borderRadius:8, gap:10,
                      border: `1.5px solid ${sel ? '#2e6db4' : '#e2e8f0'}`,
                      background: sel ? '#eff6ff' : '#fff',
                      color: sel ? '#2e6db4' : '#1e293b', fontSize:13, fontWeight: sel ? 600 : 400,
                      cursor:'pointer', fontFamily:'inherit', textAlign:'left', transition:'all .12s' }}
                    onMouseEnter={e => { if(!sel) e.currentTarget.style.borderColor='#cbd5e1' }}
                    onMouseLeave={e => { if(!sel) e.currentTarget.style.borderColor='#e2e8f0' }}>
                    <span style={{ display:'flex', alignItems:'center', gap:9 }}>
                      <span style={{ width:9, height:9, borderRadius:'50%', background:opt.color }} />
                      {opt.label}
                    </span>
                    {sel && <span>✓</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {status === 'cancelado' && (
            <div>
              <label style={LBL}>Observação sobre o cancelamento</label>
              <textarea value={note} onChange={e => setNote(e.target.value)}
                placeholder="Descreva o motivo do cancelamento, valores a devolver, prazos, etc…"
                rows={3}
                style={{ ...INP, resize:'vertical', lineHeight:1.5 }}
                onFocus={e => e.target.style.borderColor='#dc2626'}
                onBlur={e => e.target.style.borderColor='#e2e8f0'} />
              <p style={{ margin:'6px 0 0', fontSize:11, color:'#b91c1c', fontStyle:'italic' }}>
                O passageiro será movido para a seção "Cancelados", pendente de devolução de valores.
              </p>
            </div>
          )}
        </div>

        <div style={{ padding:'0 22px 18px', display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button type="button" onClick={onClose}
            style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={!dirty || saving}
            style={{ padding:'8px 22px', borderRadius:8, border:'none', background: !dirty || saving ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor: !dirty || saving ? 'default' : 'pointer', fontFamily:'inherit' }}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Popup "Observações" do passageiro — reaproveita o campo notes do enrollment ── */
function PassengerNotesModal({ enrollment, listId, onSaved, onClose }) {
  const [notes,  setNotes]  = useState(enrollment.notes || '')
  const [saving, setSaving] = useState(false)
  const name  = enrollment.passenger_name || enrollment.block_agency || 'Passageiro'
  const dirty = notes !== (enrollment.notes || '')

  const handleSave = async () => {
    setSaving(true)
    try {
      await listsApi.updatePassenger(listId, enrollment.id, { notes })
      toast.success('Observações salvas.')
      onSaved(); onClose()
    } catch { toast.error('Erro ao salvar observações.') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:750, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:420, boxShadow:'0 32px 80px rgba(0,0,0,.25)' }}>
        <div style={{ padding:'18px 22px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ minWidth:0 }}>
            <p style={{ margin:0, fontSize:15, fontWeight:700, color:'#0f172a' }}>Observações</p>
            <p title={name} style={{ margin:'2px 0 0', fontSize:12, color:'#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2, flexShrink:0 }}>×</button>
        </div>

        <div style={{ padding:'16px 22px 20px' }}>
          <label style={LBL}>Anotações sobre este passageiro</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Escreva aqui qualquer observação relevante sobre o passageiro nesta viagem…"
            rows={5}
            style={{ ...INP, resize:'vertical', lineHeight:1.5 }}
            onFocus={e => e.target.style.borderColor='#2e6db4'}
            onBlur={e => e.target.style.borderColor='#e2e8f0'} />
        </div>

        <div style={{ padding:'0 22px 18px', display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button type="button" onClick={onClose}
            style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={!dirty || saving}
            style={{ padding:'8px 22px', borderRadius:8, border:'none', background: !dirty || saving ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor: !dirty || saving ? 'default' : 'pointer', fontFamily:'inherit' }}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Picker de aeroporto — busca por nome / IATA / cidade ── */
function AirportPicker({ value, onChange, placeholder }) {
  const [query,   setQuery]   = useState('')
  const [open,    setOpen]    = useState(false)
  const [options, setOptions] = useState([])
  const [rect,    setRect]    = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const h = e => { if (inputRef.current && !inputRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      configApi.airports({ q: query }).then(r => setOptions(r.data.results ?? r.data)).catch(() => {})
    }, 200)
    return () => clearTimeout(t)
  }, [query, open])

  const handleFocus = () => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect())
    setQuery('')
    setOpen(true)
  }

  const display = value ? `${value.iata_code ? value.iata_code + ' — ' : ''}${value.name}` : ''

  const dropdown = open && rect && createPortal(
    <div style={{ position:'fixed', top: rect.bottom + 2, left: rect.left, width: rect.width, background:'#fff', border:'1.5px solid #e2e8f0', borderRadius:8, maxHeight:260, overflowY:'auto', zIndex:9999, boxShadow:'0 8px 24px rgba(0,0,0,.12)' }}>
      {options.length === 0 ? (
        <p style={{ textAlign:'center', padding:'16px 0', color:'#94a3b8', fontSize:13, margin:0 }}>
          {query.length >= 1 ? 'Nenhum aeroporto encontrado.' : 'Digite para buscar…'}
        </p>
      ) : options.map(a => (
        <div key={a.id}
          onMouseDown={e => { e.preventDefault(); onChange(a); setOpen(false); setQuery('') }}
          style={{ padding:'9px 12px', cursor:'pointer', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid #f1f5f9' }}
          onMouseEnter={e => e.currentTarget.style.background='#f0f7ff'}
          onMouseLeave={e => e.currentTarget.style.background='#fff'}>
          {a.iata_code && (
            <span style={{ fontSize:12, fontWeight:700, color:'#1a2d4f', background:'#eff6ff', padding:'2px 7px', borderRadius:5, fontFamily:'monospace', flexShrink:0 }}>{a.iata_code}</span>
          )}
          <span style={{ fontSize:13, color:'#1e293b', fontWeight:500, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.name}</span>
          {(a.city || a.country) && (
            <span style={{ fontSize:11, color:'#94a3b8', flexShrink:0 }}>{[a.city, a.country].filter(Boolean).join(', ')}</span>
          )}
        </div>
      ))}
    </div>,
    document.body
  )

  return (
    <div style={{ position:'relative' }}>
      <input
        ref={inputRef}
        value={open ? query : display}
        onChange={e => { setQuery(e.target.value); if (!open && inputRef.current) setRect(inputRef.current.getBoundingClientRect()); setOpen(true) }}
        onFocus={handleFocus}
        placeholder={placeholder || 'Buscar aeroporto…'}
        style={{ width:'100%', padding:'8px 10px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b', boxSizing:'border-box' }}
      />
      {dropdown}
    </div>
  )
}

/* ── Modal de passagem aérea ── */
function TicketModal({ enrollment, listId, defaultAirport, onSaved, onClose }) {
  const name = enrollment.passenger_name || enrollment.block_agency || 'Passageiro'
  const hasConn = !enrollment.is_block && enrollment.departure_airport_data && defaultAirport &&
                  enrollment.departure_airport_data.id !== defaultAirport.id
  const connAp  = hasConn ? enrollment.departure_airport_data : null

  const [main, setMain] = useState(enrollment.ticket_status            || 'nao_emitida')
  const [conn, setConn] = useState(enrollment.connection_ticket_status || 'nao_emitida')
  const [saving, setSaving] = useState(false)

  const OPTS = [
    { v:'nao_emitida',   label:'Não emitida',   fg:'#94a3b8',          bg:'#f8fafc',  accent:'#94a3b8'          },
    { v:'via_bloqueio',  label:'Via bloqueio',  fg:'#b45309',          bg:'#fffbeb',  accent:'#b45309'          },
    { v:'fora_bloqueio', label:'Voo individual', fg:'rgb(147,66,171)', bg:'#faf5ff',  accent:'rgb(147,66,171)'  },
  ]

  const StatusBar = ({ value, onChange }) => (
    <div style={{ display:'flex', borderRadius:8, border:'1px solid #e2e8f0', overflow:'hidden' }}>
      {OPTS.map(({ v, label, fg, bg, accent }, i) => {
        const sel = value === v
        return (
          <button key={v} type="button" onClick={() => onChange(v)}
            style={{
              flex:1, padding:'10px 4px', border:'none', cursor:'pointer', fontFamily:'inherit',
              fontSize:12, fontWeight: sel ? 700 : 500, transition:'all .12s',
              borderRight: i < OPTS.length-1 ? '1px solid #e2e8f0' : 'none',
              background:  sel ? bg     : '#fff',
              color:       sel ? fg     : '#94a3b8',
              boxShadow:   sel ? `inset 0 -2px 0 ${accent}` : 'none',
            }}>
            {label}
          </button>
        )
      })}
    </div>
  )

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = { ticket_status: main }
      if (hasConn) payload.connection_ticket_status = conn
      await listsApi.updatePassenger(listId, enrollment.id, payload)
      toast.success('Passagem atualizada.')
      onSaved(); onClose()
    } catch { toast.error('Erro ao salvar.') }
    finally { setSaving(false) }
  }

  return (
    <div className="overlay" style={{ zIndex:750 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mbox" style={{ maxWidth:400 }}>
        <div className="mhead">
          <div style={{ minWidth:0 }}>
            <span className="mtitle">Passagem aérea</span>
            <p style={{ margin:'2px 0 0', fontSize:12, color:'#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</p>
          </div>
          <button className="mclose" onClick={onClose}><Ic n="x" s={14}/></button>
        </div>
        <div className="mbody" style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {/* Voo principal */}
          <div>
            <p style={{ margin:'0 0 6px', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.05em' }}>✈ Voo principal</p>
            <StatusBar value={main} onChange={setMain} />
          </div>
          {/* Voo de acesso (só quando aeroporto individual diferente do padrão) */}
          {hasConn && (
            <div>
              <p style={{ margin:'0 0 6px', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.05em', display:'flex', alignItems:'center', gap:6 }}>
                ✈ Voo de acesso
                <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:11, color:'#92400e', background:'#fef3c7', border:'1px solid #fde68a', padding:'1px 6px', borderRadius:4 }}>
                  {connAp.iata_code || connAp.name.slice(0,3).toUpperCase()}
                </span>
                <span style={{ fontWeight:400, color:'#94a3b8' }}>{connAp.city || connAp.name}</span>
              </p>
              <StatusBar value={conn} onChange={setConn} />
            </div>
          )}
        </div>
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Modal para definir aeroporto de saída individual do passageiro ── */
function BoardingModal({ enrollment, listId, defaultAirport, onSaved, onClose }) {
  const name = enrollment.passenger_name || enrollment.block_agency || 'Passageiro'
  const [airport, setAirport] = useState(enrollment.departure_airport_data || null)
  const [saving,  setSaving]  = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await listsApi.updatePassenger(listId, enrollment.id, { departure_airport: airport?.id ?? null })
      toast.success('Aeroporto de saída atualizado.')
      onSaved(); onClose()
    } catch { toast.error('Erro ao salvar.') }
    finally { setSaving(false) }
  }

  const fmtA = a => a ? (a.iata_code ? `${a.iata_code} — ${a.name}` : a.name) : null

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:750, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:440, boxShadow:'0 32px 80px rgba(0,0,0,.25)' }}>
        <div style={{ padding:'18px 22px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ minWidth:0 }}>
            <p style={{ margin:0, fontSize:15, fontWeight:700, color:'#0f172a' }}>Local de embarque</p>
            <p title={name} style={{ margin:'2px 0 0', fontSize:12, color:'#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>

        <div style={{ padding:'16px 22px 20px' }}>
          {defaultAirport && (
            <p style={{ fontSize:12, color:'#64748b', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:7, padding:'7px 10px', margin:'0 0 14px' }}>
              ✈ Padrão da lista: <strong>{fmtA(defaultAirport)}</strong>
            </p>
          )}
          <label style={LBL}>Aeroporto de saída individual</label>
          <AirportPicker value={airport} onChange={setAirport} placeholder="Mesmo que o padrão da lista…" />
          {airport && (
            <button type="button" onClick={() => setAirport(null)}
              style={{ marginTop:8, fontSize:12, color:'#64748b', background:'none', border:'none', cursor:'pointer', padding:0, textDecoration:'underline' }}>
              ✕ Remover e usar aeroporto padrão da lista
            </button>
          )}
        </div>

        <div style={{ padding:'0 22px 18px', display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button type="button" onClick={onClose}
            style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            style={{ padding:'8px 22px', borderRadius:8, border:'none', background: saving ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor: saving ? 'default' : 'pointer', fontFamily:'inherit' }}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Visualizador de documento — abre sobre o QuickEditModal ── */
function DocViewerModal({ doc, onClose }) {
  const isImage = doc.mime_type?.startsWith('image/')
  const isPdf   = doc.mime_type === 'application/pdf'

  const fmtDate = (iso) => {
    if (!iso) return null
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }

  const infoItems = [
    doc.issued_by   && { label: 'Emissor',   value: doc.issued_by },
    fmtDate(doc.issued_date) && { label: 'Emissão',   value: fmtDate(doc.issued_date) },
    fmtDate(doc.expiry_date) && { label: 'Validade',  value: fmtDate(doc.expiry_date) },
    doc.doc_number  && { label: 'Número',    value: doc.doc_number },
  ].filter(Boolean)

  return createPortal(
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.72)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:900, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:700, maxHeight:'92vh', display:'flex', flexDirection:'column', boxShadow:'0 40px 100px rgba(0,0,0,.5)' }}>

        {/* Header */}
        <div style={{ padding:'14px 18px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div style={{ minWidth:0 }}>
            <p style={{ margin:0, fontSize:14, fontWeight:700, color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {doc.display_name || doc.doc_type_label || doc.doc_type}
            </p>
            {doc.doc_number && (
              <p style={{ margin:'2px 0 0', fontSize:12, color:'#64748b', fontFamily:'monospace' }}>Nº {doc.doc_number}</p>
            )}
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2, flexShrink:0 }}>×</button>
        </div>

        {/* Preview */}
        <div style={{ flex:1, overflow:'hidden', background:'#0f172a', display:'flex', alignItems:'center', justifyContent:'center', minHeight:200 }}>
          {isImage && doc.preview_url ? (
            <img src={doc.preview_url} alt="" style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain' }} />
          ) : isPdf ? (
            <iframe src={doc.download_url} title="documento" style={{ width:'100%', height:'100%', minHeight:420, border:'none' }} />
          ) : (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, color:'#94a3b8' }}>
              <span style={{ fontSize:48 }}>📄</span>
              <p style={{ margin:0, fontSize:13 }}>Pré-visualização não disponível</p>
            </div>
          )}
        </div>

        {/* Info + Download */}
        <div style={{ padding:'12px 18px', borderTop:'1px solid #e2e8f0', display:'flex', alignItems:'center', gap:16, flexShrink:0, flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:16, flex:1, flexWrap:'wrap' }}>
            {infoItems.map(item => (
              <div key={item.label}>
                <p style={{ margin:0, fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.05em' }}>{item.label}</p>
                <p style={{ margin:'1px 0 0', fontSize:12, fontWeight:600, color:'#1e293b' }}>{item.value}</p>
              </div>
            ))}
          </div>
          <a href={doc.download_url} download target="_blank" rel="noreferrer"
            style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:8, background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, textDecoration:'none', flexShrink:0 }}>
            ↓ Baixar
          </a>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ── Helpers de campo para QuickEditModal — definidos fora para evitar re-mount ao digitar ── */
const QE_DISABLED_STYLE = { width:'100%', boxSizing:'border-box', padding:'8px 10px', borderRadius:7, fontSize:13, fontFamily:'inherit', border:'1px solid #f1f5f9', background:'#f8fafc', color:'#94a3b8', outline:'none' }
const QE_INPUT_STYLE    = { width:'100%', boxSizing:'border-box', padding:'8px 10px', borderRadius:7, fontSize:13, fontFamily:'inherit', border:'1px solid #e2e8f0', background:'#fff', color:'#0f172a', outline:'none' }

function QEField({ label, value, onChange, disabled, type = 'text', placeholder }) {
  return (
    <div>
      <label style={LBL}>{label}</label>
      <input type={type} value={value || ''} placeholder={placeholder || ''}
        disabled={disabled} onChange={e => onChange && onChange(e.target.value)}
        style={disabled ? QE_DISABLED_STYLE : QE_INPUT_STYLE} />
    </div>
  )
}

function QEToggle({ label, value, onChange }) {
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

function QESelect({ label, value, onChange, options, disabled, placeholder = 'Selecione…' }) {
  return (
    <div>
      <label style={LBL}>{label}</label>
      <select value={value || ''} disabled={disabled}
        onChange={e => onChange && onChange(e.target.value)}
        style={{ ...(disabled ? QE_DISABLED_STYLE : QE_INPUT_STYLE), appearance:'auto', paddingRight:10 }}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

/* ── Edição rápida do passageiro — popup com 2 abas: Informações e Documentos ── */
function QuickEditModal({ enrollment, listId, startDate, onSaved, onClose }) {
  const passengerId = enrollment.passenger
  const [activeTab, setActiveTab] = useState('info')
  const [form,    setForm]    = useState(null)
  const [docs,    setDocs]    = useState([])
  const [genders, setGenders] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [selectedPassport, setSelectedPassport] = useState(enrollment.selected_passport || null)
  const [viewingDoc,       setViewingDoc]       = useState(null)

  useEffect(() => {
    Promise.all([
      passengersApi.get(passengerId),
      documentsApi.list(passengerId),
      configApi.genders(),
    ])
    .then(([pRes, dRes, gRes]) => {
      setForm(pRes.data)
      setDocs(dRes.data)
      setGenders(gRes.data)
    })
    .catch(() => toast.error('Erro ao carregar dados do passageiro.'))
    .finally(() => setLoading(false))
  }, [passengerId])

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form) return
    setSaving(true)
    try {
      await passengersApi.patch(passengerId, {
        first_name:      form.first_name || '',
        last_name:       form.last_name  || '',
        email:           form.email,
        cpf:             form.cpf,
        rg:              form.rg,
        rg_issue_date:   form.rg_issue_date   || null,
        rg_issuer:       form.rg_issuer,
        birth_date:      form.birth_date       || null,
        gender:          form.gender,
        is_foreign:      form.is_foreign,
        is_verified:     form.is_verified,
        nationality:     form.nationality,
        passport:        form.passport,
        passport_issue:  form.passport_issue   || null,
        passport_expiry: form.passport_expiry  || null,
        rne:             form.rne,
        rne_expiry:      form.rne_expiry       || null,
        rne_issue:       form.rne_issue        || null,
        phone1:          form.phone1,
        seat_preference: form.seat_preference,
      })
      await listsApi.updatePassenger(listId, enrollment.id, { selected_passport: selectedPassport || null })
      toast.success('Passageiro atualizado.')
      onSaved()
      onClose()
    } catch { toast.error('Erro ao salvar.') }
    finally { setSaving(false) }
  }

  const SEAT_OPTS = [
    { value: 'corredor', label: 'Corredor' },
    { value: 'janela',   label: 'Janela'   },
    { value: 'meio',     label: 'Meio'     },
  ]

  const TAB_BTN = (key, label) => (
    <button type="button" key={key} onClick={() => setActiveTab(key)}
      style={{
        padding: '8px 18px', border: 'none', background: 'transparent',
        borderBottom: activeTab === key ? '2px solid #1a2d4f' : '2px solid transparent',
        color: activeTab === key ? '#1a2d4f' : '#94a3b8',
        fontSize: 13, fontWeight: activeTab === key ? 700 : 500,
        cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
      }}>
      {label}
    </button>
  )

  return (
    <>
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 750, padding: 20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 32px 80px rgba(0,0,0,.25)' }}>

        {/* Header */}
        <div style={{ padding: '18px 22px 0', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Passageiro</p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {enrollment.passenger_name || enrollment.block_agency || '—'}
              </p>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 22, lineHeight: 1, padding: 2, flexShrink: 0 }}>×</button>
          </div>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0 }}>
            {TAB_BTN('info', 'Informações cadastrais')}
            {TAB_BTN('docs', 'Documentos')}
          </div>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, margin: '40px 0' }}>Carregando…</p>
          ) : activeTab === 'info' ? (
            <>
              {/* Agências — somente leitura no popup */}
              <div>
                <label style={LBL}>Agências</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 36, alignItems: 'center' }}>
                  {form?.agency_names?.length > 0
                    ? form.agency_names.map(a => (
                        <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 20, fontSize: 12, color: '#475569', fontWeight: 500 }}>
                          {a.name}
                        </span>
                      ))
                    : <span style={{ fontSize: 13, color: '#94a3b8' }}>Nenhuma agência vinculada</span>
                  }
                </div>
              </div>

              <QEToggle label="Estrangeiro?" value={!!form?.is_foreign} onChange={v => upd('is_foreign', v)} />
              <QEToggle label="Cadastro verificado?" value={!!form?.is_verified} onChange={v => upd('is_verified', v)} />

              <QEField label="CPF" value={form?.cpf} onChange={v => upd('cpf', v)} />

              {/* 2 colunas: Nome + Sobrenome */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <QEField label="Nome"      value={form?.first_name} onChange={v => upd('first_name', v)} />
                <QEField label="Sobrenome" value={form?.last_name}  onChange={v => upd('last_name',  v)} />
              </div>

              {/* 2 colunas: Nascimento + Gênero */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={LBL}>Data de nascimento</label>
                  <DatePicker value={form?.birth_date || ''} onChange={v => upd('birth_date', v)} placeholder="DD/MM/AAAA" />
                </div>
                <QESelect label="Gênero" value={form?.gender} onChange={v => upd('gender', v)}
                  options={genders.map(g => ({ value: g.name, label: g.name }))} />
              </div>

              <QEField label="E-mail"       value={form?.email}       onChange={v => upd('email',       v)} type="email" />
              <QEField label="Nacionalidade" value={form?.nationality} onChange={v => upd('nationality', v)} />

              {/* RGs registrados nos documentos */}
              {(() => {
                const rgs = docs.filter(d => d.doc_type === 'rg')
                const fmtDate = (iso) => {
                  if (!iso) return null
                  const [y, m, d] = iso.split('-')
                  return `${d}/${m}/${y}`
                }
                return (
                  <div>
                    <label style={LBL}>RG</label>
                    {rgs.length === 0
                      ? <p style={{ fontSize: 13, color: '#94a3b8', margin: '8px 0 0' }}>Nenhum RG cadastrado nos documentos.</p>
                      : <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                          {rgs.map(r => (
                            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff' }}>
                              {/* Thumbnail */}
                              <div style={{ width: 52, height: 36, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e2e8f0' }}>
                                {r.preview_url
                                  ? <img src={r.preview_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  : <span style={{ fontSize: 20 }}>🪪</span>
                                }
                              </div>
                              {/* Info */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                                    {r.doc_number || '—'}
                                  </span>
                                  {r.issued_by && (
                                    <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>{r.issued_by}</span>
                                  )}
                                </div>
                                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                                  {fmtDate(r.issued_date) ? `Emissão: ${fmtDate(r.issued_date)}` : 'Sem data de emissão'}
                                  {fmtDate(r.expiry_date) ? ` · Validade: ${fmtDate(r.expiry_date)}` : ''}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                    }
                  </div>
                )
              })()}

              {/* Passaportes registrados — lista com seleção para a viagem */}
              {(() => {
                const today = new Date(); today.setHours(0,0,0,0)
                // Referência para a flag: 1 ano após o início da viagem (ou hoje + 1 ano se sem data)
                const tripRef = startDate
                  ? new Date(startDate + 'T00:00:00')
                  : new Date(today.getTime() + 365 * 86400000)
                const tripRefPlus1y = new Date(tripRef.getTime() + 365 * 86400000)

                // Passaportes já vencidos ficam fora da lista
                const passports = docs.filter(d => {
                  if (d.doc_type !== 'passport') return false
                  if (!d.expiry_date) return true
                  return new Date(d.expiry_date + 'T00:00:00') >= today
                })

                const daysFromTrip = (iso) => {
                  if (!iso) return null
                  return Math.ceil((new Date(iso + 'T00:00:00') - tripRef) / 86400000)
                }
                const fmtDate = (iso) => {
                  if (!iso) return '—'
                  const [y, m, d] = iso.split('-')
                  return `${d}/${m}/${y}`
                }

                return (
                  <div>
                    <label style={LBL}>Passaportes</label>
                    {passports.length === 0
                      ? <p style={{ fontSize: 13, color: '#94a3b8', margin: '8px 0 0' }}>Nenhum passaporte válido cadastrado.</p>
                      : <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                          {passports.map(p => {
                            const days = daysFromTrip(p.expiry_date)
                            // Flag vermelha: vence dentro de 1 ano da data da viagem
                            const tooClose = days !== null && days < 365
                            const sel = selectedPassport === p.id

                            const expiryBadge = (() => {
                              if (days === null) return null
                              if (tooClose) return {
                                label: days <= 0 ? 'Vence antes da viagem!' : `Vence em ${days}d após viagem`,
                                color: '#dc2626', bg: '#fef2f2',
                              }
                              const months = Math.floor(days / 30)
                              return {
                                label: months >= 24 ? `${Math.floor(months/12)} anos após viagem` : `${months} meses após viagem`,
                                color: '#16a34a', bg: '#f0fdf4',
                              }
                            })()

                            return (
                              <button key={p.id} type="button" onClick={() => setSelectedPassport(sel ? null : p.id)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                                  borderRadius: 10,
                                  border: `2px solid ${tooClose ? '#fecaca' : sel ? '#1a2d4f' : '#e2e8f0'}`,
                                  background: tooClose ? '#fff8f8' : sel ? '#f0f4ff' : '#fff',
                                  cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit',
                                  transition: 'border-color .15s, background .15s',
                                }}>
                                {/* Thumbnail */}
                                <div style={{ width: 52, height: 36, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e2e8f0' }}>
                                  {p.preview_url
                                    ? <img src={p.preview_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    : <span style={{ fontSize: 20 }}>🛂</span>
                                  }
                                </div>
                                {/* Info */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                                      {p.doc_number || '—'}
                                    </span>
                                    {p.issued_by && (
                                      <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>{p.issued_by}</span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                                    Emissão: {fmtDate(p.issued_date)} · Validade: {fmtDate(p.expiry_date)}
                                  </div>
                                </div>
                                {/* Badge prazo */}
                                {expiryBadge && (
                                  <div style={{ flexShrink: 0, textAlign: 'right' }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: expiryBadge.color, background: expiryBadge.bg, padding: '2px 8px', borderRadius: 10, border: `1px solid ${expiryBadge.color}30` }}>
                                      {expiryBadge.label}
                                    </span>
                                  </div>
                                )}
                                {/* Selecionado */}
                                <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${sel ? '#1a2d4f' : '#e2e8f0'}`, background: sel ? '#1a2d4f' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  {sel && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                    }
                  </div>
                )
              })()}

              {/* RNE — só aparece quando Estrangeiro? estiver ativado */}
              {form?.is_foreign && (() => {
                const rnes = docs.filter(d => d.doc_type === 'rne')
                const fmtDate = (iso) => {
                  if (!iso) return null
                  const [y, m, d] = iso.split('-')
                  return `${d}/${m}/${y}`
                }
                const today = new Date(); today.setHours(0,0,0,0)
                const tripRef = startDate ? new Date(startDate + 'T00:00:00') : new Date(today.getTime() + 365 * 86400000)
                const daysFromTrip = (iso) => iso ? Math.ceil((new Date(iso + 'T00:00:00') - tripRef) / 86400000) : null
                return (
                  <div>
                    <label style={LBL}>RNE</label>
                    {rnes.length === 0
                      ? <p style={{ fontSize: 13, color: '#94a3b8', margin: '8px 0 0' }}>Nenhum RNE cadastrado nos documentos.</p>
                      : <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                          {rnes.map(r => {
                            const days = daysFromTrip(r.expiry_date)
                            const tooClose = days !== null && days < 365
                            const expired = r.expiry_date && new Date(r.expiry_date + 'T00:00:00') < today
                            if (expired) return null
                            return (
                              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, border: `1px solid ${tooClose ? '#fecaca' : '#e2e8f0'}`, background: tooClose ? '#fff8f8' : '#fff' }}>
                                <div style={{ width: 52, height: 36, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e2e8f0' }}>
                                  {r.preview_url
                                    ? <img src={r.preview_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    : <span style={{ fontSize: 20 }}>🪪</span>
                                  }
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>{r.doc_number || '—'}</span>
                                    {r.issued_by && <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>{r.issued_by}</span>}
                                  </div>
                                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                                    {fmtDate(r.issued_date) ? `Emissão: ${fmtDate(r.issued_date)}` : 'Sem data de emissão'}
                                    {fmtDate(r.expiry_date) ? ` · Validade: ${fmtDate(r.expiry_date)}` : ''}
                                  </div>
                                </div>
                                {days !== null && (
                                  <span style={{ fontSize: 11, fontWeight: 700, flexShrink: 0, color: tooClose ? '#dc2626' : '#16a34a', background: tooClose ? '#fef2f2' : '#f0fdf4', padding: '2px 8px', borderRadius: 10, border: `1px solid ${tooClose ? '#fecaca' : '#bbf7d0'}` }}>
                                    {tooClose ? (days <= 0 ? 'Vence antes da viagem!' : `Vence em ${days}d após viagem`) : `${Math.floor(days/30)} meses após viagem`}
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                    }
                  </div>
                )
              })()}

              {/* Telefone */}
              <div>
                <label style={LBL}>Telefone</label>
                <PhoneInput value={form?.phone1 || ''} onChange={v => upd('phone1', v)} />
              </div>

              <QESelect label="Preferência de assento" value={form?.seat_preference} onChange={v => upd('seat_preference', v)} options={SEAT_OPTS} placeholder="Sem preferência" />

              {/* Documento de preferência — não está no banco */}
              <div>
                <label style={LBL}>Documento de preferência</label>
                <input disabled value="" placeholder="Não disponível nesta versão" style={QE_DISABLED_STYLE} />
              </div>
            </>
          ) : (
            /* Aba Documentos */
            (() => {
              const today = new Date(); today.setHours(0,0,0,0)
              const tripRef = startDate ? new Date(startDate + 'T00:00:00') : null

              const DOC_ICON = { passport:'🛂', rg:'🪪', cnh:'🚗', visa:'📋', vaccine:'💉', default:'📄' }

              const fmtDate = (iso) => {
                if (!iso) return null
                const [y, m, d] = iso.split('-')
                return `${d}/${m}/${y}`
              }

              const expiryBadge = (iso) => {
                if (!iso) return null
                const exp = new Date(iso + 'T00:00:00')
                const daysToday = Math.ceil((exp - today) / 86400000)
                if (daysToday < 0) return { label: `Vencido há ${Math.abs(daysToday)}d`, color: '#dc2626', bg: '#fef2f2' }
                if (tripRef) {
                  const daysTrip = Math.ceil((exp - tripRef) / 86400000)
                  if (daysTrip < 0)   return { label: 'Vence antes da viagem!', color: '#dc2626', bg: '#fef2f2' }
                  if (daysTrip < 365) return { label: `Vence em ${daysTrip}d após viagem`, color: '#f59e0b', bg: '#fffbeb' }
                  const months = Math.floor(daysTrip / 30)
                  return { label: months >= 24 ? `${Math.floor(months/12)} anos após viagem` : `${months} meses após viagem`, color: '#16a34a', bg: '#f0fdf4' }
                }
                if (daysToday < 180) return { label: `${daysToday}d restantes`, color: '#f59e0b', bg: '#fffbeb' }
                const months = Math.floor(daysToday / 30)
                return { label: months >= 24 ? `${Math.floor(months/12)} anos` : `${months} meses`, color: '#16a34a', bg: '#f0fdf4' }
              }

              return docs.length === 0
                ? <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, margin: '40px 0' }}>Nenhum documento enviado.</p>
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {docs.map(doc => {
                      const badge = expiryBadge(doc.expiry_date)
                      const icon = DOC_ICON[doc.doc_type] || DOC_ICON.default
                      const label = doc.display_name || doc.doc_type_label || doc.doc_type
                      return (
                        <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, border: `1px solid ${badge?.color === '#dc2626' ? '#fecaca' : '#e2e8f0'}`, background: badge?.color === '#dc2626' ? '#fff8f8' : '#fff' }}>
                          {/* Thumbnail */}
                          <div style={{ width: 52, height: 40, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e2e8f0' }}>
                            {doc.preview_url
                              ? <img src={doc.preview_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : <span style={{ fontSize: 22 }}>{icon}</span>
                            }
                          </div>

                          {/* Info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                            {doc.doc_number && (
                              <div style={{ fontSize: 12, color: '#475569', fontFamily: 'monospace', marginTop: 1 }}>Nº {doc.doc_number}</div>
                            )}
                            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                              {fmtDate(doc.issued_date) ? `Emissão: ${fmtDate(doc.issued_date)}` : 'Sem data de emissão'}
                              {fmtDate(doc.expiry_date) ? ` · Validade: ${fmtDate(doc.expiry_date)}` : ''}
                            </div>
                          </div>

                          {/* Badge prazo */}
                          {badge && (
                            <span style={{ fontSize: 10, fontWeight: 700, flexShrink: 0, color: badge.color, background: badge.bg, padding: '2px 7px', borderRadius: 10, border: `1px solid ${badge.color}30`, whiteSpace: 'nowrap' }}>
                              {badge.label}
                            </span>
                          )}

                          {/* Ver documento */}
                          <button type="button" onClick={() => setViewingDoc(doc)} title="Ver documento"
                            style={{ flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', width:28, height:28, borderRadius:6, border:'1px solid #e2e8f0', color:'#64748b', background:'#f8fafc', cursor:'pointer', fontSize:13 }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor='#1a2d4f'; e.currentTarget.style.color='#1a2d4f' }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.color='#64748b' }}>
                            🔍
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )
            })()
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '0 22px 18px', display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid #f1f5f9', paddingTop: 14, flexShrink: 0 }}>
          <button type="button" onClick={onClose}
            style={{ padding: '8px 18px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Fechar
          </button>
          <button type="button" onClick={handleSave} disabled={saving || loading}
            style={{ padding: '8px 22px', borderRadius: 8, border: 'none', background: saving || loading ? '#94a3b8' : '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving || loading ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>

    {viewingDoc && <DocViewerModal doc={viewingDoc} onClose={() => setViewingDoc(null)} />}
    </>
  )
}

/* ── Menu "mais ações" do passageiro — itens já existentes funcionam, os demais aparecem como "Em breve" ── */
const PASSENGER_ACTIONS = [
  { key:'quick_edit',  label:'Edição rápida do passageiro', icon:'list',     enabled:true  },
  { key:'edit',        label:'Editar o passageiro',         icon:'edit',     enabled:true  },
  { key:'notes',       label:'Observações',                 icon:'docs',     enabled:true  },
  { key:'extra_info',  label:'Informações adicionais',      icon:'plus',     enabled:false },
  { key:'seat',        label:'Informar o assento',          icon:'grid',     enabled:false },
  { key:'crew',        label:'Equipe técnica',              icon:'users',    enabled:false },
  { key:'pax_type',    label:'Tipo de passageiro',          icon:'settings', enabled:false },
  { key:'boarding',    label:'Local de embarque',           icon:'globe',    enabled:true  },
  { key:'contracts',   label:'Contratos',                   icon:'docs',     enabled:false },
  { key:'swap_room',   label:'Trocar de quarto',            icon:'building', enabled:true  },
  { key:'link_client', label:'Vincular cliente',            icon:'users',    enabled:true  },
  { key:'link_agency', label:'Vincular agência',            icon:'building', enabled:true  },
  { key:'delete',      label:'Excluir passageiro',          icon:'trash',    enabled:true, danger:true },
]

function PassengerActionsModal({ enrollment, onAction, onClose }) {
  const name = enrollment.passenger_name || enrollment.block_agency || 'Passageiro'
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:750, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:380, maxHeight:'85vh', display:'flex', flexDirection:'column', boxShadow:'0 32px 80px rgba(0,0,0,.25)' }}>

        {/* Header */}
        <div style={{ padding:'18px 22px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div style={{ minWidth:0 }}>
            <p style={{ margin:0, fontSize:15, fontWeight:700, color:'#0f172a' }}>Ações do passageiro</p>
            <p title={name} style={{ margin:'2px 0 0', fontSize:12, color:'#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2, flexShrink:0 }}>×</button>
        </div>

        {/* Opções */}
        <div style={{ padding:'8px 10px', overflowY:'auto' }}>
          {PASSENGER_ACTIONS.map(act => (
            <button key={act.key} type="button" disabled={!act.enabled}
              onClick={() => { if (!act.enabled) return; onAction(act.key) }}
              style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%',
                padding:'10px 12px', gap:10, borderRadius:8, background:'transparent',
                border:'none', marginBottom:2,
                color: !act.enabled ? '#cbd5e1' : act.danger ? '#dc2626' : '#1e293b',
                fontSize:13, fontWeight:400, cursor: act.enabled ? 'pointer' : 'default',
                fontFamily:'inherit', textAlign:'left', transition:'background .1s' }}
              onMouseEnter={e => { if (act.enabled) e.currentTarget.style.background = act.danger ? '#fef2f2' : '#f8fafc' }}
              onMouseLeave={e => { e.currentTarget.style.background='transparent' }}>
              <span style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
                <Ic n={act.icon} s={14} />
                <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{act.label}</span>
              </span>
              {!act.enabled && (
                <span style={{ fontSize:9, fontWeight:700, color:'#94a3b8', background:'#f1f5f9', padding:'2px 6px', borderRadius:10, letterSpacing:'.03em', textTransform:'uppercase', flexShrink:0 }}>
                  Em breve
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function PassengerActionsButton({ onClick }) {
  return (
    <button type="button" onClick={(ev) => { ev.stopPropagation(); onClick() }}
      title="Editar / mais ações"
      style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#64748b', cursor:'pointer' }}
      onMouseEnter={ev => { ev.currentTarget.style.borderColor='#1a2d4f'; ev.currentTarget.style.color='#1a2d4f' }}
      onMouseLeave={ev => { ev.currentTarget.style.borderColor='#e2e8f0'; ev.currentTarget.style.color='#64748b' }}>
      <Ic n="edit" s={12} />
    </button>
  )
}

/* ── Picker de acomodação — busca em tempo real com nomes dos hóspedes ── */
function AccomPicker({ onSelect, existingRooms = [], enrolledList = [] }) {
  const [types,   setTypes]   = useState([])
  const [query,   setQuery]   = useState('')
  const [open,    setOpen]    = useState(false)
  const [cursor,  setCursor]  = useState(-1)
  const [dropPos, setDropPos] = useState({})
  const inputRef = useRef(null)

  useEffect(() => {
    configApi.accommodations().then(r => setTypes(r.data.results ?? r.data)).catch(() => {})
  }, [])

  // Mapa: roomName → lista de nomes dos passageiros
  const roomPeople = {}
  enrolledList.forEach(e => {
    if (!e.accommodation) return
    if (!roomPeople[e.accommodation]) roomPeople[e.accommodation] = []
    if (e.passenger_name) roomPeople[e.accommodation].push(e.passenger_name)
    else if (e.block_agency) roomPeople[e.accommodation].push(`[${e.block_agency}]`)
  })

  const q = query.toLowerCase()

  const opts = (() => {
    const result = []
    const existingRoomNames = [...new Set(existingRooms)].sort()

    // Quartos existentes que batem com a busca
    existingRoomNames.forEach(room => {
      const people = roomPeople[room] || []
      const matchesRoom   = !q || room.toLowerCase().includes(q)
      const matchesPeople = people.some(p => p.toLowerCase().includes(q))
      if (matchesRoom || matchesPeople) {
        result.push({ kind:'room', room, people })
      }
    })

    // Opções de "novo quarto" para cada tipo que bate
    types.forEach(t => {
      if (!q || t.name.toLowerCase().includes(q)) {
        const roomsOfType = existingRoomNames.filter(r => r === t.name || r.startsWith(t.name + ' '))
        let next = `${t.name} 1`
        for (let n = 1; n <= 99; n++) {
          const c = `${t.name} ${n}`
          if (!roomsOfType.includes(c)) { next = c; break }
        }
        result.push({ kind:'new', room: next, type: t })
      }
    })
    return result
  })()

  const openDrop = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    setOpen(true); setCursor(-1)
  }

  const pick = (opt) => {
    if (onSelect) onSelect(opt.room)
    setQuery(''); setOpen(false); setCursor(-1)
  }

  const handleKey = (e) => {
    if (!open) { if (e.key === 'ArrowDown') { openDrop(); return } }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c+1, opts.length-1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c-1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (cursor >= 0 && opts[cursor]) pick(opts[cursor]) }
    else if (e.key === 'Escape') { setOpen(false); setQuery('') }
  }

  return (
    <div style={{ position:'relative' }}>
      <input ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); setCursor(-1); if (!open) openDrop() }}
        onFocus={openDrop}
        onBlur={() => setTimeout(() => { setOpen(false); setQuery('') }, 160)}
        onKeyDown={handleKey}
        autoComplete="new-password"
        placeholder="Buscar acomodação…"
        style={{ width:'100%', boxSizing:'border-box', padding:'9px 12px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b' }}
        onFocus2={e => e.target.style.borderColor='#1a2d4f'}
      />
      {open && opts.length > 0 && (
        <div style={{ position:'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex:900, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', boxShadow:'0 12px 32px rgba(0,0,0,.14)', overflow:'hidden', maxHeight:300, overflowY:'auto' }}>
          {opts.map((opt, i) => {
            const isSel = i === cursor
            return (
              <div key={i} onMouseDown={() => pick(opt)}
                style={{ padding:'9px 14px', borderBottom:'1px solid #f8fafc', cursor:'pointer', background: isSel ? '#eff6ff' : 'transparent' }}
                onMouseEnter={() => setCursor(i)} onMouseLeave={() => setCursor(-1)}>
                {opt.kind === 'room' ? (
                  <div>
                    <p style={{ margin:0, fontSize:13, fontWeight: isSel ? 600 : 500, color: isSel ? '#1a2d4f' : '#1e293b' }}>
                      {opt.room}
                    </p>
                    {opt.people.length > 0 && (
                      <p style={{ margin:'2px 0 0', fontSize:11, color:'#64748b' }}>
                        {opt.people.join(', ')}
                      </p>
                    )}
                  </div>
                ) : (
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <span style={{ fontSize:13, color:'#2e6db4', fontWeight:600 }}>
                      + Novo quarto — {opt.room}
                    </span>
                    <div style={{ display:'flex', gap:4 }}>
                      <span style={{ fontSize:11, color:'#94a3b8', background:'#f1f5f9', padding:'1px 7px', borderRadius:20 }}>{opt.type.capacity}p</span>
                      {opt.type.is_couple && <span style={{ fontSize:10, color:'#7c3aed', background:'#ede9fe', padding:'1px 6px', borderRadius:10 }}>casal</span>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const LBL = { display:'block', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:5 }
const INP = { width:'100%', boxSizing:'border-box', padding:'9px 12px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b' }

/* ── Seletor de responsável (membros da agência) ── */
function ResponsibleSelect({ members, selected, onChange }) {
  if (members.length === 0) return (
    <p style={{ margin:0, fontSize:12, color:'#94a3b8', fontStyle:'italic' }}>
      Nenhum usuário vinculado a esta agência.
    </p>
  )
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      {members.map(m => {
        const isSel = selected?.id === m.id
        const label = m.full_name || m.email
        return (
          <label key={m.id}
            style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:8, border:`1.5px solid ${isSel ? '#1a2d4f' : '#e2e8f0'}`, background: isSel ? '#f0f4ff' : '#fff', cursor:'pointer', transition:'all .12s', userSelect:'none' }}
            onClick={() => onChange(isSel ? null : m)}>
            <div style={{ width:16, height:16, borderRadius:'50%', border:`2px solid ${isSel ? '#1a2d4f' : '#d1d5db'}`, background: isSel ? '#1a2d4f' : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              {isSel && <span style={{ color:'#fff', fontSize:10, fontWeight:900, lineHeight:1 }}>✓</span>}
            </div>
            <div>
              <p style={{ margin:0, fontSize:13, color: isSel ? '#1a2d4f' : '#1e293b', fontWeight: isSel ? 600 : 400 }}>{label}</p>
              {m.full_name && <p style={{ margin:0, fontSize:11, color:'#94a3b8' }}>{m.email}</p>}
            </div>
          </label>
        )
      })}
    </div>
  )
}

/* ── Status toggle reutilizável ── */
function StatusToggle({ value, onChange }) {
  return (
    <div style={{ display:'flex', gap:0, borderRadius:8, overflow:'hidden', border:'1.5px solid #e2e8f0', width:'fit-content' }}>
      {[{v:'reservado',l:'Reservado',c:'#64748b'},{v:'pendente',l:'Pendente',c:'#f59e0b'},{v:'confirmado',l:'Confirmado',c:'#16a34a'}].map(opt => (
        <button key={opt.v} type="button" onClick={() => onChange(opt.v)}
          style={{ padding:'7px 14px', border:'none', fontFamily:'inherit', fontSize:12, fontWeight:600, cursor:'pointer', transition:'all .12s',
            background: value===opt.v ? opt.c : '#fff',
            color: value===opt.v ? '#fff' : '#64748b',
          }}>
          {opt.l}
        </button>
      ))}
    </div>
  )
}

/* ── Popup de adicionar passageiro / bloqueio ── */
function AddPassengerPopup({ listId, enrolled, rooms: existingRooms = [], onAdded, onClose }) {
  const mkRow = () => ({ id: Date.now() + Math.random(), paxSearch:'', passenger:null, paxResults:[], paxSearching:false, agSearch:'', agency:null, agResults:[], agSearching:false, members:[], responsible:null, respInput:'', status:'reservado', statusInput:'Reservado', prazo:'', notes:'' })
  // accom: 'none' | 'new' | 'existing'
  const [accomMode,       setAccomMode]       = useState('none')
  const [accomType,       setAccomType]       = useState('')
  const [accomTypeInput,  setAccomTypeInput]  = useState('')
  const [accomTypes,      setAccomTypes]      = useState([])
  const [existingRoom,    setExistingRoom]    = useState('')
  const [existingRoomInput, setExistingRoomInput] = useState('')
  const [accomDrop,       setAccomDrop]       = useState(null) // { field:'type'|'room', top, left, width, hover }
  const [rows,       setRows]       = useState([mkRow()])
  const [saving,     setSaving]     = useState(false)
  const [submitted,  setSubmitted]  = useState(false)
  const [openDrop,   setOpenDrop]   = useState(null)
  const debMap = useRef({})

  useEffect(() => {
    configApi.accommodations().then(r => setAccomTypes(r.data.results ?? r.data)).catch(() => {})
  }, [])

  const upd = (id, patch) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
  const addRow = () => setRows(rs => [...rs, mkRow()])
  const delRow = (id) => setRows(rs => rs.filter(r => r.id !== id))

  const searchPax = (id, q) => {
    upd(id, { paxSearch: q, passenger: null })
    clearTimeout(debMap.current[`p${id}`])
    debMap.current[`p${id}`] = setTimeout(async () => {
      upd(id, { paxSearching: true })
      try {
        const r = await passengersApi.list({ search: q, page_size: 20 })
        const eids = new Set(enrolled.map(e => e.passenger).filter(Boolean))
        upd(id, { paxResults: (r.data.results ?? r.data).filter(p => !eids.has(p.id)), paxSearching: false })
      } catch { upd(id, { paxSearching: false }) }
    }, 200)
  }

  const searchAg = (id, q) => {
    upd(id, { agSearch: q, agency: null })
    clearTimeout(debMap.current[`a${id}`])
    debMap.current[`a${id}`] = setTimeout(async () => {
      upd(id, { agSearching: true })
      try {
        const r = await agenciesApi.list({ search: q, page_size: 20 })
        upd(id, { agResults: r.data.results ?? r.data, agSearching: false })
      } catch { upd(id, { agSearching: false }) }
    }, 200)
  }

  const getDropItems = (row, field) => {
    if (field === 'pax') return row.paxResults
    if (field === 'ag')  return row.agResults
    if (field === 'status') {
      const q = (row.statusInput || '').toLowerCase()
      return ENROLLMENT_STATUS_OPTS.filter(o => o.value !== 'cancelado' && o.label.toLowerCase().includes(q))
    }
    if (field === 'resp') {
      const q = (row.respInput || '').toLowerCase()
      return (row.members || []).filter(m =>
        (m.user_name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q)
      )
    }
    return []
  }

  const selectItem = (rid, field, item) => {
    if (field === 'pax') {
      upd(rid, { passenger: item, paxSearch: item.full_name })
    } else if (field === 'ag') {
      const lbl = item.company_name || item.name
      upd(rid, { agency: item, agSearch: lbl, responsible: null, respInput: '', members: [] })
      agenciesApi.listMembers(item.id).then(r => upd(rid, { members: r.data })).catch(() => {})
    } else if (field === 'status') {
      upd(rid, { status: item.value, statusInput: item.label })
    } else if (field === 'resp') {
      upd(rid, { responsible: item, respInput: item.user_name || item.email })
    }
    setOpenDrop(null)
  }

  const handleKey = (e, rid, field) => {
    if (!['ArrowDown','ArrowUp','Enter','Escape'].includes(e.key)) return
    if (e.key === 'Escape') { setOpenDrop(null); return }
    e.preventDefault()
    if (!openDrop || openDrop.rid !== rid || openDrop.field !== field) return
    const row = rows.find(r => r.id === rid)
    if (!row) return
    const items = getDropItems(row, field)
    const h = openDrop.hover ?? 0
    if (e.key === 'ArrowDown') setOpenDrop(d => d ? { ...d, hover: Math.min(h + 1, items.length - 1) } : d)
    else if (e.key === 'ArrowUp') setOpenDrop(d => d ? { ...d, hover: Math.max(h - 1, 0) } : d)
    else if (e.key === 'Enter') { const it = items[h]; if (it) selectItem(rid, field, it) }
  }

  const openDropFor = (e, rid, field) => {
    const r = e.target.getBoundingClientRect()
    setOpenDrop({ rid, field, top: r.bottom + 4, left: r.left, width: Math.max(r.width, 200), hover: 0 })
  }

  const restoreOnBlur = (rid, field) => setTimeout(() => {
    setOpenDrop(d => d?.rid === rid && d?.field === field ? null : d)
    setRows(rs => rs.map(r => {
      if (r.id !== rid) return r
      if (field === 'status') return { ...r, statusInput: ENROLLMENT_STATUS_OPTS.find(o => o.value === r.status)?.label || r.status }
      if (field === 'resp')   return { ...r, respInput: r.responsible ? (r.responsible.user_name || r.responsible.email) : '' }
      return r
    }))
  }, 150)

  const handleSave = async () => {
    setSubmitted(true)
    const valid = rows.filter(r => r.passenger)
    const accomErr = (accomMode === 'new' && !accomType) || (accomMode === 'existing' && !existingRoom)
    if (!valid.length || accomErr) return
    setSaving(true)
    try {
      let roomName = ''
      if (accomMode === 'new' && accomType) {
        await listsApi.addRoom(listId, accomType).catch(() => {})
        roomName = accomType
      } else if (accomMode === 'existing' && existingRoom) {
        roomName = existingRoom
      }
      for (const row of valid) {
        if (row.passenger.provisional) {
          await listsApi.addPassenger(listId, {
            is_block: true,
            is_provisional: true,
            block_agency: row.passenger.full_name,
            block_quantity: 1,
            agency: row.agency?.id || null,
            responsible_user: row.responsible?.user_id || null,
            enrollment_status: row.status,
            pending_until: row.status !== 'confirmado' ? (row.prazo || null) : null,
            pending_reason: row.status !== 'confirmado' ? row.notes : '',
            notes: row.notes || '',
            ...(roomName ? { accommodation: roomName } : {}),
          })
        } else {
          await listsApi.addPassenger(listId, {
            passenger: row.passenger.id,
            agency: row.agency?.id || null,
            responsible_user: row.responsible?.user_id || null,
            enrollment_status: row.status,
            pending_until: row.status !== 'confirmado' ? (row.prazo || null) : null,
            pending_reason: row.status !== 'confirmado' ? row.notes : '',
            notes: row.status === 'confirmado' ? '' : row.notes,
            ...(roomName ? { accommodation: roomName } : {}),
          })
        }
      }
      toast.success(`${valid.length} passageiro${valid.length>1?'s':''} adicionado${valid.length>1?'s':''}.`)
      onAdded(); onClose()
    } catch (err) { toast.error(err.response?.data?.error ?? 'Erro ao adicionar.') }
    finally { setSaving(false) }
  }

  const DROP_STYLE = { position:'fixed', zIndex:9999, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', boxShadow:'0 12px 32px rgba(0,0,0,.14)', overflow:'hidden', maxHeight:200, overflowY:'auto', minWidth:200 }
  const DROP_EMPTY = txt => <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'10px 0', margin:0 }}>{txt}</p>

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:600, padding:16 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:1060, boxShadow:'0 32px 80px rgba(0,0,0,.25)', display:'flex', flexDirection:'column', maxHeight:'92vh' }}>

        {/* Header */}
        <div className="mhead">
          <p style={{ margin:0, fontSize:15, fontWeight:700, color:'#0f172a' }}>Adicionar acomodação e passageiros</p>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>

        {/* Body */}
        <div className="mbody" style={{ display:'flex', flexDirection:'column', gap:14 }}>

          {/* Acomodação — segmented control */}
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{ display:'inline-flex', background:'#f1f5f9', borderRadius:8, padding:3, gap:2 }}>
              {[
                { k:'none',     label:'Sem acomodação'      },
                { k:'new',      label:'Nova acomodação'      },
                { k:'existing', label:'Acomodação existente' },
              ].map(opt => {
                const sel = accomMode === opt.k
                return (
                  <button key={opt.k} type="button" onClick={() => setAccomMode(opt.k)}
                    style={{ padding:'6px 14px', borderRadius:6, border:'none', cursor:'pointer', fontFamily:'inherit',
                      fontSize:12.5, fontWeight: sel ? 600 : 400, transition:'all .15s',
                      background: sel ? '#fff' : 'transparent',
                      color: sel ? '#1a2d4f' : '#94a3b8',
                      boxShadow: sel ? '0 1px 4px rgba(0,0,0,.10)' : 'none' }}>
                    {opt.label}
                  </button>
                )
              })}
            </div>

            {accomMode === 'new' && (() => {
              const err = submitted && !accomType
              const q   = accomTypeInput.toLowerCase()
              const items = accomTypes.filter(t => t.name.toLowerCase().includes(q))
              return (
                <div>
                  <input value={accomTypeInput}
                    onChange={e => { setAccomTypeInput(e.target.value); setAccomType(''); setAccomDrop(d => d?.field==='type' ? {...d,hover:0} : d) }}
                    onFocus={e => { const r=e.target.getBoundingClientRect(); setAccomDrop({ field:'type', top:r.bottom+4, left:r.left, width:r.width, hover:0 }) }}
                    onBlur={() => setTimeout(() => { setAccomDrop(d => d?.field==='type' ? null : d); if (!accomType) setAccomTypeInput('') }, 150)}
                    onKeyDown={e => {
                      if (!accomDrop || accomDrop.field!=='type') return
                      if (e.key==='ArrowDown') { e.preventDefault(); setAccomDrop(d => ({...d, hover: Math.min((d.hover??0)+1, items.length-1)})) }
                      else if (e.key==='ArrowUp') { e.preventDefault(); setAccomDrop(d => ({...d, hover: Math.max((d.hover??0)-1, 0)})) }
                      else if (e.key==='Enter') { e.preventDefault(); const it=items[accomDrop.hover??0]; if(it){setAccomType(it.name);setAccomTypeInput(it.name);setAccomDrop(null)} }
                      else if (e.key==='Escape') setAccomDrop(null)
                    }}
                    placeholder="Tipo de acomodação…" className="fi"
                    style={{ borderColor: err ? '#dc2626' : accomType ? '#16a34a' : undefined }} />
                  {err && <p style={{ margin:'4px 0 0', fontSize:11, color:'#dc2626' }}>Selecione o tipo de acomodação.</p>}
                  {accomType && !err && <p style={{ margin:'4px 0 0', fontSize:11, color:'#16a34a', fontWeight:600 }}>✓ {accomType}</p>}
                </div>
              )
            })()}

            {accomMode === 'existing' && (() => {
              const err = submitted && !existingRoom
              const q   = existingRoomInput.toLowerCase()
              const items = existingRooms.filter(r => r.name.toLowerCase().includes(q))
              return (
                <div>
                  <input value={existingRoomInput}
                    onChange={e => { setExistingRoomInput(e.target.value); setExistingRoom(''); setAccomDrop(d => d?.field==='room' ? {...d,hover:0} : d) }}
                    onFocus={e => { const r=e.target.getBoundingClientRect(); setAccomDrop({ field:'room', top:r.bottom+4, left:r.left, width:r.width, hover:0 }) }}
                    onBlur={() => setTimeout(() => { setAccomDrop(d => d?.field==='room' ? null : d); if (!existingRoom) setExistingRoomInput('') }, 150)}
                    onKeyDown={e => {
                      if (!accomDrop || accomDrop.field!=='room') return
                      if (e.key==='ArrowDown') { e.preventDefault(); setAccomDrop(d => ({...d, hover: Math.min((d.hover??0)+1, items.length-1)})) }
                      else if (e.key==='ArrowUp') { e.preventDefault(); setAccomDrop(d => ({...d, hover: Math.max((d.hover??0)-1, 0)})) }
                      else if (e.key==='Enter') { e.preventDefault(); const it=items[accomDrop.hover??0]; if(it){setExistingRoom(it.name);setExistingRoomInput(it.name);setAccomDrop(null)} }
                      else if (e.key==='Escape') setAccomDrop(null)
                    }}
                    placeholder="Buscar quarto…" className="fi"
                    style={{ borderColor: err ? '#dc2626' : existingRoom ? '#16a34a' : undefined }} />
                  {err && <p style={{ margin:'4px 0 0', fontSize:11, color:'#dc2626' }}>Selecione o quarto.</p>}
                  {existingRoom && !err && <p style={{ margin:'4px 0 0', fontSize:11, color:'#16a34a', fontWeight:600 }}>✓ {existingRoom}</p>}
                </div>
              )
            })()}

            {/* Portal para dropdowns de acomodação */}
            {accomDrop && createPortal(
              <div style={{ position:'fixed', zIndex:9999, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', boxShadow:'0 12px 32px rgba(0,0,0,.14)', overflow:'hidden', maxHeight:200, overflowY:'auto', top:accomDrop.top, left:accomDrop.left, width:accomDrop.width }}>
                {accomDrop.field === 'type' && (() => {
                  const q = accomTypeInput.toLowerCase()
                  const items = accomTypes.filter(t => t.name.toLowerCase().includes(q))
                  if (!items.length) return <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'10px 0', margin:0 }}>Nenhum tipo encontrado.</p>
                  return items.map((t, i) => (
                    <div key={t.id}
                      style={{ padding:'9px 14px', borderBottom:'1px solid #f8fafc', cursor:'pointer', background: accomDrop.hover===i ? '#eff6ff' : 'transparent', fontSize:13, color:'#1e293b' }}
                      onMouseDown={() => { setAccomType(t.name); setAccomTypeInput(t.name); setAccomDrop(null) }}
                      onMouseEnter={() => setAccomDrop(d => d ? {...d, hover:i} : d)}>
                      {t.name}
                    </div>
                  ))
                })()}
                {accomDrop.field === 'room' && (() => {
                  const q = existingRoomInput.toLowerCase()
                  const items = existingRooms.filter(r => r.name.toLowerCase().includes(q))
                  if (!items.length) return <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'10px 0', margin:0 }}>Nenhum quarto encontrado.</p>
                  return items.map((r, i) => {
                    const occupants = enrolled.filter(e => e.accommodation === r.name && e.enrollment_status !== 'cancelado')
                    const names = occupants.map(e => e.passenger_name || e.block_agency).filter(Boolean)
                    return (
                      <div key={r.id}
                        style={{ padding:'9px 14px', borderBottom:'1px solid #f8fafc', cursor:'pointer', background: accomDrop.hover===i ? '#eff6ff' : 'transparent' }}
                        onMouseDown={() => { setExistingRoom(r.name); setExistingRoomInput(r.name); setAccomDrop(null) }}
                        onMouseEnter={() => setAccomDrop(d => d ? {...d, hover:i} : d)}>
                        <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
                          <p style={{ margin:0, fontSize:13, fontWeight:600, color:'#1e293b' }}>{r.name}</p>
                          <span style={{ fontSize:11, color:'#94a3b8' }}>{occupants.length} passageiro{occupants.length!==1?'s':''}</span>
                        </div>
                        {names.length > 0 && (
                          <div style={{ marginTop:4, display:'flex', flexWrap:'wrap', gap:4 }}>
                            {names.map((n, ni) => (
                              <span key={ni} style={{ fontSize:11, color:'#475569', background:'#f1f5f9', padding:'1px 7px', borderRadius:10 }}>{n}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>,
              document.body
            )}
          </div>

          {/* Tabela de passageiros */}
          <div style={{ overflowX:'auto', borderRadius:10, border:'1px solid #e2e8f0' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed' }}>
              <colgroup>
                <col style={{ width:32 }} />
                <col style={{ width:'22%' }} />
                <col style={{ width:'19%' }} />
                <col style={{ width:148 }} />
                <col style={{ width:118 }} />
                <col />
                <col style={{ width:'18%' }} />
                <col style={{ width:30 }} />
              </colgroup>
              <thead>
                <tr style={{ background:'#f8fafc', borderBottom:'1.5px solid #e2e8f0' }}>
                  {['#','Passageiro','Agência','Status','Prazo','Observações','Responsável',''].map((h,i) => (
                    <th key={i} style={{ padding:'8px 10px', fontSize:11, fontWeight:600, color:'#94a3b8', textAlign: i===0||i===7 ? 'center' : 'left', whiteSpace:'nowrap', overflow:'hidden' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const rid = row.id
                  const isOdd = idx % 2 === 1
                  const cellInput = { fontSize:12, padding:'5px 8px', width:'100%', boxSizing:'border-box' }
                  return (
                    <tr key={rid} style={{ borderBottom:'1px solid #f1f5f9', background: isOdd ? '#fafbfc' : '#fff', verticalAlign:'middle' }}>

                      {/* # */}
                      <td style={{ padding:'6px 4px', textAlign:'center', fontSize:12, fontWeight:600, color:'#94a3b8' }}>{idx+1}</td>

                      {/* Passageiro */}
                      <td style={{ padding:'5px 6px', overflow:'hidden' }}>
                        <input value={row.paxSearch}
                          onChange={e => { searchPax(rid, e.target.value); setOpenDrop(d => d?.rid===rid&&d?.field==='pax' ? {...d,hover:0} : d) }}
                          onFocus={e => { openDropFor(e, rid, 'pax'); if (!row.paxResults.length) searchPax(rid, row.paxSearch) }}
                          onBlur={() => setTimeout(() => {
                            setOpenDrop(d => d?.rid===rid&&d?.field==='pax' ? null : d)
                            setRows(rs => rs.map(r => {
                              if (r.id !== rid || r.passenger || !r.paxSearch.trim()) return r
                              return { ...r, passenger: { id: null, full_name: r.paxSearch.trim(), provisional: true } }
                            }))
                          }, 150)}
                          onKeyDown={e => handleKey(e, rid, 'pax')}
                          placeholder="Passageiro…" className="fi"
                          style={{ ...cellInput, borderColor: row.passenger ? '#16a34a' : (submitted ? '#dc2626' : undefined) }} />
                        {submitted && !row.passenger && <p style={{ margin:'2px 0 0', fontSize:10, color:'#dc2626', fontWeight:600 }}>Obrigatório</p>}
                        {row.passenger && !row.passenger.provisional && <p style={{ margin:'2px 0 0', fontSize:10, color:'#16a34a', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>✓ {row.passenger.full_name}</p>}
                        {row.passenger?.provisional && <p style={{ margin:'2px 0 0', fontSize:10, color:'#d97706', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>⚠ provisório — vincular depois</p>}
                      </td>

                      {/* Agência */}
                      <td style={{ padding:'5px 6px', overflow:'hidden' }}>
                        <input value={row.agSearch}
                          onChange={e => { searchAg(rid, e.target.value); setOpenDrop(d => d?.rid===rid&&d?.field==='ag' ? {...d,hover:0} : d) }}
                          onFocus={e => { openDropFor(e, rid, 'ag'); if (!row.agResults.length) searchAg(rid, row.agSearch) }}
                          onBlur={() => setTimeout(() => setOpenDrop(d => d?.rid===rid&&d?.field==='ag' ? null : d), 150)}
                          onKeyDown={e => handleKey(e, rid, 'ag')}
                          placeholder="Agência…" className="fi"
                          style={{ ...cellInput, borderColor: row.agency ? '#16a34a' : undefined }} />
                        {row.agency && <p style={{ margin:'2px 0 0', fontSize:10, color:'#16a34a', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>✓ {row.agency.company_name || row.agency.name}</p>}
                      </td>

                      {/* Status — botão + dropdown */}
                      {(() => {
                        const opt = ENROLLMENT_STATUS_OPTS.find(o => o.value === row.status)
                        const isOpen = openDrop?.rid === rid && openDrop?.field === 'status'
                        return (
                          <td style={{ padding:'5px 6px' }}>
                            <button type="button"
                              onMouseDown={e => {
                                if (isOpen) { setOpenDrop(null); return }
                                const r = e.currentTarget.getBoundingClientRect()
                                setOpenDrop({ rid, field:'status', top: r.bottom+4, left: r.left, width: Math.max(r.width, 190), hover:-1 })
                              }}
                              style={{ width:'100%', display:'flex', alignItems:'center', gap:6, padding:'6px 9px', borderRadius:7,
                                border:`1.5px solid ${isOpen ? (opt?.color||'#e2e8f0') : '#e2e8f0'}`,
                                background: isOpen ? `${opt?.color||'#f1f5f9'}12` : '#fafafa',
                                cursor:'pointer', fontFamily:'inherit', transition:'all .12s' }}>
                              <span style={{ width:8, height:8, borderRadius:'50%', background: opt?.color||'#94a3b8', flexShrink:0 }} />
                              <span style={{ flex:1, fontSize:12, fontWeight:600, color: opt?.color||'#475569', textAlign:'left' }}>{opt?.label||'—'}</span>
                              <span style={{ fontSize:9, color:'#94a3b8', lineHeight:1 }}>▾</span>
                            </button>
                          </td>
                        )
                      })()}

                      {/* Prazo */}
                      <td style={{ padding:'5px 6px' }}>
                        {row.status !== 'confirmado'
                          ? <DatePicker fixed value={row.prazo} onChange={v => upd(rid, { prazo: v })} placeholder="DD/MM/AAAA" />
                          : <span style={{ fontSize:12, color:'#cbd5e1', paddingLeft:4 }}>—</span>}
                      </td>

                      {/* Observações */}
                      <td style={{ padding:'5px 6px', overflow:'hidden' }}>
                        {row.status !== 'confirmado'
                          ? <input value={row.notes} onChange={e => upd(rid, { notes: e.target.value })}
                              placeholder="Observações…" className="fi" style={{ ...cellInput }} />
                          : <span style={{ fontSize:12, color:'#cbd5e1', paddingLeft:4 }}>—</span>}
                      </td>

                      {/* Responsável */}
                      <td style={{ padding:'5px 6px', overflow:'hidden' }}>
                        <input value={row.respInput}
                          onChange={e => { upd(rid, { respInput: e.target.value }); setOpenDrop(d => d?.rid===rid&&d?.field==='resp' ? {...d,hover:0} : d) }}
                          onFocus={e => openDropFor(e, rid, 'resp')}
                          onBlur={() => restoreOnBlur(rid, 'resp')}
                          onKeyDown={e => handleKey(e, rid, 'resp')}
                          placeholder={row.agency ? 'Responsável…' : '—'}
                          disabled={!row.agency}
                          className="fi"
                          style={{ ...cellInput, color: row.responsible ? '#1e293b' : undefined, background: !row.agency ? '#f8fafc' : undefined }} />
                      </td>

                      {/* Remover */}
                      <td style={{ padding:'5px 6px', textAlign:'center', width:32 }}>
                        {rows.length > 1 && (
                          <button type="button" onClick={() => delRow(rid)}
                            style={{ background:'none', border:'none', cursor:'pointer', color:'#fca5a5', fontSize:17, lineHeight:1, padding:2 }}
                            onMouseEnter={e => e.currentTarget.style.color='#dc2626'}
                            onMouseLeave={e => e.currentTarget.style.color='#fca5a5'}>×</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Portal dropdown — unified for pax / ag / status / resp */}
          {openDrop && createPortal(
            <div style={{ ...DROP_STYLE, top: openDrop.top, left: openDrop.left, width: openDrop.width }}>
              {(() => {
                const row = rows.find(r => r.id === openDrop.rid)
                if (!row) return null
                const { field, hover } = openDrop
                const rid = openDrop.rid

                if (field === 'pax') {
                  if (row.paxSearching) return DROP_EMPTY('Buscando…')
                  const provIdx = row.paxResults.length
                  const hasQuery = row.paxSearch.trim().length > 0
                  return (
                    <>
                      {row.paxResults.length === 0 && !hasQuery && DROP_EMPTY('Digite para buscar…')}
                      {row.paxResults.length === 0 && hasQuery && DROP_EMPTY('Nenhum resultado no cadastro.')}
                      {row.paxResults.map((p, i) => (
                        <div key={p.id}
                          style={{ padding:'8px 14px', borderBottom:'1px solid #f8fafc', cursor:'pointer', background: hover===i ? '#eff6ff' : 'transparent' }}
                          onMouseDown={() => selectItem(rid, 'pax', p)}
                          onMouseEnter={() => setOpenDrop(d => d ? {...d, hover:i} : d)}>
                          <p style={{ margin:0, fontSize:13, fontWeight:600, color:'#1e293b' }}>{p.full_name}</p>
                          <p style={{ margin:0, fontSize:11, color:'#94a3b8' }}>{p.cpf || p.email || '—'}</p>
                        </div>
                      ))}
                      {hasQuery && (
                        <div
                          style={{ padding:'9px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:9, background: hover===provIdx ? '#fffbeb' : '#fefce8', borderTop: row.paxResults.length ? '1px solid #fef3c7' : 'none' }}
                          onMouseDown={() => selectItem(rid, 'pax', { id: null, full_name: row.paxSearch.trim(), provisional: true })}
                          onMouseEnter={() => setOpenDrop(d => d ? {...d, hover:provIdx} : d)}>
                          <span style={{ fontSize:14, color:'#d97706', flexShrink:0 }}>⚠</span>
                          <div>
                            <p style={{ margin:0, fontSize:13, fontWeight:700, color:'#92400e' }}>Reservar "{row.paxSearch.trim()}" como provisório</p>
                            <p style={{ margin:0, fontSize:11, color:'#b45309' }}>Vincular ao cadastro do passageiro depois</p>
                          </div>
                        </div>
                      )}
                    </>
                  )
                }

                if (field === 'ag') {
                  if (row.agSearching) return DROP_EMPTY('Buscando…')
                  if (!row.agResults.length) return DROP_EMPTY('Nenhuma agência encontrada.')
                  return row.agResults.map((ag, i) => {
                    const lbl = ag.company_name || ag.name
                    return (
                      <div key={ag.id}
                        style={{ padding:'8px 14px', borderBottom:'1px solid #f8fafc', cursor:'pointer', background: hover===i ? '#eff6ff' : 'transparent' }}
                        onMouseDown={() => selectItem(rid, 'ag', ag)}
                        onMouseEnter={() => setOpenDrop(d => d ? {...d, hover:i} : d)}>
                        <p style={{ margin:0, fontSize:13, fontWeight:600, color:'#1e293b' }}>{lbl}</p>
                        <p style={{ margin:0, fontSize:11, color:'#94a3b8' }}>{ag.cnpj || ag.email || '—'}</p>
                      </div>
                    )
                  })
                }

                if (field === 'status') {
                  const opts = ENROLLMENT_STATUS_OPTS.filter(o => o.value !== 'cancelado')
                  return (
                    <div style={{ padding:6, display:'flex', flexDirection:'column', gap:4 }}>
                      {opts.map(opt => {
                        const sel = row.status === opt.value
                        return (
                          <button key={opt.value} type="button"
                            onMouseDown={() => selectItem(rid, 'status', opt)}
                            style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:8,
                              border:`1.5px solid ${sel ? opt.color : '#e2e8f0'}`,
                              background: sel ? `${opt.color}14` : '#fff',
                              cursor:'pointer', fontFamily:'inherit', textAlign:'left', transition:'all .1s',
                              width:'100%' }}
                            onMouseEnter={e => { if (!sel) e.currentTarget.style.background='#f8fafc' }}
                            onMouseLeave={e => { if (!sel) e.currentTarget.style.background='#fff' }}>
                            <span style={{ width:10, height:10, borderRadius:'50%', background: opt.color, flexShrink:0 }} />
                            <span style={{ fontSize:13, fontWeight: sel ? 700 : 500, color: sel ? opt.color : '#1e293b' }}>{opt.label}</span>
                            {sel && <span style={{ marginLeft:'auto', fontSize:11, color: opt.color }}>✓</span>}
                          </button>
                        )
                      })}
                    </div>
                  )
                }

                if (field === 'resp') {
                  const items = getDropItems(row, 'resp')
                  if (!row.agency) return DROP_EMPTY('Selecione uma agência primeiro.')
                  if (!items.length) return DROP_EMPTY(row.members.length ? 'Nenhum membro encontrado.' : 'Carregando…')
                  return items.map((m, i) => (
                    <div key={m.user_id}
                      style={{ padding:'8px 14px', borderBottom:'1px solid #f8fafc', cursor:'pointer', background: hover===i ? '#eff6ff' : 'transparent' }}
                      onMouseDown={() => selectItem(rid, 'resp', m)}
                      onMouseEnter={() => setOpenDrop(d => d ? {...d, hover:i} : d)}>
                      <p style={{ margin:0, fontSize:13, fontWeight:600, color:'#1e293b' }}>{m.user_name || m.email}</p>
                      {m.user_name && <p style={{ margin:0, fontSize:11, color:'#94a3b8' }}>{m.email}</p>}
                    </div>
                  ))
                }

                return null
              })()}
            </div>,
            document.body
          )}

          {/* + passageiro */}
          <button type="button" onClick={addRow}
            style={{ alignSelf:'flex-end', display:'flex', alignItems:'center', gap:7, padding:'7px 16px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            + passageiro
          </button>
        </div>

        {/* Footer */}
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onClose}>Fechar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ opacity: saving ? .6 : 1 }}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Popup para atribuir passageiro a um bloco ── */
function AssignPassengerPopup({ enrollment, listId, enrolled, onSaved, onClose }) {
  const navigate = useNavigate()

  // ── Busca passageiro existente ──
  const [search,    setSearch]    = useState('')
  const [results,   setResults]   = useState([])
  const [searching, setSearching] = useState(false)
  const [selected,  setSelected]  = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [open,      setOpen]      = useState(false)
  const [dropPos,   setDropPos]   = useState({})
  const inputRef = useRef(null)
  const debRef   = useRef(null)

  // ── Cadastrar novo ──
  const [mode,       setMode]       = useState('assign') // 'assign' | 'new'
  const [cpf,        setCpf]        = useState('')
  const [cpfError,   setCpfError]   = useState('')
  const [cpfChecking,setCpfChecking]= useState(false)

  const handleSearch = (q) => {
    setSearch(q); setSelected(null); setOpen(true)
    clearTimeout(debRef.current)
    debRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await passengersApi.list({ search: q, page_size: 20 })
        const enrolledIds = new Set(enrolled.map(e => e.passenger).filter(Boolean))
        setResults((r.data.results ?? r.data).filter(p => !enrolledIds.has(p.id)))
      } catch {} finally { setSearching(false) }
    }, 200)
  }

  const handleFocus = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    setOpen(true)
    if (!results.length) handleSearch('')
  }

  const handleAssign = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await listsApi.updatePassenger(listId, enrollment.id, { passenger: selected.id, is_provisional: false })
      toast.success(`${selected.full_name} vinculado.`)
      onSaved(); onClose()
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Erro ao atribuir.')
    } finally { setSaving(false) }
  }

  const handleUnlink = async () => {
    setSaving(true)
    try {
      await listsApi.updatePassenger(listId, enrollment.id, { passenger: null })
      toast.success('Passageiro desvinculado.')
      onSaved(); onClose()
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Erro ao desvincular.')
    } finally { setSaving(false) }
  }

  const validateCpf = (c) => {
    const d = c.replace(/\D/g, '')
    if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
    let s = 0
    for (let i = 0; i < 9; i++) s += +d[i] * (10 - i)
    let r = (s * 10) % 11; if (r === 10 || r === 11) r = 0
    if (r !== +d[9]) return false
    s = 0
    for (let i = 0; i < 10; i++) s += +d[i] * (11 - i)
    r = (s * 10) % 11; if (r === 10 || r === 11) r = 0
    return r === +d[10]
  }

  const handleGoNew = async () => {
    const digits = cpf.replace(/\D/g, '')
    if (digits.length !== 11) { setCpfError('Digite o CPF completo (11 dígitos).'); return }
    if (!validateCpf(cpf))    { setCpfError('CPF inválido. Verifique os dígitos.'); return }
    setCpfChecking(true); setCpfError('')
    try {
      const r = await passengersApi.checkCpf(cpf)
      if (r.data.exists) {
        setCpfError(`CPF já cadastrado: ${r.data.name}. Busque pelo nome acima.`)
        setCpfChecking(false); return
      }
      navigate(`/passageiros/novo?cpf=${encodeURIComponent(digits)}`)
    } catch { setCpfError('Erro ao verificar CPF. Tente novamente.') }
    finally { setCpfChecking(false) }
  }

  const isProvisional = enrollment.is_provisional
  const isBlock       = enrollment.is_block
  const hasPassenger  = !!enrollment.passenger

  const popupTitle = isProvisional
    ? 'Vincular passageiro'
    : isBlock
      ? 'Atribuir passageiro ao bloco'
      : 'Vincular / trocar passageiro'

  const popupSubtitle = isProvisional
    ? `Reserva provisória: ${enrollment.block_agency}`
    : isBlock
      ? `Agência: ${enrollment.block_agency}`
      : (enrollment.passenger_name || 'Sem passageiro vinculado')

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:700, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:480, boxShadow:'0 32px 80px rgba(0,0,0,.25)', display:'flex', flexDirection:'column' }}>

        {/* Header */}
        <div className="mhead">
          <div>
            <p style={{ margin:0, fontSize:15, fontWeight:700, color:'#0f172a' }}>{popupTitle}</p>
            <p style={{ margin:'2px 0 0', fontSize:12, color:'#94a3b8' }}>{popupSubtitle}</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'1.5px solid #e2e8f0' }}>
          {[{k:'assign', label:'Buscar cadastrado'}, {k:'new', label:'Cadastrar novo'}].map(t => (
            <button key={t.k} type="button" onClick={() => { setMode(t.k); setCpfError('') }}
              style={{ flex:1, padding:'11px 0', border:'none', cursor:'pointer', fontFamily:'inherit', fontWeight: mode===t.k ? 600 : 400, fontSize:13,
                color: mode===t.k ? '#1a2d4f' : '#94a3b8', background:'transparent',
                borderBottom: mode===t.k ? '2px solid #1a2d4f' : '2px solid transparent', marginBottom:'-1.5px' }}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="mbody" style={{ display:'flex', flexDirection:'column', gap:14 }}>

          {mode === 'assign' && (
            <>
              <div className="ff" style={{ margin:0 }}>
                <label className="fl">Passageiro</label>
                <input ref={inputRef} value={search} onChange={e => handleSearch(e.target.value)}
                  onFocus={handleFocus} onBlur={() => setTimeout(() => setOpen(false), 200)}
                  autoComplete="new-password" placeholder="Buscar por nome, CPF ou e-mail…" className="fi" />
                {open && createPortal(
                  <div style={{ position:'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex:9999, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', boxShadow:'0 12px 32px rgba(0,0,0,.14)', overflow:'hidden', maxHeight:220, overflowY:'auto' }}>
                    {searching
                      ? <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'12px 0', margin:0 }}>Buscando…</p>
                      : results.length === 0
                      ? <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'12px 0', margin:0 }}>Nenhum resultado.</p>
                      : results.map(p => (
                        <div key={p.id}
                          style={{ padding:'9px 14px', borderBottom:'1px solid #f8fafc', cursor:'pointer', background: selected?.id===p.id ? '#f0fdf4' : 'transparent' }}
                          onMouseDown={() => { setSelected(p); setSearch(p.full_name); setOpen(false) }}
                          onMouseEnter={ev => { if (selected?.id!==p.id) ev.currentTarget.style.background='#f8fafc' }}
                          onMouseLeave={ev => { ev.currentTarget.style.background = selected?.id===p.id ? '#f0fdf4' : 'transparent' }}>
                          <p style={{ margin:0, fontSize:13, fontWeight:600, color:'#1e293b' }}>{p.full_name}</p>
                          <p style={{ margin:0, fontSize:11, color:'#94a3b8' }}>{p.cpf || p.email || '—'}</p>
                        </div>
                      ))}
                  </div>,
                  document.body
                )}
                {selected && <p style={{ margin:'5px 0 0', fontSize:12, color:'#16a34a', fontWeight:600 }}>✓ {selected.full_name} selecionado</p>}
              </div>

              {hasPassenger && (
                <div style={{ padding:'10px 14px', background:'#fff7ed', borderRadius:8, border:'1px solid #fed7aa', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
                  <p style={{ margin:0, fontSize:12, color:'#92400e' }}>Passageiro atual: <strong>{enrollment.passenger_name}</strong></p>
                  <button type="button" onClick={handleUnlink} disabled={saving}
                    style={{ padding:'4px 12px', borderRadius:6, border:'1.5px solid #fb923c', background:'#fff', color:'#ea580c', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', flexShrink:0 }}>
                    Desvincular
                  </button>
                </div>
              )}
            </>
          )}

          {mode === 'new' && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <p style={{ margin:0, fontSize:13, color:'#475569' }}>Informe o CPF do novo passageiro para iniciar o cadastro.</p>
              <div className="ff" style={{ margin:0 }}>
                <label className="fl">CPF</label>
                <CpfInput value={cpf} onChange={v => { setCpf(v); setCpfError('') }} />
                {cpfError && <p style={{ margin:'5px 0 0', fontSize:12, color:'#dc2626' }}>{cpfError}</p>}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          {mode === 'assign'
            ? <button className="btn btn-primary" onClick={handleAssign} disabled={!selected || saving}
                style={{ opacity: !selected||saving ? .5 : 1 }}>
                {saving ? 'Vinculando…' : 'Vincular passageiro'}
              </button>
            : <button className="btn btn-primary" onClick={handleGoNew} disabled={cpfChecking}
                style={{ opacity: cpfChecking ? .5 : 1 }}>
                {cpfChecking ? 'Verificando…' : 'Ir para cadastro →'}
              </button>
          }
        </div>
      </div>
    </div>
  )
}

/* ── Popup Vincular Agência ── */
function LinkAgencyPopup({ enrollment, listId, onSaved, onClose }) {
  const name = enrollment.passenger_name || enrollment.block_agency || 'Passageiro'
  const [query,     setQuery]     = useState('')
  const [allAgencies, setAllAgencies] = useState([])  // lista completa carregada ao montar
  const [results,   setResults]   = useState([])       // lista filtrada pelo query
  const [searching, setSearching] = useState(true)
  const [selected,  setSelected]  = useState(
    enrollment.agency ? { id: enrollment.agency, label: enrollment.agency_name } : null
  )
  const [dropOpen, setDropOpen] = useState(false)
  const [hover,    setHover]    = useState(-1)
  const [saving,   setSaving]   = useState(false)
  const debRef = useRef(null)
  const inpRef = useRef(null)
  const wrapRef = useRef(null)

  // Carrega todas as agências ao montar
  useEffect(() => {
    agenciesApi.list({ page_size: 100 })
      .then(r => {
        const list = r.data.results || r.data
        setAllAgencies(list)
        setResults(list)
      })
      .catch(() => {})
      .finally(() => setSearching(false))
  }, [])

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    const h = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setDropOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const getDropPos = () => {
    if (!inpRef.current) return {}
    const rect = inpRef.current.getBoundingClientRect()
    return { top: rect.bottom + 4, left: rect.left, width: rect.width }
  }

  const handleChange = e => {
    const q = e.target.value
    setQuery(q)
    setSelected(null)
    setHover(-1)
    clearTimeout(debRef.current)
    if (!q.trim()) {
      setResults(allAgencies)
      setDropOpen(true)
      return
    }
    debRef.current = setTimeout(() => {
      const lower = q.toLowerCase()
      const filtered = allAgencies.filter(ag =>
        (ag.company_name || '').toLowerCase().includes(lower) ||
        (ag.name || '').toLowerCase().includes(lower)
      )
      // Se locais não batem, faz busca no servidor
      if (filtered.length > 0) {
        setResults(filtered)
        setDropOpen(true)
      } else {
        setSearching(true)
        agenciesApi.list({ search: q, page_size: 15 })
          .then(r => {
            const list = r.data.results || r.data
            setResults(list)
            setDropOpen(list.length > 0)
          })
          .catch(() => setResults([]))
          .finally(() => setSearching(false))
      }
    }, 200)
  }

  const pick = ag => {
    setSelected({ id: ag.id, label: ag.company_name || ag.name })
    setQuery(ag.company_name || ag.name)
    setDropOpen(false)
    setHover(-1)
  }

  const handleKey = e => {
    if (!dropOpen || results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHover(h => Math.min(h+1, results.length-1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHover(h => Math.max(h-1, 0)) }
    if (e.key === 'Enter' && hover >= 0) { e.preventDefault(); pick(results[hover]) }
    if (e.key === 'Escape') setDropOpen(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await listsApi.updatePassenger(listId, enrollment.id, { agency: selected?.id || null })
      toast.success(selected ? 'Agência vinculada com sucesso.' : 'Agência desvinculada.')
      onSaved()
      onClose()
    } catch { toast.error('Erro ao salvar.') }
    finally { setSaving(false) }
  }

  const dropPos = getDropPos()
  const dropdown = dropOpen && results.length > 0 && createPortal(
    <div onMouseDown={e => e.preventDefault()}
      style={{ position:'fixed', top:dropPos.top, left:dropPos.left, width:dropPos.width, zIndex:9999,
        background:'#fff', border:'1px solid #e2e8f0', borderRadius:10,
        boxShadow:'0 8px 28px rgba(0,0,0,.13)', overflow:'hidden', maxHeight:260, overflowY:'auto' }}>
      {results.map((ag, i) => {
        const label = ag.company_name || ag.name
        return (
          <button key={ag.id} type="button" onMouseDown={() => pick(ag)}
            style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'10px 14px', textAlign:'left',
              background: i===hover ? '#f0f7ff' : '#fff', border:'none', cursor:'pointer',
              fontFamily:'inherit', fontSize:13, color:'#1e293b', borderBottom: i < results.length-1 ? '1px solid #f8fafc' : 'none' }}
            onMouseEnter={() => setHover(i)}>
            <span style={{ display:'flex', alignItems:'center', justifyContent:'center', width:28, height:28, borderRadius:6, background:'#f1f5f9', flexShrink:0, fontSize:12 }}>🏢</span>
            <span style={{ fontWeight: i===hover ? 600 : 400 }}>{label}</span>
          </button>
        )
      })}
    </div>,
    document.body
  )

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)',
        display:'flex', alignItems:'center', justifyContent:'center', zIndex:760, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:420, boxShadow:'0 32px 80px rgba(0,0,0,.25)' }}>

        {/* Header */}
        <div style={{ padding:'18px 22px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ minWidth:0 }}>
            <p style={{ margin:0, fontSize:15, fontWeight:700, color:'#0f172a' }}>Vincular agência</p>
            <p title={name} style={{ margin:'2px 0 0', fontSize:12, color:'#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding:'20px 22px 8px' }}>
          {/* Agência atual */}
          {selected && (
            <div style={{ marginBottom:16, padding:'10px 14px', background:'#f0f7ff', border:'1px solid #bfdbfe', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
              <div style={{ minWidth:0 }}>
                <p style={{ margin:0, fontSize:10, fontWeight:700, color:'#2e6db4', textTransform:'uppercase', letterSpacing:'.05em' }}>Agência vinculada</p>
                <p style={{ margin:'3px 0 0', fontSize:14, fontWeight:600, color:'#1e293b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{selected.label}</p>
              </div>
              <button type="button" onClick={() => { setSelected(null); setQuery(''); setResults(allAgencies); setTimeout(() => inpRef.current?.focus(), 50) }}
                style={{ fontSize:11, fontWeight:600, color:'#dc2626', background:'#fee2e2', border:'none', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontFamily:'inherit', flexShrink:0 }}>
                Desvincular
              </button>
            </div>
          )}

          {/* Input busca */}
          <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>
            {selected ? 'Trocar agência' : 'Buscar agência'}
          </label>
          <div ref={wrapRef}>
            <input ref={inpRef}
              value={query}
              onChange={handleChange}
              onFocus={() => { setDropOpen(true); setHover(-1) }}
              onKeyDown={handleKey}
              placeholder={searching ? 'Carregando agências…' : 'Digite ou selecione a agência…'}
              disabled={searching}
              className="fi"
              style={{ width:'100%', boxSizing:'border-box' }}
              autoFocus
            />
          </div>
          {!searching && !dropOpen && query.trim() && !selected && results.length === 0 && (
            <p style={{ margin:'5px 0 0', fontSize:12, color:'#94a3b8' }}>Nenhuma agência encontrada.</p>
          )}
          {dropdown}
          <div style={{ height:16 }} />
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 22px 18px', borderTop:'1px solid #f1f5f9', display:'flex', justifyContent:'flex-end', gap:8 }}>
          <button onClick={onClose}
            style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding:'8px 22px', borderRadius:8, border:'none', background: saving ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor: saving ? 'default' : 'pointer', fontFamily:'inherit' }}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Modal de acomodação (reutilizável para massa e individual) ── */
// enrollmentIds: lista de IDs de enrollments a vincular
// enrolled: lista completa de enrollments da lista
// accomTypes: tipos de acomodação disponíveis
// onConfirm(roomName): callback ao confirmar
// onClose: fechar modal
function AccomPickerModal({ enrollmentIds, enrolled, accomTypes, rooms, onConfirm, onClose }) {
  const [saving, setSaving] = useState(false)

  // Monta mapa de quartos existentes: roomName → { type, people[] }
  const roomMap = {}
  enrolled.forEach(e => {
    if (!e.accommodation) return
    if (!roomMap[e.accommodation]) {
      const type = findAccomType(accomTypes, e.accommodation)
      roomMap[e.accommodation] = { type, people: [] }
    }
    if (e.passenger_name) roomMap[e.accommodation].people.push(e.passenger_name)
    else if (e.block_agency) roomMap[e.accommodation].people.push(`[${e.block_agency}]`)
  })
  // Acomodações vazias (criadas via "Gerenciar acomodações", sem passageiros ainda)
  rooms.filter(room => room.occupant_count === 0).forEach(room => {
    if (!roomMap[room.name]) roomMap[room.name] = { type: findAccomType(accomTypes, room.name), people: [] }
  })
  const existingRooms = Object.keys(roomMap).sort()

  const handleSelectRoom = async (room) => {
    setSaving(true)
    try {
      await onConfirm(room)
    } finally { setSaving(false) }
  }

  const handleCreateNewType = async (typeName) => {
    if (!typeName) return
    const existing = existingRooms.filter(r => r === typeName || r.startsWith(typeName + ' '))
    let next = `${typeName} 1`
    for (let n = 1; n <= 99; n++) {
      const c = `${typeName} ${n}`
      if (!existing.includes(c)) { next = c; break }
    }
    setSaving(true)
    try {
      await onConfirm(next)
    } finally { setSaving(false) }
  }

  const isBulk = enrollmentIds.length > 1
  const subtitle = isBulk
    ? `${enrollmentIds.length} passageiros selecionados`
    : enrolled.find(e => enrollmentIds[0] === e.id)?.passenger_name || enrolled.find(e => enrollmentIds[0] === e.id)?.block_agency || ''

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:700, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:480, boxShadow:'0 32px 80px rgba(0,0,0,.25)', display:'flex', flexDirection:'column', maxHeight:'85vh', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ padding:'18px 22px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div>
            <p style={{ margin:0, fontSize:15, fontWeight:700, color:'#0f172a' }}>Adicionar à acomodação</p>
            {subtitle && <p style={{ margin:'2px 0 0', fontSize:12, color:'#94a3b8' }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'16px 22px 20px', display:'flex', flexDirection:'column', gap:20 }}>

          {/* Seção 1 — Acomodações existentes */}
          {existingRooms.length > 0 && (
            <div>
              <p style={{ margin:'0 0 10px', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em' }}>
                Acomodações existentes
              </p>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {existingRooms.map(room => {
                  const { type, people } = roomMap[room]
                  const cap   = type?.capacity
                  const count = people.length
                  const full  = cap && count === cap
                  const over  = cap && count > cap
                  return (
                    <button key={room} type="button" onClick={() => !saving && handleSelectRoom(room)} disabled={saving}
                      style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', cursor: saving ? 'default' : 'pointer', fontFamily:'inherit', textAlign:'left', transition:'all .12s' }}
                      onMouseEnter={ev => { if (!saving) ev.currentTarget.style.borderColor='#1a2d4f' }}
                      onMouseLeave={ev => ev.currentTarget.style.borderColor='#e2e8f0'}>
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom: people.length ? 3 : 0 }}>
                          <span style={{ fontSize:13, fontWeight:600, color:'#1e293b' }}>{room}</span>
                          {type?.is_couple && <span style={{ fontSize:10, color:'#7c3aed', background:'#ede9fe', padding:'1px 6px', borderRadius:10 }}>casal</span>}
                        </div>
                        {people.length > 0 && (
                          <p style={{ margin:0, fontSize:11, color:'#64748b' }}>{people.join(' / ')}</p>
                        )}
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                        {cap
                          ? <span style={{ fontSize:11, fontWeight:600,
                              color:      over ? '#dc2626' : full ? '#92400e' : '#16a34a',
                              background: over ? '#fee2e2' : full ? '#fef9c3' : '#dcfce7',
                              padding:'1px 8px', borderRadius:20 }}>
                              {count}/{cap} {over ? '⚠' : full ? '●' : '✓'}
                            </span>
                          : <span style={{ fontSize:11, color:'#94a3b8' }}>{count}p</span>
                        }
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Seção 2 — Criar nova acomodação */}
          <div>
            <p style={{ margin:'0 0 10px', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em' }}>
              Criar nova acomodação
            </p>
            {accomTypes.length === 0 ? (
              <p style={{ margin:0, fontSize:12, color:'#94a3b8', fontStyle:'italic' }}>
                Nenhum tipo configurado. Acesse Configurações → Acomodações.
              </p>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {accomTypes.map(t => (
                  <button key={t.id} type="button"
                    onClick={() => handleCreateNewType(t.name)}
                    disabled={saving}
                    style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', cursor: saving ? 'default' : 'pointer', fontFamily:'inherit', textAlign:'left', transition:'all .12s' }}
                    onMouseEnter={ev => { if (!saving) { ev.currentTarget.style.borderColor='#1a2d4f'; ev.currentTarget.style.background='#f8fafc' } }}
                    onMouseLeave={ev => { ev.currentTarget.style.borderColor='#e2e8f0'; ev.currentTarget.style.background='#fff' }}>
                    <span style={{ fontSize:13, fontWeight:600, color:'#2e6db4' }}>+ {t.name}</span>
                    <div style={{ display:'flex', gap:4 }}>
                      {t.capacity && <span style={{ fontSize:11, color:'#94a3b8', background:'#f1f5f9', padding:'1px 7px', borderRadius:20 }}>{t.capacity}p</span>}
                      {t.is_couple && <span style={{ fontSize:10, color:'#7c3aed', background:'#ede9fe', padding:'1px 6px', borderRadius:10 }}>casal</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>

        <div style={{ padding:'0 22px 18px', display:'flex', justifyContent:'flex-end', flexShrink:0, borderTop:'1px solid #f1f5f9', paddingTop:14 }}>
          <button type="button" onClick={onClose}
            style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Modal de edição de tipo da acomodação (não remove passageiros) ── */
function EditAccomTypeModal({ roomName, accomTypes, enrolled, listId, onSaved, onDelete, onClose }) {
  const navigate    = useNavigate()
  const currentType = findAccomType(accomTypes, roomName)
  const [selectedType, setSelectedType] = useState(currentType?.name || '')
  const [saving,       setSaving]       = useState(false)
  const [previewPax,   setPreviewPax]   = useState(null)   // objeto completo do passageiro
  const [loadingPax,   setLoadingPax]   = useState(null)   // id sendo carregado

  const occupants = enrolled.filter(e => e.accommodation === roomName)

  const openPreview = async (e) => {
    if (!e.passenger) return
    setLoadingPax(e.passenger)
    try {
      const r = await passengersApi.get(e.passenger)
      setPreviewPax(r.data)
    } catch { toast.error('Não foi possível carregar o passageiro.') }
    finally { setLoadingPax(null) }
  }

  // Flags calculadas com base no tipo SELECIONADO
  const selType  = accomTypes.find(t => t.name === selectedType)
  const paxCount = occupants.length
  const capacity = selType?.capacity
  const capOver  = capacity && paxCount > capacity
  const capFull  = capacity && paxCount === capacity
  const capUnder = capacity && paxCount < capacity
  const genders  = occupants.filter(e => !e.is_block && e.passenger_gender).map(e => e.passenger_gender)
  const sameSex  = selType?.is_couple && genders.length >= 2 && genders.every(g => g === genders[0])

  const typeOptions = accomTypes.map(t => ({
    value: t.name,
    label: `${t.name}${t.capacity ? ` (${t.capacity}p)` : ''}${t.is_couple ? ' — casal' : ''}`,
  }))

  const handleSave = async () => {
    if (!selectedType || selectedType === currentType?.name) { onClose(); return }
    setSaving(true)
    const suffix  = currentType ? roomName.slice(currentType.name.length).trim() : ''
    const newRoom = suffix ? `${selectedType} ${suffix}` : selectedType
    try {
      await Promise.all(occupants.map(e => listsApi.updatePassenger(listId, e.id, { accommodation: newRoom })))
      toast.success(`Acomodação alterada para ${newRoom}.`)
      onSaved(); onClose()
    } catch {
      toast.error('Erro ao alterar tipo da acomodação.')
    } finally { setSaving(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:750, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:420, boxShadow:'0 32px 80px rgba(0,0,0,.25)', overflow:'visible' }}>

        {/* Header */}
        <div style={{ padding:'18px 22px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <p style={{ margin:0, fontSize:15, fontWeight:700, color:'#0f172a' }}>Editar acomodação</p>
            <p style={{ margin:'2px 0 0', fontSize:12, color:'#94a3b8' }}>{roomName}</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>

        <div style={{ padding:'16px 22px 20px', display:'flex', flexDirection:'column', gap:16 }}>

          {/* Passageiros vinculados */}
          {occupants.length > 0 && (
            <div style={{ background:'#f8fafc', borderRadius:8, padding:'10px 14px' }}>
              <p style={{ margin:'0 0 6px', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.05em' }}>Passageiros vinculados</p>
              <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                {occupants.map((e) => {
                  const name     = e.passenger_name || (e.block_agency ? `[${e.block_agency}]` : null)
                  if (!name) return null
                  const isLoading = loadingPax === e.passenger
                  const clickable = !!e.passenger
                  return (
                    <div key={e.id}
                      onClick={() => clickable && openPreview(e)}
                      style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 4px', borderRadius:6, minWidth:0, cursor: clickable ? 'pointer' : 'default', transition:'background .1s' }}
                      onMouseEnter={ev => { if (clickable) ev.currentTarget.style.background='#e2e8f0' }}
                      onMouseLeave={ev => { ev.currentTarget.style.background='transparent' }}>
                      <span style={{ color:'#94a3b8', fontSize:12, flexShrink:0 }}>•</span>
                      <span title={isLoading ? undefined : name}
                        style={{ fontSize:13, color: clickable ? '#1a2d4f' : '#1e293b', fontWeight: clickable ? 600 : 400, textDecoration: clickable ? 'underline' : 'none', textDecorationStyle:'dotted', textUnderlineOffset:3, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {isLoading ? 'Carregando…' : name}
                      </span>
                    </div>
                  )
                })}
              </div>
              <p style={{ margin:'8px 0 0', fontSize:11, color:'#94a3b8', fontStyle:'italic' }}>
                Alterar o tipo não remove estes passageiros.
              </p>
            </div>
          )}

          {/* Flags de alerta */}
          {(capOver || capFull || capUnder || sameSex) && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {capOver && (
                <span style={{ fontSize:11, fontWeight:700, background:'#fee2e2', color:'#dc2626', padding:'3px 10px', borderRadius:20, display:'flex', alignItems:'center', gap:3 }}>
                  ⚠ Superlotado ({paxCount}/{capacity})
                </span>
              )}
              {capFull && (
                <span style={{ fontSize:11, fontWeight:700, background:'#fef9c3', color:'#92400e', padding:'3px 10px', borderRadius:20 }}>
                  ● Capacidade máxima ({paxCount}/{capacity})
                </span>
              )}
              {capUnder && (
                <span style={{ fontSize:11, fontWeight:600, background:'#f0fdf4', color:'#16a34a', padding:'3px 10px', borderRadius:20 }}>
                  ✓ {capacity - paxCount} vaga{(capacity - paxCount) !== 1 ? 's' : ''} disponível{(capacity - paxCount) !== 1 ? 'is' : ''}
                </span>
              )}
              {sameSex && (
                <span style={{ fontSize:11, fontWeight:700, background:'#fef9c3', color:'#92400e', padding:'3px 10px', borderRadius:20, display:'flex', alignItems:'center', gap:3 }}>
                  ⚠ Mesmo sexo
                </span>
              )}
            </div>
          )}

          {/* Seletor de tipo */}
          <div>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>
              Tipo da acomodação
            </label>
            <FormSelect
              value={selectedType}
              onChange={setSelectedType}
              options={typeOptions}
              placeholder="Escolha o tipo…"
            />
          </div>
        </div>

        <div style={{ padding:'0 22px 18px', display:'flex', gap:8, justifyContent:'space-between', alignItems:'center' }}>
          {onDelete ? (
            <button type="button" onClick={() => { onDelete(); onClose() }}
              title="Excluir acomodação"
              style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 14px', borderRadius:8, border:'1.5px solid #fecaca', background:'#fee2e2', color:'#dc2626', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              <Ic n="trash" s={13} /> Excluir
            </button>
          ) : <span />}
          <div style={{ display:'flex', gap:8 }}>
            <button type="button" onClick={onClose}
              style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={!selectedType || saving}
              style={{ padding:'8px 22px', borderRadius:8, border:'none', background: !selectedType || saving ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor: !selectedType || saving ? 'default' : 'pointer', fontFamily:'inherit' }}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>

      {previewPax && createPortal(
        <PassengerPreviewModal
          passenger={previewPax}
          onClose={() => setPreviewPax(null)}
          onEdit={() => { setPreviewPax(null); onClose(); navigate(`/passageiros/${previewPax.id}`) }}
        />,
        document.body
      )}
    </div>
  )
}

/* ── Modal "Excluir acomodação ocupada" — escolhe o destino dos passageiros antes de remover o quarto ── */
function DeleteOccupiedRoomModal({ roomName, occupants, onConfirm, onClose }) {
  const [resolution, setResolution] = useState('unassign')
  const [busy,       setBusy]       = useState(false)
  const n = occupants.length

  const OPTIONS = [
    {
      value: 'unassign',
      label: 'Excluir a acomodação e devolver os passageiros à lista de espera',
      detail: `${n === 1 ? 'O passageiro volta' : 'Os passageiros voltam'} para "Aguardando acomodação" e ${n === 1 ? 'pode' : 'podem'} ser realocado${n === 1 ? '' : 's'} depois.`,
    },
    {
      value: 'cancel',
      label: 'Marcar os passageiros como cancelados e excluir a acomodação',
      detail: `${n === 1 ? 'O passageiro é movido' : 'Os passageiros são movidos'} para "Cancelados" nesta lista.`,
    },
    {
      value: 'remove',
      label: 'Remover os passageiros desta viagem e excluir a acomodação',
      detail: `${n === 1 ? 'A inscrição deste passageiro' : 'As inscrições destes passageiros'} nesta lista ${n === 1 ? 'é apagada' : 'são apagadas'} definitivamente.`,
    },
    {
      value: 'move',
      label: 'Mover cada passageiro individualmente para outra acomodação',
      detail: 'Abre uma tela para escolher, um a um, o destino de cada passageiro — em acomodações existentes ou novas.',
    },
  ]

  const handleConfirm = async () => {
    setBusy(true)
    try { await onConfirm(resolution) } finally { setBusy(false) }
  }

  const isMove = resolution === 'move'

  return (
    <div className="overlay" onClick={onClose}>
      <div className="mbox" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">Excluir acomodação ocupada</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="mbody">
          <div style={{ display:'flex', gap:12, alignItems:'flex-start', marginBottom:14 }}>
            <div style={{ color:'#f59e0b', flexShrink:0, marginTop:2 }}><Ic n="warn" s={20}/></div>
            <p style={{ fontSize:14, color:'#475569', lineHeight:1.7, margin:0 }}>
              <strong>{roomName}</strong> tem {n} passageiro{n !== 1 ? 's' : ''} vinculado{n !== 1 ? 's' : ''}.
              O que deseja fazer com {n !== 1 ? 'eles' : 'ele'} antes de excluir a acomodação?
            </p>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {OPTIONS.map(opt => {
              const isSel = resolution === opt.value
              return (
                <label key={opt.value}
                  style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'10px 12px', borderRadius:8, border:`1.5px solid ${isSel ? '#1a2d4f' : '#e2e8f0'}`, background: isSel ? '#f0f4ff' : '#fff', cursor:'pointer', transition:'all .12s' }}
                  onClick={() => setResolution(opt.value)}>
                  <div style={{ width:16, height:16, marginTop:2, borderRadius:'50%', border:`2px solid ${isSel ? '#1a2d4f' : '#d1d5db'}`, background: isSel ? '#1a2d4f' : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    {isSel && <span style={{ color:'#fff', fontSize:10, fontWeight:900, lineHeight:1 }}>✓</span>}
                  </div>
                  <div>
                    <p style={{ margin:0, fontSize:13, color: isSel ? '#1a2d4f' : '#1e293b', fontWeight: isSel ? 600 : 500 }}>{opt.label}</p>
                    <p style={{ margin:'2px 0 0', fontSize:11, color:'#94a3b8' }}>{opt.detail}</p>
                  </div>
                </label>
              )
            })}
          </div>
          {!isMove && <p style={{ fontSize:12, color:'#94a3b8', margin:'12px 0 0' }}>Esta ação não pode ser desfeita.</p>}
        </div>
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className={isMove ? 'btn btn-primary' : 'btn btn-danger'} onClick={handleConfirm} disabled={busy}>
            {busy ? 'Aguarde…' : (isMove ? 'Continuar' : 'Excluir acomodação')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Modal "Mover passageiros" — realoca cada ocupante individualmente antes de excluir o quarto ── */
function MovePassengersModal({ roomId, roomName, listId, enrolled, accomTypes, rooms, onMoved, onDeleteRoom, onClose }) {
  const [pickerFor, setPickerFor] = useState(null)   // enrollment sendo movido

  const occupants = enrolled.filter(e => e.accommodation === roomName)

  const handleConfirmMove = async (room) => {
    await listsApi.updatePassenger(listId, pickerFor.id, { accommodation: room })
    const name = pickerFor.passenger_name || pickerFor.block_agency || 'Passageiro'
    toast.success(`${name} movido para ${room}.`)
    setPickerFor(null)
    onMoved()
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:690, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:460, boxShadow:'0 32px 80px rgba(0,0,0,.25)', display:'flex', flexDirection:'column', maxHeight:'85vh', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ padding:'18px 22px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div>
            <p style={{ margin:0, fontSize:15, fontWeight:700, color:'#0f172a' }}>Mover passageiros</p>
            <p style={{ margin:'2px 0 0', fontSize:12, color:'#94a3b8' }}>{roomName} — escolha o destino de cada um</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'16px 22px 20px', display:'flex', flexDirection:'column', gap:8 }}>
          {occupants.length === 0 ? (
            <div style={{ textAlign:'center', padding:'20px 0', display:'flex', flexDirection:'column', gap:10, alignItems:'center' }}>
              <p style={{ margin:0, fontSize:14, fontWeight:700, color:'#16a34a' }}>✓ Todos os passageiros foram movidos</p>
              <p style={{ margin:0, fontSize:12, color:'#94a3b8' }}>A acomodação "{roomName}" está vazia e pode ser excluída agora.</p>
              <button type="button" onClick={onDeleteRoom}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:8, border:'1.5px solid #fecaca', background:'#fee2e2', color:'#dc2626', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                <Ic n="trash" s={13}/> Excluir acomodação vazia
              </button>
            </div>
          ) : occupants.map(e => {
            const name = e.passenger_name || (e.block_agency ? `[${e.block_agency}]` : 'Vaga em bloco')
            return (
              <div key={e.id}
                style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'10px 12px', borderRadius:8, border:'1.5px solid #e2e8f0' }}>
                <span style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                  color:     e.enrollment_status === 'pendente' ? '#92400e' : '#1e293b',
                  fontStyle: e.enrollment_status === 'pendente' ? 'italic'  : 'normal',
                }}>{name}</span>
                <button type="button" onClick={() => setPickerFor(e)}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:8, border:'1.5px solid #1a2d4f', background:'#fff', color:'#1a2d4f', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', flexShrink:0 }}>
                  <Ic n="building" s={13}/> Mover
                </button>
              </div>
            )
          })}
        </div>

        <div style={{ padding:'0 22px 18px', display:'flex', justifyContent:'flex-end', flexShrink:0, borderTop:'1px solid #f1f5f9', paddingTop:14 }}>
          <button type="button" onClick={onClose}
            style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            Fechar
          </button>
        </div>
      </div>

      {pickerFor && (
        <AccomPickerModal
          enrollmentIds={[pickerFor.id]}
          enrolled={enrolled.filter(en => en.accommodation !== roomName || en.id === pickerFor.id)}
          accomTypes={accomTypes}
          rooms={rooms.filter(r => r.id !== roomId)}
          onConfirm={handleConfirmMove}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  )
}

/* ── Modal "Gerenciar acomodações" — cria, renomeia e remove quartos da lista ── */
function ManageRoomsModal({ listId, accomTypes, onChanged, onClose }) {
  const [rooms,    setRooms]    = useState(null)
  const [newType,  setNewType]  = useState('')
  const [creating, setCreating] = useState(false)
  const [editing,  setEditing]  = useState(null)   // id da sala em edição
  const [editVal,  setEditVal]  = useState('')
  const [busyId,   setBusyId]   = useState(null)   // id em salvamento/exclusão

  const load = useCallback(() => {
    listsApi.listRooms(listId).then(r => setRooms(r.data)).catch(() => toast.error('Erro ao carregar acomodações.'))
  }, [listId])

  useEffect(() => { load() }, [load])

  const typeOptions = accomTypes.map(t => ({
    value: t.name,
    label: `${t.name}${t.capacity ? ` (${t.capacity}p)` : ''}${t.is_couple ? ' — casal' : ''}`,
  }))

  const handleCreate = async () => {
    if (!newType) return
    const existingNames = (rooms || []).map(r => r.name)
    const matching = existingNames.filter(n => n === newType || n.startsWith(newType + ' '))
    let name = `${newType} 1`
    for (let n = 1; n <= 99; n++) {
      const c = `${newType} ${n}`
      if (!matching.includes(c)) { name = c; break }
    }
    setCreating(true)
    try {
      await listsApi.addRoom(listId, name)
      setNewType('')
      toast.success('Acomodação criada.')
      load(); onChanged()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Erro ao criar acomodação.')
    } finally { setCreating(false) }
  }

  const startEdit = (room) => { setEditing(room.id); setEditVal(room.name) }
  const cancelEdit = () => { setEditing(null); setEditVal('') }

  const handleRename = async (room) => {
    const name = editVal.trim()
    if (!name || name === room.name) { cancelEdit(); return }
    setBusyId(room.id)
    try {
      await listsApi.renameRoom(listId, room.id, name)
      toast.success('Acomodação renomeada.')
      cancelEdit()
      load(); onChanged()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Erro ao renomear acomodação.')
    } finally { setBusyId(null) }
  }

  const handleDelete = async (room) => {
    setBusyId(room.id)
    try {
      await listsApi.removeRoom(listId, room.id)
      toast.success('Acomodação removida.')
      load(); onChanged()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Erro ao remover acomodação.')
    } finally { setBusyId(null) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:700, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:480, boxShadow:'0 32px 80px rgba(0,0,0,.25)', display:'flex', flexDirection:'column', maxHeight:'85vh', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ padding:'18px 22px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div>
            <p style={{ margin:0, fontSize:15, fontWeight:700, color:'#0f172a' }}>Gerenciar acomodações</p>
            <p style={{ margin:'2px 0 0', fontSize:12, color:'#94a3b8' }}>Crie, renomeie ou remova as acomodações da lista</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'16px 22px 20px', display:'flex', flexDirection:'column', gap:18 }}>

          {/* Criar nova acomodação */}
          <div>
            <p style={{ margin:'0 0 10px', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em' }}>
              Criar acomodação vazia
            </p>
            <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
              <div style={{ flex:1 }}>
                <FormSelect
                  value={newType}
                  onChange={setNewType}
                  options={typeOptions}
                  placeholder="Escolha o tipo…"
                />
              </div>
              <button type="button" onClick={handleCreate} disabled={creating || !newType}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:8, border:'none', background: creating || !newType ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor: creating || !newType ? 'default' : 'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                <Ic n="plus" s={13} /> Criar
              </button>
            </div>
            <p style={{ margin:'8px 0 0', fontSize:11, color:'#94a3b8', fontStyle:'italic' }}>
              O nome é gerado a partir do tipo (ex: "Duplo 3") — depois é só renomear para um nome fixo, se quiser.
            </p>
          </div>

          {/* Lista de acomodações */}
          <div>
            <p style={{ margin:'0 0 10px', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em' }}>
              Acomodações da lista {rooms ? `(${rooms.length})` : ''}
            </p>
            {rooms === null ? (
              <p style={{ margin:0, fontSize:12, color:'#94a3b8', textAlign:'center', padding:'14px 0' }}>Carregando…</p>
            ) : rooms.length === 0 ? (
              <p style={{ margin:0, fontSize:12, color:'#94a3b8', fontStyle:'italic', textAlign:'center', padding:'14px 0' }}>Nenhuma acomodação criada ainda.</p>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {rooms.map(room => {
                  const isEditing = editing === room.id
                  const isBusy    = busyId === room.id
                  const empty     = room.occupant_count === 0
                  return (
                    <div key={room.id}
                      style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'9px 12px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff' }}>
                      {isEditing ? (
                        <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleRename(room); if (e.key === 'Escape') cancelEdit() }}
                          style={{ flex:1, boxSizing:'border-box', padding:'6px 9px', border:'1.5px solid #1a2d4f', borderRadius:6, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b', background:'#fff' }} />
                      ) : (
                        <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
                          <span style={{ fontSize:13, fontWeight:600, color:'#1e293b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{room.name}</span>
                          <span style={{ fontSize:11, color: empty ? '#94a3b8' : '#16a34a', background: empty ? '#f1f5f9' : '#dcfce7', padding:'1px 8px', borderRadius:20, flexShrink:0 }}>
                            {room.occupant_count} {room.occupant_count === 1 ? 'pessoa' : 'pessoas'}
                          </span>
                        </div>
                      )}
                      <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                        {isEditing ? (
                          <>
                            <button type="button" onClick={() => handleRename(room)} disabled={isBusy} title="Salvar"
                              style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:'1px solid #bbf7d0', background:'#f0fdf4', color:'#16a34a', cursor: isBusy ? 'default' : 'pointer' }}>
                              <Ic n="check" s={13} />
                            </button>
                            <button type="button" onClick={cancelEdit} disabled={isBusy} title="Cancelar"
                              style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#94a3b8', cursor: isBusy ? 'default' : 'pointer' }}>
                              <Ic n="x" s={13} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => startEdit(room)} disabled={isBusy} title="Renomear"
                              style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', cursor: isBusy ? 'default' : 'pointer' }}>
                              <Ic n="edit" s={12} />
                            </button>
                            <button type="button" onClick={() => empty && handleDelete(room)} disabled={isBusy || !empty}
                              title={empty ? 'Excluir' : 'Não é possível excluir — há passageiros nesta acomodação'}
                              style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:`1px solid ${empty ? '#fecaca' : '#e2e8f0'}`, background: empty ? '#fee2e2' : '#f8fafc', color: empty ? '#dc2626' : '#cbd5e1', cursor: isBusy || !empty ? 'default' : 'pointer' }}>
                              <Ic n="trash" s={12} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding:'0 22px 18px', display:'flex', justifyContent:'flex-end', flexShrink:0, borderTop:'1px solid #f1f5f9', paddingTop:14 }}>
          <button type="button" onClick={onClose}
            style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Painel de métricas — faixas etárias, acomodações e vagas para venda ── */
const AGE_ROWS = [
  { test: a => a >= 60,            label:'Acima de 60 anos'  },
  { test: a => a >= 12 && a < 60,  label:'Adultos 12-59 anos' },
  { test: a => a >= 2  && a < 12,  label:'Crianças 2-11 anos' },
  { test: a => a < 2,              label:'Crianças 0-23 meses'  },
]

/* Chip de métrica — título em cima, contagem em destaque embaixo (igual ao padrão dos dados da viagem, mas exibe zero) */
function MetricChip({ label, value }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, minWidth:90 }}>
      <span style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.05em', textAlign:'center' }}>{label}</span>
      <span style={{ fontSize:18, color:'#1e293b', fontWeight:700 }}>{value}</span>
    </div>
  )
}

function MetricsPanel({ enrolled, accomTypes }) {
  const ageCounts = AGE_ROWS.map(() => 0)
  enrolled.forEach(e => {
    if (e.is_block || !e.passenger_birth_date) return
    const age = calcAge(e.passenger_birth_date)
    const idx = AGE_ROWS.findIndex(r => r.test(age))
    if (idx >= 0) ageCounts[idx]++
  })

  // Quartos ocupados, agrupados por tipo de acomodação
  const roomNames = [...new Set(enrolled.filter(e => e.accommodation).map(e => e.accommodation))]
  const accomCounts = {}
  roomNames.forEach(name => {
    const label = findAccomType(accomTypes, name)?.name || 'Outro'
    if (label === 'Duplo Casal') return
    accomCounts[label] = (accomCounts[label] || 0) + 1
  })

  return (
    <div style={{ display:'flex', flexWrap:'nowrap', alignItems:'center', gap:28, overflowX:'auto', minWidth:0, background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:'12px 20px', boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
      {AGE_ROWS.map((r, i) => <MetricChip key={r.label} label={r.label} value={ageCounts[i]} />)}
      {Object.entries(accomCounts).map(([label, count]) => (
        <MetricChip key={label} label={`Apto. ${label}`} value={count} />
      ))}
      <MetricChip label="Total de acomodações" value={roomNames.length} />
      <MetricChip label="Total de passageiros" value={enrolled.length} />
    </div>
  )
}

/* ── Aba de Passageiros ── */
function PassengersTab({ listId, listType, defaultAirport, startDate, endDate, onData }) {
  const navigate = useNavigate()
  const [enrolled,   setEnrolled]   = useState([])
  const [accomTypes, setAccomTypes] = useState([])
  const [rooms,      setRooms]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [showAdd,    setShowAdd]    = useState(false)
  const [confirm,      setConfirm]      = useState(null)
  const [assignBlk,    setAssignBlk]    = useState(null)
  const [selected,      setSelected]      = useState(new Set())
  const [bulkSaving,    setBulkSaving]    = useState(false)
  // accomModal: null | { enrollmentIds: number[] }
  const [accomModal,    setAccomModal]    = useState(null)
  // editAccomType: null | roomName (string)
  const [editAccomType, setEditAccomType] = useState(null)
  const [collapsed,       setCollapsed]       = useState(new Set())
  const [accordionEnabled, setAccordionEnabled] = useState(false)
  // statusModal: null | enrollment (objeto) — popup para trocar status / observação de cancelamento
  const [statusModal,   setStatusModal]   = useState(null)
  // notesModal: null | enrollment (objeto) — popup "Observações" do menu de ações
  const [notesModal,    setNotesModal]    = useState(null)
  // actionsModal: null | enrollment (objeto) — popup "Ações do passageiro"
  const [actionsModal,  setActionsModal]  = useState(null)
  // roomsModal: bool — popup "Gerenciar acomodações"
  const [roomsModal,    setRoomsModal]    = useState(false)
  // deleteRoomModal: null | { roomId, roomName, occupants } — popup "excluir acomodação ocupada"
  const [deleteRoomModal, setDeleteRoomModal] = useState(null)
  // moveRoomModal: null | { roomId, roomName } — popup "mover passageiros individualmente"
  const [moveRoomModal,   setMoveRoomModal]   = useState(null)
  // boardingModal: null | enrollment (objeto) — popup "Local de embarque" do passageiro
  const [boardingModal,   setBoardingModal]   = useState(null)
  // ticketModal: null | enrollment — popup "Passagem aérea"
  const [ticketModal,     setTicketModal]     = useState(null)
  // agencyModal: null | enrollment — popup "Vincular agência"
  const [agencyModal,     setAgencyModal]     = useState(null)
  // quickEditModal: null | enrollment — popup "Edição rápida do passageiro"
  const [quickEditModal,  setQuickEditModal]  = useState(null)
  // filterSearch — filtro de pesquisa na tabela de passageiros
  const [filterSearch,    setFilterSearch]    = useState('')

  const firstLoad = useRef(true)

  const load = useCallback(() => {
    setLoading(true)
    listsApi.listPassengers(listId)
      .then(r => {
        setEnrolled(r.data)
        if (firstLoad.current) {
          firstLoad.current = false
          const keys = r.data.map(e => e.enrollment_status === 'cancelado' ? '(cancelados)' : (e.accommodation || '(sem acomodação)'))
          setCollapsed(new Set(keys))
        }
      })
      .catch(() => toast.error('Erro ao carregar passageiros.'))
      .finally(() => setLoading(false))
  }, [listId])

  const loadRooms = useCallback(() => {
    listsApi.listRooms(listId).then(r => setRooms(r.data)).catch(() => {})
  }, [listId])

  useEffect(() => { load(); loadRooms() }, [load, loadRooms])
  useEffect(() => {
    configApi.accommodations().then(r => setAccomTypes(r.data.results ?? r.data)).catch(() => {})
  }, [])

  // Repassa os dados ao componente pai — exibidos no painel de métricas, acima das abas
  // (cancelados não contam mais como vaga ocupada nem entram nas métricas)
  useEffect(() => {
    onData?.({ enrolled: enrolled.filter(e => e.enrollment_status !== 'cancelado'), accomTypes, loading })
  }, [enrolled, accomTypes, loading, onData])

  const toggleSelect  = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll     = ()   => setSelected(s => s.size === enrolled.length ? new Set() : new Set(enrolled.map(e => e.id)))
  const clearSelect   = ()   => setSelected(new Set())

  const toggleGroup = (key) => {
    if (!accordionEnabled) return
    setCollapsed(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }
  const toggleGroupSelect = (rows) => setSelected(s => {
    const n = new Set(s)
    const allIn = rows.every(r => n.has(r.id))
    rows.forEach(r => allIn ? n.delete(r.id) : n.add(r.id))
    return n
  })

  const bulkDelete = async () => {
    setBulkSaving(true)
    try {
      await Promise.all([...selected].map(eid => listsApi.removePassenger(listId, eid)))
      toast.success(`${selected.size} removido${selected.size > 1 ? 's' : ''}.`)
      clearSelect(); load()
    } catch { toast.error('Erro ao remover selecionados.') }
    finally { setBulkSaving(false) }
  }

  const remove = async (eid, name) => {
    await listsApi.removePassenger(listId, eid).catch(() => toast.error('Erro ao remover.'))
    setConfirm(null)
    toast.success(`${name} removido.`)
    load()
  }

  // Callback unificado: vincula os enrollmentIds à acomodação escolhida
  const handleAccomConfirm = async (room) => {
    const ids = accomModal.enrollmentIds
    await Promise.all(ids.map(eid => listsApi.updatePassenger(listId, eid, { accommodation: room })))
    const n = ids.length
    toast.success(n > 1 ? `${n} passageiros vinculados a ${room}.` : `Vinculado a ${room}.`)
    setAccomModal(null)
    clearSelect()
    load()
  }

  const handleDeleteRoom = (roomId, roomName) => {
    const occupants = enrolled.filter(e => e.accommodation === roomName)
    if (occupants.length === 0) {
      doDeleteRoom(roomId, roomName)
    } else {
      setDeleteRoomModal({ roomId, roomName, occupants })
    }
  }

  const doDeleteRoom = async (roomId, roomName, resolution) => {
    try {
      await listsApi.removeRoom(listId, roomId, resolution)
      toast.success(`Acomodação "${roomName}" removida.`)
      setDeleteRoomModal(null)
      load(); loadRooms()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Erro ao remover acomodação.')
    }
  }

  const handleEnrollmentStatus = async (enrollment, status, note) => {
    const statusChanged = status !== enrollment.enrollment_status
    const reactivating  = statusChanged && enrollment.enrollment_status === 'cancelado' && status !== 'cancelado'
    const payload = { enrollment_status: status }
    if (status === 'cancelado') payload.notes = note
    // Ao reativar quem estava cancelado, a acomodação anterior é liberada —
    // a pessoa volta para "Aguardando acomodação" para ser realocada manualmente
    if (reactivating) payload.accommodation = ''
    await listsApi.updatePassenger(listId, enrollment.id, payload)
      .then(() => {
        if (!statusChanged) toast.success('Observação atualizada.')
        else if (status === 'cancelado') toast.success('Passageiro movido para Cancelados.')
        else if (reactivating) toast.success('Passageiro reativado — aguardando nova acomodação.')
        else toast.success('Status atualizado.')
      })
      .catch(() => toast.error('Erro ao atualizar status.'))
    load()
  }

  // Roteia as ações do popup "Ações do passageiro" — algumas reaproveitam popups já existentes
  const handlePassengerAction = (action, enrollment) => {
    setActionsModal(null)
    switch (action) {
      case 'quick_edit':
        if (enrollment.passenger) setQuickEditModal(enrollment)
        break
      case 'edit':
        if (enrollment.passenger) {
          // Sempre abrir na aba "Informações do cliente" — a aba persistida pode estar em "Documentos"
          try { localStorage.setItem('tab_passenger_detail', 'info') } catch { /* localStorage indisponível — segue normalmente */ }
          navigate(`/passageiros/${enrollment.passenger}`)
        }
        break
      case 'notes':
        setNotesModal(enrollment)
        break
      case 'boarding':
        setBoardingModal(enrollment)
        break
      case 'swap_room':
        setAccomModal({ enrollmentIds: [enrollment.id] })
        break
      case 'link_client':
        setAssignBlk(enrollment)
        break
      case 'link_agency':
        setAgencyModal(enrollment)
        break
      case 'delete':
        setConfirm({ id: enrollment.id, name: enrollment.passenger_name || enrollment.block_agency })
        break
      default:
        break
    }
  }

  // Cancelados ficam separados — pendentes de devolução de valores
  const CANCELLED = '(cancelados)'
  const filterQ = filterSearch.toLowerCase().trim()
  const matchesFilter = e =>
    !filterQ ||
    (e.passenger_name || '').toLowerCase().includes(filterQ) ||
    (e.block_agency   || '').toLowerCase().includes(filterQ)
  const activeEnrolled    = enrolled.filter(e => e.enrollment_status !== 'cancelado' && matchesFilter(e))
  const cancelledEnrolled = enrolled.filter(e => e.enrollment_status === 'cancelado'  && matchesFilter(e))

  // Agrupar por acomodação — sem acomodação sempre no topo
  const UNASSIGNED = '(sem acomodação)'
  const seen = {}
  const groups = []
  const roomIdByName = {}
  rooms.forEach(room => { roomIdByName[room.name] = room.id })
  activeEnrolled.forEach(e => {
    const key = e.accommodation || UNASSIGNED
    if (!seen[key]) { seen[key] = []; groups.push({ key, rows: seen[key] }) }
    seen[key].push(e)
  })
  // Acomodações vazias — só aparecem quando não há filtro ativo
  if (!filterQ) {
    rooms.forEach(room => {
      if (!seen[room.name]) { seen[room.name] = []; groups.push({ key: room.name, rows: seen[room.name], roomId: room.id }) }
    })
  }
  groups.sort((a, b) => a.key === UNASSIGNED ? -1 : b.key === UNASSIGNED ? 1 : 0)
  // Com filtro ativo, esconde grupos sem passageiro correspondente
  if (filterQ) groups.splice(0, groups.length, ...groups.filter(g => g.rows.length > 0))
  if (cancelledEnrolled.length > 0) groups.push({ key: CANCELLED, rows: cancelledEnrolled })

  // Número sequencial global — cancelados não entram na contagem
  let seq = 0
  const seqMap = {}
  activeEnrolled.forEach(e => { seq++; seqMap[e.id] = seq })

  const isAereo = listType === 'aereo'

  const allSelected = enrolled.length > 0 && selected.size === enrolled.length

  return (
    <div>
      {/* Link de log — acima da toolbar, alinhado à direita */}
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
        <button type="button" onClick={() => navigate(`/log?list_id=${listId}`)}
          style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:7, border:'1px solid #e2e8f0', background:'#f8fafc', color:'#64748b', fontSize:12, fontWeight:500, cursor:'pointer', fontFamily:'inherit', transition:'all .12s' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor='#1a2d4f'; e.currentTarget.style.color='#1a2d4f'; e.currentTarget.style.background='#f1f5f9' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.color='#64748b'; e.currentTarget.style.background='#f8fafc' }}>
          📋 Log da lista
        </button>
      </div>

      {/* Toolbar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: selected.size > 0 ? 8 : 16 }}>
        {/* Campo de pesquisa — esquerda */}
        <div style={{ position:'relative', flexShrink:0 }}>
          <span style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:'#94a3b8', fontSize:13, pointerEvents:'none', lineHeight:1 }}>⌕</span>
          <input
            value={filterSearch}
            onChange={e => setFilterSearch(e.target.value)}
            placeholder="Pesquisar passageiro…"
            style={{ paddingLeft:28, paddingRight: filterSearch ? 26 : 10, height:34, border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b', width:230, background:'#fff', boxSizing:'border-box', transition:'border-color .12s' }}
            onFocus={e => e.target.style.borderColor='#1a2d4f'}
            onBlur={e => e.target.style.borderColor='#e2e8f0'}
          />
          {filterSearch && (
            <button onClick={() => setFilterSearch('')}
              style={{ position:'absolute', right:7, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:16, padding:0, lineHeight:1 }}>×</button>
          )}
        </div>
        <span style={{ fontSize:13, fontWeight:500, color: filterQ ? '#1a2d4f' : '#94a3b8', marginLeft:10, flexShrink:0 }}>
          {filterQ
            ? `${activeEnrolled.length + cancelledEnrolled.length} resultado${activeEnrolled.length + cancelledEnrolled.length !== 1 ? 's' : ''}`
            : `${activeEnrolled.length} passageiro${activeEnrolled.length !== 1 ? 's' : ''}${cancelledEnrolled.length > 0 ? ` · ${cancelledEnrolled.length} cancelado${cancelledEnrolled.length !== 1 ? 's' : ''}` : ''}`
          }
        </span>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {/* Toggle sanfona — habilita/desabilita recolher grupos */}
          <button type="button"
            title={accordionEnabled ? 'Desativar sanfona (manter tudo aberto)' : 'Ativar sanfona (permite recolher seções)'}
            onClick={() => { setAccordionEnabled(v => !v); if (accordionEnabled) setCollapsed(new Set()) }}
            style={{ width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:8, border:`1.5px solid ${accordionEnabled ? '#1a2d4f' : '#e2e8f0'}`, background: accordionEnabled ? '#1a2d4f' : '#fff', color: accordionEnabled ? '#fff' : '#cbd5e1', cursor:'pointer', fontSize:13, transition:'all .14s', flexShrink:0 }}
            onMouseEnter={e => { if (!accordionEnabled) { e.currentTarget.style.borderColor='#94a3b8'; e.currentTarget.style.color='#475569' } }}
            onMouseLeave={e => { if (!accordionEnabled) { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.color='#cbd5e1' } }}>
            ▾
          </button>
          <button type="button" onClick={() => setRoomsModal(true)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#1a2d4f', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            🛏 Gerenciar acomodações
          </button>
          <button type="button" onClick={() => setShowAdd(true)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            + Adicionar passageiro
          </button>
        </div>
      </div>

      {/* Barra de ações em massa */}
      {selected.size > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', marginBottom:12, background:'#eff6ff', border:'1.5px solid #bfdbfe', borderRadius:10 }}>
          <span style={{ fontSize:13, fontWeight:700, color:'#1d4ed8', flex:1 }}>
            {selected.size} selecionado{selected.size > 1 ? 's' : ''}
          </span>
          <button type="button"
            onClick={() => setAccomModal({ enrollmentIds: [...selected] })}
            disabled={bulkSaving}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            🛏 Adicionar à acomodação
          </button>
          <button type="button" onClick={bulkDelete} disabled={bulkSaving}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:7, border:'1.5px solid #fecaca', background:'#fee2e2', color:'#dc2626', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            <Ic n="trash" s={12} /> Apagar selecionados
          </button>
          <button type="button" onClick={clearSelect}
            style={{ padding:'6px 12px', borderRadius:7, border:'1px solid #e2e8f0', background:'#fff', color:'#64748b', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign:'center', padding:'48px 0', color:'#94a3b8' }}>Carregando…</div>
      ) : enrolled.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 0' }}>
          <p style={{ fontSize:36, marginBottom:8 }}>👥</p>
          <p style={{ color:'#94a3b8', fontSize:14, fontWeight:500 }}>Nenhum passageiro na lista.</p>
          <p style={{ color:'#cbd5e1', fontSize:12 }}>Clique em "+ Adicionar passageiro" para começar.</p>
        </div>
      ) : (
        <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,.05)' }}>
          {/* Cabeçalho da tabela */}
          <div style={{ display:'grid', gridTemplateColumns: isAereo ? '32px 36px 22px 26px 56px 1fr 90px 46px 36px 105px 96px 90px 90px' : '32px 36px 22px 26px 1fr 90px 46px 36px 105px 96px 90px 90px', columnGap:6, padding:'8px 10px', background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }}>
            {/* Checkbox select-all */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll}
                style={{ width:15, height:15, cursor:'pointer', accentColor:'#1a2d4f' }} />
            </div>
            {[
              {h:'Nº',        align:'center'},
              {h:'●',         align:'center'},
              {h:isAereo?'✈':'', align:'center'},
              ...(isAereo ? [{h:'Emb.', align:'center'}] : []),
              {h:'Passageiro',align:'left'},
              {h:'Nasc.',     align:'center'},
              {h:'Nac.',      align:'center'},
              {h:'Gên.',      align:'center'},
              {h:'Passaporte',align:'center'},
              {h:'CPF',       align:'center'},
              {h:'Agência',   align:'left'},
              {h:'Ações',     align:'center'},
            ].map(({h, align}, i) => (
              <span key={i} style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.05em', textAlign: align }}>{h}</span>
            ))}
          </div>

          {/* Grupos por acomodação */}
          {groups.map(({ key, rows }) => {
            const isUnassigned = key === UNASSIGNED
            const isCancelled  = key === CANCELLED
            // Validação de capacidade — detecta tipo pelo prefixo (ex: "Duplo 2" → tipo "Duplo")
            const accomType = (!isUnassigned && !isCancelled)
              ? findAccomType(accomTypes, key)
              : null
            const paxCount  = rows.length
            const capacity  = accomType?.capacity
            const capStatus = !accomType ? null
              : paxCount > capacity  ? 'over'
              : paxCount < capacity  ? 'under'
              : 'ok'
            // Alerta de casal: is_couple + 2 ou mais ocupantes reais do mesmo sexo
            const genders = rows.filter(e => !e.is_block && e.passenger_gender).map(e => e.passenger_gender)
            const sameSexCouple = accomType?.is_couple && genders.length >= 2
              && genders.every(g => g === genders[0])
            const isCollapsed   = accordionEnabled && !filterQ && collapsed.has(key)
            const groupAllSel   = rows.length > 0 && rows.every(r => selected.has(r.id))
            return (
            <div key={key}>
              {/* Header do grupo */}
              <div onClick={() => toggleGroup(key)}
                title={accordionEnabled ? (isCollapsed ? 'Expandir' : 'Recolher') : undefined}
                style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px',
                cursor: accordionEnabled ? 'pointer' : 'default',
                background: isCancelled ? '#fef2f2' : isUnassigned ? '#fffbeb' : '#dde6f5',
                borderBottom: `1px solid ${isCancelled ? '#fecaca' : isUnassigned ? '#fde68a' : '#b8cce8'}`,
                borderTop:    `1px solid ${isCancelled ? '#fecaca' : isUnassigned ? '#fde68a' : '#b8cce8'}`,
                borderLeft:   isCancelled ? '4px solid #ef4444' : isUnassigned ? '4px solid #f59e0b' : '4px solid #1a2d4f',
              }}>
                {/* Expandir/recolher grupo — só visível quando accordion habilitado */}
                <button type="button" onClick={(ev) => { ev.stopPropagation(); toggleGroup(key) }}
                  title={isCollapsed ? 'Expandir' : 'Recolher'}
                  style={{ width:22, height:22, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:5, border:'none', background:'transparent', color: accordionEnabled ? '#64748b' : '#cbd5e1', cursor: accordionEnabled ? 'pointer' : 'default', fontSize:11, flexShrink:0, transition:'transform .15s', transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}
                  onMouseEnter={ev => { if (accordionEnabled) ev.currentTarget.style.color='#1a2d4f' }}
                  onMouseLeave={ev => ev.currentTarget.style.color = accordionEnabled ? '#64748b' : '#cbd5e1'}>
                  ▾
                </button>

                {/* Selecionar todos do setor */}
                <input type="checkbox" checked={groupAllSel} onChange={() => toggleGroupSelect(rows)}
                  onClick={ev => ev.stopPropagation()}
                  title="Selecionar todos deste setor"
                  style={{ width:15, height:15, cursor:'pointer', accentColor:'#1a2d4f', flexShrink:0 }} />

                {isCancelled ? (
                  <>
                    <span style={{ fontSize:14 }}>🚫</span>
                    <span style={{ fontSize:12, fontWeight:700, color:'#b91c1c', letterSpacing:'.03em' }}>
                      Cancelados
                    </span>
                    <span style={{ fontSize:11, background:'#fecaca', color:'#7f1d1d', padding:'1px 7px', borderRadius:20, fontWeight:700 }}>
                      {rows.length} pax
                    </span>
                    <span style={{ fontSize:11, color:'#b91c1c', fontStyle:'italic' }}>
                      Pendentes de devolução de valores
                    </span>
                  </>
                ) : isUnassigned ? (
                  <>
                    <span style={{ fontSize:14 }}>⏳</span>
                    <span style={{ fontSize:12, fontWeight:700, color:'#92400e', letterSpacing:'.03em' }}>
                      Aguardando acomodação
                    </span>
                    <span style={{ fontSize:11, background:'#fde68a', color:'#78350f', padding:'1px 7px', borderRadius:20, fontWeight:700 }}>
                      {rows.length} pax
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize:13, fontWeight:700, color:'#1a2d4f', letterSpacing:'.02em' }}>{key}</span>
                    <span style={{ fontSize:11, fontWeight:600, color:'#fff', background:'#1a2d4f', padding:'1px 8px', borderRadius:20 }}>{rows.length} pax</span>

                    {/* Flag de capacidade */}
                    {capStatus === 'over' && (
                      <span title={`Capacidade: ${capacity} pessoa${capacity!==1?'s':''}. Quarto superlotado!`}
                        style={{ fontSize:11, fontWeight:700, background:'#fee2e2', color:'#dc2626', padding:'2px 8px', borderRadius:20, display:'flex', alignItems:'center', gap:3 }}>
                        ⚠ Superlotado ({paxCount}/{capacity})
                      </span>
                    )}
                    {capStatus === 'under' && (
                      <span title={`Capacidade: ${capacity} pessoa${capacity!==1?'s':''}. Há vagas disponíveis.`}
                        style={{ fontSize:11, fontWeight:600, background:'#fef9c3', color:'#854d0e', padding:'2px 8px', borderRadius:20, display:'flex', alignItems:'center', gap:3 }}>
                        ○ {capacity - paxCount} vaga{(capacity-paxCount)!==1?'s':''} disponível{(capacity-paxCount)!==1?'is':''}
                      </span>
                    )}
                    {capStatus === 'ok' && (
                      <span style={{ fontSize:11, color:'#16a34a', fontWeight:600 }}>✓</span>
                    )}
                    {accomType?.is_couple && (
                      <span style={{ fontSize:10, color:'#7c3aed', background:'#ede9fe', padding:'1px 7px', borderRadius:20, fontWeight:600 }}>
                        casal
                      </span>
                    )}
                    {sameSexCouple && (
                      <span title="Acomodação de casal com dois passageiros do mesmo sexo"
                        style={{ fontSize:11, fontWeight:700, background:'#fef9c3', color:'#92400e', padding:'2px 8px', borderRadius:20, display:'flex', alignItems:'center', gap:3 }}>
                        ⚠ Mesmo sexo
                      </span>
                    )}

                    <button type="button"
                      onClick={(ev) => { ev.stopPropagation(); setEditAccomType(key) }}
                      title="Editar tipo da acomodação"
                      style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:13, padding:0, lineHeight:1 }}
                      onMouseEnter={e => e.currentTarget.style.color='#1a2d4f'}
                      onMouseLeave={e => e.currentTarget.style.color='#94a3b8'}>
                      <Ic n="edit" s={13} />
                    </button>

                    {roomIdByName[key] != null && (
                      <button type="button"
                        onClick={(ev) => { ev.stopPropagation(); handleDeleteRoom(roomIdByName[key], key) }}
                        title="Excluir acomodação"
                        style={{ marginLeft:'auto', width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:'none', background:'transparent', color:'#cbd5e1', cursor:'pointer', flexShrink:0 }}
                        onMouseEnter={e => e.currentTarget.style.color='#dc2626'}
                        onMouseLeave={e => e.currentTarget.style.color='#cbd5e1'}>
                        <Ic n="trash" s={13} />
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Linhas dos passageiros */}
              {!isCollapsed && rows.map((e, ri) => {
                const nat = (e.passenger_nationality || '').slice(0,3).toUpperCase() || '—'
                const gen = e.passenger_gender ? e.passenger_gender[0].toUpperCase() : '—'
                const passports = e.passenger_passports || []
                const cpf = e.passenger_cpf || '—'
                const birth = e.passenger_birth_date ? fmt(e.passenger_birth_date) : '—'
                const bday  = !e.is_block ? getBirthdayInTrip(e.passenger_birth_date, startDate, endDate) : null
                const copy = (text) => {
                  if (!text || text === '—') return
                  navigator.clipboard.writeText(String(text))
                  toast.success('Copiado!', { id: 'cp', duration: 1000 })
                }

                return (
                  <div key={e.id}
                    style={{ display:'grid', gridTemplateColumns: isAereo ? '32px 36px 22px 26px 56px 1fr 90px 46px 36px 105px 96px 90px 90px' : '32px 36px 22px 26px 1fr 90px 46px 36px 105px 96px 90px 90px', columnGap:6, padding:'8px 10px', borderBottom: ri < rows.length-1 ? '1px solid #f8fafc' : 'none', background: selected.has(e.id) ? '#eff6ff' : ri%2===0 ? '#fff' : '#fafbfc', alignItems:'center' }}
                    onMouseEnter={ev => ev.currentTarget.style.background='#f0f7ff'}
                    onMouseLeave={ev => ev.currentTarget.style.background = ri%2===0 ? '#fff' : '#fafbfc'}>

                    {/* Checkbox */}
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelect(e.id)}
                        style={{ width:15, height:15, cursor:'pointer', accentColor:'#1a2d4f' }} />
                    </div>

                    {/* Nº */}
                    <span style={{ textAlign:'center', fontSize:13, fontWeight:600, color:'#94a3b8' }}>{seqMap[e.id] ?? '—'}</span>

                    {/* Status — clique abre popup com Confirmado / Pendente / Cancelado */}
                    <EnrollmentStatusDot value={e.enrollment_status} onClick={() => setStatusModal(e)} />

                    {/* ✈ passagem — clicável em listas aéreas */}
                    {isAereo ? (() => {
                      const hasConnAirport = !e.is_block && e.departure_airport_data && defaultAirport && e.departure_airport_data.id !== defaultAirport.id
                      const mkBtn = (ticketStatus) => {
                        const ts = ticketStatus || 'nao_emitida'
                        const tColor = ts === 'nao_emitida' ? '#cbd5e1' : ts === 'via_bloqueio' ? '#f59e0b' : 'rgb(147,66,171)'
                        const c = ts === 'nao_emitida' ? '148,163,184' : ts === 'via_bloqueio' ? '245,158,11' : '147,66,171'
                        const a = ts === 'nao_emitida' ? '.22' : '.38'
                        const tGrad = `radial-gradient(circle at center, rgba(${c},${a}) 0%, rgba(${c},.08) 60%, rgba(${c},0) 100%)`
                        return (
                          <button type="button" onClick={() => setTicketModal(e)}
                            style={{ display:'flex', alignItems:'center', justifyContent:'center', width:20, height:20, borderRadius:'50%', background:tGrad, border:'none', cursor:'pointer', padding:0, flexShrink:0 }}>
                            <span style={{ fontSize:11, lineHeight:1, color:tColor }}>✈</span>
                          </button>
                        )
                      }
                      return (
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:2 }}>
                          {mkBtn(e.ticket_status)}
                          {hasConnAirport && mkBtn(e.connection_ticket_status)}
                        </div>
                      )
                    })() : <span style={{ fontSize:14, textAlign:'center' }}>🚌</span>
                    }

                    {/* Embarque — aeroporto de saída, logo antes do nome */}
                    {isAereo && (() => {
                      const ap = e.departure_airport_data || defaultAirport
                      const isIndividual = !!e.departure_airport_data
                      const code = ap?.iata_code || (ap?.name?.slice(0,3).toUpperCase())
                      return (
                        <span title={ap ? `${ap.name}${ap.city ? ' — ' + ap.city : ''}${isIndividual ? ' (embarque individual)' : ' (padrão da lista)'}` : 'Não definido'}
                          style={{ display:'flex', justifyContent:'center', flexShrink:0 }}>
                          {ap ? (
                            <span style={{
                              fontSize:11, fontWeight:700, fontFamily:'monospace', letterSpacing:'.03em',
                              padding:'2px 7px', borderRadius:5,
                              color:      isIndividual ? '#92400e' : '#64748b',
                              background: isIndividual ? '#fef3c7' : '#f1f5f9',
                              border:     isIndividual ? '1.5px solid #f59e0b' : '1px solid transparent',
                              boxShadow:  isIndividual ? '0 0 0 2px #fde68a55' : 'none',
                            }}>
                              {code}
                            </span>
                          ) : (
                            <span style={{ fontSize:11, color:'#cbd5e1' }}>—</span>
                          )}
                        </span>
                      )
                    })()}

                    {/* Nome / Bloqueio */}
                    <div style={{ minWidth:0 }}>
                      {e.is_block ? (
                        <div style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}
                          onClick={() => setAssignBlk(e)}>
                          {e.is_provisional ? (
                            <>
                              <span style={{ fontSize:14, fontWeight:600, color:'#1e293b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.block_agency}</span>
                              <span title="Passageiro não cadastrado — clique para vincular" style={{ fontSize:11, fontWeight:700, background:'#fef3c7', color:'#92400e', padding:'1px 6px', borderRadius:4, flexShrink:0, cursor:'pointer' }}>⚠ vincular</span>
                            </>
                          ) : (
                            <>
                              <span style={{ fontSize:11, fontWeight:700, background:'#fef3c7', color:'#92400e', padding:'1px 6px', borderRadius:4, flexShrink:0 }}>VAGA</span>
                              <span style={{ fontSize:13, color:'#78350f', fontStyle:'italic' }}>Clique para atribuir passageiro</span>
                            </>
                          )}
                        </div>
                      ) : (
                        <>
                          <p onClick={() => copy(e.passenger_name)} title="Clique para copiar"
                            style={{ margin:0, fontSize:14, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', cursor:'pointer',
                              color:     e.enrollment_status === 'pendente' ? '#92400e' : '#1e293b',
                              fontStyle: e.enrollment_status === 'pendente' ? 'italic'  : 'normal',
                            }}>
                            {e.passenger_name}
                          </p>
                          {isCancelled && e.notes && (
                            <p title={e.notes} style={{ margin:'2px 0 0', fontSize:12, color:'#b91c1c', fontStyle:'italic', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              💬 {e.notes}
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    {/* Nasc. */}
                    {bday ? (
                      <span onClick={() => copy(birth)} title="Aniversário durante a viagem — clique para copiar"
                        style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:4, cursor:'pointer' }}>
                        <span style={{ width:6, height:6, borderRadius:'50%', background:'#ec4899', flexShrink:0 }}/>
                        <span style={{ fontSize:14, fontWeight:600, color:'#be185d' }}>{birth}</span>
                        <span style={{ width:6, height:6, borderRadius:'50%', background:'#ec4899', flexShrink:0 }}/>
                      </span>
                    ) : (
                      <span onClick={() => copy(birth)} title="Clique para copiar"
                        style={{ fontSize:13, color:'#64748b', textAlign:'center', display:'block', cursor: e.is_block ? 'default' : 'pointer' }}>{e.is_block ? '—' : birth}</span>
                    )}

                    {/* Nac. */}
                    <div style={{ display:'flex', justifyContent:'center' }}>
                      {e.is_block
                        ? <span style={{ fontSize:12, color:'#cbd5e1' }}>—</span>
                        : <span onClick={() => copy(e.passenger_nationality)} title="Clique para copiar"
                            style={{ fontSize:12, fontWeight:600, color:'#475569', background:'#f1f5f9', padding:'2px 6px', borderRadius:4, cursor:'pointer' }}>{nat}</span>
                      }
                    </div>

                    {/* Gênero */}
                    <span onClick={() => copy(e.passenger_gender)} title="Clique para copiar"
                      style={{ fontSize:13, color:'#64748b', textAlign:'center', display:'block', cursor: e.is_block ? 'default' : 'pointer' }}>{e.is_block ? '—' : gen}</span>

                    {/* Passaporte(s) — número + sigla do país, até 2 */}
                    <span style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1, overflow:'hidden' }}>
                      {e.is_block || passports.length === 0 ? (
                        <span style={{ fontSize:13, color:'#475569' }}>—</span>
                      ) : passports.map((p, pi) => (
                        <span key={pi} onClick={() => copy(p.number)} title="Clique para copiar"
                          style={{ fontSize:12.5, color:'#475569', fontFamily:'monospace', display:'flex', alignItems:'center', gap:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'100%', cursor:'pointer' }}>
                          {p.number}
                          {p.country && (
                            <span style={{ fontSize:10, fontWeight:700, color:'#2e6db4', background:'#eff6ff', border:'1px solid #dbeafe', borderRadius:4, padding:'1px 4px', letterSpacing:'.03em', flexShrink:0 }}>{p.country.toUpperCase()}</span>
                          )}
                        </span>
                      ))}
                    </span>

                    {/* CPF */}
                    <span onClick={() => copy(e.passenger_cpf)} title="Clique para copiar"
                      style={{ fontSize:13, color:'#475569', fontFamily:'monospace', textAlign:'center', display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', cursor: e.is_block ? 'default' : 'pointer' }}>{e.is_block ? '—' : cpf}</span>

                    {/* Agência */}
                    <span onClick={() => copy(e.agency_name)} title="Clique para copiar"
                      style={{ fontSize:12, color:'#475569', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', cursor:'pointer' }}>
                      {(e.is_provisional && !e.agency) ? '—' : (e.agency_name || '—')}
                    </span>

                    {/* Ações */}
                    <div style={{ display:'flex', gap:3, justifyContent:'center' }}>
                      {/* Editar / mais ações — abre popup com todas as opções do passageiro */}
                      <PassengerActionsButton onClick={() => setActionsModal(e)} />
                      {/* Atribuir passageiro — só em bloqueios */}
                      {e.is_block && (
                        <button type="button"
                          onClick={() => setAssignBlk(e)}
                          title="Atribuir passageiro ao bloco"
                          style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:'1.5px solid #f59e0b', background:'#fffbeb', color:'#92400e', fontSize:13, cursor:'pointer' }}
                          onMouseEnter={ev => ev.currentTarget.style.background='#fde68a'}
                          onMouseLeave={ev => ev.currentTarget.style.background='#fffbeb'}>
                          <Ic n="users" s={12} />
                        </button>
                      )}
                      {/* Acomodação — só aparece enquanto o passageiro ainda não tem quarto;
                          depois de acomodado, a troca passa a ser feita por "Trocar de quarto" no popup de ações */}
                      {isUnassigned && (
                        <button type="button"
                          onClick={() => setAccomModal({ enrollmentIds: [e.id] })}
                          title="Adicionar à acomodação"
                          style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:'1.5px solid #f59e0b', background:'#fffbeb', color:'#92400e', fontSize:11, cursor:'pointer' }}
                          onMouseEnter={ev => { ev.currentTarget.style.borderColor='#1a2d4f'; ev.currentTarget.style.color='#1a2d4f'; ev.currentTarget.style.background='#fde68a' }}
                          onMouseLeave={ev => { ev.currentTarget.style.borderColor='#f59e0b'; ev.currentTarget.style.color='#92400e'; ev.currentTarget.style.background='#fffbeb' }}>
                          🛏
                        </button>
                      )}
                      <button type="button"
                        onClick={() => setConfirm({ id:e.id, name: e.passenger_name || e.block_agency })}
                        title="Remover"
                        style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#94a3b8', cursor:'pointer' }}
                        onMouseEnter={ev => { ev.currentTarget.style.background='#fee2e2'; ev.currentTarget.style.color='#dc2626'; ev.currentTarget.style.borderColor='#fecaca' }}
                        onMouseLeave={ev => { ev.currentTarget.style.background='#fff'; ev.currentTarget.style.color='#94a3b8'; ev.currentTarget.style.borderColor='#e2e8f0' }}>
                        <Ic n="trash" s={12} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )})}
        </div>
      )}

      {/* Modal de acomodação — reutilizado para massa e individual */}
      {accomModal && (
        <AccomPickerModal
          enrollmentIds={accomModal.enrollmentIds}
          enrolled={enrolled}
          accomTypes={accomTypes}
          rooms={rooms}
          onConfirm={handleAccomConfirm}
          onClose={() => setAccomModal(null)}
        />
      )}

      {/* Popup "Ações do passageiro" — lista as 13 opções, abre os demais popups */}
      {actionsModal && (
        <PassengerActionsModal
          enrollment={actionsModal}
          onAction={(action) => handlePassengerAction(action, actionsModal)}
          onClose={() => setActionsModal(null)}
        />
      )}

      {/* Popup Observações — acessado pelo menu de ações do passageiro */}
      {notesModal && (
        <PassengerNotesModal
          enrollment={notesModal}
          listId={listId}
          onSaved={load}
          onClose={() => setNotesModal(null)}
        />
      )}

      {/* Popup passagem aérea */}
      {ticketModal && (
        <TicketModal
          enrollment={ticketModal}
          listId={listId}
          defaultAirport={defaultAirport}
          onSaved={load}
          onClose={() => setTicketModal(null)}
        />
      )}

      {/* Popup Vincular agência */}
      {agencyModal && (
        <LinkAgencyPopup
          enrollment={agencyModal}
          listId={listId}
          onSaved={load}
          onClose={() => setAgencyModal(null)}
        />
      )}

      {/* Popup Local de embarque — define aeroporto de saída individual */}
      {boardingModal && (
        <BoardingModal
          enrollment={boardingModal}
          listId={listId}
          defaultAirport={defaultAirport}
          onSaved={load}
          onClose={() => setBoardingModal(null)}
        />
      )}

      {/* Popup Edição rápida do passageiro */}
      {quickEditModal && (
        <QuickEditModal
          enrollment={quickEditModal}
          listId={listId}
          startDate={startDate}
          onSaved={load}
          onClose={() => setQuickEditModal(null)}
        />
      )}

      {/* Popup trocar status do passageiro / observação de cancelamento */}
      {statusModal && (
        <EnrollmentStatusModal
          enrollment={statusModal}
          onSave={(status, note) => handleEnrollmentStatus(statusModal, status, note)}
          onClose={() => setStatusModal(null)}
        />
      )}

      {/* Modal editar tipo da acomodação */}
      {editAccomType && (
        <EditAccomTypeModal
          roomName={editAccomType}
          accomTypes={accomTypes}
          enrolled={enrolled}
          listId={listId}
          onSaved={load}
          onDelete={roomIdByName[editAccomType] != null ? () => handleDeleteRoom(roomIdByName[editAccomType], editAccomType) : null}
          onClose={() => setEditAccomType(null)}
        />
      )}

      {/* Modal gerenciar acomodações da lista */}
      {roomsModal && (
        <ManageRoomsModal
          listId={listId}
          accomTypes={accomTypes}
          onChanged={() => { load(); loadRooms() }}
          onClose={() => setRoomsModal(false)}
        />
      )}

      {/* Popup atribuir passageiro a bloco */}
      {assignBlk && (
        <AssignPassengerPopup
          enrollment={assignBlk}
          listId={listId}
          enrolled={enrolled}
          onSaved={load}
          onClose={() => setAssignBlk(null)}
        />
      )}

      {/* Popup adicionar */}
      {showAdd && (
        <AddPassengerPopup
          listId={listId}
          enrolled={enrolled}
          rooms={rooms}
          onAdded={() => { load(); loadRooms() }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {confirm && (
        <ConfirmModal
          message={`Remover ${confirm.name} da lista?`}
          onOk={() => remove(confirm.id, confirm.name)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {deleteRoomModal && (
        <DeleteOccupiedRoomModal
          roomName={deleteRoomModal.roomName}
          occupants={deleteRoomModal.occupants}
          onConfirm={(resolution) => {
            if (resolution === 'move') {
              const { roomId, roomName } = deleteRoomModal
              setDeleteRoomModal(null)
              setMoveRoomModal({ roomId, roomName })
              return Promise.resolve()
            }
            return doDeleteRoom(deleteRoomModal.roomId, deleteRoomModal.roomName, resolution)
          }}
          onClose={() => setDeleteRoomModal(null)}
        />
      )}

      {moveRoomModal && (
        <MovePassengersModal
          roomId={moveRoomModal.roomId}
          roomName={moveRoomModal.roomName}
          listId={listId}
          enrolled={enrolled}
          accomTypes={accomTypes}
          rooms={rooms}
          onMoved={() => { load(); loadRooms() }}
          onDeleteRoom={() => { doDeleteRoom(moveRoomModal.roomId, moveRoomModal.roomName); setMoveRoomModal(null) }}
          onClose={() => setMoveRoomModal(null)}
        />
      )}
    </div>
  )
}

/* ── Aba de Voos ── */
function FlightsTab({ listId, list }) {
  const [enrolled, setEnrolled] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [filterQ,  setFilterQ]  = useState('')

  const defAirport = list.default_airport_data || null

  const loadAll = useCallback(() => {
    setLoading(true)
    listsApi.listPassengers(listId)
      .then(r => setEnrolled(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [listId])

  useEffect(() => { loadAll() }, [loadAll])

  if (list.list_type !== 'aereo') {
    return (
      <div className="det-card">
        <div className="section" style={{ textAlign:'center', padding:'48px 0' }}>
          <p style={{ fontSize:32, marginBottom:8 }}>🚌</p>
          <p style={{ color:'#94a3b8', fontSize:14, fontWeight:500 }}>Esta lista é via terrestre.</p>
        </div>
      </div>
    )
  }

  const active = enrolled.filter(e => e.enrollment_status !== 'cancelado')

  const airportMap = {}
  active.forEach(e => {
    if (!e.departure_airport_data) return
    const ap  = e.departure_airport_data
    const key = String(ap.id)
    if (!airportMap[key]) airportMap[key] = { ap, passengers: [] }
    airportMap[key].passengers.push(e)
  })

  const fq = filterQ.toLowerCase().trim()
  const groups = Object.values(airportMap)
    .map(({ ap, passengers }) => {
      const apMatch =
        !fq ||
        (ap.name      || '').toLowerCase().includes(fq) ||
        (ap.iata_code || '').toLowerCase().includes(fq) ||
        (ap.city      || '').toLowerCase().includes(fq)
      const filteredPax = !fq
        ? passengers
        : passengers.filter(e =>
            apMatch ||
            (e.passenger_name || '').toLowerCase().includes(fq) ||
            (e.block_agency   || '').toLowerCase().includes(fq)
          )
      return { ap, passengers: filteredPax, visible: apMatch || filteredPax.length > 0 }
    })
    .filter(g => g.visible)
    .sort((a, b) => b.passengers.length - a.passengers.length)

  const STATUS_COLOR = { confirmado:'#16a34a', pendente:'#f59e0b', reservado:'#64748b', cancelado:'#dc2626' }
  const STATUS_LABEL = { confirmado:'Confirmado', pendente:'Pendente', reservado:'Reservado', cancelado:'Cancelado' }

  return (
    <div className="det-card">
      <div className="section">
        {/* Toolbar */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
          <div style={{ position:'relative', flex:1, maxWidth:340 }}>
            <span style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:'#94a3b8', fontSize:13, pointerEvents:'none' }}>⌕</span>
            <input
              value={filterQ}
              onChange={e => setFilterQ(e.target.value)}
              placeholder="Pesquisar aeroporto ou passageiro…"
              style={{ paddingLeft:28, height:34, border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, width:'100%', fontFamily:'inherit', outline:'none', boxSizing:'border-box' }}
            />
            {filterQ && (
              <button onClick={() => setFilterQ('')}
                style={{ position:'absolute', right:7, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:16, lineHeight:1, padding:0 }}>×</button>
            )}
          </div>
          {!loading && Object.keys(airportMap).length > 0 && !filterQ && (
            <span style={{ fontSize:12, color:'#64748b' }}>
              {Object.keys(airportMap).length} aeroporto{Object.keys(airportMap).length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {loading ? (
          <p style={{ color:'#94a3b8', fontSize:13 }}>Carregando…</p>
        ) : groups.length === 0 ? (
          <div style={{ textAlign:'center', padding:'48px 0', border:'1px dashed #e2e8f0', borderRadius:12 }}>
            {filterQ ? (
              <p style={{ margin:0, color:'#94a3b8', fontSize:13 }}>Nenhum resultado para "{filterQ}".</p>
            ) : (
              <>
                <p style={{ fontSize:32, margin:'0 0 8px' }}>✈</p>
                <p style={{ margin:0, color:'#94a3b8', fontSize:14, fontWeight:500 }}>Nenhum passageiro com aeroporto diferente do padrão.</p>
                {defAirport && (
                  <p style={{ margin:'6px 0 0', color:'#94a3b8', fontSize:12 }}>
                    Aeroporto padrão: <strong style={{ color:'#1a2d4f' }}>{defAirport.iata_code} — {defAirport.name}</strong>
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {groups.map(({ ap, passengers }) => (
              <div key={ap.id} style={{ border:'1px solid #e2e8f0', borderRadius:12, overflow:'hidden' }}>
                {/* Airport group header */}
                <div style={{
                  display:'flex', alignItems:'center', gap:10, padding:'11px 16px',
                  background:'#dde6f5', borderBottom:'1px solid #b8cce8', borderLeft:'4px solid #1a2d4f',
                }}>
                  <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:12, color:'#92400e', background:'#fef3c7', border:'1.5px solid #f59e0b', padding:'2px 9px', borderRadius:5 }}>
                    {ap.iata_code || ap.name.slice(0,3).toUpperCase()}
                  </span>
                  <span style={{ fontSize:14, fontWeight:700, color:'#1a2d4f' }}>{ap.name}</span>
                  {ap.city && <span style={{ fontSize:12, color:'#475569' }}>{ap.city}</span>}
                  <span style={{ flex:1 }}/>
                  <span style={{ fontSize:11, fontWeight:700, color:'#fff', background:'#1a2d4f', padding:'2px 9px', borderRadius:20 }}>
                    {passengers.length} pax
                  </span>
                </div>
                {/* Passenger rows */}
                {passengers.length === 0 ? (
                  <div style={{ padding:'12px 16px' }}>
                    <p style={{ margin:0, fontSize:12, color:'#94a3b8', fontStyle:'italic' }}>Nenhum passageiro atribuído a este aeroporto.</p>
                  </div>
                ) : (
                  passengers.map((e, idx) => {
                    const sc   = STATUS_COLOR[e.enrollment_status] || '#94a3b8'
                    const sl   = STATUS_LABEL[e.enrollment_status] || e.enrollment_status
                    const name = e.passenger_name || e.block_agency || '—'
                    return (
                      <div key={e.id} style={{
                        display:'flex', alignItems:'center', gap:10, padding:'9px 16px',
                        borderBottom: idx < passengers.length-1 ? '1px solid #f1f5f9' : 'none',
                        background: idx%2===0 ? '#fff' : '#fafbfc',
                      }}>
                        <span style={{ flex:1, fontSize:13, fontWeight:500, color:'#1e293b' }}>{name}</span>
                        {e.accommodation && (
                          <span style={{ fontSize:11, color:'#475569', background:'#f1f5f9', padding:'1px 7px', borderRadius:10 }}>{e.accommodation}</span>
                        )}
                        <span style={{ fontSize:11, fontWeight:700, color: sc, background: sc+'1a', padding:'2px 8px', borderRadius:20 }}>
                          {sl}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}



/* ── Página principal ── */
export default function TripDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()

  const [list,      setList]      = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [showEdit,  setShowEdit]  = useState(false)
  const [tab, setTab] = usePersistedTab('tab_list_detail', 'passengers')
  const [paxData, setPaxData] = useState({ enrolled: [], accomTypes: [], loading: true })

  const load = useCallback(() => {
    listsApi.get(id)
      .then(r => setList(r.data))
      .catch(() => { toast.error('Lista de passageiros não encontrada.'); navigate('/viagens') })
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { load() }, [load])

  const handleSaved = (data) => {
    setList(data)
    setShowEdit(false)
    toast.success('Lista de passageiros atualizada.')
  }

  const handleStatusChange = async (status) => {
    const prev = list.status
    setList(l => ({ ...l, status }))
    try {
      await listsApi.patch(id, { status })
      toast.success('Status atualizado.')
    } catch {
      setList(l => ({ ...l, status: prev }))
      toast.error('Erro ao atualizar status.')
    }
  }

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:300, color:'#94a3b8' }}>
      Carregando…
    </div>
  )

  const TABS = [
    { key:'passengers', label:'Passageiros' },
    ...(list.list_type === 'aereo' ? [{ key:'voos', label:'Voos' }] : []),
  ]

  // Pode ficar negativo — significa que foram vendidas mais vagas do que o bloqueio permite
  const available = list.block_capacity > 0 ? list.block_capacity - paxData.enrolled.length : null
  const oversold  = available != null && available < 0

  return (
    <div>
      {/* Cabeçalho */}
      <div className="ph" style={{ alignItems:'flex-start' }}>
        <div>
          <button onClick={() => navigate('/viagens')}
            style={{ background:'none', border:'none', cursor:'pointer', color:'#64748b', fontSize:12, fontFamily:'inherit', padding:0, marginBottom:6 }}
            onMouseEnter={e => e.currentTarget.style.color='#1a2d4f'}
            onMouseLeave={e => e.currentTarget.style.color='#64748b'}>
            ← Listas de Passageiros
          </button>
          <h1 className="ph-title" style={{ margin:0 }}>{list.name}</h1>
        </div>
        <div className="ph-actions" style={{ alignItems:'center' }}>
          <TripPhaseBadge startDate={list.start_date} endDate={list.end_date} />
          <ListStatusBadge value={list.status} onChange={handleStatusChange} />
          <button type="button" onClick={() => setShowEdit(true)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', transition:'all .12s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor='#1a2d4f'; e.currentTarget.style.color='#1a2d4f' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.color='#475569' }}>
            <Ic n="edit" s={13} /> Editar lista de passageiros
          </button>
        </div>
      </div>

      {/* Resumo + Métricas */}
      <div style={{ display:'flex', gap:20, alignItems:'stretch', marginBottom:20 }}>
        <div style={{ flex:1, display:'flex', flexDirection:'column', gap:12, minWidth:0 }}>
          {/* Card de resumo */}
          <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:'12px 20px', boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'14px 40px', alignItems:'flex-start' }}>
              <Chip label="Tipo"           value={TYPE_LABEL[list.list_type] || list.list_type} />
              <Chip label="Categoria"      value={list.category} />
              <Chip label="Início"         value={fmt(list.start_date)} />
              <Chip label="Término"        value={fmt(list.end_date)} />
              <Chip label="Capacidade do bloqueio"     value={list.block_capacity > 0 ? String(list.block_capacity) : '—'} />
              <Chip label="Acomodações reservadas"    value={list.total_accommodations > 0 ? String(list.total_accommodations) : '—'} />
            </div>
          </div>

          {/* Métricas */}
          {!paxData.loading && paxData.enrolled.length > 0 && (
            <MetricsPanel enrolled={paxData.enrolled} accomTypes={paxData.accomTypes} />
          )}
        </div>

        {available != null && (
          <div style={{
            flexShrink:0, width:200, borderRadius:12, color:'#fff', display:'flex', flexDirection:'column',
            alignItems:'flex-end', justifyContent:'center', padding:'18px 22px', gap:2,
            background: oversold ? 'linear-gradient(135deg,#dc2626,#b91c1c)' : 'linear-gradient(135deg,#16a34a,#15803d)',
            boxShadow:'0 1px 4px rgba(0,0,0,.08)',
          }}>
            <span style={{ fontSize:38, fontWeight:800, lineHeight:1 }}>{available}</span>
            <span style={{ fontSize:13, fontWeight:600, textAlign:'right' }}>Disponíveis para venda</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, borderBottom:'2px solid #e2e8f0', marginBottom:20 }}>
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{ padding:'10px 22px', background:'none', border:'none', borderBottom: tab===t.key ? '2px solid #1a2d4f' : '2px solid transparent', marginBottom:-2, color: tab===t.key ? '#1a2d4f' : '#64748b', fontSize:14, fontWeight: tab===t.key ? 700 : 400, cursor:'pointer', fontFamily:'inherit', transition:'color .15s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Conteúdo das abas */}
      {tab === 'passengers' && <PassengersTab listId={id} listType={list.list_type} defaultAirport={list.default_airport_data} startDate={list.start_date} endDate={list.end_date} onData={setPaxData} />}

{tab === 'voos' && <FlightsTab listId={id} list={list} />}

      {/* Modal de edição */}
      {showEdit && (
        <ListModal
          initial={list}
          onClose={() => setShowEdit(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
