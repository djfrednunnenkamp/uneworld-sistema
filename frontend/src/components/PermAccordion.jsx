import { useState } from 'react'
import { Ic } from './Icon'
import {
  PERM_GROUPS, PERM_DEPENDENCIES, groupItems,
  EMPTY_PERMISSIONS, PRESET_ADMIN, PRESET_USER, applyPermChanges,
} from '../utils/permGroups'

/* ── Barra de presets ── */
export function PermPresetBar({ setForm, extraProfiles = [] }) {
  const btnBase = { padding:'4px 11px', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', fontSize:12, cursor:'pointer', fontFamily:'inherit', transition:'all .12s' }
  const apply = (perms) => setForm(f => ({ ...f, permissions: applyPermChanges(EMPTY_PERMISSIONS, perms) }))
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', paddingBottom:2 }}>
      <span style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.04em', whiteSpace:'nowrap' }}>Preset:</span>
      {[
        { label:'Usuário padrão', perms: PRESET_USER },
        { label:'Administrador',  perms: PRESET_ADMIN },
        ...extraProfiles.map(p => ({ label: p.name, perms: p.permissions })),
      ].map(({ label, perms }) => (
        <button key={label} type="button"
          style={{ ...btnBase, color:'#475569' }}
          onClick={() => apply(perms)}
          onMouseEnter={e => { e.currentTarget.style.borderColor='#2e6db4'; e.currentTarget.style.color='#2e6db4' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.color='#475569' }}>
          {label}
        </button>
      ))}
      <button type="button"
        style={{ ...btnBase, color:'#94a3b8' }}
        onClick={() => setForm(f => ({ ...f, permissions: { ...EMPTY_PERMISSIONS } }))}
        onMouseEnter={e => { e.currentTarget.style.borderColor='#fecaca'; e.currentTarget.style.color='#dc2626' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.color='#94a3b8' }}>
        Limpar tudo
      </button>
    </div>
  )
}

/* ── Accordion de grupo ── */
export function PermAccordionItem({ group, permissions, onToggle, onToggleAll }) {
  const items = groupItems(group)
  const checkedCount = items.filter(([k]) => permissions?.[k]).length
  const [open, setOpen] = useState(checkedCount > 0)
  const allChecked = checkedCount === items.length
  const someChecked = checkedCount > 0 && !allChecked
  const keys = items.map(([k]) => k)

  const visibleItems = (its) => its.filter(([key]) => {
    const baseKey = PERM_DEPENDENCIES[key]
    return !baseKey || !!permissions?.[baseKey]
  })

  const renderCheckboxes = (its) => (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(210px, 1fr))', gap:'5px 16px' }}>
      {visibleItems(its).map(([key, label, icon]) => (
        <label key={key} style={{ display:'flex', alignItems:'center', gap:7, cursor:'pointer', fontSize:12.5, color:'#1e293b', padding:'4px 3px', borderRadius:4 }}>
          <input type="checkbox" checked={!!permissions?.[key]}
            onChange={e => onToggle(key, e.target.checked)}
            style={{ accentColor:'#1a2d4f', width:14, height:14, flexShrink:0 }} />
          {icon && <span style={{ color:'#64748b', display:'flex' }}><Ic n={icon} s={12}/></span>}
          <span>{label}</span>
        </label>
      ))}
    </div>
  )

  return (
    <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden' }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer', background: open ? '#f8fafc' : '#fff', userSelect:'none', transition:'background .1s' }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = '#f8fafc' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = '#fff' }}>
        <span style={{ color: checkedCount > 0 ? '#2e6db4' : '#cbd5e1', display:'flex', flexShrink:0, transition:'color .12s' }}>
          <Ic n={group.icon} s={14}/>
        </span>
        <span style={{ flex:1, fontSize:13, fontWeight:600, color:'#1e293b' }}>{group.title}</span>
        {checkedCount > 0 ? (
          <span style={{ fontSize:11, fontWeight:700, padding:'2px 9px', borderRadius:999, background:'#e8f0fb', color:'#2e6db4', whiteSpace:'nowrap' }}>
            {checkedCount}/{items.length}
          </span>
        ) : (
          <span style={{ fontSize:11, color:'#cbd5e1', whiteSpace:'nowrap' }}>Nenhuma</span>
        )}
        <label style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer', fontSize:11, color:'#64748b', whiteSpace:'nowrap' }}
          onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={allChecked}
            ref={el => { if (el) el.indeterminate = someChecked }}
            onChange={e => onToggleAll(keys, e.target.checked)}
            style={{ accentColor:'#1a2d4f', width:13, height:13 }} />
          Todos
        </label>
        <span style={{ fontSize:10, color:'#94a3b8', transform: open ? 'rotate(180deg)' : 'none', transition:'transform .18s', flexShrink:0 }}>▼</span>
      </div>

      {open && (
        <div style={{ padding:'10px 14px 14px', borderTop:'1px solid #f1f5f9' }}>
          {group.sections
            ? group.sections.map((sec, i) => (
                visibleItems(sec.items).length === 0 ? null : (
                  <div key={sec.label} style={i > 0 ? { marginTop:10, paddingTop:10, borderTop:'1px dashed #e2e8f0' } : undefined}>
                    <p style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.05em', margin:'0 0 7px' }}>{sec.label}</p>
                    {renderCheckboxes(sec.items)}
                  </div>
                )
              ))
            : renderCheckboxes(group.items)
          }
        </div>
      )}
    </div>
  )
}

export { PERM_GROUPS }
