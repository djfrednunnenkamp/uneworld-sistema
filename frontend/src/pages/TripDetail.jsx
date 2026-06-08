import { useEffect, useState, useCallback, useRef } from 'react'
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

/* ── Chip de info ── */
function Chip({ label, value }) {
  if (!value) return null
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
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
function AccomPickerModal({ enrollmentIds, enrolled, accomTypes, onConfirm, onClose }) {
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
function EditAccomTypeModal({ roomName, accomTypes, enrolled, listId, onSaved, onClose }) {
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
                      style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 4px', borderRadius:6, cursor: clickable ? 'pointer' : 'default', transition:'background .1s' }}
                      onMouseEnter={ev => { if (clickable) ev.currentTarget.style.background='#e2e8f0' }}
                      onMouseLeave={ev => { ev.currentTarget.style.background='transparent' }}>
                      <span style={{ color:'#94a3b8', fontSize:12 }}>•</span>
                      <span style={{ fontSize:13, color: clickable ? '#1a2d4f' : '#1e293b', fontWeight: clickable ? 600 : 400, textDecoration: clickable ? 'underline' : 'none', textDecorationStyle:'dotted', textUnderlineOffset:3 }}>
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

        <div style={{ padding:'0 22px 18px', display:'flex', gap:8, justifyContent:'flex-end' }}>
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

/* ── Painel de métricas — faixas etárias, acomodações e vagas para venda ── */
const AGE_ROWS = [
  { test: a => a >= 60,            label:'Acima de 60 anos'  },
  { test: a => a >= 12 && a < 60,  label:'Adultos 12-59 anos' },
  { test: a => a >= 2  && a < 12,  label:'Crianças 2-11 anos' },
  { test: a => a < 2,              label:'Infantil < 2 anos'  },
]

function MetricRow({ label, value }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'5px 0' }}>
      <span style={{ fontSize:13, color:'#475569' }}>{label}</span>
      <span style={{ fontSize:11, fontWeight:700, color:'#64748b', background:'#f1f5f9', borderRadius:20, minWidth:24, textAlign:'center', padding:'2px 8px' }}>
        {value}
      </span>
    </div>
  )
}

function MetricsPanel({ enrolled, accomTypes, blockCapacity }) {
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
    accomCounts[label] = (accomCounts[label] || 0) + 1
  })

  const available = blockCapacity > 0 ? Math.max(0, blockCapacity - enrolled.length) : null

  return (
    <div style={{ display:'flex', gap:20, alignItems:'stretch', flexWrap:'wrap', background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:'16px 20px', marginBottom:16, boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
      <div style={{ flex:1, minWidth:220 }}>
        {AGE_ROWS.map((r, i) => <MetricRow key={r.label} label={r.label} value={ageCounts[i]} />)}
        <div style={{ height:1, background:'#f1f5f9', margin:'6px 0' }} />
        {Object.entries(accomCounts).map(([label, count]) => (
          <MetricRow key={label} label={`Apto. ${label}`} value={count} />
        ))}
        <MetricRow label="Total de acomodações" value={roomNames.length} />
        <div style={{ height:1, background:'#f1f5f9', margin:'6px 0' }} />
        <MetricRow label="Total de passageiros" value={enrolled.length} />
      </div>
      {available != null && (
        <div style={{ flexShrink:0, width:200, borderRadius:10, background:'linear-gradient(135deg,#16a34a,#15803d)', color:'#fff', display:'flex', flexDirection:'column', alignItems:'flex-end', justifyContent:'center', padding:'18px 22px', gap:2 }}>
          <span style={{ fontSize:34, fontWeight:800, lineHeight:1 }}>{available}</span>
          <span style={{ fontSize:13, fontWeight:600, textAlign:'right' }}>Disponíveis para venda</span>
        </div>
      )}
    </div>
  )
}

/* ── Aba de Passageiros ── */
function PassengersTab({ listId, listType, blockCapacity }) {
  const [enrolled,   setEnrolled]   = useState([])
  const [accomTypes, setAccomTypes] = useState([])
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

  const load = useCallback(() => {
    setLoading(true)
    listsApi.listPassengers(listId)
      .then(r => setEnrolled(r.data))
      .catch(() => toast.error('Erro ao carregar passageiros.'))
      .finally(() => setLoading(false))
  }, [listId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    configApi.accommodations().then(r => setAccomTypes(r.data.results ?? r.data)).catch(() => {})
  }, [])

  const toggleSelect  = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll     = ()   => setSelected(s => s.size === enrolled.length ? new Set() : new Set(enrolled.map(e => e.id)))
  const clearSelect   = ()   => setSelected(new Set())

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

  const toggleStatus = async (e) => {
    const next = e.enrollment_status === 'confirmado' ? 'pendente' : 'confirmado'
    await listsApi.updatePassenger(listId, e.id, { enrollment_status: next }).catch(() => {})
    load()
  }

  // Agrupar por acomodação — sem acomodação sempre no topo
  const UNASSIGNED = '(sem acomodação)'
  const seen = {}
  const groups = []
  enrolled.forEach(e => {
    const key = e.accommodation || UNASSIGNED
    if (!seen[key]) { seen[key] = []; groups.push({ key, rows: seen[key] }) }
    seen[key].push(e)
  })
  groups.sort((a, b) => a.key === UNASSIGNED ? -1 : b.key === UNASSIGNED ? 1 : 0)

  // Número sequencial global
  let seq = 0
  const seqMap = {}
  enrolled.forEach(e => { seq++; seqMap[e.id] = seq })

  const isAereo = listType === 'aereo'

  const allSelected = enrolled.length > 0 && selected.size === enrolled.length

  return (
    <div>
      {/* Métricas */}
      {!loading && enrolled.length > 0 && (
        <MetricsPanel enrolled={enrolled} accomTypes={accomTypes} blockCapacity={blockCapacity} />
      )}

      {/* Toolbar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: selected.size > 0 ? 8 : 16 }}>
        <span style={{ fontSize:14, fontWeight:600, color:'#1e293b' }}>
          {enrolled.length} passageiro{enrolled.length !== 1 ? 's' : ''}
        </span>
        <button type="button" onClick={() => setShowAdd(true)}
          style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
          + Adicionar passageiro
        </button>
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
          <div style={{ display:'grid', gridTemplateColumns:'32px 40px 24px 28px 1fr 100px 52px 40px 130px 130px 120px 70px', columnGap:10, padding:'9px 12px', background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }}>
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
              {h:'Pass / RG', align:'center'},
              {h:'CPF',       align:'center'},
              {h:'Agência',   align:'left'},
              {h:'Ações',     align:'center'},
            ].map(({h, align}, i) => (
              <span key={i} style={{ fontSize:10, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.05em', textAlign: align }}>{h}</span>
            ))}
          </div>

          {/* Grupos por acomodação */}
          {groups.map(({ key, rows }) => {
            const isUnassigned = key === '(sem acomodação)'
            // Validação de capacidade — detecta tipo pelo prefixo (ex: "Duplo 2" → tipo "Duplo")
            const accomType = !isUnassigned
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
            return (
            <div key={key}>
              {/* Header do grupo */}
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px',
                background: isUnassigned ? '#fffbeb' : '#f1f5f9',
                borderBottom: `1px solid ${isUnassigned ? '#fde68a' : '#e2e8f0'}`,
                borderTop:    `1px solid ${isUnassigned ? '#fde68a' : '#e2e8f0'}`,
              }}>
                {isUnassigned ? (
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
                      onClick={() => setEditAccomType(key)}
                      title="Editar tipo da acomodação"
                      style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:13, padding:0, lineHeight:1 }}
                      onMouseEnter={e => e.currentTarget.style.color='#1a2d4f'}
                      onMouseLeave={e => e.currentTarget.style.color='#94a3b8'}>
                      ✎
                    </button>
                  </>
                )}
              </div>

              {/* Linhas dos passageiros */}
              {rows.map((e, ri) => {
                const dot = STATUS_DOT[e.enrollment_status] || STATUS_DOT.pendente
                const nat = (e.passenger_nationality || '').slice(0,3).toUpperCase() || '—'
                const gen = e.passenger_gender ? e.passenger_gender[0].toUpperCase() : '—'
                const doc = e.passenger_passport || e.passenger_rg || '—'
                const cpf = e.passenger_cpf || '—'
                const birth = e.passenger_birth_date ? fmt(e.passenger_birth_date) : '—'

                return (
                  <div key={e.id}
                    style={{ display:'grid', gridTemplateColumns:'32px 40px 24px 28px 1fr 100px 52px 40px 130px 130px 120px 70px', columnGap:10, padding:'9px 12px', borderBottom: ri < rows.length-1 ? '1px solid #f8fafc' : 'none', background: selected.has(e.id) ? '#eff6ff' : ri%2===0 ? '#fff' : '#fafbfc', alignItems:'center' }}
                    onMouseEnter={ev => ev.currentTarget.style.background='#f0f7ff'}
                    onMouseLeave={ev => ev.currentTarget.style.background = ri%2===0 ? '#fff' : '#fafbfc'}>

                    {/* Checkbox */}
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelect(e.id)}
                        style={{ width:15, height:15, cursor:'pointer', accentColor:'#1a2d4f' }} />
                    </div>

                    {/* Nº */}
                    <span style={{ textAlign:'center', fontSize:12, fontWeight:600, color:'#94a3b8' }}>{seqMap[e.id]}</span>

                    {/* Status dot */}
                    <div title={dot.title} onClick={() => toggleStatus(e)} style={{ cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <div style={{ width:10, height:10, borderRadius:'50%', background:dot.bg, boxShadow:`0 0 0 2px ${dot.bg}30` }} />
                    </div>

                    {/* ✈ (modo de transporte) */}
                    {isAereo
                      ? <span style={{ fontSize:14, textAlign:'center' }}>✈</span>
                      : <span style={{ fontSize:14, textAlign:'center' }}>🚌</span>
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
                        <p style={{ margin:0, fontSize:13, fontWeight:600, color:'#1e293b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {e.passenger_name}
                        </p>
                      )}
                    </div>

                    {/* Nasc. */}
                    <span style={{ fontSize:12, color:'#64748b', textAlign:'center', display:'block' }}>{e.is_block ? '—' : birth}</span>

                    {/* Nac. */}
                    <div style={{ display:'flex', justifyContent:'center' }}>
                      {e.is_block
                        ? <span style={{ fontSize:11, color:'#cbd5e1' }}>—</span>
                        : <span style={{ fontSize:11, fontWeight:600, color:'#475569', background:'#f1f5f9', padding:'2px 6px', borderRadius:4 }}>{nat}</span>
                      }
                    </div>

                    {/* Gênero */}
                    <span style={{ fontSize:12, color:'#64748b', textAlign:'center', display:'block' }}>{e.is_block ? '—' : gen}</span>

                    {/* Pass/RG */}
                    <span style={{ fontSize:12, color:'#475569', fontFamily:'monospace', textAlign:'center', display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.is_block ? '—' : doc}</span>

                    {/* CPF */}
                    <span style={{ fontSize:12, color:'#475569', fontFamily:'monospace', textAlign:'center', display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.is_block ? '—' : cpf}</span>

                    {/* Agência */}
                    <span style={{ fontSize:11, color:'#475569', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {e.agency_name || '—'}
                    </span>

                    {/* Ações */}
                    <div style={{ display:'flex', gap:3, justifyContent:'center' }}>
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
                      {/* Acomodação — disponível para todos */}
                      <button type="button"
                        onClick={() => setAccomModal({ enrollmentIds: [e.id] })}
                        title={isUnassigned ? 'Adicionar à acomodação' : 'Alterar acomodação'}
                        style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border: isUnassigned ? '1.5px solid #f59e0b' : '1px solid #e2e8f0', background: isUnassigned ? '#fffbeb' : '#fff', color: isUnassigned ? '#92400e' : '#64748b', fontSize:11, cursor:'pointer' }}
                        onMouseEnter={ev => { ev.currentTarget.style.borderColor='#1a2d4f'; ev.currentTarget.style.color='#1a2d4f'; if (isUnassigned) ev.currentTarget.style.background='#fde68a' }}
                        onMouseLeave={ev => { ev.currentTarget.style.borderColor= isUnassigned ? '#f59e0b' : '#e2e8f0'; ev.currentTarget.style.color= isUnassigned ? '#92400e' : '#64748b'; if (isUnassigned) ev.currentTarget.style.background='#fffbeb' }}>
                        🛏
                      </button>
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
          onConfirm={handleAccomConfirm}
          onClose={() => setAccomModal(null)}
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
          onClose={() => setEditAccomType(null)}
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
    { key:'roteiro',    label:'Roteiro'     },
  ]

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

      {/* Card de resumo */}
      <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:'16px 20px', marginBottom:20, boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'20px 40px', alignItems:'flex-start' }}>
          <Chip label="Tipo"           value={TYPE_LABEL[list.list_type] || list.list_type} />
          <Chip label="Categoria"      value={list.category} />
          <Chip label="Início"         value={fmt(list.start_date)} />
          <Chip label="Término"        value={fmt(list.end_date)} />
          <Chip label="Capacidade"     value={list.block_capacity > 0 ? String(list.block_capacity) : '—'} />
          <Chip label="Acomodações"    value={list.total_accommodations > 0 ? String(list.total_accommodations) : '—'} />
        </div>
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
      {tab === 'passengers' && <PassengersTab listId={id} listType={list.list_type} blockCapacity={list.block_capacity} />}

      {tab === 'roteiro' && (
        <div className="det-card">
          <div className="section">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
              <div>
                <div className="section-title" style={{ marginBottom:2 }}>Roteiros</div>
                <p style={{ fontSize:12, color:'#94a3b8', margin:0 }}>
                  Roteiros vinculados a esta lista de passageiros.
                </p>
              </div>
              <button type="button" onClick={() => setShowEdit(true)}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='#1a2d4f'; e.currentTarget.style.color='#1a2d4f' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.color='#475569' }}>
                + Gerenciar roteiros
              </button>
            </div>

            {(list.roteiros_data || []).length === 0 ? (
              <div style={{ textAlign:'center', padding:'48px 0' }}>
                <p style={{ fontSize:32, marginBottom:8 }}>🗺️</p>
                <p style={{ color:'#94a3b8', fontSize:14, fontWeight:500 }}>Nenhum roteiro vinculado.</p>
                <p style={{ color:'#cbd5e1', fontSize:12 }}>Clique em "Gerenciar roteiros" para adicionar.</p>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
                {(list.roteiros_data || []).map((r, idx) => (
                  <div key={r.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', borderBottom:'1px solid #f1f5f9', background: idx % 2 === 0 ? '#fff' : '#fafbfc' }}>
                    <span style={{ fontSize:16 }}>🗺️</span>
                    <span style={{ fontSize:14, fontWeight:600, color:'#1e293b' }}>{r.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
