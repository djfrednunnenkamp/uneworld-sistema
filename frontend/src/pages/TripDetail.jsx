import React, { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import FormSelect from '../components/FormSelect'
import PassengerPreviewModal from '../components/PassengerPreviewModal'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { listsApi, passengersApi, agenciesApi, configApi } from '../api'
import DatePicker from '../components/DatePicker'
import ListModal from '../components/ListModal'
import usePersistedTab from '../hooks/usePersistedTab'
import ConfirmModal from '../components/ConfirmModal'
import { Ic } from '../components/Icon'
import AirlinePicker from '../components/AirlinePicker'

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
  cancelado:  { bg:'#dc2626', title:'Cancelado'  },
}

const ENROLLMENT_STATUS_OPTS = [
  { value:'confirmado', label:'Confirmado', color:'#16a34a' },
  { value:'pendente',   label:'Pendente',   color:'#f59e0b' },
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

  const depAirport = enrollment.departure_airport_data || null
  const hasFeeder  = depAirport && defaultAirport && depAirport.id !== defaultAirport.id

  const [status,  setStatus]  = useState(enrollment.ticket_status  || 'nao_emitida')
  const [number,  setNumber]  = useState(enrollment.ticket_number  || '')
  const [saving,  setSaving]  = useState(false)

  // Voos do bloqueio (para exibição em "via_bloqueio")
  const [blockLegs,    setBlockLegs]    = useState([])
  // Trechos individuais do passageiro (para "fora_bloqueio")
  const [pLegs,        setPLegs]        = useState([])
  const [pLegsLoaded,  setPLegsLoaded]  = useState(false)
  const [copying,      setCopying]      = useState(false)
  const [legModal,     setLegModal]     = useState(null)
  const [delLeg,       setDelLeg]       = useState(null)

  // Voo de acesso (feeder)
  const [feederStatus,     setFeederStatus]     = useState(enrollment.connection_ticket_status || 'nao_emitida')
  const [feederNumber,     setFeederNumber]     = useState(enrollment.connection_ticket_number || '')
  const [feederBlockLegs,  setFeederBlockLegs]  = useState([])
  const [feederBlockLoaded, setFeederBlockLoaded] = useState(false)
  const [pFeederLegs,      setPFeederLegs]      = useState([])
  const [pFeederLoaded,    setPFeederLoaded]    = useState(false)
  const [feederLegModal,   setFeederLegModal]   = useState(null)
  const [delFeederLeg,     setDelFeederLeg]     = useState(null)

  useEffect(() => {
    listsApi.listFlights(listId).then(r => setBlockLegs(r.data)).catch(() => {})
  }, [listId])

  useEffect(() => {
    if (hasFeeder && feederStatus === 'via_bloqueio' && !feederBlockLoaded) {
      listsApi.listFeederLegs(listId, depAirport.id).then(r => {
        setFeederBlockLegs(r.data)
        setFeederBlockLoaded(true)
      }).catch(() => {})
    }
  }, [feederStatus, feederBlockLoaded, hasFeeder])

  useEffect(() => {
    if (hasFeeder && !feederBlockLoaded) {
      listsApi.listFeederLegs(listId, depAirport.id).then(r => {
        setFeederBlockLegs(r.data)
        setFeederBlockLoaded(true)
      }).catch(() => {})
    }
  }, [hasFeeder])

  useEffect(() => {
    if (status === 'fora_bloqueio' && !pLegsLoaded) {
      listsApi.listPassengerLegs(listId, enrollment.id).then(r => {
        setPLegs(r.data.filter(l => l.direction !== 'feeder'))
        setPLegsLoaded(true)
      }).catch(() => {})
    }
  }, [status, pLegsLoaded, listId, enrollment.id])

  useEffect(() => {
    if (hasFeeder && feederStatus === 'fora_bloqueio' && !pFeederLoaded) {
      listsApi.listPassengerLegs(listId, enrollment.id, 'feeder').then(r => {
        setPFeederLegs(r.data)
        setPFeederLoaded(true)
      }).catch(() => {})
    }
  }, [feederStatus, pFeederLoaded, hasFeeder])

  const reloadPLegs = () =>
    listsApi.listPassengerLegs(listId, enrollment.id).then(r => {
      setPLegs(r.data.filter(l => l.direction !== 'feeder'))
    }).catch(() => {})

  const reloadPFeederLegs = () =>
    listsApi.listPassengerLegs(listId, enrollment.id, 'feeder').then(r => setPFeederLegs(r.data)).catch(() => {})

  const handleCopyFromBlock = async () => {
    setCopying(true)
    try {
      const r = await listsApi.copyLegsFromBlock(listId, enrollment.id)
      setPLegs(r.data.filter(l => l.direction !== 'feeder'))
      toast.success('Voos copiados do bloqueio.')
    } catch { toast.error('Erro ao copiar.') }
    finally { setCopying(false) }
  }

  const handleSaveLeg = async (data) => {
    if (legModal.initial) {
      await listsApi.updatePassengerLeg(listId, enrollment.id, legModal.initial.id, data)
      toast.success('Trecho atualizado.')
    } else {
      await listsApi.addPassengerLeg(listId, enrollment.id, data)
      toast.success('Trecho adicionado.')
    }
    reloadPLegs()
  }

  const handleDeleteLeg = async (leg) => {
    await listsApi.removePassengerLeg(listId, enrollment.id, leg.id)
    setDelLeg(null)
    reloadPLegs()
  }

  const handleSaveFeederLeg = async (data) => {
    const payload = { ...data, direction: 'feeder' }
    if (feederLegModal.initial) {
      await listsApi.updatePassengerLeg(listId, enrollment.id, feederLegModal.initial.id, payload)
      toast.success('Trecho atualizado.')
    } else {
      await listsApi.addPassengerLeg(listId, enrollment.id, payload)
      toast.success('Trecho adicionado.')
    }
    setFeederLegModal(null)
    reloadPFeederLegs()
  }

  const handleDeleteFeederLeg = async (leg) => {
    await listsApi.removePassengerLeg(listId, enrollment.id, leg.id)
    setDelFeederLeg(null)
    reloadPFeederLegs()
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await listsApi.updatePassenger(listId, enrollment.id, {
        ticket_status: status,
        ticket_number: status === 'nao_emitida' ? '' : number,
        ticket_seat:   '',
        connection_ticket_status: hasFeeder ? feederStatus : 'nao_emitida',
        connection_ticket_number: hasFeeder && feederStatus !== 'nao_emitida' ? feederNumber : '',
        connection_ticket_seat:   '',
      })
      toast.success('Passagem atualizada.')
      onSaved(); onClose()
    } catch { toast.error('Erro ao salvar.') }
    finally { setSaving(false) }
  }

  const COLORS = {
    nao_emitida:   { fg:'#94a3b8', bg:'#f8fafc',  accent:'#94a3b8' },
    via_bloqueio:  { fg:'#b45309', bg:'#fffbeb',  accent:'#b45309' },
    fora_bloqueio: { fg:'rgb(147,66,171)', bg:'#faf5ff', accent:'rgb(147,66,171)' },
  }

  const fmtDate = d => { if (!d) return null; const [y,m,day]=d.split('-'); return `${day}/${m}/${y}` }
  const fmtTime = t => t ? t.slice(0,5) : null

  const LegReadRow = ({ leg }) => (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:'#fff', borderBottom:'1px solid #f1f5f9' }}>
      {[leg.origin_airport_data, leg.destination_airport_data].map((ap, i) => (
        <span key={i} style={{ display:'flex', alignItems:'center', gap:4 }}>
          {i===1 && <span style={{ color:'#cbd5e1', fontSize:13 }}>→</span>}
          {ap ? (
            <span style={{ display:'flex', alignItems:'center', gap:4 }}>
              <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:11, color:'#1a2d4f', background:'#eff6ff', padding:'1px 5px', borderRadius:4, border:'1px solid #bfdbfe' }}>
                {ap.iata_code || ap.name.slice(0,3).toUpperCase()}
              </span>
              <span style={{ fontSize:12, color:'#1e293b', fontWeight:500 }}>{ap.city || ap.name}</span>
            </span>
          ) : <span style={{ fontSize:12, color:'#cbd5e1', fontStyle:'italic' }}>—</span>}
        </span>
      ))}
      <span style={{ flex:1 }}/>
      {leg.flight_number && <span style={{ fontSize:11, fontFamily:'monospace', fontWeight:700, color:'#475569', background:'#f1f5f9', padding:'1px 6px', borderRadius:4 }}>{leg.flight_number}</span>}
      {leg.airline && <span style={{ fontSize:11, color:'#64748b' }}>{leg.airline}</span>}
      {(leg.departure_date || leg.departure_time) && (
        <span style={{ fontSize:11, color:'#94a3b8' }}>{[fmtDate(leg.departure_date), fmtTime(leg.departure_time)].filter(Boolean).join(' ')}</span>
      )}
    </div>
  )

  const LegEditRow = ({ leg }) => (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:'#fff', borderBottom:'1px solid #f1f5f9' }}
      onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
      onMouseLeave={e => e.currentTarget.style.background='#fff'}>
      {[leg.origin_airport_data, leg.destination_airport_data].map((ap, i) => (
        <span key={i} style={{ display:'flex', alignItems:'center', gap:4 }}>
          {i===1 && <span style={{ color:'#cbd5e1', fontSize:13 }}>→</span>}
          {ap ? (
            <span style={{ display:'flex', alignItems:'center', gap:4 }}>
              <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:11, color:'#1a2d4f', background:'#eff6ff', padding:'1px 5px', borderRadius:4, border:'1px solid #bfdbfe' }}>
                {ap.iata_code || ap.name.slice(0,3).toUpperCase()}
              </span>
              <span style={{ fontSize:12, color:'#1e293b', fontWeight:500 }}>{ap.city || ap.name}</span>
            </span>
          ) : <span style={{ fontSize:12, color:'#cbd5e1', fontStyle:'italic' }}>—</span>}
        </span>
      ))}
      <span style={{ flex:1 }}/>
      {leg.flight_number && <span style={{ fontSize:11, fontFamily:'monospace', fontWeight:700, color:'#475569', background:'#f1f5f9', padding:'1px 6px', borderRadius:4 }}>{leg.flight_number}</span>}
      {(leg.departure_date || leg.departure_time) && (
        <span style={{ fontSize:11, color:'#94a3b8' }}>{[fmtDate(leg.departure_date), fmtTime(leg.departure_time)].filter(Boolean).join(' ')}</span>
      )}
      <button type="button" onClick={() => setLegModal({ direction: leg.direction, initial: leg })}
        style={{ width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:5, border:'1.5px solid #e2e8f0', background:'#fff', color:'#64748b', cursor:'pointer', flexShrink:0 }}>
        <Ic n="edit" s={11}/>
      </button>
      <button type="button" onClick={() => setDelLeg(leg)}
        style={{ width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:5, border:'1.5px solid #fee2e2', background:'#fff', color:'#dc2626', cursor:'pointer', flexShrink:0 }}>
        <Ic n="trash" s={11}/>
      </button>
    </div>
  )

  const LegsSection = ({ direction, label, legs, editable }) => {
    const dirLegs = legs.filter(l => l.direction === direction)
    return (
      <div style={{ marginBottom:10 }}>
        <p style={{ margin:'0 0 4px', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.05em' }}>{label}</p>
        {dirLegs.length === 0 ? (
          <p style={{ margin:0, fontSize:12, color:'#94a3b8', padding:'8px 12px', background:'#f8fafc', borderRadius:6, border:'1px dashed #e2e8f0' }}>
            Nenhum trecho cadastrado.
          </p>
        ) : (
          <div style={{ border:'1px solid #e2e8f0', borderRadius:7, overflow:'hidden' }}>
            {dirLegs.map(l => editable ? <LegEditRow key={l.id} leg={l}/> : <LegReadRow key={l.id} leg={l}/>)}
          </div>
        )}
        {editable && (
          <button type="button"
            onClick={() => {
              const last = dirLegs.length > 0 ? dirLegs[dirLegs.length-1] : null
              setLegModal({
                direction,
                initial: null,
                prefill: last ? {
                  origin_airport_data: last.destination_airport_data,
                  departure_date:      last.arrival_date || '',
                  departure_time:      last.arrival_time ? last.arrival_time.slice(0,5) : '',
                } : null,
              })
            }}
            style={{ marginTop:5, display:'flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:6, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            <Ic n="plus" s={10}/> Adicionar trecho
          </button>
        )}
      </div>
    )
  }

  const c = COLORS[status] || COLORS.nao_emitida

  return (
    <div className="overlay" style={{ zIndex:750 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mbox" style={{ maxWidth:500 }}>

        <div className="mhead">
          <div style={{ minWidth:0 }}>
            <span className="mtitle">Passagem aérea</span>
            <p style={{ margin:'2px 0 0', fontSize:12, color:'#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</p>
          </div>
          <button className="mclose" onClick={onClose}><Ic n="x" s={14}/></button>
        </div>

        <div className="mbody" style={{ display:'flex', flexDirection:'column', gap:14, maxHeight:'72vh', overflowY:'auto' }}>

          {/* Seletor de status */}
          <div style={{ display:'flex', borderRadius:8, border:'1px solid #e2e8f0', overflow:'hidden' }}>
            {[
              { v:'nao_emitida',   label:'Não emitida'    },
              { v:'via_bloqueio',  label:'Via bloqueio'   },
              { v:'fora_bloqueio', label:'Voo individual' },
            ].map(({ v, label }, i, arr) => {
              const sel = status === v
              const col = COLORS[v]
              return (
                <button key={v} type="button" onClick={() => setStatus(v)}
                  style={{
                    flex:1, padding:'9px 4px', border:'none', cursor:'pointer', fontFamily:'inherit',
                    fontSize:12, fontWeight: sel ? 700 : 500, transition:'all .12s',
                    borderRight: i < arr.length-1 ? '1px solid #e2e8f0' : 'none',
                    background:  sel ? col.bg  : '#fff',
                    color:       sel ? col.fg  : '#94a3b8',
                    boxShadow:   sel ? `inset 0 -2px 0 ${col.accent}` : 'none',
                  }}>
                  {label}
                </button>
              )
            })}
          </div>

          {/* Número da reserva (quando emitida) */}
          {status !== 'nao_emitida' && (
            <div className="ff" style={{ margin:0 }}>
              <label className="fl">Número da reserva</label>
              <input className="fi" value={number} onChange={e => setNumber(e.target.value)} placeholder="Ex: ABC123" />
            </div>
          )}

          {/* Via bloqueio — exibe voos do bloqueio */}
          {status === 'via_bloqueio' && (
            <div>
              <p style={{ margin:'0 0 8px', fontSize:11, fontWeight:700, color:'#b45309', textTransform:'uppercase', letterSpacing:'.05em' }}>
                Voos do bloqueio
              </p>
              {blockLegs.length === 0 ? (
                <p style={{ margin:0, fontSize:12, color:'#94a3b8', padding:'10px 14px', background:'#fffbeb', borderRadius:7, border:'1px solid #fde68a' }}>
                  Nenhum voo cadastrado no bloqueio desta lista.
                </p>
              ) : (
                <>
                  <LegsSection direction="ida"   label="✈ Ida"   legs={blockLegs} editable={false}/>
                  <LegsSection direction="volta" label="✈ Volta" legs={blockLegs} editable={false}/>
                </>
              )}
            </div>
          )}

          {/* Voo individual — editor de trechos por passageiro */}
          {status === 'fora_bloqueio' && (
            <div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <p style={{ margin:0, fontSize:11, fontWeight:700, color:'rgb(147,66,171)', textTransform:'uppercase', letterSpacing:'.05em' }}>
                  Trechos do passageiro
                </p>
                <button type="button" onClick={handleCopyFromBlock} disabled={copying}
                  style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:6, border:'1.5px solid #e9d5ff', background:'#faf5ff', color:'rgb(147,66,171)', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                  {copying ? '…' : '↓ Copiar do bloqueio'}
                </button>
              </div>
              {!pLegsLoaded ? (
                <p style={{ color:'#94a3b8', fontSize:12 }}>Carregando…</p>
              ) : (
                <>
                  <LegsSection direction="ida"   label="✈ Ida"   legs={pLegs} editable={true}/>
                  <LegsSection direction="volta" label="✈ Volta" legs={pLegs} editable={true}/>
                </>
              )}
            </div>
          )}

          {/* ── Voo de acesso (só aparece quando aeroporto individual diferente do padrão) ── */}
          {hasFeeder && (
            <div style={{ borderTop:'2px dashed #e2e8f0', paddingTop:14 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:11, color:'#92400e', background:'#fef3c7', border:'1px solid #fde68a', padding:'1px 7px', borderRadius:5 }}>
                  {depAirport.iata_code || depAirport.name.slice(0,3).toUpperCase()}
                </span>
                <p style={{ margin:0, fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em' }}>
                  Voo de acesso — {depAirport.city || depAirport.name}
                </p>
              </div>

              {/* Seletor feeder */}
              <div style={{ display:'flex', borderRadius:8, border:'1px solid #e2e8f0', overflow:'hidden', marginBottom:12 }}>
                {[
                  { v:'nao_emitida',   label:'Não emitida'    },
                  ...(feederBlockLegs.length > 0 ? [{ v:'via_bloqueio', label:'Via bloqueio' }] : []),
                  { v:'fora_bloqueio', label:'Voo individual' },
                ].map(({ v, label }, i, arr) => {
                  const sel = feederStatus === v
                  const col = COLORS[v] || COLORS.nao_emitida
                  return (
                    <button key={v} type="button" onClick={() => setFeederStatus(v)}
                      style={{
                        flex:1, padding:'8px 4px', border:'none', cursor:'pointer', fontFamily:'inherit',
                        fontSize:12, fontWeight: sel ? 700 : 500, transition:'all .12s',
                        borderRight: i < arr.length-1 ? '1px solid #e2e8f0' : 'none',
                        background:  sel ? col.bg  : '#fff',
                        color:       sel ? col.fg  : '#94a3b8',
                        boxShadow:   sel ? `inset 0 -2px 0 ${col.accent}` : 'none',
                      }}>
                      {label}
                    </button>
                  )
                })}
              </div>

              {/* Número da reserva feeder */}
              {feederStatus !== 'nao_emitida' && (
                <div className="ff" style={{ margin:'0 0 10px' }}>
                  <label className="fl">Número da reserva (acesso)</label>
                  <input className="fi" value={feederNumber} onChange={e => setFeederNumber(e.target.value)} placeholder="Ex: ABC123" />
                </div>
              )}

              {/* Via bloqueio feeder — leitura */}
              {feederStatus === 'via_bloqueio' && (
                feederBlockLegs.length === 0 ? (
                  <p style={{ margin:0, fontSize:12, color:'#94a3b8', padding:'10px 14px', background:'#fffbeb', borderRadius:7, border:'1px solid #fde68a' }}>
                    Nenhum voo de acesso configurado para este aeroporto.
                  </p>
                ) : (
                  <div style={{ border:'1px solid #e2e8f0', borderRadius:7, overflow:'hidden' }}>
                    {feederBlockLegs.map(l => <LegReadRow key={l.id} leg={l}/>)}
                  </div>
                )
              )}

              {/* Roteiro próprio feeder — edição */}
              {feederStatus === 'fora_bloqueio' && (
                !pFeederLoaded ? (
                  <p style={{ color:'#94a3b8', fontSize:12 }}>Carregando…</p>
                ) : (
                  <div>
                    {pFeederLegs.length === 0 ? (
                      <p style={{ margin:'0 0 6px', fontSize:12, color:'#94a3b8', padding:'8px 12px', background:'#f8fafc', borderRadius:6, border:'1px dashed #e2e8f0' }}>
                        Nenhum trecho cadastrado.
                      </p>
                    ) : (
                      <div style={{ border:'1px solid #e2e8f0', borderRadius:7, overflow:'hidden', marginBottom:6 }}>
                        {pFeederLegs.map(l => (
                          <div key={l.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:'#fff', borderBottom:'1px solid #f1f5f9' }}
                            onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
                            onMouseLeave={e => e.currentTarget.style.background='#fff'}>
                            {[l.origin_airport_data, l.destination_airport_data].map((ap, i) => (
                              <span key={i} style={{ display:'flex', alignItems:'center', gap:4 }}>
                                {i===1 && <span style={{ color:'#cbd5e1', fontSize:13 }}>→</span>}
                                {ap ? (
                                  <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                                    <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:11, color:'#1a2d4f', background:'#eff6ff', padding:'1px 5px', borderRadius:4, border:'1px solid #bfdbfe' }}>
                                      {ap.iata_code || ap.name.slice(0,3).toUpperCase()}
                                    </span>
                                    <span style={{ fontSize:12, color:'#1e293b', fontWeight:500 }}>{ap.city || ap.name}</span>
                                  </span>
                                ) : <span style={{ fontSize:12, color:'#cbd5e1', fontStyle:'italic' }}>—</span>}
                              </span>
                            ))}
                            <span style={{ flex:1 }}/>
                            {l.flight_number && <span style={{ fontSize:11, fontFamily:'monospace', fontWeight:700, color:'#475569', background:'#f1f5f9', padding:'1px 6px', borderRadius:4 }}>{l.flight_number}</span>}
                            <button type="button" onClick={() => setFeederLegModal({ initial: l })}
                              style={{ width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:5, border:'1.5px solid #e2e8f0', background:'#fff', color:'#64748b', cursor:'pointer', flexShrink:0 }}>
                              <Ic n="edit" s={11}/>
                            </button>
                            <button type="button" onClick={() => setDelFeederLeg(l)}
                              style={{ width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:5, border:'1.5px solid #fee2e2', background:'#fff', color:'#dc2626', cursor:'pointer', flexShrink:0 }}>
                              <Ic n="trash" s={11}/>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button type="button"
                      onClick={() => {
                        const last = pFeederLegs.length > 0 ? pFeederLegs[pFeederLegs.length-1] : null
                        setFeederLegModal({
                          initial: null,
                          prefill: last ? {
                            origin_airport_data: last.destination_airport_data,
                            departure_date: last.arrival_date || '',
                            departure_time: last.arrival_time ? last.arrival_time.slice(0,5) : '',
                          } : { origin_airport_data: depAirport },
                        })
                      }}
                      style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:6, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                      <Ic n="plus" s={10}/> Adicionar trecho
                    </button>
                  </div>
                )
              )}
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

      {/* Sub-modal para editar trecho individual */}
      {legModal && (
        <FlightLegModal
          initial={legModal.initial}
          prefill={legModal.prefill}
          direction={legModal.direction}
          zIndex={820}
          hideBlockedSeats
          onSave={handleSaveLeg}
          onClose={() => setLegModal(null)}
        />
      )}

      {delLeg && (
        <ConfirmModal
          message={`Remover trecho ${delLeg.origin_airport_data?.iata_code || '?'} → ${delLeg.destination_airport_data?.iata_code || '?'}?`}
          onOk={() => handleDeleteLeg(delLeg)}
          onCancel={() => setDelLeg(null)}
        />
      )}

      {feederLegModal && (
        <FlightLegModal
          initial={feederLegModal.initial}
          prefill={feederLegModal.prefill}
          direction="feeder"
          zIndex={820}
          hideBlockedSeats
          onSave={handleSaveFeederLeg}
          onClose={() => setFeederLegModal(null)}
        />
      )}

      {delFeederLeg && (
        <ConfirmModal
          message={`Remover trecho de acesso ${delFeederLeg.origin_airport_data?.iata_code || '?'} → ${delFeederLeg.destination_airport_data?.iata_code || '?'}?`}
          onOk={() => handleDeleteFeederLeg(delFeederLeg)}
          onCancel={() => setDelFeederLeg(null)}
        />
      )}
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

/* ── Menu "mais ações" do passageiro — itens já existentes funcionam, os demais aparecem como "Em breve" ── */
const PASSENGER_ACTIONS = [
  { key:'quick_edit',  label:'Edição rápida do passageiro', icon:'list',     enabled:false },
  { key:'edit',        label:'Editar o passageiro',         icon:'edit',     enabled:true  },
  { key:'notes',       label:'Observações',                 icon:'docs',     enabled:true  },
  { key:'extra_info',  label:'Informações adicionais',      icon:'plus',     enabled:false },
  { key:'seat',        label:'Informar o assento',          icon:'grid',     enabled:false },
  { key:'crew',        label:'Equipe técnica',              icon:'users',    enabled:false },
  { key:'pax_type',    label:'Tipo de passageiro',          icon:'settings', enabled:false },
  { key:'boarding',    label:'Local de embarque',           icon:'globe',    enabled:true  },
  { key:'contracts',   label:'Contratos',                   icon:'docs',     enabled:false },
  { key:'swap_room',   label:'Trocar de quarto',            icon:'building', enabled:true  },
  { key:'link_client', label:'Vincular cliente',            icon:'users',    enabled:false },
  { key:'link_agency', label:'Vincular agência',            icon:'building', enabled:false },
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
      {[{v:'confirmado',l:'Confirmado'},{v:'pendente',l:'Pendente'}].map(opt => (
        <button key={opt.v} type="button" onClick={() => onChange(opt.v)}
          style={{ padding:'7px 14px', border:'none', fontFamily:'inherit', fontSize:12, fontWeight:600, cursor:'pointer', transition:'all .12s',
            background: value===opt.v ? (opt.v==='confirmado'?'#16a34a':opt.v==='cancelado'?'#dc2626':'#f59e0b') : '#fff',
            color: value===opt.v ? '#fff' : '#64748b',
          }}>
          {opt.l}
        </button>
      ))}
    </div>
  )
}

/* ── Popup de adicionar passageiro / bloqueio ── */
function AddPassengerPopup({ listId, enrolled, onAdded, onClose }) {
  const [mode,         setMode]         = useState('passenger') // 'passenger' | 'block'
  // Modo passageiro
  const [search,       setSearch]       = useState('')
  const [results,      setResults]      = useState([])
  const [searching,    setSearching]    = useState(false)
  const [selected,     setSelected]     = useState(null)
  const [paxOpen,      setPaxOpen]      = useState(false)
  const [paxAgencies,  setPaxAgencies]  = useState([])
  const [selPaxAgency, setSelPaxAgency] = useState(null)
  const [paxAgMembers, setPaxAgMembers] = useState([])
  const [selPaxResp,   setSelPaxResp]   = useState(null)
  // Modo bloqueio — agência
  const [blockAgency,  setBlockAgency]  = useState('')
  const [blockQty,     setBlockQty]     = useState(1)
  const [agResults,    setAgResults]    = useState([])
  const [agSearching,  setAgSearching]  = useState(false)
  const [agOpen,       setAgOpen]       = useState(false)
  const [selAgency,    setSelAgency]    = useState(null)
  const [blkMembers,   setBlkMembers]   = useState([])
  const [selBlkResp,   setSelBlkResp]   = useState(null)
  // Campos comuns
  const [accommodation,setAccommodation]= useState('')
  const [estatus,       setEstatus]      = useState('pendente')
  const [pendingUntil,  setPendingUntil] = useState('')
  const [pendingReason, setPendingReason]= useState('')
  const [saving,        setSaving]       = useState(false)
  const debRef     = useRef(null)
  const debAg      = useRef(null)
  const paxInputRef = useRef(null)
  const agInputRef  = useRef(null)
  const [paxDropPos, setPaxDropPos] = useState({})
  const [agDropPos,  setAgDropPos]  = useState({})

  // Passageiro: busca ao digitar OU ao focar (mostra todos se vazio)
  const handleSearch = (q) => {
    setSearch(q); setSelected(null); setPaxOpen(true)
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

  const handlePaxFocus = () => {
    if (paxInputRef.current) {
      const r = paxInputRef.current.getBoundingClientRect()
      setPaxDropPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    setPaxOpen(true)
    if (!results.length && !searching) handleSearch(search)
  }

  // Agência: busca ao digitar OU ao focar
  const handleAgSearch = (q) => {
    setBlockAgency(q); setSelAgency(null); setAgOpen(true)
    clearTimeout(debAg.current)
    debAg.current = setTimeout(async () => {
      setAgSearching(true)
      try {
        const r = await agenciesApi.list({ search: q, page_size: 20 })
        setAgResults(r.data.results ?? r.data)
      } catch {} finally { setAgSearching(false) }
    }, 200)
  }

  const handleAgFocus = () => {
    if (agInputRef.current) {
      const r = agInputRef.current.getBoundingClientRect()
      setAgDropPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    setAgOpen(true)
    if (!agResults.length && !agSearching) handleAgSearch(blockAgency)
  }

  const handleAdd = async () => {
    setSaving(true)
    try {
      if (mode === 'block') {
        const agName = selAgency ? (selAgency.company_name || selAgency.name) : blockAgency.trim()
        if (!agName) { toast.error('Selecione ou informe a agência.'); setSaving(false); return }
        await listsApi.addPassenger(listId, {
          is_block: true, block_agency: agName,
          agency: selAgency?.id || null,
          responsible_user: selBlkResp?.user_id || null,
          block_quantity: blockQty, enrollment_status: estatus,
          pending_until: estatus === 'pendente' ? (pendingUntil || null) : null,
          pending_reason: estatus === 'pendente' ? pendingReason : '',
          notes: '',
        })
        toast.success(`${blockQty} vaga${blockQty>1?'s':''} de ${agName} adicionada${blockQty>1?'s':''}.`)
      } else {
        if (!selected) { toast.error('Selecione um passageiro.'); setSaving(false); return }
        if (enrolled.some(e => e.passenger === selected.id)) {
          toast.error('Passageiro já está nesta lista.'); setSaving(false); return
        }
        await listsApi.addPassenger(listId, {
          passenger: selected.id,
          agency: selPaxAgency?.id || null,
          responsible_user: selPaxResp?.user_id || null,
          enrollment_status: estatus,
          pending_until: estatus === 'pendente' ? (pendingUntil || null) : null,
          pending_reason: estatus === 'pendente' ? pendingReason : '',
          notes: '',
        })
        toast.success(`${selected.full_name} adicionado.`)
      }
      onAdded(); onClose()
    } catch (err) { toast.error(err.response?.data?.error ?? 'Erro ao adicionar.') }
    finally { setSaving(false) }
  }

  const agName   = selAgency ? (selAgency.company_name || selAgency.name) : blockAgency.trim()
  const canSubmit = mode === 'block' ? !!agName : !!selected

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:600, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:500, boxShadow:'0 32px 80px rgba(0,0,0,.25)', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ padding:'18px 22px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>Adicionar à lista</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>

        {/* Toggle modo */}
        <div style={{ padding:'14px 22px 0', display:'flex', gap:0, borderBottom:'1px solid #e2e8f0' }}>
          {[{v:'passenger',l:'Passageiro'},{v:'block',l:'Bloqueio de agência'}].map(opt => (
            <button key={opt.v} type="button" onClick={() => { setMode(opt.v); setResults([]); setSearch(''); setSelected(null) }}
              style={{ padding:'9px 18px', background:'none', border:'none', borderBottom: mode===opt.v ? '2px solid #1a2d4f' : '2px solid transparent', marginBottom:-1, color: mode===opt.v ? '#1a2d4f' : '#64748b', fontSize:13, fontWeight: mode===opt.v ? 700 : 500, cursor:'pointer', fontFamily:'inherit', transition:'color .12s' }}>
              {opt.l}
            </button>
          ))}
        </div>

        <div style={{ padding:'18px 22px', display:'flex', flexDirection:'column', gap:14 }}>

          {/* ── Modo passageiro ── */}
          {mode === 'passenger' && (
            <div>
              <label style={LBL}>Passageiro</label>
              <div style={{ position:'relative' }}>
                <input ref={paxInputRef} value={search} onChange={e => handleSearch(e.target.value)}
                  onFocus={handlePaxFocus}
                  onBlur={() => setTimeout(() => setPaxOpen(false), 200)}
                  placeholder="Buscar por nome, CPF ou e-mail…"
                  autoComplete="new-password"
                  style={{ ...INP, borderColor: selected ? '#16a34a' : '#e2e8f0' }} />
                {paxOpen && (
                  <div style={{ position:'fixed', top: paxDropPos.top, left: paxDropPos.left, width: paxDropPos.width, zIndex:800, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', boxShadow:'0 12px 32px rgba(0,0,0,.14)', overflow:'hidden', maxHeight:220, overflowY:'auto' }}>
                    {searching
                      ? <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'12px 0', margin:0 }}>Buscando…</p>
                      : results.length === 0
                      ? <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'12px 0', margin:0 }}>Nenhum passageiro encontrado.</p>
                      : results.map(p => (
                        <div key={p.id}
                          style={{ padding:'9px 14px', borderBottom:'1px solid #f8fafc', cursor:'pointer', background: selected?.id===p.id ? '#f0fdf4' : 'transparent' }}
                          onMouseDown={() => {
                            setSelected(p); setSearch(p.full_name); setPaxOpen(false)
                            setSelPaxAgency(null); setPaxAgencies([]); setSelPaxResp(null); setPaxAgMembers([])
                            passengersApi.agencies(p.id).then(r => setPaxAgencies(r.data)).catch(() => {})
                          }}
                          onMouseEnter={ev => { if (selected?.id!==p.id) ev.currentTarget.style.background='#f8fafc' }}
                          onMouseLeave={ev => { ev.currentTarget.style.background = selected?.id===p.id ? '#f0fdf4' : 'transparent' }}>
                          <p style={{ margin:0, fontSize:13, fontWeight:600, color:'#1e293b' }}>{p.full_name}</p>
                          <p style={{ margin:0, fontSize:11, color:'#94a3b8' }}>{p.cpf || p.email || '—'}</p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              {selected && (
                <p style={{ margin:'6px 0 0', fontSize:12, color:'#16a34a', fontWeight:600 }}>✓ {selected.full_name} selecionado</p>
              )}
            </div>
          )}

          {/* Agência do passageiro — aparece após selecionar passageiro */}
          {mode === 'passenger' && selected && (
            <div>
              <label style={LBL}>Agência <span style={{ fontWeight:400, color:'#94a3b8', textTransform:'none', letterSpacing:0 }}>(opcional)</span></label>
              {paxAgencies.length === 0 ? (
                <p style={{ margin:0, fontSize:12, color:'#94a3b8', fontStyle:'italic' }}>
                  Nenhuma agência vinculada a este passageiro.
                </p>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {paxAgencies.map(ag => {
                    const isSel = selPaxAgency?.id === ag.id
                    return (
                      <label key={ag.id}
                        style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:8, border:`1.5px solid ${isSel ? '#1a2d4f' : '#e2e8f0'}`, background: isSel ? '#f0f4ff' : '#fff', cursor:'pointer', transition:'all .12s', userSelect:'none' }}
                        onClick={() => {
                          const next = isSel ? null : ag
                          setSelPaxAgency(next); setSelPaxResp(null); setPaxAgMembers([])
                          if (next) agenciesApi.listMembers(next.id).then(r => setPaxAgMembers(r.data)).catch(() => {})
                        }}>
                        <div style={{ width:16, height:16, borderRadius:4, border:`2px solid ${isSel ? '#1a2d4f' : '#d1d5db'}`, background: isSel ? '#1a2d4f' : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          {isSel && <span style={{ color:'#fff', fontSize:10, fontWeight:900, lineHeight:1 }}>✓</span>}
                        </div>
                        <span style={{ fontSize:13, color: isSel ? '#1a2d4f' : '#1e293b', fontWeight: isSel ? 600 : 400 }}>{ag.name}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Responsável — aparece após selecionar agência (modo passageiro) */}
          {mode === 'passenger' && selPaxAgency && (
            <div>
              <label style={LBL}>Responsável da agência <span style={{ fontWeight:400, color:'#94a3b8', textTransform:'none', letterSpacing:0 }}>(opcional)</span></label>
              <ResponsibleSelect members={paxAgMembers} selected={selPaxResp} onChange={setSelPaxResp} />
            </div>
          )}

          {/* ── Modo bloqueio ── */}
          {mode === 'block' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 110px', gap:12 }}>
              <div>
                <label style={LBL}>Agência</label>
                <div style={{ position:'relative' }}>
                  <input ref={agInputRef} value={blockAgency} onChange={e => handleAgSearch(e.target.value)}
                    onFocus={handleAgFocus}
                    onBlur={() => setTimeout(() => setAgOpen(false), 200)}
                    placeholder="Buscar agência…"
                    style={{ ...INP, borderColor: selAgency ? '#16a34a' : '#e2e8f0' }} />
                  {agOpen && (
                    <div style={{ position:'fixed', top: agDropPos.top, left: agDropPos.left, width: agDropPos.width, zIndex:800, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', boxShadow:'0 12px 32px rgba(0,0,0,.14)', overflow:'hidden', maxHeight:220, overflowY:'auto' }}>
                      {agSearching
                        ? <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'12px 0', margin:0 }}>Buscando…</p>
                        : agResults.length === 0
                        ? <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'12px 0', margin:0 }}>Nenhuma agência encontrada.</p>
                        : agResults.map(ag => {
                            const label = ag.company_name || ag.name
                            const isSel = selAgency?.id === ag.id
                            return (
                              <div key={ag.id}
                                style={{ padding:'9px 14px', borderBottom:'1px solid #f8fafc', cursor:'pointer', background: isSel ? '#f0fdf4' : 'transparent' }}
                                onMouseDown={() => {
                                  setSelAgency(ag); setBlockAgency(label); setAgOpen(false)
                                  setSelBlkResp(null); setBlkMembers([])
                                  agenciesApi.listMembers(ag.id).then(r => setBlkMembers(r.data)).catch(() => {})
                                }}
                                onMouseEnter={ev => { if (!isSel) ev.currentTarget.style.background='#f8fafc' }}
                                onMouseLeave={ev => { ev.currentTarget.style.background = isSel ? '#f0fdf4' : 'transparent' }}>
                                <p style={{ margin:0, fontSize:13, fontWeight:600, color:'#1e293b' }}>{label}</p>
                                <p style={{ margin:0, fontSize:11, color:'#94a3b8' }}>{ag.cnpj || ag.cpf || ag.email || '—'}</p>
                              </div>
                            )
                          })}
                    </div>
                  )}
                </div>
                {selAgency && (
                  <p style={{ margin:'6px 0 0', fontSize:12, color:'#16a34a', fontWeight:600 }}>✓ {selAgency.company_name || selAgency.name}</p>
                )}
              </div>
              <div>
                <label style={LBL}>Vagas</label>
                <input type="number" min="1" max="100" value={blockQty}
                  onChange={e => setBlockQty(Math.max(1, parseInt(e.target.value)||1))}
                  style={INP}
                  onFocus={e => e.target.style.borderColor='#1a2d4f'}
                  onBlur={e => e.target.style.borderColor='#e2e8f0'} />
              </div>
            </div>
          )}

          {/* Responsável — aparece após selecionar agência (modo bloqueio) */}
          {mode === 'block' && selAgency && (
            <div>
              <label style={LBL}>Responsável da agência <span style={{ fontWeight:400, color:'#94a3b8', textTransform:'none', letterSpacing:0 }}>(opcional)</span></label>
              <ResponsibleSelect members={blkMembers} selected={selBlkResp} onChange={setSelBlkResp} />
            </div>
          )}

          {/* Status (comum) */}
          <div>
            <label style={LBL}>Status</label>
            <StatusToggle value={estatus} onChange={v => { setEstatus(v); if (v !== 'pendente') { setPendingUntil(''); setPendingReason('') } }} />
          </div>

          {/* Campos extras quando Pendente */}
          {estatus === 'pendente' && (
            <>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={LBL}>Pendente até</label>
                  <DatePicker fixed value={pendingUntil} onChange={setPendingUntil} />
                </div>
                <div style={{ display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
                  {pendingUntil && (() => {
                    const days = Math.ceil((new Date(pendingUntil) - new Date()) / 86400000)
                    return <span style={{ fontSize:12, color: days < 0 ? '#dc2626' : days <= 3 ? '#f59e0b' : '#16a34a', fontWeight:600 }}>
                      {days < 0 ? `Venceu há ${-days}d` : days === 0 ? 'Vence hoje' : `Vence em ${days}d`}
                    </span>
                  })()}
                </div>
              </div>
              <div>
                <label style={LBL}>Motivo da pendência</label>
                <textarea value={pendingReason} onChange={e => setPendingReason(e.target.value)}
                  placeholder="Descreva o motivo pelo qual está pendente…"
                  rows={3}
                  style={{ ...INP, resize:'vertical', lineHeight:1.5 }}
                  onFocus={e => e.target.style.borderColor='#f59e0b'}
                  onBlur={e => e.target.style.borderColor='#e2e8f0'} />
              </div>
            </>
          )}
        </div>

        <div style={{ padding:'0 22px 18px', display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button type="button" onClick={onClose}
            style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
          <button type="button" onClick={handleAdd} disabled={!canSubmit || saving}
            style={{ padding:'8px 22px', borderRadius:8, border:'none', background: !canSubmit||saving ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor: !canSubmit||saving ? 'default' : 'pointer', fontFamily:'inherit' }}>
            {saving ? 'Adicionando…' : mode==='block' ? `Reservar ${blockQty} vaga${blockQty>1?'s':''}` : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Popup para atribuir passageiro a um bloco ── */
function AssignPassengerPopup({ enrollment, listId, enrolled, onSaved, onClose }) {
  const [search,    setSearch]    = useState('')
  const [results,   setResults]   = useState([])
  const [searching, setSearching] = useState(false)
  const [selected,  setSelected]  = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [open,      setOpen]      = useState(false)
  const [dropPos,   setDropPos]   = useState({})
  const inputRef = useRef(null)
  const debRef = useRef(null)

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
      await listsApi.updatePassenger(listId, enrollment.id, { passenger: selected.id })
      toast.success(`${selected.full_name} atribuído ao bloco.`)
      onSaved(); onClose()
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Erro ao atribuir.')
    } finally { setSaving(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:700, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:460, boxShadow:'0 32px 80px rgba(0,0,0,.25)', overflow:'hidden' }}>
        <div style={{ padding:'18px 22px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <p style={{ margin:0, fontSize:15, fontWeight:700, color:'#0f172a' }}>Atribuir passageiro ao bloco</p>
            <p style={{ margin:'2px 0 0', fontSize:12, color:'#94a3b8' }}>Agência: {enrollment.block_agency}</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>
        <div style={{ padding:'18px 22px 20px', display:'flex', flexDirection:'column', gap:14 }}>
          <div>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:5 }}>Passageiro</label>
            <div style={{ position:'relative' }}>
              <input ref={inputRef} value={search} onChange={e => handleSearch(e.target.value)}
                onFocus={handleFocus}
                onBlur={() => setTimeout(() => setOpen(false), 200)}
                autoComplete="new-password"
                placeholder="Buscar por nome, CPF ou e-mail…"
                style={{ width:'100%', boxSizing:'border-box', padding:'9px 12px', border:`1.5px solid ${selected ? '#16a34a' : '#e2e8f0'}`, borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b' }} />
              {open && (
                <div style={{ position:'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex:900, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', boxShadow:'0 12px 32px rgba(0,0,0,.14)', overflow:'hidden', maxHeight:220, overflowY:'auto' }}>
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
                </div>
              )}
            </div>
            {selected && <p style={{ margin:'6px 0 0', fontSize:12, color:'#16a34a', fontWeight:600 }}>✓ {selected.full_name} selecionado</p>}
          </div>
        </div>
        <div style={{ padding:'0 22px 18px', display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Cancelar</button>
          <button onClick={handleAssign} disabled={!selected || saving}
            style={{ padding:'8px 22px', borderRadius:8, border:'none', background: !selected||saving ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor: !selected||saving ? 'default' : 'pointer', fontFamily:'inherit' }}>
            {saving ? 'Atribuindo…' : 'Atribuir passageiro'}
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
                <span style={{ fontSize:13, fontWeight:600, color:'#1e293b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
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
  { test: a => a < 2,              label:'Infantil < 2 anos'  },
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
  const [collapsed,     setCollapsed]     = useState(new Set())
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

  const toggleGroup = (key) => setCollapsed(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
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
      case 'delete':
        setConfirm({ id: enrollment.id, name: enrollment.passenger_name || enrollment.block_agency })
        break
      default:
        break
    }
  }

  // Cancelados ficam separados — pendentes de devolução de valores
  const CANCELLED = '(cancelados)'
  const activeEnrolled    = enrolled.filter(e => e.enrollment_status !== 'cancelado')
  const cancelledEnrolled = enrolled.filter(e => e.enrollment_status === 'cancelado')

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
  // Acomodações vazias (criadas via "Gerenciar acomodações") aparecem como grupos sem passageiros
  rooms.forEach(room => {
    if (!seen[room.name]) { seen[room.name] = []; groups.push({ key: room.name, rows: seen[room.name], roomId: room.id }) }
  })
  groups.sort((a, b) => a.key === UNASSIGNED ? -1 : b.key === UNASSIGNED ? 1 : 0)
  if (cancelledEnrolled.length > 0) groups.push({ key: CANCELLED, rows: cancelledEnrolled })

  // Número sequencial global — cancelados não entram na contagem
  let seq = 0
  const seqMap = {}
  activeEnrolled.forEach(e => { seq++; seqMap[e.id] = seq })

  const isAereo = listType === 'aereo'

  const allSelected = enrolled.length > 0 && selected.size === enrolled.length

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: selected.size > 0 ? 8 : 16 }}>
        <span style={{ fontSize:14, fontWeight:600, color:'#1e293b' }}>
          {activeEnrolled.length} passageiro{activeEnrolled.length !== 1 ? 's' : ''}
          {cancelledEnrolled.length > 0 && (
            <span style={{ fontSize:12, fontWeight:500, color:'#dc2626' }}> · {cancelledEnrolled.length} cancelado{cancelledEnrolled.length !== 1 ? 's' : ''}</span>
          )}
        </span>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
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
          <div style={{ display:'grid', gridTemplateColumns: isAereo ? '32px 40px 24px 28px 1fr 100px 52px 40px 130px 130px 120px 70px 102px' : '32px 40px 24px 28px 1fr 100px 52px 40px 130px 130px 120px 102px', columnGap:10, padding:'9px 12px', background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }}>
            {/* Checkbox select-all */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll}
                style={{ width:15, height:15, cursor:'pointer', accentColor:'#1a2d4f' }} />
            </div>
            {[
              {h:'Nº',        align:'center'},
              {h:'●',         align:'center'},
              {h:isAereo?'✈':'', align:'center'},
              {h:'Passageiro',align:'left'},
              {h:'Nasc.',     align:'center'},
              {h:'Nac.',      align:'center'},
              {h:'Gên.',      align:'center'},
              {h:'Passaporte',align:'center'},
              {h:'CPF',       align:'center'},
              {h:'Agência',   align:'left'},
              ...(isAereo ? [{h:'Emb.',     align:'center'}] : []),
              {h:'Ações',     align:'center'},
            ].map(({h, align}, i) => (
              <span key={i} style={{ fontSize:10, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.05em', textAlign: align }}>{h}</span>
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
            const isCollapsed   = collapsed.has(key)
            const groupAllSel   = rows.length > 0 && rows.every(r => selected.has(r.id))
            return (
            <div key={key}>
              {/* Header do grupo */}
              <div onClick={() => toggleGroup(key)}
                title={isCollapsed ? 'Expandir' : 'Recolher'}
                style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px',
                cursor: 'pointer',
                background: isCancelled ? '#fef2f2' : isUnassigned ? '#fffbeb' : '#f1f5f9',
                borderBottom: `1px solid ${isCancelled ? '#fecaca' : isUnassigned ? '#fde68a' : '#e2e8f0'}`,
                borderTop:    `1px solid ${isCancelled ? '#fecaca' : isUnassigned ? '#fde68a' : '#e2e8f0'}`,
              }}>
                {/* Expandir/recolher grupo */}
                <button type="button" onClick={(ev) => { ev.stopPropagation(); toggleGroup(key) }}
                  title={isCollapsed ? 'Expandir' : 'Recolher'}
                  style={{ width:22, height:22, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:5, border:'none', background:'transparent', color:'#64748b', cursor:'pointer', fontSize:11, flexShrink:0, transition:'transform .15s', transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}
                  onMouseEnter={ev => ev.currentTarget.style.color='#1a2d4f'}
                  onMouseLeave={ev => ev.currentTarget.style.color='#64748b'}>
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
                    <span style={{ fontSize:12, fontWeight:700, color:'#475569', letterSpacing:'.03em' }}>{key}</span>
                    <span style={{ fontSize:11, color:'#94a3b8' }}>({rows.length} pax)</span>

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
                    style={{ display:'grid', gridTemplateColumns: isAereo ? '32px 40px 24px 28px 1fr 100px 52px 40px 130px 130px 120px 70px 102px' : '32px 40px 24px 28px 1fr 100px 52px 40px 130px 130px 120px 102px', columnGap:10, padding:'9px 12px', borderBottom: ri < rows.length-1 ? '1px solid #f8fafc' : 'none', background: selected.has(e.id) ? '#eff6ff' : ri%2===0 ? '#fff' : '#fafbfc', alignItems:'center' }}
                    onMouseEnter={ev => ev.currentTarget.style.background='#f0f7ff'}
                    onMouseLeave={ev => ev.currentTarget.style.background = ri%2===0 ? '#fff' : '#fafbfc'}>

                    {/* Checkbox */}
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelect(e.id)}
                        style={{ width:15, height:15, cursor:'pointer', accentColor:'#1a2d4f' }} />
                    </div>

                    {/* Nº */}
                    <span style={{ textAlign:'center', fontSize:12, fontWeight:600, color:'#94a3b8' }}>{seqMap[e.id] ?? '—'}</span>

                    {/* Status — clique abre popup com Confirmado / Pendente / Cancelado */}
                    <EnrollmentStatusDot value={e.enrollment_status} onClick={() => setStatusModal(e)} />

                    {/* ✈ passagem — clicável em listas aéreas */}
                    {isAereo ? (() => {
                      const ticketColor = ts => ts === 'nao_emitida' ? '#cbd5e1' : ts === 'via_bloqueio' ? '#b45309' : 'rgb(147,66,171)'
                      const ticketBg    = ts => ts === 'nao_emitida' ? 'transparent' : ts === 'via_bloqueio' ? '#fef3c7' : '#f5edfb'
                      const ticketTitle = (ts, num) => ts === 'nao_emitida' ? 'Passagem não emitida' : ts === 'via_bloqueio' ? `Via bloqueio${num ? ' · ' + num : ''}` : `Voo individual${num ? ' · ' + num : ''}`
                      const ts1 = e.ticket_status || 'nao_emitida'
                      const hasFeederIcon = !e.is_block && e.departure_airport_data && defaultAirport && e.departure_airport_data.id !== defaultAirport.id
                      const ts2 = e.connection_ticket_status || 'nao_emitida'
                      return (
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:2 }}>
                          <button type="button" onClick={() => setTicketModal(e)}
                            title={ticketTitle(ts1, e.ticket_number)}
                            style={{ display:'flex', alignItems:'center', justifyContent:'center', width:26, height:26, borderRadius:6, border:'none', background:ticketBg(ts1), color:ticketColor(ts1), fontSize:13, cursor:'pointer', padding:0 }}>
                            ✈
                          </button>
                          {hasFeederIcon && (
                            <button type="button" onClick={() => setTicketModal(e)}
                              title={`Acesso ${e.departure_airport_data.iata_code || ''}: ${ticketTitle(ts2, e.connection_ticket_number)}`}
                              style={{ display:'flex', alignItems:'center', justifyContent:'center', width:26, height:26, borderRadius:6, border:`1.5px dashed ${ticketColor(ts2) === '#cbd5e1' ? '#e2e8f0' : ticketColor(ts2)}`, background:ticketBg(ts2), color:ticketColor(ts2), fontSize:11, cursor:'pointer', padding:0 }}>
                              ✈
                            </button>
                          )}
                        </div>
                      )
                    })() : <span style={{ fontSize:14, textAlign:'center' }}>🚌</span>
                    }

                    {/* Nome / Bloqueio */}
                    <div style={{ minWidth:0 }}>
                      {e.is_block ? (
                        <div style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}
                          onClick={() => setAssignBlk(e)}>
                          <span style={{ fontSize:10, fontWeight:700, background:'#fef3c7', color:'#92400e', padding:'1px 6px', borderRadius:4, flexShrink:0 }}>VAGA</span>
                          <span style={{ fontSize:12, color:'#78350f', fontStyle:'italic' }}>Clique para atribuir passageiro</span>
                        </div>
                      ) : (
                        <>
                          <p onClick={() => copy(e.passenger_name)} title="Clique para copiar"
                            style={{ margin:0, fontSize:13, fontWeight:600, color:'#1e293b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', cursor:'pointer' }}>
                            {e.passenger_name}
                          </p>
                          {isCancelled && e.notes && (
                            <p title={e.notes} style={{ margin:'2px 0 0', fontSize:11, color:'#b91c1c', fontStyle:'italic', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
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
                        <span style={{ fontSize:13, fontWeight:600, color:'#be185d' }}>{birth}</span>
                        <span style={{ width:6, height:6, borderRadius:'50%', background:'#ec4899', flexShrink:0 }}/>
                      </span>
                    ) : (
                      <span onClick={() => copy(birth)} title="Clique para copiar"
                        style={{ fontSize:12, color:'#64748b', textAlign:'center', display:'block', cursor: e.is_block ? 'default' : 'pointer' }}>{e.is_block ? '—' : birth}</span>
                    )}

                    {/* Nac. */}
                    <div style={{ display:'flex', justifyContent:'center' }}>
                      {e.is_block
                        ? <span style={{ fontSize:11, color:'#cbd5e1' }}>—</span>
                        : <span onClick={() => copy(e.passenger_nationality)} title="Clique para copiar"
                            style={{ fontSize:11, fontWeight:600, color:'#475569', background:'#f1f5f9', padding:'2px 6px', borderRadius:4, cursor:'pointer' }}>{nat}</span>
                      }
                    </div>

                    {/* Gênero */}
                    <span onClick={() => copy(e.passenger_gender)} title="Clique para copiar"
                      style={{ fontSize:12, color:'#64748b', textAlign:'center', display:'block', cursor: e.is_block ? 'default' : 'pointer' }}>{e.is_block ? '—' : gen}</span>

                    {/* Passaporte(s) — número + sigla do país, até 2 */}
                    <span style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1, overflow:'hidden' }}>
                      {e.is_block || passports.length === 0 ? (
                        <span style={{ fontSize:12, color:'#475569' }}>—</span>
                      ) : passports.map((p, pi) => (
                        <span key={pi} onClick={() => copy(p.number)} title="Clique para copiar"
                          style={{ fontSize:11.5, color:'#475569', fontFamily:'monospace', display:'flex', alignItems:'center', gap:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'100%', cursor:'pointer' }}>
                          {p.number}
                          {p.country && (
                            <span style={{ fontSize:9.5, fontWeight:700, color:'#2e6db4', background:'#eff6ff', border:'1px solid #dbeafe', borderRadius:4, padding:'1px 4px', letterSpacing:'.03em', flexShrink:0 }}>{p.country.toUpperCase()}</span>
                          )}
                        </span>
                      ))}
                    </span>

                    {/* CPF */}
                    <span onClick={() => copy(e.passenger_cpf)} title="Clique para copiar"
                      style={{ fontSize:12, color:'#475569', fontFamily:'monospace', textAlign:'center', display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', cursor: e.is_block ? 'default' : 'pointer' }}>{e.is_block ? '—' : cpf}</span>

                    {/* Agência */}
                    <span onClick={() => copy(e.agency_name)} title="Clique para copiar"
                      style={{ fontSize:11, color:'#475569', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', cursor:'pointer' }}>
                      {e.agency_name || '—'}
                    </span>

                    {/* Embarque — aeroporto de saída (individual ou padrão da lista) */}
                    {isAereo && (() => {
                      const ap = e.departure_airport_data || defaultAirport
                      const isIndividual = !!e.departure_airport_data
                      const code = ap?.iata_code || (ap?.name?.slice(0,3).toUpperCase())
                      return (
                        <span title={ap ? `${ap.name}${ap.city ? ' — ' + ap.city : ''}${isIndividual ? ' (embarque individual)' : ' (padrão da lista)'}` : 'Não definido'}
                          style={{ display:'flex', justifyContent:'center' }}>
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
          onAdded={load}
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

/* ── Aba "Local de Embarque" ── */
/* ── Popup passageiros com embarque diferente do padrão ── */
function FeederLegsModal({ listId, airport, onClose }) {
  const [legs,     setLegs]     = useState([])
  const [loaded,   setLoaded]   = useState(false)
  const [legModal, setLegModal] = useState(null)
  const [delLeg,   setDelLeg]   = useState(null)

  const load = () =>
    listsApi.listFeederLegs(listId, airport.id).then(r => { setLegs(r.data); setLoaded(true) }).catch(() => {})

  useEffect(() => { load() }, [])

  const handleSave = async (data) => {
    const payload = { ...data, departure_airport: airport.id }
    if (legModal.initial) {
      await listsApi.updateFeederLeg(listId, legModal.initial.id, payload)
      toast.success('Trecho atualizado.')
    } else {
      await listsApi.addFeederLeg(listId, payload)
      toast.success('Trecho adicionado.')
    }
    setLegModal(null)
    load()
  }

  const handleDelete = async (leg) => {
    await listsApi.removeFeederLeg(listId, leg.id)
    setDelLeg(null)
    load()
  }

  const fmtDate = d => { if (!d) return null; const [y,m,day]=d.split('-'); return `${day}/${m}/${y}` }
  const fmtTime = t => t ? t.slice(0,5) : null

  const calcLayover = (prev, next) => {
    if (!prev.arrival_date || !prev.arrival_time || !next.departure_date || !next.departure_time) return null
    const from = new Date(`${prev.arrival_date}T${prev.arrival_time}`)
    const to   = new Date(`${next.departure_date}T${next.departure_time}`)
    const diff = to - from
    const h = Math.floor(Math.abs(diff)/3600000)
    const m = Math.floor((Math.abs(diff)%3600000)/60000)
    const label = h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`
    return { label, valid: diff > 0 }
  }

  const iata = airport.iata_code || airport.name.slice(0,3).toUpperCase()

  return (
    <div className="overlay" style={{ zIndex:830 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mbox" style={{ maxWidth:520 }}>
        <div className="mhead">
          <span className="mtitle" style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:12, color:'#92400e', background:'#fef3c7', border:'1px solid #fde68a', padding:'2px 8px', borderRadius:5 }}>{iata}</span>
            Voos de acesso — {airport.city || airport.name}
          </span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={14}/></button>
        </div>
        <div className="mbody">
          {!loaded ? (
            <p style={{ color:'#94a3b8', fontSize:13, margin:0 }}>Carregando…</p>
          ) : legs.length === 0 ? (
            <p style={{ color:'#94a3b8', fontSize:13, margin:'0 0 12px' }}>Nenhum trecho cadastrado.</p>
          ) : (
            <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden', marginBottom:12 }}>
              {legs.map((leg, idx) => (
                <React.Fragment key={leg.id}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 12px', background: idx%2===0?'#fff':'#fafbfc', borderBottom: idx < legs.length-1 ? '1px solid #f1f5f9' : 'none' }}>
                    {[leg.origin_airport_data, leg.destination_airport_data].map((ap, i) => (
                      <span key={i} style={{ display:'flex', alignItems:'center', gap:4 }}>
                        {i===1 && <span style={{ color:'#cbd5e1' }}>→</span>}
                        {ap ? (
                          <span style={{ display:'flex', alignItems:'center', gap:3 }}>
                            <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:11, color:'#1a2d4f', background:'#eff6ff', padding:'1px 5px', borderRadius:4, border:'1px solid #bfdbfe' }}>
                              {ap.iata_code || ap.name.slice(0,3).toUpperCase()}
                            </span>
                            <span style={{ fontSize:12, color:'#1e293b', fontWeight:500 }}>{ap.city || ap.name}</span>
                          </span>
                        ) : <span style={{ fontSize:12, color:'#cbd5e1', fontStyle:'italic' }}>—</span>}
                      </span>
                    ))}
                    <span style={{ flex:1 }}/>
                    {leg.flight_number && <span style={{ fontSize:11, fontFamily:'monospace', fontWeight:700, color:'#475569', background:'#f1f5f9', padding:'1px 6px', borderRadius:4 }}>{leg.flight_number}</span>}
                    {leg.airline && <span style={{ fontSize:11, color:'#64748b' }}>{leg.airline}</span>}
                    {(leg.departure_date||leg.departure_time) && <span style={{ fontSize:11, color:'#94a3b8' }}>{[fmtDate(leg.departure_date),fmtTime(leg.departure_time)].filter(Boolean).join(' ')}</span>}
                    {leg.blocked_seats != null && <span style={{ fontSize:10, fontWeight:700, color:'#1a2d4f', background:'#eff6ff', border:'1px solid #bfdbfe', padding:'1px 6px', borderRadius:20 }}>🔒 {leg.blocked_seats}</span>}
                    <button type="button" onClick={() => setLegModal({ initial: leg })}
                      style={{ width:26, height:26, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:5, border:'1.5px solid #e2e8f0', background:'#fff', color:'#64748b', cursor:'pointer' }}>
                      <Ic n="edit" s={11}/>
                    </button>
                    <button type="button" onClick={() => setDelLeg(leg)}
                      style={{ width:26, height:26, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:5, border:'1.5px solid #fee2e2', background:'#fff', color:'#dc2626', cursor:'pointer' }}>
                      <Ic n="trash" s={11}/>
                    </button>
                  </div>
                  {idx < legs.length - 1 && (() => {
                    const ly = calcLayover(leg, legs[idx+1])
                    const conAp = leg.destination_airport_data
                    return (
                      <div style={{ display:'flex', alignItems:'center', background:'#f8fafc', borderBottom:'1px solid #f1f5f9' }}>
                        <div style={{ flex:1, height:1, background:'#e2e8f0' }}/>
                        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', fontSize:11 }}>
                          <span style={{ color:'#94a3b8' }}>✈</span>
                          {ly ? (
                            <span style={{ fontWeight:700, color: ly.valid ? '#0f766e' : '#b45309', background: ly.valid ? '#f0fdf4' : '#fffbeb', border:`1px solid ${ly.valid ? '#bbf7d0' : '#fde68a'}`, padding:'1px 7px', borderRadius:20 }}>
                              {ly.valid ? '' : '⚠ '}{ly.label} de conexão
                            </span>
                          ) : null}
                          {conAp && <span style={{ color:'#64748b' }}><strong>{conAp.city||conAp.name}</strong> <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:10, color:'#1a2d4f', background:'#eff6ff', padding:'1px 5px', borderRadius:4, border:'1px solid #bfdbfe' }}>{conAp.iata_code}</span></span>}
                        </div>
                        <div style={{ flex:1, height:1, background:'#e2e8f0' }}/>
                      </div>
                    )
                  })()}
                </React.Fragment>
              ))}
            </div>
          )}
          <button type="button"
            onClick={() => {
              const last = legs.length > 0 ? legs[legs.length-1] : null
              setLegModal({
                initial: null,
                prefill: last ? {
                  origin_airport_data: last.destination_airport_data,
                  departure_date: last.arrival_date || '',
                  departure_time: last.arrival_time ? last.arrival_time.slice(0,5) : '',
                } : {
                  origin_airport_data: airport,
                },
              })
            }}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:7, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            <Ic n="plus" s={11}/> Adicionar trecho
          </button>
        </div>
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onClose}>Fechar</button>
        </div>
      </div>

      {legModal && (
        <FlightLegModal
          initial={legModal.initial}
          prefill={legModal.prefill}
          direction="ida"
          zIndex={860}
          onSave={handleSave}
          onClose={() => setLegModal(null)}
        />
      )}
      {delLeg && (
        <ConfirmModal
          message={`Remover trecho ${delLeg.origin_airport_data?.iata_code||'?'} → ${delLeg.destination_airport_data?.iata_code||'?'}?`}
          onOk={() => handleDelete(delLeg)}
          onCancel={() => setDelLeg(null)}
        />
      )}
    </div>
  )
}

function BoardingInfoModal({ listId, defAirport, onClose }) {
  const [enrolled,  setEnrolled]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [feederAp,  setFeederAp]  = useState(null)
  const [feederLegs, setFeederLegs] = useState([])
  const [addingAp,  setAddingAp]  = useState(false)

  const loadFeederLegs = () =>
    listsApi.listFeederLegs(listId).then(r => setFeederLegs(r.data)).catch(() => {})

  useEffect(() => {
    listsApi.listPassengers(listId)
      .then(r => setEnrolled(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
    loadFeederLegs()
  }, [listId])

  const active      = enrolled.filter(e => e.enrollment_status !== 'cancelado')
  const nonDefault  = active.filter(e => !!e.departure_airport_data)

  // Aeroportos únicos: passageiros + aeroportos que têm feeder legs
  const airportMap = {}
  active.forEach(e => {
    const ap  = e.departure_airport_data || defAirport
    const key = ap ? String(ap.id) : '__none__'
    if (!airportMap[key]) airportMap[key] = { ap, count: 0 }
    airportMap[key].count++
  })
  feederLegs.forEach(leg => {
    if (!leg.departure_airport) return
    const ap  = leg.departure_airport_data || { id: leg.departure_airport }
    const key = String(ap.id)
    if (!airportMap[key]) airportMap[key] = { ap, count: 0 }
  })
  const airportGroups = Object.values(airportMap).sort((a, b) => b.count - a.count)

  const IataChip = ({ ap, amber }) => (
    <span style={{
      fontFamily:'monospace', fontWeight:700, fontSize:11, padding:'1px 7px',
      borderRadius:5, letterSpacing:'.03em', flexShrink:0,
      color:      amber ? '#92400e' : '#1a2d4f',
      background: amber ? '#fef3c7' : '#eff6ff',
      border:     amber ? '1.5px solid #f59e0b' : '1px solid #bfdbfe',
    }}>
      {ap.iata_code || ap.name.slice(0,3).toUpperCase()}
    </span>
  )

  return (
    <div className="overlay" style={{ zIndex:800 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mbox" style={{ maxWidth:520 }}>
        <div className="mhead">
          <span className="mtitle">Aeroportos de embarque</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={14}/></button>
        </div>
        <div className="mbody">
          {loading ? (
            <p style={{ color:'#94a3b8', fontSize:13, margin:0 }}>Carregando…</p>
          ) : (
            <>
              {/* Todos os aeroportos */}
              <div style={{ marginBottom:20 }}>
                <div style={{ display:'flex', alignItems:'center', marginBottom:10 }}>
                  <p style={{ margin:0, flex:1, fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em' }}>Aeroportos</p>
                  <button type="button" onClick={() => setAddingAp(true)}
                    style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:6, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                    <Ic n="plus" s={10}/> Aeroporto
                  </button>
                </div>
                {addingAp && (
                  <div className="overlay" style={{ zIndex:830 }} onMouseDown={e => { if (e.target === e.currentTarget) setAddingAp(false) }}>
                    <div className="mbox" style={{ maxWidth:400 }}>
                      <div className="mhead">
                        <span className="mtitle">Adicionar aeroporto</span>
                        <button className="mclose" onClick={() => setAddingAp(false)}><Ic n="x" s={14}/></button>
                      </div>
                      <div className="mbody">
                        <AirportPicker
                          value={null}
                          placeholder="Buscar aeroporto…"
                          onChange={ap => { setAddingAp(false); setFeederAp(ap) }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden' }}>
                  {airportGroups.map(({ ap, count }, idx) => {
                    const isDefAp = defAirport && ap && ap.id === defAirport.id
                    return (
                      <div key={ap ? ap.id : '__none__'}
                        onClick={() => ap && setFeederAp(ap)}
                        style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 14px', borderBottom: idx < airportGroups.length-1 ? '1px solid #f1f5f9' : 'none', background: isDefAp ? '#f0f7ff' : idx%2===0 ? '#fff' : '#fafbfc', cursor: ap ? 'pointer' : 'default', transition:'background .12s' }}
                        onMouseEnter={e => { if (ap) e.currentTarget.style.background = isDefAp ? '#dbeafe' : '#f1f5f9' }}
                        onMouseLeave={e => { if (ap) e.currentTarget.style.background = isDefAp ? '#f0f7ff' : idx%2===0 ? '#fff' : '#fafbfc' }}>
                        {ap ? <IataChip ap={ap} amber={!isDefAp} /> : <span style={{ fontSize:12, color:'#cbd5e1' }}>—</span>}
                        <span style={{ flex:1, fontSize:13, color:'#1e293b' }}>{ap ? ap.name : 'Não definido'}</span>
                        {isDefAp && <span style={{ fontSize:10, fontWeight:700, color:'#1a2d4f', background:'#dbeafe', padding:'1px 6px', borderRadius:4 }}>PADRÃO</span>}
                        <span style={{ fontSize:12, color:'#64748b', fontWeight:600 }}>{count} pax</span>
                        {ap && <span style={{ fontSize:11, color:'#94a3b8' }}>✈</span>}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Passageiros fora do padrão */}
              <div style={{ marginBottom:20 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                  <p style={{ margin:0, fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em' }}>Embarques diferentes do padrão</p>
                  {nonDefault.length > 0 && (
                    <span style={{ fontSize:11, fontWeight:700, color:'#92400e', background:'#fef3c7', border:'1.5px solid #f59e0b', padding:'1px 7px', borderRadius:20 }}>{nonDefault.length}</span>
                  )}
                </div>
                {nonDefault.length === 0 ? (
                  <p style={{ color:'#94a3b8', fontSize:13, margin:0 }}>Todos embarcam pelo aeroporto padrão.</p>
                ) : (
                  <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden' }}>
                    {nonDefault.map((e, idx) => {
                      const ap = e.departure_airport_data
                      return (
                        <div key={e.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 14px', borderBottom: idx < nonDefault.length-1 ? '1px solid #f1f5f9' : 'none', background: idx%2===0 ? '#fff' : '#fafbfc' }}>
                          <span style={{ flex:1, fontSize:13, fontWeight:500, color:'#1e293b' }}>
                            {e.passenger_name || <span style={{ color:'#f59e0b', fontStyle:'italic' }}>[{e.block_agency}]</span>}
                          </span>
                          <IataChip ap={ap} amber />
                          <span style={{ fontSize:12, color:'#475569' }}>{ap.city || ap.name}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

            </>
          )}
        </div>
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onClose}>Fechar</button>
        </div>
      </div>
      {feederAp && (
        <FeederLegsModal listId={listId} airport={feederAp} onClose={() => { setFeederAp(null); loadFeederLegs() }} />
      )}
    </div>
  )
}

/* ── Modal criar/editar trecho de voo ── */
function FlightLegModal({ initial, prefill, direction, onSave, onClose, zIndex, hideBlockedSeats }) {
  const isEdit = !!initial
  const [origin,      setOrigin]      = useState(initial?.origin_airport_data      || prefill?.origin_airport_data || null)
  const [dest,        setDest]        = useState(initial?.destination_airport_data || null)
  const [fnum,        setFnum]        = useState(initial?.flight_number || '')
  const [airline,     setAirline]     = useState(initial?.airline || '')
  const [date,        setDate]        = useState(initial?.departure_date || prefill?.departure_date || '')
  const [time,        setTime]        = useState(initial?.departure_time?.slice(0,5) || prefill?.departure_time || '')
  const [arrivalDate,    setArrivalDate]    = useState(initial?.arrival_date || '')
  const [arrivalTime,    setArrivalTime]    = useState(initial?.arrival_time?.slice(0,5) || '')
  const [blockedSeats,   setBlockedSeats]   = useState(initial?.blocked_seats ?? '')
  const [saving,         setSaving]         = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave({
        direction,
        origin_airport:      origin?.id ?? null,
        destination_airport: dest?.id   ?? null,
        flight_number:       fnum.trim().toUpperCase(),
        airline:             airline.trim(),
        departure_date:      date        || null,
        departure_time:      time        || null,
        arrival_date:        arrivalDate || null,
        arrival_time:        arrivalTime || null,
        blocked_seats:       blockedSeats !== '' ? Number(blockedSeats) : null,
        order:               initial?.order ?? 0,
      })
      onClose()
    } catch { toast.error('Erro ao salvar trecho.') }
    finally { setSaving(false) }
  }

  const dirLabel = direction === 'ida' ? 'Ida' : direction === 'volta' ? 'Volta' : 'Acesso'

  return (
    <div className="overlay" style={{ zIndex: zIndex ?? 810 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mbox" style={{ maxWidth:460 }}>
        <div className="mhead">
          <span className="mtitle">{isEdit ? 'Editar trecho' : `Novo trecho — ${dirLabel}`}</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={14}/></button>
        </div>
        <div className="mbody">
          {/* Origem → Destino */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 32px 1fr', gap:8, alignItems:'end', marginBottom:14 }}>
            <div className="ff" style={{ margin:0 }}>
              <label className="fl">Aeroporto de origem</label>
              <AirportPicker value={origin} onChange={setOrigin} placeholder="Buscar origem…" />
            </div>
            <div style={{ textAlign:'center', fontSize:16, color:'#94a3b8', paddingBottom:8 }}>→</div>
            <div className="ff" style={{ margin:0 }}>
              <label className="fl">Aeroporto de destino</label>
              <AirportPicker value={dest} onChange={setDest} placeholder="Buscar destino…" />
            </div>
          </div>
          {/* Número do voo + Companhia */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
            <div className="ff" style={{ margin:0 }}>
              <label className="fl">Número do voo</label>
              <input className="fi" value={fnum} onChange={e => setFnum(e.target.value)} placeholder="Ex: LA8084" style={{ textTransform:'uppercase' }} />
            </div>
            <div className="ff" style={{ margin:0 }}>
              <label className="fl">Companhia aérea</label>
              <AirlinePicker value={airline} onChange={setAirline} />
            </div>
          </div>
          {/* Partida */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 120px', gap:10, marginBottom:14 }}>
            <div className="ff" style={{ margin:0 }}>
              <label className="fl">Data de partida</label>
              <DatePicker fixed value={date} onChange={setDate} />
            </div>
            <div className="ff" style={{ margin:0 }}>
              <label className="fl">Horário partida</label>
              <input className="fi" type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>
          {/* Chegada */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 120px', gap:10, marginBottom:14 }}>
            <div className="ff" style={{ margin:0 }}>
              <label className="fl">Data de chegada</label>
              <DatePicker fixed value={arrivalDate} onChange={setArrivalDate} />
            </div>
            <div className="ff" style={{ margin:0 }}>
              <label className="fl">Horário chegada</label>
              <input className="fi" type="time" value={arrivalTime} onChange={e => setArrivalTime(e.target.value)} />
            </div>
          </div>
          {/* Lugares bloqueados */}
          {!hideBlockedSeats && (
            <div className="ff" style={{ margin:0 }}>
              <label className="fl">Lugares bloqueados</label>
              <input className="fi" type="number" min="0" max="999" value={blockedSeats}
                onChange={e => setBlockedSeats(e.target.value)}
                placeholder="Qtd. de assentos reservados no bloqueio" />
            </div>
          )}
        </div>
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Aba de Voos ── */
function FlightsTab({ listId, list }) {
  const [legs,      setLegs]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [legModal,  setLegModal]  = useState(null)   // null | { direction, initial? }
  const [delConfirm, setDelConfirm] = useState(null) // null | leg
  const [showBoarding, setShowBoarding] = useState(false)
  const defAirport = list.default_airport_data || null

  const load = useCallback(() => {
    listsApi.listFlights(listId)
      .then(r => setLegs(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [listId])

  useEffect(() => { load() }, [load])

  const handleSave = async (data) => {
    if (legModal.initial) {
      await listsApi.updateFlight(listId, legModal.initial.id, data)
      toast.success('Trecho atualizado.')
    } else {
      await listsApi.addFlight(listId, data)
      toast.success('Trecho adicionado.')
    }
    load()
  }

  const handleDelete = async (leg) => {
    await listsApi.removeFlight(listId, leg.id)
    toast.success('Trecho removido.')
    setDelConfirm(null)
    load()
  }

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

  const ida   = legs.filter(l => l.direction === 'ida')
  const volta = legs.filter(l => l.direction === 'volta')

  const fmtDate = d => {
    if (!d) return null
    const [y, m, day] = d.split('-')
    return `${day}/${m}/${y}`
  }
  const fmtTime = t => t ? t.slice(0,5) : null

  const LegRow = ({ leg, idx, total }) => (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderBottom: idx < total-1 ? '1px solid #f1f5f9' : 'none', background: idx%2===0 ? '#fff' : '#fafbfc' }}>
      {/* Rota */}
      <div style={{ display:'flex', alignItems:'center', gap:8, flex:1, minWidth:0 }}>
        {[leg.origin_airport_data, leg.destination_airport_data].map((ap, i) => (
          <span key={i} style={{ display:'flex', alignItems:'center', gap:4 }}>
            {i === 1 && <span style={{ color:'#cbd5e1', fontSize:14 }}>→</span>}
            {ap ? (
              <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:12, color:'#1a2d4f', background:'#eff6ff', padding:'2px 7px', borderRadius:5, border:'1px solid #bfdbfe' }}>
                  {ap.iata_code || ap.name.slice(0,3).toUpperCase()}
                </span>
                <span style={{ fontSize:13, color:'#1e293b', fontWeight:500 }}>{ap.city || ap.name}</span>
              </span>
            ) : (
              <span style={{ fontSize:13, color:'#cbd5e1', fontStyle:'italic' }}>—</span>
            )}
          </span>
        ))}
      </div>
      {/* Detalhes */}
      <div style={{ display:'flex', alignItems:'center', gap:14, flexShrink:0 }}>
        {leg.flight_number && (
          <span style={{ fontSize:12, fontWeight:700, fontFamily:'monospace', color:'#475569', background:'#f1f5f9', padding:'2px 8px', borderRadius:5 }}>
            {leg.flight_number}
          </span>
        )}
        {leg.airline && (
          <span style={{ fontSize:12, color:'#64748b' }}>{leg.airline}</span>
        )}
        {(leg.departure_date || leg.departure_time) && (
          <span style={{ fontSize:12, color:'#94a3b8' }}>
            {[fmtDate(leg.departure_date), fmtTime(leg.departure_time)].filter(Boolean).join(' · ')}
          </span>
        )}
        {leg.blocked_seats != null && (
          <span style={{ fontSize:11, fontWeight:700, color:'#1a2d4f', background:'#eff6ff', border:'1px solid #bfdbfe', padding:'2px 8px', borderRadius:20, display:'flex', alignItems:'center', gap:4 }}>
            🔒 {leg.blocked_seats} lugares
          </span>
        )}
        <button type="button" onClick={() => setLegModal({ direction: leg.direction, initial: leg })}
          style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:'1.5px solid #e2e8f0', background:'#fff', color:'#64748b', cursor:'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor='#1a2d4f'; e.currentTarget.style.color='#1a2d4f' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.color='#64748b' }}>
          <Ic n="edit" s={12}/>
        </button>
        <button type="button" onClick={() => setDelConfirm(leg)}
          style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:'1.5px solid #fee2e2', background:'#fff', color:'#dc2626', cursor:'pointer' }}
          onMouseEnter={e => e.currentTarget.style.background='#fef2f2'}
          onMouseLeave={e => e.currentTarget.style.background='#fff'}>
          <Ic n="trash" s={12}/>
        </button>
      </div>
    </div>
  )

  const calcLayover = (prev, next) => {
    if (!prev.arrival_date || !prev.arrival_time || !next.departure_date || !next.departure_time) return null
    const from = new Date(`${prev.arrival_date}T${prev.arrival_time}`)
    const to   = new Date(`${next.departure_date}T${next.departure_time}`)
    const diff = to - from
    const h = Math.floor(Math.abs(diff) / 3600000)
    const m = Math.floor((Math.abs(diff) % 3600000) / 60000)
    const label = h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`
    return { label, valid: diff > 0 }
  }

  const ConnectionBadge = ({ prev, next }) => {
    const ap      = prev.destination_airport_data
    const layover = calcLayover(prev, next)
    const missingArrival   = !prev.arrival_date || !prev.arrival_time
    const missingDeparture = !next.departure_date || !next.departure_time
    return (
      <div style={{ display:'flex', alignItems:'center', background:'#f8fafc', borderTop:'1px solid #e2e8f0', borderBottom:'1px solid #e2e8f0' }}>
        <div style={{ flex:1, height:1, background:'#e2e8f0' }} />
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 16px', flexShrink:0 }}>
          <span style={{ fontSize:15, color:'#94a3b8' }}>✈</span>
          {layover ? (
            layover.valid ? (
              <span style={{ fontSize:12, fontWeight:700, color:'#0f766e', background:'#f0fdf4', border:'1px solid #bbf7d0', padding:'2px 8px', borderRadius:20 }}>
                {layover.label} de conexão
              </span>
            ) : (
              <span style={{ fontSize:12, fontWeight:700, color:'#b45309', background:'#fffbeb', border:'1px solid #fde68a', padding:'2px 8px', borderRadius:20 }}>
                ⚠ {layover.label} (verificar horários)
              </span>
            )
          ) : (
            <span style={{ fontSize:11, fontWeight:600, color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a', padding:'2px 8px', borderRadius:20 }}>
              {missingArrival ? 'preencha a chegada do voo anterior' : missingDeparture ? 'preencha a partida do próximo voo' : '—'}
            </span>
          )}
          {ap ? (
            <span style={{ fontSize:12, color:'#475569', display:'flex', alignItems:'center', gap:5 }}>
              {ap.city && <span style={{ fontWeight:600, color:'#1e293b' }}>{ap.city}</span>}
              <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:11, color:'#1a2d4f', background:'#eff6ff', padding:'1px 6px', borderRadius:4, border:'1px solid #bfdbfe' }}>
                {ap.iata_code || ap.name.slice(0,3).toUpperCase()}
              </span>
              <span style={{ color:'#94a3b8' }}>{ap.name}</span>
            </span>
          ) : (
            <span style={{ fontSize:12, color:'#94a3b8', fontStyle:'italic' }}>aeroporto de conexão não definido</span>
          )}
        </div>
        <div style={{ flex:1, height:1, background:'#e2e8f0' }} />
      </div>
    )
  }

  const Section = ({ direction, title, legsList }) => (
    <div style={{ marginBottom:28 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div className="section-title" style={{ marginBottom:0 }}>{title}</div>
          {legsList.length > 0 && (
            <span style={{ fontSize:11, fontWeight:600, color:'#64748b', background:'#f1f5f9', padding:'2px 8px', borderRadius:20 }}>
              {legsList.length} trecho{legsList.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button type="button" onClick={() => {
          const last = legsList.length > 0 ? legsList[legsList.length - 1] : null
          setLegModal({
            direction,
            initial: null,
            prefill: last ? {
              origin_airport_data: last.destination_airport_data,
              departure_date:      last.arrival_date || '',
              departure_time:      last.arrival_time ? last.arrival_time.slice(0, 5) : '',
            } : null,
          })
        }}
          style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:7, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor='#1a2d4f'; e.currentTarget.style.color='#1a2d4f' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.color='#475569' }}>
          <Ic n="plus" s={12}/> Adicionar trecho
        </button>
      </div>
      {legsList.length === 0 ? (
        <div style={{ textAlign:'center', padding:'24px 0', background:'#f8fafc', borderRadius:10, border:'1px dashed #e2e8f0' }}>
          <p style={{ margin:0, fontSize:13, color:'#94a3b8' }}>Nenhum trecho cadastrado. Clique em "Adicionar trecho".</p>
        </div>
      ) : (
        <div style={{ border:'1px solid #e2e8f0', borderRadius:10, overflow:'hidden' }}>
          {legsList.map((leg, idx) => (
            <>
              <LegRow key={leg.id} leg={leg} idx={idx} total={legsList.length} />
              {idx < legsList.length - 1 && (
                <ConnectionBadge key={`conn-${leg.id}`} prev={leg} next={legsList[idx + 1]} />
              )}
            </>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="det-card">
      <div className="section">
        {/* Cabeçalho com botão de embarques */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', marginBottom:20 }}>
          <button type="button" onClick={() => setShowBoarding(true)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor='#1a2d4f'; e.currentTarget.style.color='#1a2d4f' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.color='#475569' }}>
            <Ic n="users" s={13}/> Aeroportos dos passageiros
          </button>
        </div>

        {loading ? (
          <p style={{ color:'#94a3b8', fontSize:13 }}>Carregando…</p>
        ) : (
          <>
            <Section direction="ida"   title="✈ Ida"   legsList={ida}   />
            <Section direction="volta" title="✈ Volta" legsList={volta} />
          </>
        )}
      </div>

      {legModal && (
        <FlightLegModal
          initial={legModal.initial}
          prefill={legModal.prefill}
          direction={legModal.direction}
          onSave={handleSave}
          onClose={() => setLegModal(null)}
        />
      )}
      {delConfirm && (
        <ConfirmModal
          message={`Remover trecho ${delConfirm.origin_airport_data?.iata_code || '?'} → ${delConfirm.destination_airport_data?.iata_code || '?'}?`}
          onOk={() => handleDelete(delConfirm)}
          onCancel={() => setDelConfirm(null)}
        />
      )}
      {showBoarding && (
        <BoardingInfoModal listId={listId} defAirport={defAirport} onClose={() => setShowBoarding(false)} />
      )}
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
              <Chip label="Capacidade"     value={list.block_capacity > 0 ? String(list.block_capacity) : '—'} />
              <Chip label="Acomodações"    value={list.total_accommodations > 0 ? String(list.total_accommodations) : '—'} />
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
