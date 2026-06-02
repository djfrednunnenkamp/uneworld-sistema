import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { listsApi, passengersApi } from '../api'
import FormSelect from '../components/FormSelect'
import usePersistedTab from '../hooks/usePersistedTab'
import ConfirmModal from '../components/ConfirmModal'
import { Ic } from '../components/Icon'

/* ── Opções estáticas ── */
const TYPE_OPTS = [
  { value: 'aereo',     label: 'Aéreo'      },
  { value: 'terrestre', label: 'Terrestre'   },
  { value: 'maritimo',  label: 'Marítimo'    },
  { value: 'fluvial',   label: 'Fluvial'     },
  { value: 'misto',     label: 'Misto'       },
]
const CAT_OPTS = [
  { value: 'internacional', label: 'Internacional' },
  { value: 'nacional',      label: 'Nacional'      },
]
const DOC_OPTS = [
  { value: '',           label: 'Nenhum'      },
  { value: 'passaporte', label: 'Passaporte'  },
  { value: 'rg',         label: 'RG'          },
  { value: 'cnh',        label: 'CNH'         },
  { value: 'visto',      label: 'Visto'       },
]

const EMPTY = {
  name: '', list_type: 'aereo', category: 'internacional',
  block_capacity: 0, total_accommodations: 0,
  start_date: '', end_date: '',
  suppliers: [], additionals: [],
  required_document: '', status: 'aberta', notes: '',
}

/* ── DateInput DD/MM/AAAA ── */
function DateInput({ value, onChange, placeholder = 'DD/MM/AAAA' }) {
  const [display, setDisplay] = useState(() => {
    if (!value) return ''
    const [y, m, d] = value.split('-')
    return `${d}/${m}/${y}`
  })

  useEffect(() => {
    if (!value) { setDisplay(''); return }
    const [y, m, d] = value.split('-')
    setDisplay(`${d}/${m}/${y}`)
  }, [value])

  const handleChange = (e) => {
    let v = e.target.value.replace(/\D/g, '').slice(0, 8)
    if (v.length > 4) v = v.slice(0,2) + '/' + v.slice(2,4) + '/' + v.slice(4)
    else if (v.length > 2) v = v.slice(0,2) + '/' + v.slice(2)
    setDisplay(v)
    if (v.length === 10) {
      const [dd, mm, yyyy] = v.split('/')
      onChange(`${yyyy}-${mm}-${dd}`)
    } else if (v.length === 0) {
      onChange('')
    }
  }

  return (
    <input
      value={display}
      onChange={handleChange}
      placeholder={placeholder}
      className="fi"
    />
  )
}

/* ── MultiPicker: multi-select dropdown com opções inline gerenciáveis ── */
function MultiPicker({ label, selected, options, onToggle, onCreate, onDelete }) {
  const [open, setOpen]   = useState(false)
  const [input, setInput] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const displayVal = selected.length === 0
    ? 'Nada selecionado'
    : options.filter(o => selected.includes(o.id)).map(o => o.name).join(', ')

  const handleCreate = async () => {
    const name = input.trim()
    if (!name) return
    await onCreate(name)
    setInput('')
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="fi"
        style={{ display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer', textAlign:'left' }}>
        <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color: selected.length ? '#1e293b' : '#94a3b8' }}>
          {displayVal}
        </span>
        <span style={{ fontSize:10, color:'#94a3b8', flexShrink:0, marginLeft:8 }}>▼</span>
      </button>

      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:300, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', boxShadow:'0 12px 32px rgba(0,0,0,.12)', overflow:'hidden' }}>
          {/* Campo para adicionar novo */}
          <div style={{ padding:'10px 12px', borderBottom:'1px solid #f1f5f9', display:'flex', gap:6 }}>
            <input
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder={`Novo ${label.toLowerCase()}…`}
              style={{ flex:1, padding:'5px 8px', border:'1.5px solid #e2e8f0', borderRadius:6, fontSize:12, outline:'none', fontFamily:'inherit' }}
              onFocus={e => e.target.style.borderColor='#1a2d4f'}
              onBlur={e => e.target.style.borderColor='#e2e8f0'}
            />
            <button type="button" onClick={handleCreate}
              style={{ padding:'5px 10px', borderRadius:6, border:'none', background:'#1a2d4f', color:'#fff', fontSize:12, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>
              + Add
            </button>
          </div>

          {/* Lista de opções */}
          <div style={{ maxHeight:200, overflowY:'auto' }}>
            {options.length === 0 ? (
              <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'12px 0', margin:0 }}>
                Nenhum {label.toLowerCase()} cadastrado.
              </p>
            ) : options.map(opt => {
              const checked = selected.includes(opt.id)
              return (
                <div key={opt.id}
                  style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid #f8fafc', background: checked ? '#f0f9ff' : 'transparent', cursor:'pointer' }}
                  onClick={() => onToggle(opt.id)}
                  onMouseEnter={e => { if (!checked) e.currentTarget.style.background = '#f8fafc' }}
                  onMouseLeave={e => { e.currentTarget.style.background = checked ? '#f0f9ff' : 'transparent' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ width:16, height:16, borderRadius:4, border:`2px solid ${checked ? '#1a2d4f' : '#d1d5db'}`, background: checked ? '#1a2d4f' : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      {checked && <span style={{ color:'#fff', fontSize:10, fontWeight:900, lineHeight:1 }}>✓</span>}
                    </div>
                    <span style={{ fontSize:13, color:'#1e293b' }}>{opt.name}</span>
                  </div>
                  <button type="button" onClick={e => { e.stopPropagation(); onDelete(opt.id) }}
                    style={{ background:'none', border:'none', cursor:'pointer', color:'#cbd5e1', fontSize:14, padding:2, lineHeight:1 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                    onMouseLeave={e => e.currentTarget.style.color = '#cbd5e1'}>
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
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
    const already = enrolled.some(e => e.passenger === p.id)
    if (already) { toast.error('Passageiro já está nesta lista.'); return }
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
        <div className="section-title" style={{ marginBottom:16 }}>Passageiros na lista</div>

        {/* Busca para adicionar */}
        <div style={{ position:'relative', marginBottom:16 }}>
          <input
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Buscar passageiro pelo nome, CPF ou e-mail…"
            style={{ width:'100%', boxSizing:'border-box', padding:'9px 12px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b' }}
            onFocus={e => e.target.style.borderColor='#1a2d4f'}
            onBlur={e => e.target.style.borderColor='#e2e8f0'}
          />
          {(results.length > 0 || searching) && (
            <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:400, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', boxShadow:'0 12px 32px rgba(0,0,0,.12)', overflow:'hidden' }}>
              {searching ? (
                <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'12px 0', margin:0 }}>Buscando…</p>
              ) : results.map(p => (
                <div key={p.id}
                  style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 14px', borderBottom:'1px solid #f8fafc', cursor:'pointer' }}
                  onClick={() => add(p)}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
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

        {/* Lista de inscritos */}
        {loading ? (
          <p style={{ textAlign:'center', color:'#94a3b8', fontSize:13, padding:'24px 0' }}>Carregando…</p>
        ) : enrolled.length === 0 ? (
          <div style={{ textAlign:'center', padding:'40px 0' }}>
            <p style={{ fontSize:32, marginBottom:8 }}>👥</p>
            <p style={{ color:'#94a3b8', fontSize:14, fontWeight:500 }}>Nenhum passageiro na lista.</p>
            <p style={{ color:'#cbd5e1', fontSize:12 }}>Use a busca acima para adicionar.</p>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 160px 160px 120px 48px', gap:0, padding:'8px 12px', background:'#f8fafc', borderRadius:'8px 8px 0 0', borderBottom:'2px solid #e2e8f0' }}>
              {['Nome', 'CPF', 'E-mail', 'Telefone', ''].map((h, i) => (
                <span key={i} style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.05em' }}>{h}</span>
              ))}
            </div>
            {enrolled.map((e, idx) => (
              <div key={e.id} style={{ display:'grid', gridTemplateColumns:'1fr 160px 160px 120px 48px', gap:0, padding:'10px 12px', borderBottom:'1px solid #f1f5f9', background: idx % 2 === 0 ? '#fff' : '#fafbfc', alignItems:'center' }}>
                <span style={{ fontSize:13, fontWeight:600, color:'#1e293b' }}>{e.passenger_name}</span>
                <span style={{ fontSize:12, color:'#64748b' }}>{e.passenger_cpf || '—'}</span>
                <span style={{ fontSize:12, color:'#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.passenger_email || '—'}</span>
                <span style={{ fontSize:12, color:'#64748b' }}>{e.passenger_phone || '—'}</span>
                <button type="button"
                  onClick={() => setConfirm({ id: e.id, name: e.passenger_name })}
                  style={{ padding:'4px 8px', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#94a3b8', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}
                  onMouseEnter={e => { e.currentTarget.style.background='#fee2e2'; e.currentTarget.style.color='#dc2626'; e.currentTarget.style.borderColor='#fecaca' }}
                  onMouseLeave={e => { e.currentTarget.style.background='#fff'; e.currentTarget.style.color='#94a3b8'; e.currentTarget.style.borderColor='#e2e8f0' }}>
                  ✕
                </button>
              </div>
            ))}
            <div style={{ padding:'8px 12px', background:'#f8fafc', borderRadius:'0 0 8px 8px', fontSize:12, color:'#64748b' }}>
              {enrolled.length} passageiro{enrolled.length !== 1 ? 's' : ''}
            </div>
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
  const isNew    = id === 'nova'

  const [form,      setForm]      = useState({ ...EMPTY })
  const [loading,   setLoading]   = useState(!isNew)
  const [saving,    setSaving]    = useState(false)
  const [isDirty,   setIsDirty]   = useState(false)
  const [suppliers, setSuppliers] = useState([])
  const [additionals, setAdditionals] = useState([])
  const [tab, setTab] = usePersistedTab('tab_list_detail', 'info')

  // Carregar opções de fornecedores e adicionais
  useEffect(() => {
    listsApi.suppliers().then(r => setSuppliers(r.data.results ?? r.data)).catch(() => {})
    listsApi.listAdditionals().then(r => setAdditionals(r.data.results ?? r.data)).catch(() => {})
  }, [])

  // Carregar dados da lista existente
  useEffect(() => {
    if (!isNew) {
      listsApi.get(id)
        .then(r => {
          const d = r.data
          setForm({
            ...d,
            suppliers:   (d.suppliers || []).map(s => typeof s === 'object' ? s.id : s),
            additionals: (d.additionals || []).map(a => typeof a === 'object' ? a.id : a),
          })
        })
        .catch(() => { toast.error('Lista não encontrada.'); navigate('/viagens') })
        .finally(() => setLoading(false))
    }
  }, [id])

  const set  = (k) => (e) => { setForm(f => ({ ...f, [k]: e.target.value })); setIsDirty(true) }
  const setV = (k, v)     => { setForm(f => ({ ...f, [k]: v }));             setIsDirty(true) }

  const toggleItem = (key, itemId) => {
    setForm(f => {
      const list = f[key] || []
      const next = list.includes(itemId) ? list.filter(x => x !== itemId) : [...list, itemId]
      return { ...f, [key]: next }
    })
    setIsDirty(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Nome da lista é obrigatório.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        start_date: form.start_date || null,
        end_date:   form.end_date   || null,
        block_capacity:       Number(form.block_capacity)       || 0,
        total_accommodations: Number(form.total_accommodations) || 0,
      }
      if (isNew) {
        const r = await listsApi.create(payload)
        toast.success('Lista criada!')
        setIsDirty(false)
        navigate(`/viagens/${r.data.id}`, { replace: true })
      } else {
        await listsApi.update(id, payload)
        toast.success('Alterações salvas.')
        setIsDirty(false)
      }
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Erro ao salvar.')
    } finally { setSaving(false) }
  }

  const handleAddSupplier = async (name) => {
    const r = await listsApi.addSupplier(name)
    setSuppliers(prev => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)))
  }
  const handleDeleteSupplier = async (sid) => {
    await listsApi.removeSupplier(sid)
    setSuppliers(prev => prev.filter(s => s.id !== sid))
    setForm(f => ({ ...f, suppliers: f.suppliers.filter(x => x !== sid) }))
  }
  const handleAddAdditional = async (name) => {
    const r = await listsApi.addAdditional(name)
    setAdditionals(prev => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)))
  }
  const handleDeleteAdditional = async (aid) => {
    await listsApi.removeAdditional(aid)
    setAdditionals(prev => prev.filter(a => a.id !== aid))
    setForm(f => ({ ...f, additionals: f.additionals.filter(x => x !== aid) }))
  }

  useEffect(() => {
    const h = (e) => { if (isDirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [isDirty])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:300, color:'#94a3b8' }}>
      Carregando…
    </div>
  )

  const lbl = { display:'block', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }

  return (
    <div>
      {/* Header */}
      <div className="ph">
        <div>
          <button onClick={() => navigate('/viagens')}
            style={{ background:'none', border:'none', cursor:'pointer', color:'#64748b', fontSize:12, fontFamily:'inherit', padding:0, marginBottom:4 }}
            onMouseEnter={e => e.currentTarget.style.color='#1a2d4f'}
            onMouseLeave={e => e.currentTarget.style.color='#64748b'}>
            ← Listas de Passageiros
          </button>
          <h1 className="ph-title" style={{ margin:0 }}>
            {isNew ? 'Nova Lista' : form.name || 'Lista'}
          </h1>
        </div>
        <div className="ph-actions">
          <button type="button" onClick={() => navigate('/viagens')}
            style={{ padding:'8px 16px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            style={{ padding:'8px 20px', borderRadius:8, border:'none', background: saving ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor: saving ? 'default' : 'pointer', fontFamily:'inherit' }}>
            {saving ? 'Salvando…' : isNew ? 'Criar Lista' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, borderBottom:'2px solid #e2e8f0', marginBottom:20 }}>
        {[
          { key:'info',       label:'Dados da Lista' },
          ...(!isNew ? [{ key:'passengers', label:'Passageiros' }] : []),
        ].map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{ padding:'10px 20px', background:'none', border:'none', borderBottom: tab===t.key ? '2px solid #1a2d4f' : '2px solid transparent', marginBottom:-2, color: tab===t.key ? '#1a2d4f' : '#64748b', fontSize:14, fontWeight: tab===t.key ? 700 : 400, cursor:'pointer', fontFamily:'inherit', transition:'color .15s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Dados */}
      {tab === 'info' && (
        <div className="det-card">
          <div className="section">
            <div className="section-title">Identificação</div>
            <div className="form-grid">

              {/* Nome - full width */}
              <div style={{ gridColumn:'1/-1' }}>
                <label style={lbl}>Nome da Lista</label>
                <input value={form.name} onChange={set('name')} className="fi" placeholder="Ex: SUÍÇA MARAVILHOSA C/TREM GLACIER EXPRESS…" />
              </div>

              {/* Tipo */}
              <div>
                <label style={lbl}>Tipo</label>
                <FormSelect value={form.list_type} onChange={v => setV('list_type', v)} options={TYPE_OPTS} />
              </div>

              {/* Categoria */}
              <div>
                <label style={lbl}>Categoria</label>
                <FormSelect value={form.category} onChange={v => setV('category', v)} options={CAT_OPTS} />
              </div>

              {/* Capacidade do bloqueio */}
              <div>
                <label style={lbl}>Capacidade do bloqueio</label>
                <input type="number" min="0" value={form.block_capacity} onChange={set('block_capacity')} className="fi" />
              </div>

              {/* Total de acomodações */}
              <div>
                <label style={lbl}>Total de acomodações</label>
                <input type="number" min="0" value={form.total_accommodations} onChange={set('total_accommodations')} className="fi" />
              </div>

              {/* Datas */}
              <div>
                <label style={lbl}>Data de início</label>
                <DateInput value={form.start_date} onChange={v => setV('start_date', v)} />
              </div>
              <div>
                <label style={lbl}>Data de término</label>
                <DateInput value={form.end_date} onChange={v => setV('end_date', v)} />
              </div>
            </div>
          </div>

          <div className="section-divider" />

          <div className="section">
            <div className="section-title">Serviços</div>
            <div className="form-grid">

              {/* Fornecedores */}
              <div style={{ gridColumn:'span 2' }}>
                <label style={lbl}>Fornecedores</label>
                <MultiPicker
                  label="Fornecedor"
                  selected={form.suppliers}
                  options={suppliers}
                  onToggle={id => toggleItem('suppliers', id)}
                  onCreate={handleAddSupplier}
                  onDelete={handleDeleteSupplier}
                />
              </div>

              {/* Adicionais */}
              <div style={{ gridColumn:'span 2' }}>
                <label style={lbl}>Adicionais</label>
                <MultiPicker
                  label="Adicional"
                  selected={form.additionals}
                  options={additionals}
                  onToggle={id => toggleItem('additionals', id)}
                  onCreate={handleAddAdditional}
                  onDelete={handleDeleteAdditional}
                />
              </div>
            </div>
          </div>

          <div className="section-divider" />

          <div className="section">
            <div className="section-title">Configurações</div>
            <div className="form-grid">

              {/* Documento requerido */}
              <div>
                <label style={lbl}>Documento requerido</label>
                <FormSelect value={form.required_document} onChange={v => setV('required_document', v)} options={DOC_OPTS} />
              </div>

              {/* Status da lista */}
              <div>
                <label style={lbl}>Status da lista</label>
                <div style={{ display:'flex', gap:0, borderRadius:8, overflow:'hidden', border:'1.5px solid #e2e8f0', width:'fit-content' }}>
                  {[{ v:'aberta', l:'Aberta' }, { v:'fechada', l:'Fechada' }].map(opt => (
                    <button key={opt.v} type="button"
                      onClick={() => setV('status', opt.v)}
                      style={{ padding:'8px 20px', border:'none', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer', transition:'all .12s',
                        background: form.status === opt.v ? (opt.v === 'aberta' ? '#1a2d4f' : '#64748b') : '#fff',
                        color:      form.status === opt.v ? '#fff' : '#64748b',
                      }}>
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Observações */}
              <div style={{ gridColumn:'1/-1' }}>
                <label style={lbl}>Observações</label>
                <textarea value={form.notes} onChange={set('notes')}
                  className="fi" rows={3} style={{ resize:'vertical' }}
                  placeholder="Observações sobre esta lista…" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Passageiros */}
      {tab === 'passengers' && !isNew && (
        <PassengersTab listId={id} />
      )}
    </div>
  )
}
