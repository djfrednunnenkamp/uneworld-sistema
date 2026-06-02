import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { listsApi, passengersApi } from '../api'
import ListModal from '../components/ListModal'
import usePersistedTab from '../hooks/usePersistedTab'
import ConfirmModal from '../components/ConfirmModal'
import { Ic } from '../components/Icon'

const TYPE_LABEL = {
  aereo:'Via Aéreo', onibus:'Via Ônibus', maritimo:'Via Marítimo',
}
const CAT_LABEL  = { internacional:'Internacional', nacional:'Nacional' }
const DOC_LABEL  = { passaporte:'Passaporte', rg:'RG', cnh:'CNH' }

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

/* ── Aba de Passageiros ── */
function PassengersTab({ listId }) {
  const [enrolled,  setEnrolled]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [results,   setResults]   = useState([])
  const [searching, setSearching] = useState(false)
  const [confirm,   setConfirm]   = useState(null)
  const debRef = useRef(null)

  const load = useCallback(() => {
    setLoading(true)
    listsApi.listPassengers(listId)
      .then(r => setEnrolled(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [listId])

  useEffect(() => { load() }, [load])

  const handleSearch = (q) => {
    setSearch(q)
    clearTimeout(debRef.current)
    if (!q.trim()) { setResults([]); return }
    debRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await passengersApi.list({ search: q, page_size: 20 })
        setResults(r.data.results ?? r.data)
      } catch {} finally { setSearching(false) }
    }, 300)
  }

  const add = async (p) => {
    if (enrolled.some(e => e.passenger === p.id)) {
      toast.error('Passageiro já está nesta lista.')
      return
    }
    try {
      await listsApi.addPassenger(listId, p.id, '')
      toast.success(`${p.full_name} adicionado.`)
      setSearch(''); setResults([])
      load()
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Erro ao adicionar.')
    }
  }

  const remove = async (eid, name) => {
    await listsApi.removePassenger(listId, eid).catch(() => toast.error('Erro ao remover.'))
    setConfirm(null)
    toast.success(`${name} removido da lista.`)
    load()
  }

  return (
    <div className="det-card">
      <div className="section">
        <div className="section-title" style={{ marginBottom:16 }}>
          Passageiros na lista
          <span style={{ fontSize:12, fontWeight:400, color:'#94a3b8', marginLeft:8 }}>
            {enrolled.length} passageiro{enrolled.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Busca autocomplete */}
        <div style={{ position:'relative', marginBottom:16 }}>
          <input
            value={search} onChange={e => handleSearch(e.target.value)}
            placeholder="Buscar passageiro pelo nome, CPF ou e-mail…"
            style={{ width:'100%', boxSizing:'border-box', padding:'9px 12px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b' }}
            onFocus={e => e.target.style.borderColor='#1a2d4f'}
            onBlur={e => e.target.style.borderColor='#e2e8f0'}
          />
          {(results.length > 0 || searching) && (
            <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:400, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', boxShadow:'0 12px 32px rgba(0,0,0,.12)', overflow:'hidden' }}>
              {searching
                ? <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'12px 0', margin:0 }}>Buscando…</p>
                : results.map(p => (
                  <div key={p.id}
                    style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 14px', borderBottom:'1px solid #f8fafc', cursor:'pointer' }}
                    onClick={() => add(p)}
                    onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    <div>
                      <p style={{ margin:0, fontSize:13, fontWeight:600, color:'#1e293b' }}>{p.full_name}</p>
                      <p style={{ margin:0, fontSize:11, color:'#94a3b8' }}>{p.cpf || p.email || '—'}</p>
                    </div>
                    <span style={{ fontSize:11, color:'#2e6db4', fontWeight:700 }}>+ Adicionar</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Tabela de inscritos */}
        {loading ? (
          <p style={{ textAlign:'center', color:'#94a3b8', fontSize:13, padding:'24px 0' }}>Carregando…</p>
        ) : enrolled.length === 0 ? (
          <div style={{ textAlign:'center', padding:'40px 0' }}>
            <p style={{ fontSize:36, marginBottom:8 }}>👥</p>
            <p style={{ color:'#94a3b8', fontSize:14, fontWeight:500 }}>Nenhum passageiro na lista.</p>
            <p style={{ color:'#cbd5e1', fontSize:12 }}>Use a busca acima para adicionar.</p>
          </div>
        ) : (
          <div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 150px 200px 130px 48px', gap:0, padding:'8px 12px', background:'#f8fafc', borderRadius:'8px 8px 0 0', borderBottom:'2px solid #e2e8f0' }}>
              {['Nome', 'CPF', 'E-mail', 'Telefone', ''].map((h, i) => (
                <span key={i} style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.05em' }}>{h}</span>
              ))}
            </div>
            {enrolled.map((e, idx) => (
              <div key={e.id} style={{ display:'grid', gridTemplateColumns:'1fr 150px 200px 130px 48px', gap:0, padding:'10px 12px', borderBottom:'1px solid #f1f5f9', background: idx % 2 === 0 ? '#fff' : '#fafbfc', alignItems:'center' }}>
                <span style={{ fontSize:13, fontWeight:600, color:'#1e293b' }}>{e.passenger_name}</span>
                <span style={{ fontSize:12, color:'#64748b' }}>{e.passenger_cpf || '—'}</span>
                <span style={{ fontSize:12, color:'#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.passenger_email || '—'}</span>
                <span style={{ fontSize:12, color:'#64748b' }}>{e.passenger_phone || '—'}</span>
                <button type="button" onClick={() => setConfirm({ id:e.id, name:e.passenger_name })}
                  style={{ padding:'4px 8px', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#94a3b8', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}
                  onMouseEnter={e => { e.currentTarget.style.background='#fee2e2'; e.currentTarget.style.color='#dc2626'; e.currentTarget.style.borderColor='#fecaca' }}
                  onMouseLeave={e => { e.currentTarget.style.background='#fff'; e.currentTarget.style.color='#94a3b8'; e.currentTarget.style.borderColor='#e2e8f0' }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

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
    // novas abas serão adicionadas aqui futuramente
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
      {tab === 'passengers' && <PassengersTab listId={id} />}

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
