import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { configApi } from '../api'
import ConfirmModal from './ConfirmModal'
import { Ic } from './Icon'

const FIELD_TYPES = [
  { value: 'text',       label: 'Texto livre',            icon: '📝', desc: 'Input de texto' },
  { value: 'date',       label: 'Data',                   icon: '📅', desc: 'Calendário com máscara' },
  { value: 'list',       label: 'Lista suspensa',         icon: '📋', desc: 'Dropdown com opções' },
  { value: 'country',    label: 'País / Estado / Cidade', icon: '🌍', desc: 'Seletor geográfico' },
  { value: 'language',   label: 'Idioma',                 icon: '🌐', desc: 'Lista de idiomas cadastrados' },
  { value: 'profession', label: 'Profissão',              icon: '💼', desc: 'Lista de profissões (CBO)' },
  { value: 'prof_card',  label: 'Carteira profissional',  icon: '🪪', desc: 'OAB, CRM, CREA, CTPS…'   },
]

const COUNTRY_LEVELS = [
  { value: 'country_only',       label: 'Só o País',                icon: '🌍', desc: 'ex: Brasil' },
  { value: 'country_state',      label: 'País + Estado',            icon: '🗺️', desc: 'ex: Brasil · SP' },
  { value: 'country_state_city', label: 'País + Estado + Cidade',   icon: '📍', desc: 'ex: Brasil · SP · Campinas' },
]

const TYPE_COLORS = ['#2e6db4','#7c3aed','#059669','#0891b2','#b45309','#92400e','#0f766e','#dc2626','#475569','#ca8a04']

/* ── Dropdown estilizado com ícones ──
   Usa position:fixed para escapar do overflow:hidden do modal */
function IconSelect({ options, value, onChange, placeholder = 'Selecione…', compact = false }) {
  const [open,    setOpen]    = useState(false)
  const [pos,     setPos]     = useState({ top: 0, left: 0, width: 0 })
  const triggerRef = useRef(null)
  const selected   = options.find(o => o.value === value)

  /* Fecha ao clicar fora */
  useEffect(() => {
    if (!open) return
    const h = (e) => {
      if (triggerRef.current && !triggerRef.current.closest('[data-iconselect]')?.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const openDrop = (e) => {
    e.preventDefault()
    if (open) { setOpen(false); return }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const estHeight  = Math.min(options.length * 42 + 8, 280)
      const spaceBelow = window.innerHeight - rect.bottom - 8
      const spaceAbove = rect.top - 8
      let top
      if (spaceBelow >= estHeight) {
        top = rect.bottom + 4                          // cabe abaixo → abre pra baixo
      } else if (spaceAbove >= estHeight) {
        top = rect.top - estHeight - 4                // cabe acima → abre pra cima
      } else if (spaceBelow >= spaceAbove) {
        top = rect.bottom + 4                         // mais espaço abaixo → com scroll
      } else {
        top = Math.max(8, rect.top - estHeight - 4)  // mais espaço acima → com scroll
      }
      setPos({ top, left: rect.left, width: rect.width })
    }
    setOpen(true)
  }

  return (
    <div data-iconselect="1" style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        type="button"
        ref={triggerRef}
        onMouseDown={openDrop}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: compact ? '6px 8px' : '7px 10px',
          border: `1.5px solid ${open ? '#1a2d4f' : '#e2e8f0'}`,
          borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
          transition: 'border-color .12s', whiteSpace: 'nowrap',
        }}
      >
        {selected ? (
          <>
            <span style={{ fontSize: compact ? 14 : 16, flexShrink: 0 }}>{selected.icon}</span>
            <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 500, flex: compact ? undefined : 1, textAlign: 'left' }}>{selected.label}</span>
            {!compact && <span style={{ fontSize: 11, color: '#94a3b8' }}>{selected.desc}</span>}
          </>
        ) : (
          <span style={{ fontSize: 13, color: '#94a3b8', flex: 1, textAlign: 'left' }}>{placeholder}</span>
        )}
        <span style={{ color: '#94a3b8', fontSize: 10, marginLeft: compact ? 2 : 4 }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Lista — renderizada com position:fixed para não ser cortada pelo modal */}
      {open && (
        <div style={{
          position: 'fixed',
          top:   pos.top,
          left:  pos.left,
          width: Math.max(pos.width, 220),
          background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0,0,0,.18)', zIndex: 9999,
          maxHeight: 280, overflowY: 'auto',
        }}>
          {options.map(opt => {
            const isActive = opt.value === value
            return (
              <div key={opt.value}
                onMouseDown={e => { e.preventDefault(); onChange(opt.value); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                  cursor: 'pointer', background: isActive ? '#f0f4ff' : '#fff',
                  borderBottom: '1px solid #f8fafc',
                  borderLeft: isActive ? '3px solid #1a2d4f' : '3px solid transparent',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f8fafc' }}
                onMouseLeave={e => { e.currentTarget.style.background = isActive ? '#f0f4ff' : '#fff' }}
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>{opt.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? '#1a2d4f' : '#0f172a' }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{opt.desc}</div>
                </div>
                {isActive && <span style={{ color: '#1a2d4f', fontSize: 14, fontWeight: 700 }}>✓</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Modal de criação / edição ── */
function DocTypeModal({ docType, onSave, onClose }) {
  const isEdit = !!docType

  const [name,    setName]    = useState(docType?.label ?? '')
  const [icon,    setIcon]    = useState(docType?.icon  ?? '📄')
  const [color,   setColor]   = useState(docType?.color ?? '#475569')
  const [fields,  setFields]  = useState(
    (docType?.fields ?? []).map(f => ({ ...f, _id: f.id, options: f.options ?? [] }))
  )
  const [saving,    setSaving]    = useState(false)
  const [delField,  setDelField]  = useState(null)
  const [nameError, setNameError] = useState(false)       // nome do tipo em vermelho
  const [fieldErrs, setFieldErrs] = useState(new Set())   // índices de campos sem nome

  const addField = () => {
    setFields(prev => [...prev, {
      _id: null, key: '', label: '', field_type: 'text', subtype: '', required: false, order: prev.length, options: [], _new: true
    }])
  }

  const updateField = (idx, patch) =>
    setFields(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f))

  const removeField = (idx) =>
    setFields(prev => prev.filter((_, i) => i !== idx))

  const addOption = (idx, value) => {
    if (!value.trim()) return
    setFields(prev => prev.map((f, i) =>
      i === idx ? { ...f, options: [...f.options, { value: value.trim(), _new: true }] } : f
    ))
  }

  const removeOption = (fieldIdx, optIdx) =>
    setFields(prev => prev.map((f, i) =>
      i === fieldIdx ? { ...f, options: f.options.filter((_, j) => j !== optIdx) } : f
    ))

  // Drag-and-drop de reordenação
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)

  const moveField = (from, to) => {
    if (from === to || to < 0 || to >= fields.length) return
    setFields(prev => {
      const arr = [...prev]
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item)
      return arr
    })
  }

  const handleSave = async () => {
    // Valida nome e campos — marca em vermelho sem bloquear com toast
    let hasErr = false
    if (!name.trim()) { setNameError(true); hasErr = true }
    const emptyFields = new Set(
      fields.map((f, i) => f.label.trim() ? null : i).filter(i => i !== null)
    )
    if (emptyFields.size) { setFieldErrs(emptyFields); hasErr = true }
    if (hasErr) return   // fica na tela com campos vermelhos

    setSaving(true)
    try {
      await onSave({ name: name.trim(), icon, color, fields })
      onClose()
    } catch { toast.error('Erro ao salvar.') }
    finally { setSaving(false) }
  }

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.5)', backdropFilter:'blur(3px)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:600, padding:20,
    }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background:'#fff', borderRadius:14, width:'100%', maxWidth:580,
        maxHeight:'90vh', display:'flex', flexDirection:'column',
        boxShadow:'0 32px 80px rgba(0,0,0,.25)',
      }}>

        {/* Header */}
        <div style={{ padding:'18px 24px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <h2 style={{ fontSize:16, fontWeight:700, color:'#0f172a', margin:0 }}>
            {isEdit ? `Editar: ${docType.label}` : 'Novo tipo de documento'}
          </h2>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>

        {/* Corpo scrollável */}
        <div style={{ flex:1, minHeight:0, overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:18 }}>

          {/* Identidade */}
          <div>
            <p style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', margin:'0 0 10px' }}>
              Identificação
            </p>
            <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
              {/* Ícone */}
              <div>
                <label style={{ display:'block', fontSize:11, color:'#94a3b8', marginBottom:4 }}>Ícone</label>
                <input value={icon} onChange={e=>setIcon(e.target.value)} maxLength={4}
                  style={{ width:60, padding:'8px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:24, textAlign:'center', outline:'none', fontFamily:'inherit' }}
                  onFocus={e=>e.target.style.borderColor='#1a2d4f'} onBlur={e=>e.target.style.borderColor='#e2e8f0'} />
              </div>
              {/* Nome */}
              <div style={{ flex:1 }}>
                <label style={{ display:'block', fontSize:11, color: nameError ? '#dc2626' : '#94a3b8', marginBottom:4 }}>Nome do tipo *</label>
                <input value={name} onChange={e => { setName(e.target.value); if (nameError && e.target.value.trim()) setNameError(false) }}
                  placeholder="ex: Seguro de Viagem, Passaporte…"
                  style={{ width:'100%', padding:'9px 12px', border:`1.5px solid ${nameError ? '#dc2626' : '#e2e8f0'}`, borderRadius:8, fontSize:14, outline:'none', fontFamily:'inherit', boxSizing:'border-box', background: nameError ? '#fef2f2' : '#fff' }}
                  onFocus={e => e.target.style.borderColor = nameError ? '#dc2626' : '#1a2d4f'}
                  onBlur={e  => e.target.style.borderColor = nameError ? '#dc2626' : '#e2e8f0'} />
                {nameError && <p style={{ fontSize:11, color:'#dc2626', margin:'3px 0 0', fontWeight:500 }}>Informe o nome do tipo</p>}
              </div>
            </div>
            {/* Paleta de cores */}
            <div style={{ marginTop:10 }}>
              <label style={{ display:'block', fontSize:11, color:'#94a3b8', marginBottom:6 }}>Cor</label>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {TYPE_COLORS.map(c => (
                  <button key={c} onMouseDown={e=>{e.preventDefault();setColor(c)}}
                    style={{
                      width:28, height:28, borderRadius:6, background:c, cursor:'pointer',
                      border: color===c ? '3px solid #0f172a' : '2px solid transparent',
                      outline: color===c ? '2px solid #fff' : 'none', outlineOffset:'-4px',
                      transition:'all .1s',
                    }} />
                ))}
                <input type="color" value={color} onChange={e=>setColor(e.target.value)}
                  title="Cor personalizada"
                  style={{ width:28, height:28, border:'1.5px solid #e2e8f0', borderRadius:6, cursor:'pointer', padding:1 }} />
              </div>
            </div>
          </div>

          {/* Campos */}
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <p style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', margin:0 }}>
                Campos ({fields.length})
              </p>
              <button onClick={addField}
                style={{ padding:'5px 12px', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                + Adicionar campo
              </button>
            </div>

            {fields.length === 0 ? (
              <p style={{ fontSize:13, color:'#94a3b8', textAlign:'center', padding:'20px 0', background:'#f8fafc', borderRadius:8, border:'1px dashed #e2e8f0' }}>
                Nenhum campo. Clique em "Adicionar campo" para começar.
              </p>
            ) : fields.map((f, idx) => (
              <FieldEditor key={f._id ?? `new_${idx}`} field={f} index={idx} total={fields.length}
                onUpdate={(p) => updateField(idx, p)}
                onDelete={() => {
                  if (f.label) setDelField({ index:idx, label:f.label })
                  else removeField(idx)
                }}
                onAddOption={(v) => addOption(idx, v)}
                onRemoveOption={(oi) => removeOption(idx, oi)}
                isDragging={dragIdx === idx}
                isOver={overIdx === idx && dragIdx !== idx}
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => { e.preventDefault(); setOverIdx(idx) }}
                onDrop={() => { moveField(dragIdx, overIdx); setDragIdx(null); setOverIdx(null) }}
                onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
                onMoveUp={() => moveField(idx, idx - 1)}
                onMoveDown={() => moveField(idx, idx + 1)}
                hasError={fieldErrs.has(idx)}
                onClearError={() => setFieldErrs(prev => { const n = new Set(prev); n.delete(idx); return n })}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding:'14px 24px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:28 }}>{icon}</span>
            <span style={{ fontSize:13, fontWeight:600, color: name ? '#0f172a' : '#94a3b8' }}>
              {name || 'Nome do tipo…'}
            </span>
            <span style={{ width:14, height:14, borderRadius:3, background:color, display:'inline-block' }} />
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={onClose}
              style={{ padding:'9px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving || !name.trim()}
              style={{ padding:'9px 20px', borderRadius:8, border:'none', background: saving||!name.trim()?'#94a3b8':'#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor: saving||!name.trim()?'default':'pointer', fontFamily:'inherit' }}>
              {saving ? 'Salvando…' : isEdit ? '✓ Salvar alterações' : '✓ Criar tipo'}
            </button>
          </div>
        </div>
      </div>

      {delField && (
        <ConfirmModal
          message={`Remover o campo "${delField.label}"?`}
          okLabel="Remover"
          onOk={() => { removeField(delField.index); setDelField(null) }}
          onCancel={() => setDelField(null)}
        />
      )}
    </div>
  )
}

/* ── Editor de um campo dentro do modal ── */
function FieldEditor({ field, index, total, hasError, onClearError, onUpdate, onDelete, onAddOption, onRemoveOption,
                       isDragging, isOver, onDragStart, onDragOver, onDrop, onDragEnd,
                       onMoveUp, onMoveDown }) {
  const [newOpt, setNewOpt] = useState('')
  const inp = { padding:'6px 10px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:13, outline:'none', fontFamily:'inherit', background:'#fff', transition:'border-color .12s' }
  const selSubtype = field.subtype || 'country_state_city'

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{
        border: isOver ? '2px dashed #2e6db4' : '1px solid #e2e8f0',
        borderRadius:10, marginBottom:8,
        background: isDragging ? '#f0f6ff' : isOver ? '#f8fbff' : '#fff',
        opacity: isDragging ? 0.5 : 1,
        transition: 'background .1s, border-color .1s',
      }}
    >

      {/* Linha única: alça | número | nome | tipo (compacto) | obrigatório | apagar */}
      <div style={{ display:'flex', gap:8, alignItems:'center', padding:'9px 12px' }}>
        {/* Alça de drag */}
        <span
          title="Arraste para reordenar"
          style={{ fontSize:14, color:'#cbd5e1', cursor:'grab', flexShrink:0, lineHeight:1, userSelect:'none', padding:'0 2px' }}
        >⠿</span>

        {/* Botões ↑↓ */}
        <div style={{ display:'flex', flexDirection:'column', gap:1, flexShrink:0 }}>
          <button onClick={onMoveUp} disabled={index === 0}
            style={{ background:'none', border:'none', cursor: index===0 ? 'default':'pointer', color: index===0 ? '#e2e8f0':'#94a3b8', fontSize:10, lineHeight:1, padding:'1px 2px' }}
            title="Mover para cima">▲</button>
          <button onClick={onMoveDown} disabled={index === total - 1}
            style={{ background:'none', border:'none', cursor: index===total-1 ? 'default':'pointer', color: index===total-1 ? '#e2e8f0':'#94a3b8', fontSize:10, lineHeight:1, padding:'1px 2px' }}
            title="Mover para baixo">▼</button>
        </div>

        <span style={{ fontSize:11, color:'#94a3b8', width:14, textAlign:'center', flexShrink:0, fontWeight:600 }}>{index+1}</span>

        <div style={{ flex:1, minWidth:0 }}>
          <input value={field.label}
            onChange={e => { onUpdate({label:e.target.value}); if (hasError && e.target.value.trim()) onClearError?.() }}
            placeholder="Nome do campo…"
            style={{ ...inp, width:'100%', border:`1.5px solid ${hasError ? '#dc2626' : '#e2e8f0'}`, background: hasError ? '#fef2f2' : '#fff' }}
            onFocus={e => e.target.style.borderColor = hasError ? '#dc2626' : '#1a2d4f'}
            onBlur={e  => e.target.style.borderColor = hasError ? '#dc2626' : '#e2e8f0'} />
          {hasError && <p style={{ fontSize:10, color:'#dc2626', margin:'2px 0 0', fontWeight:500 }}>Nome obrigatório</p>}
        </div>

        {/* Tipo compacto — ícone + nome + seta */}
        <div style={{ flexShrink:0, width:170 }}>
          <IconSelect
            options={FIELD_TYPES}
            value={field.field_type}
            onChange={v => onUpdate({ field_type: v, subtype: '' })}
            compact
          />
        </div>

        <label style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'#475569', cursor:'pointer', whiteSpace:'nowrap', userSelect:'none', flexShrink:0 }}>
          <input type="checkbox" checked={field.required} onChange={e=>onUpdate({required:e.target.checked})} />
          Obrig.
        </label>

        <button onClick={onDelete}
          style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:6, cursor:'pointer', color:'#dc2626', fontSize:13, padding:'4px 8px', fontFamily:'inherit', flexShrink:0 }}>✕</button>
      </div>

      {/* Nível de detalhe — só quando tipo = País */}
      {field.field_type === 'country' && (
        <div style={{ padding:'0 12px 10px 36px', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:11, color:'#94a3b8', flexShrink:0 }}>Nível:</span>
          <div style={{ flex:1, maxWidth:320 }}>
            <IconSelect
              options={COUNTRY_LEVELS}
              value={selSubtype}
              onChange={v => onUpdate({ subtype: v })}
              placeholder="Escolha o nível…"
              compact
            />
          </div>
        </div>
      )}

      {/* Opções para campo do tipo lista */}
      {field.field_type === 'list' && (
        <div style={{ padding:'0 12px 10px 36px', borderTop:'1px solid #f8fafc' }}>
          <p style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.05em', margin:'8px 0 6px' }}>Opções</p>
          <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:7 }}>
            {field.options.map((opt, oi) => (
              <span key={oi} style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'2px 8px', borderRadius:20, background:'#f0f6ff', border:'1px solid #bfdbfe', fontSize:12, color:'#2e6db4' }}>
                {opt.value}
                <button onMouseDown={e=>{e.preventDefault();onRemoveOption(oi)}}
                  style={{ background:'none', border:'none', cursor:'pointer', color:'#93c5fd', fontSize:14, lineHeight:1, padding:0 }}>×</button>
              </span>
            ))}
            {field.options.length===0 && <span style={{ fontSize:12, color:'#94a3b8' }}>Sem opções ainda.</span>}
          </div>
          <div style={{ display:'flex', gap:6 }}>
            <input value={newOpt} onChange={e=>setNewOpt(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter'&&newOpt.trim()){ onAddOption(newOpt.trim()); setNewOpt('') } }}
              placeholder="Nova opção… (Enter para adicionar)"
              style={{ ...inp, flex:1, fontSize:12 }}
              onFocus={e=>e.target.style.borderColor='#1a2d4f'} onBlur={e=>e.target.style.borderColor='#e2e8f0'} />
            <button onClick={()=>{ if(newOpt.trim()){ onAddOption(newOpt.trim()); setNewOpt('') } }}
              style={{ padding:'5px 10px', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>+</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Componente principal ── */
export default function DocTypesManager({ canEdit = true, canDelete = true }) {
  const [docTypes, setDocTypes] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(null) // null | { docType?: obj }
  const [confirm,  setConfirm]  = useState(null) // { id, name }

  const load = () => {
    setLoading(true)
    configApi.docTypes().then(r => setDocTypes(r.data)).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  /* Salva criação ou edição */
  const handleSave = async ({ name, icon, color, fields }) => {
    const docType = modal?.docType
    let savedType

    if (docType) {
      // Editar tipo existente
      await configApi.updateDocType(docType.id, { label: name, icon, color })
      savedType = docType

      // Sincronizar campos:
      // 1. Remover campos apagados
      const keepIds = new Set(fields.filter(f => f._id).map(f => f._id))
      for (const f of docType.fields ?? []) {
        if (!keepIds.has(f.id)) await configApi.delDocField(f.id).catch(() => {})
      }
    } else {
      // Criar novo tipo
      const key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      const r = await configApi.addDocType({ key, label: name, icon, color, order: docTypes.length + 1 })
      savedType = r.data
    }

    // Salvar campos
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]
      const key = f.key?.trim() || f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `field_${i}`
      if (f._id) {
        // Atualizar campo existente
        await configApi.updateDocField(f._id, { label: f.label, field_type: f.field_type, subtype: f.subtype || '', required: f.required, order: i }).catch(() => {})
        // Sincronizar opções
        const keepOptIds = new Set(f.options.filter(o => o.id).map(o => o.id))
        const existing = (docType?.fields?.find(df => df.id === f._id)?.options ?? [])
        for (const o of existing) {
          if (!keepOptIds.has(o.id)) await configApi.delDocOption(o.id).catch(() => {})
        }
        for (const o of f.options.filter(o => !o.id)) {
          await configApi.addDocOption({ field_id: f._id, value: o.value, order: 0 }).catch(() => {})
        }
      } else {
        // Criar campo novo
        let fieldId = null
        try {
          const r = await configApi.addDocField({ doc_type_id: savedType.id, key, label: f.label, field_type: f.field_type, subtype: f.subtype || '', required: f.required, order: i })
          fieldId = r.data?.id
        } catch (err) {
          const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message
          toast.error(`Erro ao salvar campo "${f.label}": ${msg}`)
        }
        if (fieldId && f.field_type === 'list') {
          for (const o of f.options) {
            await configApi.addDocOption({ field_id: fieldId, value: o.value, order: 0 }).catch(() => {})
          }
        }
      }
    }

    toast.success(docType ? 'Tipo atualizado!' : 'Tipo criado!')
    load()
  }

  const delType = async (id) => {
    try { await configApi.delDocType(id); setConfirm(null); load() }
    catch { toast.error('Erro ao remover tipo.') }
  }

  const seed = async () => {
    try {
      const r = await configApi.seedDocTypes()
      toast.success(`${r.data.created_types} tipo(s) padrão criados.`)
      load()
    } catch { toast.error('Erro ao restaurar.') }
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display:'flex', gap:10, marginBottom:18, alignItems:'center' }}>
        {canEdit && (
          <button onClick={() => setModal({})}
            style={{ padding:'9px 18px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            + Novo tipo de documento
          </button>
        )}
        <span style={{ fontSize:12, color:'#94a3b8', marginLeft:'auto' }}>
          {docTypes.length} tipo{docTypes.length!==1?'s':''}
        </span>
      </div>

      {/* Lista de tipos */}
      {loading ? (
        <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
      ) : docTypes.length === 0 ? (
        <div style={{ textAlign:'center', padding:'40px 0', background:'#f8fafc', borderRadius:10, border:'1px dashed #e2e8f0' }}>
          <p style={{ color:'#94a3b8', fontSize:13, margin:'0 0 12px' }}>Nenhum tipo cadastrado.</p>
          <button onClick={seed}
            style={{ padding:'8px 18px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            ↺ Restaurar tipos padrão
          </button>
        </div>
      ) : (
        <div style={{ border:'1px solid #e2e8f0', borderRadius:10, overflow:'hidden', background:'#fff' }}>
          {docTypes.map((dt, idx) => (
            <div key={dt.id} style={{
              display:'flex', alignItems:'center', gap:14, padding:'13px 18px',
              borderBottom: idx < docTypes.length-1 ? '1px solid #f1f5f9' : 'none',
            }}
              onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
              onMouseLeave={e=>e.currentTarget.style.background='#fff'}
            >
              {/* Cor */}
              <div style={{ width:4, height:36, borderRadius:2, background:dt.color, flexShrink:0 }} />
              {/* Ícone + Nome */}
              <span style={{ fontSize:22, lineHeight:1, flexShrink:0 }}>{dt.icon}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:14, fontWeight:600, color:'#0f172a', margin:'0 0 2px' }}>{dt.label}</p>
                <p style={{ fontSize:12, color:'#94a3b8', margin:0 }}>
                  {dt.fields?.length ?? 0} campo{(dt.fields?.length??0)!==1?'s':''}
                  {dt.fields?.length > 0 && (
                    <span style={{ marginLeft:6 }}>
                      · {dt.fields.map(f => f.label).join(', ')}
                    </span>
                  )}
                </p>
              </div>
              {/* Badge ativo */}
              {!dt.is_active && (
                <span style={{ padding:'2px 8px', borderRadius:20, background:'#fee2e2', color:'#dc2626', fontSize:11, fontWeight:600 }}>Inativo</span>
              )}
              {/* Ações */}
              {(canEdit || canDelete) && (
                <div className="r-acts">
                  {canEdit   && <button className="r-btn edit" title="Editar"  onClick={() => setModal({ docType: dt })}><Ic n="edit"  s={13}/></button>}
                  {canDelete && <button className="r-btn del"  title="Excluir" onClick={() => setConfirm({ id:dt.id, name:dt.label })}><Ic n="trash" s={13}/></button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Popup criar / editar */}
      {modal !== null && (
        <DocTypeModal
          docType={modal.docType ?? null}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {/* Confirmação de exclusão */}
      {confirm && (
        <ConfirmModal
          message={`Remover o tipo "${confirm.name}"?`}
          detail="Todos os campos deste tipo serão apagados."
          okLabel="Remover"
          onOk={() => delType(confirm.id)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
