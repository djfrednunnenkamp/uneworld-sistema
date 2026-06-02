import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { listsApi } from '../api'
import FormSelect from './FormSelect'
import DatePicker from './DatePicker'

/* ── Opções ── */
const TYPE_OPTS = [
  { value: 'aereo',    label: 'Via Aéreo'   },
  { value: 'onibus',   label: 'Via Ônibus'  },
  { value: 'maritimo', label: 'Via Marítimo' },
]
const CAT_OPTS = [
  { value: 'internacional', label: 'Internacional' },
  { value: 'nacional',      label: 'Nacional'      },
]
const DOC_OPTS = [
  { value: '',           label: 'Nenhum'     },
  { value: 'passaporte', label: 'Passaporte' },
  { value: 'rg',         label: 'RG'         },
  { value: 'cnh',        label: 'CNH'        },
  { value: 'visto',      label: 'Visto'      },
]

const EMPTY = {
  name: '', list_type: 'aereo', category: 'internacional',
  block_capacity: 0, total_accommodations: 0,
  start_date: '', end_date: '',
  suppliers: [], additionals: [],
  required_document: '', status: 'aberta', notes: '',
}


/* ── MultiPicker compacto ── */
function MultiPicker({ label, selected, options, onToggle, onCreate, onDelete }) {
  const [open,  setOpen]  = useState(false)
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
      <button type="button" onClick={() => setOpen(o => !o)} style={{ ...inp, display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer', textAlign:'left', width:'100%' }}>
        <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color: selected.length ? '#1e293b' : '#94a3b8', fontSize:13 }}>
          {displayVal}
        </span>
        <span style={{ fontSize:10, color:'#94a3b8', marginLeft:8 }}>▼</span>
      </button>
      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:600, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', boxShadow:'0 12px 32px rgba(0,0,0,.15)', overflow:'hidden' }}>
          <div style={{ padding:'8px 10px', borderBottom:'1px solid #f1f5f9', display:'flex', gap:6 }}>
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder={`Novo ${label.toLowerCase()}…`}
              style={{ flex:1, padding:'5px 8px', border:'1.5px solid #e2e8f0', borderRadius:6, fontSize:12, outline:'none', fontFamily:'inherit' }}
              onFocus={e => e.target.style.borderColor='#1a2d4f'}
              onBlur={e => e.target.style.borderColor='#e2e8f0'} />
            <button type="button" onClick={handleCreate}
              style={{ padding:'5px 10px', borderRadius:6, border:'none', background:'#1a2d4f', color:'#fff', fontSize:12, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>
              +
            </button>
          </div>
          <div style={{ maxHeight:160, overflowY:'auto' }}>
            {options.length === 0
              ? <p style={{ textAlign:'center', color:'#94a3b8', fontSize:12, padding:'10px 0', margin:0 }}>Nenhum cadastrado</p>
              : options.map(opt => {
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
    suppliers:   (initial.suppliers   || []).map(s => typeof s === 'object' ? s.id : s),
    additionals: (initial.additionals || []).map(a => typeof a === 'object' ? a.id : a),
  } : { ...EMPTY })
  const [saving,      setSaving]      = useState(false)
  const [suppliers,   setSuppliers]   = useState([])
  const [additionals, setAdditionals] = useState([])

  useEffect(() => {
    listsApi.suppliers().then(r => setSuppliers(r.data.results ?? r.data)).catch(() => {})
    listsApi.listAdditionals().then(r => setAdditionals(r.data.results ?? r.data)).catch(() => {})
  }, [])

  const set  = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const setV = (k, v)     => setForm(f => ({ ...f, [k]: v }))

  const toggleItem = (key, itemId) => setForm(f => {
    const list = f[key] || []
    return { ...f, [key]: list.includes(itemId) ? list.filter(x => x !== itemId) : [...list, itemId] }
  })

  const handleAddSupplier = async (name) => {
    const r = await listsApi.addSupplier(name)
    setSuppliers(prev => [...prev, r.data].sort((a,b) => a.name.localeCompare(b.name)))
  }
  const handleDelSupplier = async (sid) => {
    await listsApi.removeSupplier(sid)
    setSuppliers(prev => prev.filter(s => s.id !== sid))
    setForm(f => ({ ...f, suppliers: f.suppliers.filter(x => x !== sid) }))
  }
  const handleAddAdditional = async (name) => {
    const r = await listsApi.addAdditional(name)
    setAdditionals(prev => [...prev, r.data].sort((a,b) => a.name.localeCompare(b.name)))
  }
  const handleDelAdditional = async (aid) => {
    await listsApi.removeAdditional(aid)
    setAdditionals(prev => prev.filter(a => a.id !== aid))
    setForm(f => ({ ...f, additionals: f.additionals.filter(x => x !== aid) }))
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

            {/* Tipo + Categoria */}
            <div style={row2}>
              <div>
                <label style={lbl}>Tipo</label>
                <FormSelect value={form.list_type} onChange={v => setV('list_type', v)} options={TYPE_OPTS} />
              </div>
              <div>
                <label style={lbl}>Categoria</label>
                <FormSelect value={form.category} onChange={v => setV('category', v)} options={CAT_OPTS} />
              </div>
            </div>

            {/* Capacidade + Acomodações */}
            <div style={row2}>
              <div>
                <label style={lbl}>Capacidade do bloqueio</label>
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

            {/* Fornecedores */}
            <div>
              <label style={lbl}>Fornecedores</label>
              <MultiPicker label="Fornecedor" selected={form.suppliers} options={suppliers}
                onToggle={id => toggleItem('suppliers', id)}
                onCreate={handleAddSupplier} onDelete={handleDelSupplier} />
            </div>

            {/* Adicionais */}
            <div>
              <label style={lbl}>Adicionais</label>
              <MultiPicker label="Adicional" selected={form.additionals} options={additionals}
                onToggle={id => toggleItem('additionals', id)}
                onCreate={handleAddAdditional} onDelete={handleDelAdditional} />
            </div>

            {/* Documento requerido + Status */}
            <div style={row2}>
              <div>
                <label style={lbl}>Documento requerido</label>
                <FormSelect value={form.required_document} onChange={v => setV('required_document', v)} options={DOC_OPTS} />
              </div>
              <div>
                <label style={lbl}>Status da lista</label>
                <div style={{ display:'flex', gap:0, borderRadius:8, overflow:'hidden', border:'1.5px solid #e2e8f0', width:'fit-content' }}>
                  {[{ v:'aberta', l:'Aberta' }, { v:'fechada', l:'Fechada' }].map(opt => (
                    <button key={opt.v} type="button" onClick={() => setV('status', opt.v)}
                      style={{ padding:'7px 18px', border:'none', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer', transition:'all .12s',
                        background: form.status === opt.v ? (opt.v === 'aberta' ? '#1a2d4f' : '#64748b') : '#fff',
                        color:      form.status === opt.v ? '#fff' : '#64748b',
                      }}>
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>
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
