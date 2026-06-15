import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { listsApi, configApi } from '../api'
import FormSelect from './FormSelect'
import DatePicker from './DatePicker'
import AirportPicker from './AirportPicker'
import { BusLayoutPreview } from './BusLayoutPreview'

/* ── Opções ── */
const TYPE_OPTS = [
  { value: 'aereo',     label: 'Via Aéreo'     },
  { value: 'terrestre', label: 'Via Terrestre'  },
]
const DOC_OPTS = [
  { value: 'passaporte',          label: 'Passaporte'             },
  { value: 'carteira_identidade', label: 'Carteira de Identidade' },
]

const EMPTY = {
  name: '', list_type: 'aereo', category: 'Internacional',
  block_capacity: 0, total_accommodations: 0,
  start_date: '', end_date: '',
  suppliers: [], additionals: [], roteiros: [],
  required_documents: [], status: 'aberta', notes: '',
  default_airport: null,
  departure_country: null, departure_state: null, departure_city: null,
  bus_map: null,
}


/* ── DocMultiSelect: dropdown de opções fixas com checkbox ── */
function DocMultiSelect({ selected, onToggle }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({})
  const ref    = useRef(null)
  const btnRef = useRef(null)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    setOpen(o => !o)
  }

  const displayVal = selected.length === 0
    ? 'Nada selecionado'
    : DOC_OPTS.filter(o => selected.includes(o.value)).map(o => o.label).join(', ')

  return (
    <div ref={ref}>
      <button ref={btnRef} type="button" onClick={toggle}
        style={{ ...inp, display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer', textAlign:'left', width:'100%' }}>
        <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color: selected.length ? '#1e293b' : '#94a3b8', fontSize:13 }}>
          {displayVal}
        </span>
        <span style={{ fontSize:10, color:'#94a3b8', marginLeft:8 }}>▼</span>
      </button>
      {open && (
        <div style={{ position:'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex:700, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', boxShadow:'0 12px 32px rgba(0,0,0,.15)', overflow:'hidden' }}>
          {DOC_OPTS.map(opt => {
            const checked = selected.includes(opt.value)
            return (
              <div key={opt.value}
                style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', borderBottom:'1px solid #f8fafc', background: checked ? '#f0f9ff' : 'transparent', cursor:'pointer' }}
                onClick={() => onToggle(opt.value)}
                onMouseEnter={e => { if (!checked) e.currentTarget.style.background='#f8fafc' }}
                onMouseLeave={e => { e.currentTarget.style.background = checked ? '#f0f9ff' : 'transparent' }}>
                <div style={{ width:15, height:15, borderRadius:4, border:`2px solid ${checked ? '#1a2d4f' : '#d1d5db'}`, background: checked ? '#1a2d4f' : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  {checked && <span style={{ color:'#fff', fontSize:9, fontWeight:900, lineHeight:1 }}>✓</span>}
                </div>
                <span style={{ fontSize:13, color:'#1e293b' }}>{opt.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Popup inline para adicionar novo item ── */
function AddItemPopup({ label, onConfirm, onSelect, onClose }) {
  const [val, setVal] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  const confirm = async () => {
    const name = val.trim()
    if (!name) return
    setSaving(true)
    try {
      const newId = await onConfirm(name)  // retorna o id do novo item
      if (newId) onSelect(newId)           // auto-seleciona
      onClose()                            // fecha só o popup; dropdown continua aberto
    }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', backdropFilter:'blur(2px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:900, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:360, boxShadow:'0 24px 60px rgba(0,0,0,.2)', overflow:'hidden' }}>
        <div style={{ padding:'16px 20px 12px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>Novo {label.toLowerCase()}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:20, lineHeight:1, padding:2 }}>×</button>
        </div>
        <div style={{ padding:'16px 20px' }}>
          <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') onClose() }}
            placeholder={`Nome do ${label.toLowerCase()}…`}
            style={{ width:'100%', boxSizing:'border-box', padding:'9px 12px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b' }}
            onFocus={e => e.target.style.borderColor='#1a2d4f'}
            onBlur={e => e.target.style.borderColor='#e2e8f0'} />
        </div>
        <div style={{ padding:'0 20px 16px', display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button type="button" onClick={onClose}
            style={{ padding:'7px 16px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
          <button type="button" onClick={confirm} disabled={saving || !val.trim()}
            style={{ padding:'7px 18px', borderRadius:8, border:'none', background: saving || !val.trim() ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor: saving || !val.trim() ? 'default' : 'pointer', fontFamily:'inherit' }}>
            {saving ? 'Adicionando…' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── MultiPicker compacto ── */
function MultiPicker({ label, selected, options, onToggle, onCreate, onDelete }) {
  const [open,      setOpen]      = useState(false)
  const [search,    setSearch]    = useState('')
  const [showAdd,   setShowAdd]   = useState(false)
  const [pos,       setPos]       = useState({})
  const ref    = useRef(null)
  const btnRef = useRef(null)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    setOpen(o => !o)
    setSearch('')
  }

  const filtered = options.filter(o => o.name.toLowerCase().includes(search.toLowerCase()))

  const displayVal = selected.length === 0
    ? 'Nada selecionado'
    : options.filter(o => selected.includes(o.id)).map(o => o.name).join(', ')

  return (
    <>
    <div ref={ref}>
      <button ref={btnRef} type="button" onClick={toggle} style={{ ...inp, display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer', textAlign:'left', width:'100%' }}>
        <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color: selected.length ? '#1e293b' : '#94a3b8', fontSize:13 }}>
          {displayVal}
        </span>
        <span style={{ fontSize:10, color:'#94a3b8', marginLeft:8 }}>▼</span>
      </button>
      {open && (
        <div style={{ position:'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex:700, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', boxShadow:'0 12px 32px rgba(0,0,0,.15)', overflow:'hidden' }}>
          {/* Busca + botão adicionar */}
          <div style={{ padding:'8px 10px', borderBottom:'1px solid #f1f5f9', display:'flex', gap:6 }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Pesquisar…"
              style={{ flex:1, padding:'5px 8px', border:'1.5px solid #e2e8f0', borderRadius:6, fontSize:12, outline:'none', fontFamily:'inherit' }}
              onFocus={e => e.target.style.borderColor='#1a2d4f'}
              onBlur={e => e.target.style.borderColor='#e2e8f0'} />
            <button type="button" onClick={() => setShowAdd(true)}
              title={`Novo ${label.toLowerCase()}`}
              style={{ padding:'5px 10px', borderRadius:6, border:'none', background:'#1a2d4f', color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer', lineHeight:1 }}>
              +
            </button>
          </div>
          <div style={{ maxHeight:180, overflowY:'auto' }}>
            {options.length === 0
              ? <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'10px 0', margin:0 }}>Nenhum cadastrado</p>
              : filtered.length === 0
              ? <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'10px 0', margin:0 }}>Nenhum resultado</p>
              : filtered.map(opt => {
                  const checked = selected.includes(opt.id)
                  return (
                    <div key={opt.id}
                      style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 10px', borderBottom:'1px solid #f8fafc', background: checked ? '#f0f9ff' : 'transparent', cursor:'pointer' }}
                      onClick={() => onToggle(opt.id)}
                      onMouseEnter={e => { if (!checked) e.currentTarget.style.background='#f8fafc' }}
                      onMouseLeave={e => { e.currentTarget.style.background = checked ? '#f0f9ff' : 'transparent' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ width:14, height:14, borderRadius:3, border:`2px solid ${checked ? '#1a2d4f' : '#d1d5db'}`, background: checked ? '#1a2d4f' : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          {checked && <span style={{ color:'#fff', fontSize:9, fontWeight:900, lineHeight:1 }}>✓</span>}
                        </div>
                        <span style={{ fontSize:13, color:'#1e293b' }}>{opt.name}</span>
                      </div>
                      <button type="button" onClick={e => { e.stopPropagation(); onDelete(opt.id) }}
                        style={{ background:'none', border:'none', cursor:'pointer', color:'#cbd5e1', fontSize:13, padding:2 }}
                        onMouseEnter={e => e.currentTarget.style.color='#dc2626'}
                        onMouseLeave={e => e.currentTarget.style.color='#cbd5e1'}>×</button>
                    </div>
                  )
                })
            }
          </div>
        </div>
      )}
    </div>
    {showAdd && (
      <AddItemPopup
        label={label}
        onConfirm={onCreate}
        onSelect={onToggle}
        onClose={() => setShowAdd(false)}
      />
    )}
    </>
  )
}

/* ── Estilos compartilhados ── */
const inp = {
  width: '100%', boxSizing:'border-box', padding:'8px 11px', border:'1.5px solid #e2e8f0',
  borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b', background:'#fff',
}
const lbl = {
  display:'block', fontSize:11, fontWeight:700, color:'#64748b',
  textTransform:'uppercase', letterSpacing:'.06em', marginBottom:5,
}
const row2 = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }

/* ── Modal principal ── */
export default function ListModal({ onClose, onSaved, initial = null }) {
  const isEdit = !!initial?.id

  const [form,       setForm]       = useState(() => initial ? {
    ...EMPTY, ...initial,
    suppliers:          (initial.suppliers   || []).map(s => typeof s === 'object' ? s.id : s),
    additionals:        (initial.additionals || []).map(a => typeof a === 'object' ? a.id : a),
    roteiros:           (initial.roteiros    || []).map(r => typeof r === 'object' ? r.id : r),
    required_documents: Array.isArray(initial.required_documents) ? initial.required_documents : [],
    default_airport:    initial.default_airport    || null,
    departure_country:  initial.departure_country  || null,
    departure_state:    initial.departure_state    || null,
    departure_city:     initial.departure_city     || null,
    bus_map:            initial.bus_map            || null,
  } : { ...EMPTY })
  const [saving,      setSaving]      = useState(false)
  const [suppliers,   setSuppliers]   = useState([])
  const [additionals, setAdditionals] = useState([])
  const [roteiros,    setRoteiros]    = useState([])
  const [categories,  setCategories]  = useState([])
  const [busMaps,     setBusMaps]     = useState([])

  // Dados para exibição do aeroporto e da localização terrestre
  const [airportData,  setAirportData]  = useState(initial?.default_airport_data  || null)
  const [countries,    setCountries]    = useState([])
  const [states,       setStates]       = useState([])
  const [cities,       setCities]       = useState([])

  useEffect(() => {
    listsApi.suppliers().then(r => setSuppliers(r.data.results ?? r.data)).catch(() => {})
    listsApi.listAdditionals().then(r => setAdditionals(r.data.results ?? r.data)).catch(() => {})
    listsApi.roteiros().then(r => setRoteiros(r.data.results ?? r.data)).catch(() => {})
    configApi.listCategories().then(r => setCategories(r.data.results ?? r.data)).catch(() => {})
    configApi.countries().then(r => setCountries(r.data.results ?? r.data)).catch(() => {})
    configApi.busMaps().then(r => setBusMaps((r.data.results ?? r.data).filter(m => m.is_active))).catch(() => {})
  }, [])

  // Carrega estados quando o país muda
  useEffect(() => {
    if (!form.departure_country) { setStates([]); setCities([]); return }
    configApi.states(form.departure_country).then(r => setStates(r.data.results ?? r.data)).catch(() => {})
  }, [form.departure_country])

  // Carrega cidades quando o estado muda
  useEffect(() => {
    if (!form.departure_state) { setCities([]); return }
    configApi.cities(form.departure_state).then(r => setCities(r.data.results ?? r.data)).catch(() => {})
  }, [form.departure_state])

  const catOpts = categories.map(c => ({ value: c.name, label: c.name }))
  const busMapOpts = [{ value: '', label: 'Nenhum' }, ...busMaps.map(m => ({ value: m.id, label: m.label, busMap: m }))]

  const renderBusMapPreview = (opt) => {
    const bm = opt.busMap
    if (!bm) return null
    const twoDecks  = bm.deck_count === 2
    const rowsDeck1 = (bm.rows ?? []).filter(r => (r.deck ?? 1) === 1)
    const rowsDeck2 = (bm.rows ?? []).filter(r => r.deck === 2)
    const deckLabel = { fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.06em', margin:'0 0 6px' }
    return (
      <>
        <p style={{ fontSize:11, fontWeight:700, color:'#1a2d4f', textTransform:'uppercase', letterSpacing:'.04em', margin:'0 0 10px' }}>
          {bm.label}
        </p>
        {twoDecks ? (
          <div style={{ display:'flex', gap:16 }}>
            <div><p style={deckLabel}>1º andar</p><BusLayoutPreview rows={rowsDeck1} seatSize={20} /></div>
            <div><p style={deckLabel}>2º andar</p><BusLayoutPreview rows={rowsDeck2} seatSize={20} /></div>
          </div>
        ) : (
          <BusLayoutPreview rows={rowsDeck1} seatSize={20} />
        )}
      </>
    )
  }

  const set  = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const setV = (k, v)     => setForm(f => ({ ...f, [k]: v }))

  const toggleItem = (key, itemId) => setForm(f => {
    const list = f[key] || []
    return { ...f, [key]: list.includes(itemId) ? list.filter(x => x !== itemId) : [...list, itemId] }
  })

  const handleAddSupplier = async (name) => {
    const r = await listsApi.addSupplier(name)
    setSuppliers(prev => [...prev, r.data].sort((a,b) => a.name.localeCompare(b.name)))
    return r.data.id
  }
  const handleDelSupplier = async (sid) => {
    await listsApi.removeSupplier(sid)
    setSuppliers(prev => prev.filter(s => s.id !== sid))
    setForm(f => ({ ...f, suppliers: f.suppliers.filter(x => x !== sid) }))
  }
  const handleAddAdditional = async (name) => {
    const r = await listsApi.addAdditional(name)
    setAdditionals(prev => [...prev, r.data].sort((a,b) => a.name.localeCompare(b.name)))
    return r.data.id
  }
  const handleDelAdditional = async (aid) => {
    await listsApi.removeAdditional(aid)
    setAdditionals(prev => prev.filter(a => a.id !== aid))
    setForm(f => ({ ...f, additionals: f.additionals.filter(x => x !== aid) }))
  }
  const handleAddRoteiro = async (name) => {
    const r = await listsApi.addRoteiro(name)
    setRoteiros(prev => [...prev, r.data].sort((a,b) => a.name.localeCompare(b.name)))
    return r.data.id
  }
  const handleDelRoteiro = async (rid) => {
    await listsApi.removeRoteiro(rid)
    setRoteiros(prev => prev.filter(r => r.id !== rid))
    setForm(f => ({ ...f, roteiros: f.roteiros.filter(x => x !== rid) }))
  }

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Nome da lista é obrigatório.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        start_date:           form.start_date || null,
        end_date:             form.end_date   || null,
        block_capacity:       Number(form.block_capacity)       || 0,
        total_accommodations: Number(form.total_accommodations) || 0,
        // limpa campos do tipo oposto
        ...(form.list_type === 'aereo'
          ? { departure_country: null, departure_state: null, departure_city: null, bus_map: null }
          : { default_airport: null }),
      }
      const r = isEdit
        ? await listsApi.update(initial.id, payload)
        : await listsApi.create(payload)
      toast.success(isEdit ? 'Lista de passageiros atualizada.' : 'Lista de passageiros criada!')
      onSaved(r.data)
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Erro ao salvar.')
    } finally { setSaving(false) }
  }

  return (
    <div
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:500, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:640, maxHeight:'92vh', display:'flex', flexDirection:'column', boxShadow:'0 32px 80px rgba(0,0,0,.25)' }}>

        {/* Cabeçalho */}
        <div style={{ padding:'18px 24px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'#0f172a' }}>
            {isEdit ? 'Editar lista de passageiros' : 'Nova lista de passageiros'}
          </span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>

        {/* Corpo com scroll */}
        <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

            {/* Nome */}
            <div>
              <label style={lbl}>Nome da Lista de Passageiros</label>
              <input value={form.name} onChange={set('name')} style={inp}
                placeholder="Ex: SUÍÇA MARAVILHOSA C/TREM GLACIER EXPRESS…" />
            </div>

            {/* Roteiros */}
            <div>
              <label style={lbl}>Roteiros</label>
              <MultiPicker label="Roteiro" selected={form.roteiros} options={roteiros}
                onToggle={id => toggleItem('roteiros', id)}
                onCreate={handleAddRoteiro} onDelete={handleDelRoteiro} />
            </div>

            {/* Tipo + Categoria */}
            <div style={row2}>
              <div>
                <label style={lbl}>Tipo</label>
                <FormSelect value={form.list_type} onChange={v => setV('list_type', v)} options={TYPE_OPTS} />
              </div>
              <div>
                <label style={lbl}>Categoria</label>
                <FormSelect value={form.category} onChange={v => setV('category', v)} options={catOpts} />
              </div>
            </div>

            {/* Aeroporto base (aéreo) ou cidade de saída (terrestre) */}
            {form.list_type === 'aereo' ? (
              <div>
                <label style={lbl}>Aeroporto de saída padrão</label>
                <AirportPicker
                  value={airportData}
                  onChange={a => { setAirportData(a); setV('default_airport', a?.id ?? null) }}
                  placeholder="Buscar aeroporto…"
                />
                {airportData && (
                  <button type="button" onClick={() => { setAirportData(null); setV('default_airport', null) }}
                    style={{ marginTop:5, fontSize:11, color:'#94a3b8', background:'none', border:'none', cursor:'pointer', padding:0, textDecoration:'underline' }}>
                    ✕ Remover aeroporto padrão
                  </button>
                )}
              </div>
            ) : (
              <div>
                <label style={lbl}>Cidade de saída</label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
                  <div>
                    <label style={{ ...lbl, marginTop:0, fontSize:10 }}>País</label>
                    <FormSelect
                      value={form.departure_country ?? ''}
                      onChange={v => { setV('departure_country', v || null); setV('departure_state', null); setV('departure_city', null) }}
                      options={[{ value: '', label: 'Selecionar…' }, ...countries.map(c => ({ value: c.id, label: c.name }))]}
                      placeholder="País…"
                    />
                  </div>
                  <div>
                    <label style={{ ...lbl, marginTop:0, fontSize:10 }}>Estado</label>
                    <FormSelect
                      value={form.departure_state ?? ''}
                      onChange={v => { setV('departure_state', v || null); setV('departure_city', null) }}
                      options={[{ value: '', label: form.departure_country ? 'Selecionar…' : '—' }, ...states.map(s => ({ value: s.id, label: s.name }))]}
                      placeholder="Estado…"
                    />
                  </div>
                  <div>
                    <label style={{ ...lbl, marginTop:0, fontSize:10 }}>Cidade</label>
                    <FormSelect
                      value={form.departure_city ?? ''}
                      onChange={v => setV('departure_city', v || null)}
                      options={[{ value: '', label: form.departure_state ? 'Selecionar…' : '—' }, ...cities.map(c => ({ value: c.id, label: c.name }))]}
                      placeholder="Cidade…"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Mapa de assentos de ônibus (apenas terrestre) */}
            {form.list_type === 'terrestre' && (
              <div>
                <label style={lbl}>Mapa de assentos de ônibus</label>
                <FormSelect
                  value={form.bus_map ?? ''}
                  onChange={v => setV('bus_map', v || null)}
                  options={busMapOpts}
                  placeholder="Selecionar mapa…"
                  renderPreview={renderBusMapPreview}
                />
              </div>
            )}

            {/* Capacidade + Acomodações */}
            <div style={row2}>
              <div>
                <label style={lbl}>{form.list_type === 'terrestre' ? 'Capacidade do ônibus' : 'Capacidade do bloqueio'}</label>
                <input type="number" min="0" value={form.block_capacity} onChange={set('block_capacity')} style={inp} />
              </div>
              <div>
                <label style={lbl}>Total de acomodações</label>
                <input type="number" min="0" value={form.total_accommodations} onChange={set('total_accommodations')} style={inp} />
              </div>
            </div>

            {/* Datas */}
            <div style={row2}>
              <div>
                <label style={lbl}>Data de início</label>
                <DatePicker fixed value={form.start_date} onChange={v => setV('start_date', v)} />
              </div>
              <div>
                <label style={lbl}>Data de término</label>
                <DatePicker fixed value={form.end_date} onChange={v => setV('end_date', v)} />
              </div>
            </div>

            {/* Adicionais */}
            <div>
              <label style={lbl}>Adicionais</label>
              <MultiPicker label="Adicional" selected={form.additionals} options={additionals}
                onToggle={id => toggleItem('additionals', id)}
                onCreate={handleAddAdditional} onDelete={handleDelAdditional} />
            </div>

            {/* Documento requerido */}
            <div>
              <label style={lbl}>Documentos requeridos</label>
              <DocMultiSelect
                selected={form.required_documents || []}
                onToggle={v => {
                  const list = form.required_documents || []
                  setV('required_documents', list.includes(v) ? list.filter(x => x !== v) : [...list, v])
                }}
              />
            </div>

          </div>
        </div>

        {/* Rodapé */}
        <div style={{ padding:'14px 24px', borderTop:'1px solid #e2e8f0', display:'flex', gap:10, justifyContent:'flex-end', flexShrink:0 }}>
          <button type="button" onClick={onClose}
            style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            style={{ padding:'8px 22px', borderRadius:8, border:'none', background: saving ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor: saving ? 'default' : 'pointer', fontFamily:'inherit' }}>
            {saving ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Criar lista de passageiros →'}
          </button>
        </div>
      </div>
    </div>
  )
}
