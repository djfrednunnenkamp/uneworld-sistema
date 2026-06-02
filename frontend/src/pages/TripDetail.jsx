import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { listsApi, passengersApi, agenciesApi, configApi } from '../api'
import DatePicker from '../components/DatePicker'
import ListModal from '../components/ListModal'
import usePersistedTab from '../hooks/usePersistedTab'
import ConfirmModal from '../components/ConfirmModal'
import { Ic } from '../components/Icon'

const TYPE_LABEL = {
  aereo:'Via Aéreo', terrestre:'Via Terrestre',
}
const CAT_LABEL  = { internacional:'Internacional', nacional:'Nacional' }
const DOC_LABEL  = { passaporte:'Passaporte', carteira_identidade:'Carteira de Identidade' }

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

/* ── Status dot ── */
const STATUS_DOT = {
  confirmado: { bg:'#16a34a', title:'Confirmado' },
  pendente:   { bg:'#f59e0b', title:'Pendente'   },
  cancelado:  { bg:'#dc2626', title:'Cancelado'  },
}

/* ── Picker de acomodação com chips + campo livre ── */
function AccomPicker({ value, onChange }) {
  const [types, setTypes] = useState([])
  useEffect(() => {
    configApi.accommodations().then(r => setTypes(r.data.results ?? r.data)).catch(() => {})
  }, [])
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {types.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
          {types.map(t => {
            const active = value === t.name
            return (
              <button key={t.id} type="button" onClick={() => onChange(active ? '' : t.name)}
                style={{ padding:'5px 14px', borderRadius:20, border:`1.5px solid ${active ? '#1a2d4f' : '#e2e8f0'}`, background: active ? '#1a2d4f' : '#fff', color: active ? '#fff' : '#475569', fontSize:13, fontWeight: active ? 600 : 400, cursor:'pointer', fontFamily:'inherit', transition:'all .12s' }}>
                {t.name}
              </button>
            )
          })}
        </div>
      )}
      <input value={value} onChange={e => onChange(e.target.value)}
        placeholder="Ou escreva o nome (ex: Apto. Duplo Twin)…"
        style={{ width:'100%', boxSizing:'border-box', padding:'9px 12px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b' }}
        onFocus={e => e.target.style.borderColor='#1a2d4f'}
        onBlur={e => e.target.style.borderColor='#e2e8f0'} />
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
        setResults(r.data.results ?? r.data)
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
        setResults(r.data.results ?? r.data)
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

/* ── Aba de Passageiros ── */
function PassengersTab({ listId, listType }) {
  const [enrolled,   setEnrolled]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [showAdd,    setShowAdd]    = useState(false)
  const [confirm,      setConfirm]      = useState(null)
  const [editAccom,    setEditAccom]    = useState(null)
  const [assignBlk,    setAssignBlk]    = useState(null)
  const [selected,     setSelected]     = useState(new Set())
  const [bulkAccom,    setBulkAccom]    = useState('')
  const [showBulkRoom, setShowBulkRoom] = useState(false)
  const [bulkSaving,   setBulkSaving]   = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    listsApi.listPassengers(listId)
      .then(r => setEnrolled(r.data))
      .catch(() => toast.error('Erro ao carregar passageiros.'))
      .finally(() => setLoading(false))
  }, [listId])

  useEffect(() => { load() }, [load])

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

  const bulkAssignRoom = async () => {
    if (!bulkAccom.trim()) return
    setBulkSaving(true)
    try {
      await Promise.all([...selected].map(eid => listsApi.updatePassenger(listId, eid, { accommodation: bulkAccom.trim() })))
      toast.success(`Acomodação atribuída a ${selected.size} passageiro${selected.size > 1 ? 's' : ''}.`)
      setShowBulkRoom(false); setBulkAccom(''); clearSelect(); load()
    } catch { toast.error('Erro ao atribuir acomodação.') }
    finally { setBulkSaving(false) }
  }

  const remove = async (eid, name) => {
    await listsApi.removePassenger(listId, eid).catch(() => toast.error('Erro ao remover.'))
    setConfirm(null)
    toast.success(`${name} removido.`)
    load()
  }

  const saveAccom = async () => {
    await listsApi.updatePassenger(listId, editAccom.id, { accommodation: editAccom.accommodation })
    setEditAccom(null); load()
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
          <button type="button" onClick={() => setShowBulkRoom(true)} disabled={bulkSaving}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            🛏 Atribuir acomodação
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
                    <button type="button"
                      onClick={() => setEditAccom({ id: rows[0].id, accommodation: rows[0].accommodation || '', bulkKey: key })}
                      title="Renomear acomodação"
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
                      {isUnassigned && e.is_block ? (
                        <button type="button"
                          onClick={() => setAssignBlk(e)}
                          title="Atribuir passageiro"
                          style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:'1.5px solid #f59e0b', background:'#fffbeb', color:'#92400e', fontSize:13, cursor:'pointer' }}
                          onMouseEnter={ev => ev.currentTarget.style.background='#fde68a'}
                          onMouseLeave={ev => ev.currentTarget.style.background='#fffbeb'}>
                          <Ic n="users" s={12} />
                        </button>
                      ) : isUnassigned ? (
                        <button type="button"
                          onClick={() => setEditAccom({ id: e.id, accommodation: '' })}
                          title="Atribuir acomodação"
                          style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:'1.5px solid #f59e0b', background:'#fffbeb', color:'#92400e', fontSize:13, cursor:'pointer' }}
                          onMouseEnter={ev => ev.currentTarget.style.background='#fde68a'}
                          onMouseLeave={ev => ev.currentTarget.style.background='#fffbeb'}>
                          🛏
                        </button>
                      ) : (
                        <button type="button"
                          onClick={() => setEditAccom({ id: e.id, accommodation: e.accommodation || '' })}
                          title="Editar acomodação"
                          style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#64748b', fontSize:11, cursor:'pointer' }}
                          onMouseEnter={ev => { ev.currentTarget.style.borderColor='#1a2d4f'; ev.currentTarget.style.color='#1a2d4f' }}
                          onMouseLeave={ev => { ev.currentTarget.style.borderColor='#e2e8f0'; ev.currentTarget.style.color='#64748b' }}>
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

      {/* Popup acomodação em massa */}
      {showBulkRoom && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:600, padding:20 }}
          onMouseDown={e => { if (e.target === e.currentTarget) setShowBulkRoom(false) }}>
          <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:400, boxShadow:'0 32px 80px rgba(0,0,0,.25)', overflow:'hidden' }}>
            <div style={{ padding:'18px 22px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div>
                <p style={{ margin:0, fontSize:15, fontWeight:700, color:'#0f172a' }}>Atribuir acomodação</p>
                <p style={{ margin:'2px 0 0', fontSize:12, color:'#94a3b8' }}>{selected.size} passageiro{selected.size > 1 ? 's' : ''} selecionado{selected.size > 1 ? 's' : ''}</p>
              </div>
              <button onClick={() => setShowBulkRoom(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
            </div>
            <div style={{ padding:'18px 22px' }}>
              <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:5 }}>Acomodação</label>
              <AccomPicker value={bulkAccom} onChange={setBulkAccom} />
            </div>
            <div style={{ padding:'0 22px 18px', display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => setShowBulkRoom(false)} style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Cancelar</button>
              <button onClick={bulkAssignRoom} disabled={!bulkAccom.trim() || bulkSaving}
                style={{ padding:'8px 22px', borderRadius:8, border:'none', background: !bulkAccom.trim()||bulkSaving ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor: !bulkAccom.trim()||bulkSaving ? 'default' : 'pointer', fontFamily:'inherit' }}>
                {bulkSaving ? 'Atribuindo…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
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

      {/* Popup editar acomodação */}
      {editAccom && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:600, padding:20 }}
          onMouseDown={e => { if (e.target === e.currentTarget) setEditAccom(null) }}>
          <div style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:380, boxShadow:'0 24px 60px rgba(0,0,0,.2)', overflow:'hidden' }}>
            <div style={{ padding:'16px 20px 12px', borderBottom:'1px solid #e2e8f0' }}>
              <span style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>Acomodação</span>
            </div>
            <div style={{ padding:'16px 20px' }}>
              <AccomPicker value={editAccom.accommodation} onChange={v => setEditAccom(ea => ({ ...ea, accommodation: v }))} />
            </div>
            <div style={{ padding:'0 20px 16px', display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button type="button" onClick={() => setEditAccom(null)}
                style={{ padding:'7px 16px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                Cancelar
              </button>
              <button type="button" onClick={saveAccom}
                style={{ padding:'7px 18px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                Salvar
              </button>
            </div>
          </div>
        </div>
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

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:300, color:'#94a3b8' }}>
      Carregando…
    </div>
  )

  const supplierNames  = (list.suppliers_data  || []).map(s => s.name).join(', ') || '—'
  const additionalNames= (list.additionals_data || []).map(a => a.name).join(', ') || '—'

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
        <div className="ph-actions">
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
          <Chip label="Categoria"      value={CAT_LABEL[list.category]   || list.category} />
          <Chip label="Início"         value={fmt(list.start_date)} />
          <Chip label="Término"        value={fmt(list.end_date)} />
          <Chip label="Capacidade"     value={list.block_capacity > 0 ? String(list.block_capacity) : '—'} />
          <Chip label="Acomodações"    value={list.total_accommodations > 0 ? String(list.total_accommodations) : '—'} />
          <Chip label="Doc. requeridos" value={(list.required_documents || []).map(d => DOC_LABEL[d]).filter(Boolean).join(', ') || '—'} />
          <Chip label="Fornecedores"   value={supplierNames} />
          <Chip label="Adicionais"     value={additionalNames} />
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            <span style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.05em' }}>Status</span>
            <span style={{
              fontSize:12, fontWeight:700, padding:'2px 10px', borderRadius:20,
              background: list.status === 'aberta' ? '#dcfce7' : '#f1f5f9',
              color:      list.status === 'aberta' ? '#16a34a' : '#64748b',
            }}>
              {list.status === 'aberta' ? 'Aberta' : 'Fechada'}
            </span>
          </div>
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
      {tab === 'passengers' && <PassengersTab listId={id} listType={list.list_type} />}

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
