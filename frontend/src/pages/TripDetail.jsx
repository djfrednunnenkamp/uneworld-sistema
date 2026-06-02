import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { listsApi, passengersApi } from '../api'
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

const LBL = { display:'block', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:5 }
const INP = { width:'100%', boxSizing:'border-box', padding:'9px 12px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b' }

/* ── Status toggle reutilizável ── */
function StatusToggle({ value, onChange }) {
  return (
    <div style={{ display:'flex', gap:0, borderRadius:8, overflow:'hidden', border:'1.5px solid #e2e8f0', width:'fit-content' }}>
      {[{v:'confirmado',l:'Confirmado'},{v:'pendente',l:'Pendente'},{v:'cancelado',l:'Cancelado'}].map(opt => (
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
  // Modo bloqueio
  const [blockAgency,  setBlockAgency]  = useState('')
  const [blockQty,     setBlockQty]     = useState(1)
  // Campos comuns
  const [accommodation,setAccommodation]= useState('')
  const [estatus,      setEstatus]      = useState('pendente')
  const [saving,       setSaving]       = useState(false)
  const debRef = useRef(null)

  const handleSearch = (q) => {
    setSearch(q); setSelected(null)
    clearTimeout(debRef.current)
    if (!q.trim()) { setResults([]); return }
    debRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await passengersApi.list({ search: q, page_size: 15 })
        setResults(r.data.results ?? r.data)
      } catch {} finally { setSearching(false) }
    }, 300)
  }

  const handleAdd = async () => {
    setSaving(true)
    try {
      if (mode === 'block') {
        if (!blockAgency.trim()) { toast.error('Informe o nome da agência.'); return }
        await listsApi.addPassenger(listId, {
          is_block: true, block_agency: blockAgency.trim(),
          block_quantity: blockQty, accommodation, enrollment_status: estatus, notes: '',
        })
        toast.success(`${blockQty} vaga${blockQty>1?'s':''} de ${blockAgency} adicionada${blockQty>1?'s':''}.`)
      } else {
        if (!selected) { toast.error('Selecione um passageiro.'); return }
        if (enrolled.some(e => e.passenger === selected.id)) {
          toast.error('Passageiro já está nesta lista.'); return
        }
        await listsApi.addPassenger(listId, {
          passenger: selected.id, accommodation, enrollment_status: estatus, notes: '',
        })
        toast.success(`${selected.full_name} adicionado.`)
      }
      onAdded(); onClose()
    } catch (err) { toast.error(err.response?.data?.error ?? 'Erro ao adicionar.') }
    finally { setSaving(false) }
  }

  const canSubmit = mode === 'block' ? blockAgency.trim() : !!selected

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
                <input value={search} onChange={e => handleSearch(e.target.value)}
                  placeholder="Buscar por nome, CPF ou e-mail…"
                  style={INP}
                  onFocus={e => e.target.style.borderColor='#1a2d4f'}
                  onBlur={e => e.target.style.borderColor='#e2e8f0'} />
                {(results.length > 0 || searching) && (
                  <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:700, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', boxShadow:'0 12px 32px rgba(0,0,0,.12)', overflow:'hidden', maxHeight:200, overflowY:'auto' }}>
                    {searching
                      ? <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'10px 0', margin:0 }}>Buscando…</p>
                      : results.map(p => (
                        <div key={p.id}
                          style={{ padding:'9px 14px', borderBottom:'1px solid #f8fafc', cursor:'pointer', background: selected?.id===p.id ? '#eff6ff' : 'transparent' }}
                          onClick={() => { setSelected(p); setSearch(p.full_name); setResults([]) }}
                          onMouseEnter={ev => { if (selected?.id!==p.id) ev.currentTarget.style.background='#f8fafc' }}
                          onMouseLeave={ev => { ev.currentTarget.style.background = selected?.id===p.id ? '#eff6ff' : 'transparent' }}>
                          <p style={{ margin:0, fontSize:13, fontWeight:600, color:'#1e293b' }}>{p.full_name}</p>
                          <p style={{ margin:0, fontSize:11, color:'#94a3b8' }}>{p.cpf || p.email || '—'}</p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Modo bloqueio ── */}
          {mode === 'block' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 120px', gap:12 }}>
              <div>
                <label style={LBL}>Agência</label>
                <input value={blockAgency} onChange={e => setBlockAgency(e.target.value)}
                  placeholder="Nome da agência…"
                  style={INP}
                  onFocus={e => e.target.style.borderColor='#1a2d4f'}
                  onBlur={e => e.target.style.borderColor='#e2e8f0'} />
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

          {/* Acomodação (comum) */}
          <div>
            <label style={LBL}>Acomodação</label>
            <input value={accommodation} onChange={e => setAccommodation(e.target.value)}
              placeholder="Ex: Apto. Duplo Twin, Apto. Single…"
              style={INP}
              onFocus={e => e.target.style.borderColor='#1a2d4f'}
              onBlur={e => e.target.style.borderColor='#e2e8f0'} />
          </div>

          {/* Status (comum) */}
          <div>
            <label style={LBL}>Status</label>
            <StatusToggle value={estatus} onChange={setEstatus} />
          </div>
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

/* ── Aba de Passageiros ── */
function PassengersTab({ listId, listType }) {
  const [enrolled,  setEnrolled]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [showAdd,   setShowAdd]   = useState(false)
  const [confirm,   setConfirm]   = useState(null)
  const [editAccom, setEditAccom] = useState(null) // {id, accommodation}

  const load = useCallback(() => {
    setLoading(true)
    listsApi.listPassengers(listId)
      .then(r => setEnrolled(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [listId])

  useEffect(() => { load() }, [load])

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

  // Agrupar por acomodação
  const groups = []
  const seen   = {}
  enrolled.forEach(e => {
    const key = e.accommodation || '(sem acomodação)'
    if (!seen[key]) { seen[key] = []; groups.push({ key, rows: seen[key] }) }
    seen[key].push(e)
  })

  // Número sequencial global
  let seq = 0
  const seqMap = {}
  enrolled.forEach(e => { seq++; seqMap[e.id] = seq })

  const isAereo = listType === 'aereo'

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
        <span style={{ fontSize:14, fontWeight:600, color:'#1e293b' }}>
          {enrolled.length} passageiro{enrolled.length !== 1 ? 's' : ''}
        </span>
        <button type="button" onClick={() => setShowAdd(true)}
          style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
          + Adicionar passageiro
        </button>
      </div>

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
          <div style={{ display:'grid', gridTemplateColumns:'44px 28px 32px 1fr 100px 56px 40px 140px 140px 90px', gap:0, padding:'9px 12px', background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }}>
            {['Nº', '●', isAereo?'✈':'', 'Passageiro', 'Nasc.', 'Nac.', 'Gên.', 'Pass / RG', 'CPF', 'Ações'].map((h, i) => (
              <span key={i} style={{ fontSize:10, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.05em', textAlign: i===0?'center':'left' }}>{h}</span>
            ))}
          </div>

          {/* Grupos por acomodação */}
          {groups.map(({ key, rows }) => (
            <div key={key}>
              {/* Header do grupo */}
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 14px', background:'#f1f5f9', borderBottom:'1px solid #e2e8f0', borderTop:'1px solid #e2e8f0' }}>
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
                    style={{ display:'grid', gridTemplateColumns:'44px 28px 32px 1fr 100px 56px 40px 140px 140px 90px', gap:0, padding:'9px 12px', borderBottom: ri < rows.length-1 ? '1px solid #f8fafc' : 'none', background: ri%2===0 ? '#fff' : '#fafbfc', alignItems:'center' }}
                    onMouseEnter={ev => ev.currentTarget.style.background='#f0f7ff'}
                    onMouseLeave={ev => ev.currentTarget.style.background = ri%2===0 ? '#fff' : '#fafbfc'}>

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
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <span style={{ fontSize:10, fontWeight:700, background:'#fef3c7', color:'#92400e', padding:'1px 6px', borderRadius:4 }}>BLOQUEIO</span>
                          <span style={{ fontSize:13, fontWeight:600, color:'#78350f' }}>{e.block_agency}</span>
                        </div>
                      ) : (
                        <p style={{ margin:0, fontSize:13, fontWeight:600, color:'#1e293b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {e.passenger_name}
                        </p>
                      )}
                    </div>

                    {/* Nasc. */}
                    <span style={{ fontSize:12, color:'#64748b' }}>{e.is_block ? '—' : birth}</span>

                    {/* Nac. */}
                    {e.is_block
                      ? <span style={{ fontSize:11, color:'#cbd5e1' }}>—</span>
                      : <span style={{ fontSize:11, fontWeight:600, color:'#475569', background:'#f1f5f9', padding:'2px 6px', borderRadius:4, display:'inline-block' }}>{nat}</span>
                    }

                    {/* Gênero */}
                    <span style={{ fontSize:12, color:'#64748b', textAlign:'center' }}>{e.is_block ? '—' : gen}</span>

                    {/* Pass/RG */}
                    <span style={{ fontSize:12, color:'#475569', fontFamily:'monospace' }}>{e.is_block ? '—' : doc}</span>

                    {/* CPF */}
                    <span style={{ fontSize:12, color:'#475569', fontFamily:'monospace' }}>{e.is_block ? '—' : cpf}</span>

                    {/* Ações */}
                    <div style={{ display:'flex', gap:4 }}>
                      <button type="button"
                        onClick={() => setEditAccom({ id: e.id, accommodation: e.accommodation || '' })}
                        title="Editar acomodação"
                        style={{ padding:'4px 7px', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#64748b', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}
                        onMouseEnter={ev => { ev.currentTarget.style.borderColor='#1a2d4f'; ev.currentTarget.style.color='#1a2d4f' }}
                        onMouseLeave={ev => { ev.currentTarget.style.borderColor='#e2e8f0'; ev.currentTarget.style.color='#64748b' }}>
                        🛏
                      </button>
                      <button type="button"
                        onClick={() => setConfirm({ id:e.id, name:e.passenger_name })}
                        title="Remover"
                        style={{ padding:'4px 7px', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#94a3b8', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}
                        onMouseEnter={ev => { ev.currentTarget.style.background='#fee2e2'; ev.currentTarget.style.color='#dc2626'; ev.currentTarget.style.borderColor='#fecaca' }}
                        onMouseLeave={ev => { ev.currentTarget.style.background='#fff'; ev.currentTarget.style.color='#94a3b8'; ev.currentTarget.style.borderColor='#e2e8f0' }}>
                        ✕
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
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
              <input value={editAccom.accommodation}
                onChange={e => setEditAccom(ea => ({ ...ea, accommodation: e.target.value }))}
                onKeyDown={e => { if (e.key==='Enter') saveAccom(); if (e.key==='Escape') setEditAccom(null) }}
                placeholder="Ex: Apto. Duplo Twin, Apto. Single…"
                autoFocus
                style={{ width:'100%', boxSizing:'border-box', padding:'9px 12px', border:'1.5px solid #1a2d4f', borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b' }} />
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
