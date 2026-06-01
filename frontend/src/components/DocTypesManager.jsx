import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { configApi } from '../api'
import ConfirmModal from './ConfirmModal'

const FIELD_TYPE_LABELS = {
  text:    'Texto livre',
  date:    'Data',
  list:    'Lista suspensa',
  country: 'País / Estado / Cidade',
}
const FIELD_TYPE_COLORS = {
  text:    { bg:'#f1f5f9', color:'#475569' },
  date:    { bg:'#eff6ff', color:'#2e6db4' },
  list:    { bg:'#f0fdf4', color:'#16a34a' },
  country: { bg:'#fef9c3', color:'#ca8a04' },
}

const inp = { padding:'7px 10px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:13, outline:'none', fontFamily:'inherit', color:'#0f172a', background:'#fff', transition:'border-color .15s' }
const btn = (bg='#1a2d4f', color='#fff') => ({ padding:'7px 14px', borderRadius:7, border:'none', background:bg, color, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' })

/* ── Linha de campo ── */
function FieldRow({ field, onUpdate, onDelete, onAddOption, onDelOption }) {
  const [editing, setEditing] = useState(false)
  const [form,    setForm]    = useState({ label: field.label, field_type: field.field_type, required: field.required })
  const [newOpt,  setNewOpt]  = useState('')
  const [confirm, setConfirm] = useState(null)

  const save = async () => {
    try { await onUpdate(field.id, form); setEditing(false) }
    catch { toast.error('Erro ao salvar campo.') }
  }

  return (
    <div style={{ border:'1px solid #e2e8f0', borderRadius:8, marginBottom:8, background:'#fff', overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 14px' }}>
        {/* tipo badge */}
        <span style={{ padding:'2px 8px', borderRadius:20, fontSize:11, fontWeight:600, ...FIELD_TYPE_COLORS[field.field_type] }}>
          {FIELD_TYPE_LABELS[field.field_type]}
        </span>

        {editing ? (
          <>
            <input value={form.label} onChange={e => setForm(f=>({...f,label:e.target.value}))}
              style={{ ...inp, flex:1 }}
              onFocus={e=>e.target.style.borderColor='#1a2d4f'} onBlur={e=>e.target.style.borderColor='#e2e8f0'} />
            <select value={form.field_type} onChange={e => setForm(f=>({...f,field_type:e.target.value}))}
              style={{ ...inp, width:160 }}>
              {Object.entries(FIELD_TYPE_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label style={{ display:'flex', alignItems:'center', gap:5, fontSize:13, color:'#475569', cursor:'pointer', whiteSpace:'nowrap' }}>
              <input type="checkbox" checked={form.required} onChange={e=>setForm(f=>({...f,required:e.target.checked}))} />
              Obrigatório
            </label>
            <button onClick={save} style={btn()}>Salvar</button>
            <button onClick={() => setEditing(false)} style={btn('#e2e8f0','#475569')}>Cancelar</button>
          </>
        ) : (
          <>
            <span style={{ flex:1, fontSize:13, color:'#0f172a', fontWeight:500 }}>{field.label}</span>
            {field.required && <span style={{ fontSize:11, color:'#dc2626', fontWeight:600 }}>Obrigatório</span>}
            <button onClick={() => setEditing(true)} style={btn('#f8fafc','#475569')}>✏ Editar</button>
            <button onClick={() => setConfirm(true)} style={btn('#fef2f2','#dc2626')}>✕</button>
          </>
        )}
      </div>

      {/* Opções para campos do tipo lista */}
      {field.field_type === 'list' && (
        <div style={{ padding:'8px 14px', borderTop:'1px solid #f1f5f9', background:'#fafafa' }}>
          <p style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.05em', margin:'0 0 8px' }}>
            Opções da lista
          </p>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:8 }}>
            {field.options?.map(opt => (
              <span key={opt.id} style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 9px', borderRadius:20, background:'#f0f6ff', border:'1px solid #bfdbfe', fontSize:12, color:'#2e6db4' }}>
                {opt.value}
                <button onMouseDown={e => { e.preventDefault(); onDelOption(opt.id) }}
                  style={{ background:'none', border:'none', cursor:'pointer', color:'#93c5fd', fontSize:13, lineHeight:1, padding:0 }}>×</button>
              </span>
            ))}
            {(!field.options || field.options.length === 0) && (
              <span style={{ fontSize:12, color:'#94a3b8' }}>Nenhuma opção ainda.</span>
            )}
          </div>
          <div style={{ display:'flex', gap:6 }}>
            <input value={newOpt} onChange={e => setNewOpt(e.target.value)}
              onKeyDown={e => { if (e.key==='Enter' && newOpt.trim()) { onAddOption(field.id, newOpt.trim()); setNewOpt('') } }}
              placeholder="Nova opção… (Enter para adicionar)"
              style={{ ...inp, flex:1, fontSize:12 }}
              onFocus={e=>e.target.style.borderColor='#1a2d4f'} onBlur={e=>e.target.style.borderColor='#e2e8f0'} />
            <button onClick={() => { if (newOpt.trim()) { onAddOption(field.id, newOpt.trim()); setNewOpt('') } }}
              style={btn()}>+</button>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmModal
          message={`Remover o campo "${field.label}"?`}
          detail="Isso remove o campo de todos os documentos que usam este tipo."
          okLabel="Remover"
          onOk={() => { onDelete(field.id); setConfirm(null) }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

/* ── Card de tipo de documento ── */
function DocTypeCard({ docType, onUpdated, onDeleted }) {
  const [expanded, setExpanded]   = useState(false)
  const [editHeader, setEditHeader] = useState(false)
  const [form, setForm]           = useState({ label: docType.label, icon: docType.icon, color: docType.color })
  const [types, setTypes]         = useState(docType)
  const [newField, setNewField]   = useState({ label:'', field_type:'text', required:false })
  const [confirm, setConfirm]     = useState(null)
  const [data, setData]           = useState(docType)

  const refresh = async () => {
    try {
      const r = await configApi.docTypes()
      const t = r.data.find(d => d.id === docType.id)
      if (t) setData(t)
    } catch {}
  }

  const saveHeader = async () => {
    try { await configApi.updateDocType(data.id, form); setEditHeader(false); onUpdated() }
    catch { toast.error('Erro ao salvar.') }
  }

  const addField = async () => {
    if (!newField.label.trim()) return
    try {
      await configApi.addDocField({ ...newField, doc_type_id: data.id })
      setNewField({ label:'', field_type:'text', required:false })
      refresh()
    } catch { toast.error('Erro ao adicionar campo.') }
  }

  const updateField = async (id, form) => {
    await configApi.updateDocField(id, form); refresh()
  }
  const deleteField = async (id) => {
    try { await configApi.delDocField(id); refresh() } catch { toast.error('Erro ao remover campo.') }
  }
  const addOption = async (fieldId, value) => {
    try { await configApi.addDocOption({ field_id: fieldId, value }); refresh() } catch { toast.error('Erro ao adicionar opção.') }
  }
  const delOption = async (id) => {
    try { await configApi.delDocOption(id); refresh() } catch { toast.error('Erro ao remover opção.') }
  }

  return (
    <div style={{ border:'1.5px solid #e2e8f0', borderRadius:10, marginBottom:10, background:'#fff', overflow:'hidden' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', cursor:'pointer' }}
        onClick={() => !editHeader && setExpanded(e => !e)}>
        <span style={{ fontSize:22 }}>{data.icon}</span>
        {editHeader ? (
          <>
            <input value={form.label} onChange={e=>setForm(f=>({...f,label:e.target.value}))}
              style={{ ...inp, flex:1 }} onClick={e=>e.stopPropagation()}
              onFocus={e=>e.target.style.borderColor='#1a2d4f'} onBlur={e=>e.target.style.borderColor='#e2e8f0'} />
            <input value={form.icon} onChange={e=>setForm(f=>({...f,icon:e.target.value}))}
              style={{ ...inp, width:60, textAlign:'center', fontSize:20 }} onClick={e=>e.stopPropagation()} maxLength={4} />
            <input type="color" value={form.color} onChange={e=>setForm(f=>({...f,color:e.target.value}))}
              style={{ width:36, height:34, border:'1px solid #e2e8f0', borderRadius:6, cursor:'pointer', padding:2 }} onClick={e=>e.stopPropagation()} />
            <button onClick={e=>{e.stopPropagation();saveHeader()}} style={btn()}>Salvar</button>
            <button onClick={e=>{e.stopPropagation();setEditHeader(false)}} style={btn('#e2e8f0','#475569')}>Cancelar</button>
          </>
        ) : (
          <>
            <span style={{ flex:1, fontSize:14, fontWeight:700, color:'#0f172a' }}>{data.label}</span>
            <span style={{ fontSize:12, color:'#94a3b8' }}>{data.fields?.length ?? 0} campos</span>
            <div style={{ display:'flex', gap:2, marginLeft:8 }}
              onClick={e => e.stopPropagation()}>
              <button onClick={() => setEditHeader(true)} style={btn('#f8fafc','#475569')}>✏ Editar</button>
              <button onClick={() => setConfirm(true)} style={btn('#fef2f2','#dc2626')}>✕</button>
            </div>
            <span style={{ fontSize:18, color:'#94a3b8', marginLeft:4 }}>{expanded ? '▲' : '▼'}</span>
          </>
        )}
      </div>

      {/* Campos */}
      {expanded && (
        <div style={{ borderTop:'1px solid #f1f5f9', padding:'14px 16px', background:'#f8fafc' }}>
          {data.fields?.length === 0 && (
            <p style={{ fontSize:13, color:'#94a3b8', margin:'0 0 12px' }}>Nenhum campo ainda.</p>
          )}
          {data.fields?.map(f => (
            <FieldRow key={f.id} field={f}
              onUpdate={updateField} onDelete={deleteField}
              onAddOption={addOption} onDelOption={delOption} />
          ))}

          {/* Adicionar campo */}
          <div style={{ background:'#fff', border:'1px dashed #e2e8f0', borderRadius:8, padding:'10px 14px', marginTop:8 }}>
            <p style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.05em', margin:'0 0 8px' }}>Novo campo</p>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
              <input value={newField.label} onChange={e=>setNewField(f=>({...f,label:e.target.value}))}
                onKeyDown={e=>e.key==='Enter'&&addField()}
                placeholder="Nome do campo…"
                style={{ ...inp, flex:1, minWidth:140 }}
                onFocus={e=>e.target.style.borderColor='#1a2d4f'} onBlur={e=>e.target.style.borderColor='#e2e8f0'} />
              <select value={newField.field_type} onChange={e=>setNewField(f=>({...f,field_type:e.target.value}))}
                style={{ ...inp, width:170 }}>
                {Object.entries(FIELD_TYPE_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <label style={{ display:'flex', alignItems:'center', gap:5, fontSize:13, color:'#475569', cursor:'pointer' }}>
                <input type="checkbox" checked={newField.required} onChange={e=>setNewField(f=>({...f,required:e.target.checked}))} />
                Obrigatório
              </label>
              <button onClick={addField} disabled={!newField.label.trim()} style={btn()}>+ Adicionar campo</button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmModal
          message={`Remover o tipo "${data.label}"?`}
          detail="Todos os campos configurados para este tipo serão apagados."
          okLabel="Remover"
          onOk={() => { onDeleted(data.id); setConfirm(null) }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

/* ── Componente principal ── */
export default function DocTypesManager() {
  const [docTypes,  setDocTypes]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [newType,   setNewType]   = useState({ label:'', icon:'📄', color:'#475569' })
  const [seeding,   setSeeding]   = useState(false)
  const [showNew,   setShowNew]   = useState(false)

  const load = () => {
    setLoading(true)
    configApi.docTypes().then(r => setDocTypes(r.data)).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const addType = async () => {
    if (!newType.label.trim()) return
    const key = newType.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    try {
      await configApi.addDocType({ ...newType, key, order: docTypes.length + 1 })
      setNewType({ label:'', icon:'📄', color:'#475569' })
      setShowNew(false)
      load()
    } catch { toast.error('Erro ao criar tipo.') }
  }

  const delType = async (id) => {
    try { await configApi.delDocType(id); load() }
    catch { toast.error('Erro ao remover tipo.') }
  }

  const seed = async () => {
    setSeeding(true)
    try {
      const r = await configApi.seedDocTypes()
      toast.success(`${r.data.created_types} tipos padrão criados.`)
      load()
    } catch { toast.error('Erro ao restaurar tipos padrão.') }
    finally { setSeeding(false) }
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display:'flex', gap:10, marginBottom:16, alignItems:'center', flexWrap:'wrap' }}>
        <button onClick={() => setShowNew(s=>!s)}
          style={{ padding:'8px 16px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
          + Novo tipo de documento
        </button>
        <button onClick={seed} disabled={seeding}
          style={{ padding:'8px 14px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', opacity:seeding?.6:1 }}>
          {seeding ? 'Restaurando…' : '↺ Restaurar tipos padrão'}
        </button>
        <span style={{ fontSize:12, color:'#94a3b8', marginLeft:'auto' }}>{docTypes.length} tipo{docTypes.length!==1?'s':''}</span>
      </div>

      {/* Formulário novo tipo */}
      {showNew && (
        <div style={{ border:'1.5px solid #2e6db4', borderRadius:10, padding:'14px 16px', marginBottom:14, background:'#f0f6ff' }}>
          <p style={{ fontSize:13, fontWeight:700, color:'#1a2d4f', margin:'0 0 10px' }}>Novo tipo de documento</p>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <input value={newType.label} onChange={e=>setNewType(f=>({...f,label:e.target.value}))}
              onKeyDown={e=>e.key==='Enter'&&addType()}
              placeholder="Nome do tipo… ex: Seguro de Viagem"
              style={{ ...inp, flex:1, minWidth:200 }}
              onFocus={e=>e.target.style.borderColor='#1a2d4f'} onBlur={e=>e.target.style.borderColor='#e2e8f0'} />
            <input value={newType.icon} onChange={e=>setNewType(f=>({...f,icon:e.target.value}))}
              style={{ ...inp, width:60, textAlign:'center', fontSize:20 }} maxLength={4} placeholder="📄" />
            <input type="color" value={newType.color} onChange={e=>setNewType(f=>({...f,color:e.target.value}))}
              style={{ width:40, height:34, border:'1px solid #e2e8f0', borderRadius:6, cursor:'pointer', padding:2 }} />
            <button onClick={addType} disabled={!newType.label.trim()} style={btn()}>Criar</button>
            <button onClick={() => setShowNew(false)} style={btn('#e2e8f0','#475569')}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista de tipos */}
      {loading ? (
        <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
      ) : docTypes.length === 0 ? (
        <div style={{ textAlign:'center', padding:'32px 0' }}>
          <p style={{ color:'#94a3b8', fontSize:13, marginBottom:12 }}>Nenhum tipo cadastrado.</p>
          <button onClick={seed} style={btn()}>↺ Restaurar tipos padrão</button>
        </div>
      ) : docTypes.map(dt => (
        <DocTypeCard key={dt.id} docType={dt} onUpdated={load} onDeleted={delType} />
      ))}
    </div>
  )
}
