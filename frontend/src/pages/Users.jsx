import { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { usersApi, agendaApi } from '../api'
import { useAuth } from '../context/AuthContext'
import { useWebSocket } from '../hooks/useWebSocket'
import DelModal from '../components/DelModal'
import PasswordInput from '../components/PasswordInput'
import DatePicker from '../components/DatePicker'
import { Ic } from '../components/Icon'

const ROLE_OPTS = [
  { value: '',           label: 'Todos os perfis' },
  { value: 'superuser',  label: 'Superusuário'     },
  { value: 'admin',      label: 'Administrador'    },
  { value: 'user',       label: 'Usuário'          },
]

const PERM_GROUPS = [
  {
    title: 'Visão Geral',
    icon: 'grid',
    sections: [
      {
        label: 'Dashboard',
        items: [
          ['dashboard_view_passengers',  'Ver total de passageiros'],
          ['dashboard_view_lists',       'Ver total de listas abertas'],
          ['dashboard_view_enrollments', 'Ver total de inscrições'],
        ],
      },
      {
        label: 'Log de E-mails',
        items: [
          ['email_log_view',       'Ver e-mails enviados pelo sistema'],
          ['email_log_preview',    'Clicar para visualizar conteúdo do e-mail'],
          ['email_resend_actions', 'Reenviar redefinição de senha / convite'],
        ],
      },
    ],
  },
  {
    title: 'Passageiros',
    icon: 'users',
    items: [
      ['passengers_view_basic',    'Ver dados básicos'],
      ['passengers_view_full',     'Ver dados completos (sensíveis)'],
      ['passengers_edit',          'Criar / Editar'],
      ['passengers_delete',        'Excluir'],
      ['passengers_download_docs', 'Baixar documentos'],
      ['passengers_upload_docs',   'Enviar documentos'],
      ['passengers_view_logs',     'Ver log de atividades do passageiro'],
    ],
  },
  {
    title: 'Agências',
    icon: 'building',
    items: [
      ['agencies_view',      'Ver agências'],
      ['agencies_edit',      'Criar / Editar'],
      ['agencies_delete',    'Excluir'],
      ['agencies_view_logs', 'Ver log de atividades da agência'],
    ],
  },
  {
    title: 'Listas de Passageiros',
    icon: 'plane',
    sections: [
      {
        label: 'Geral',
        items: [
          ['lists_view',       'Ver listas'],
          ['lists_edit',       'Criar / Editar'],
          ['lists_delete',     'Excluir lista'],
          ['lists_view_logs',  'Ver log de atividades da lista'],
          ['lists_download',   'Baixar / exportar lista'],
          ['lists_csv_upload', 'Importar passageiros via CSV'],
        ],
      },
      {
        label: 'Passageiros na lista',
        items: [
          ['lists_passengers_add',    'Adicionar passageiro à lista'],
          ['lists_passengers_edit',   'Editar passageiro na lista'],
          ['lists_passengers_remove', 'Remover passageiro da lista'],
        ],
      },
    ],
  },
  {
    title: 'Calendário',
    icon: 'calendar',
    items: [
      ['calendar_view',               'Acessar o calendário'],
      ['calendar_view_birthdays',     'Ver aniversários de passageiros'],
      ['calendar_view_all_deadlines', 'Ver prazos de confirmação de todos os usuários'],
    ],
  },
  {
    title: 'Usuários',
    icon: 'users',
    items: [
      ['users_view',               'Ver lista de usuários'],
      ['users_edit',               'Criar / Editar usuários'],
      ['users_delete',             'Excluir usuários'],
      ['users_manage_permissions', 'Gerenciar permissões'],
      ['users_set_password',       'Definir senha via admin'],
    ],
  },
  {
    title: 'Configurações',
    icon: 'settings',
    sections: [
      {
        label: 'Acesso',
        items: [
          ['settings_view', 'Acessar página de configurações'],
        ],
      },
      {
        label: 'Categorias',
        items: [
          ['settings_professions',      'Profissões'],
          ['settings_languages',        'Idiomas'],
          ['settings_countries',        'Países e Estados'],
          ['settings_genders',          'Gêneros'],
          ['settings_vaccines',         'Vacinas'],
          ['settings_doc_types',        'Tipos de documento'],
          ['settings_prof_cards',       'Carteiras profissionais'],
          ['settings_destinations',     'Destinos de viagem'],
          ['settings_list_additionals', 'Itens adicionais de lista'],
          ['settings_crew_roles',       'Funções de tripulante'],
        ],
      },
    ],
  },
  {
    title: 'Log do Sistema',
    icon: 'list',
    sections: [
      {
        label: 'Acesso',
        items: [
          ['log_view', 'Ver log do sistema'],
        ],
      },
      {
        label: 'Por área',
        items: [
          ['log_passengers', 'Passageiros'],
          ['log_lists',      'Listas de passageiros'],
          ['log_agencies',   'Agências'],
          ['log_users',      'Usuários'],
          ['log_settings',   'Configurações'],
        ],
      },
    ],
  },
]

/* Algumas permissões só fazem sentido se a permissão "base" também estiver marcada
   (ex.: não há como editar/excluir/baixar documentos de algo que não se pode ver).
   A opção dependente fica oculta até que a permissão da qual ela depende seja marcada. */
const PERM_DEPENDENCIES = {
  passengers_view_full:     'passengers_view_basic',
  passengers_edit:          'passengers_view_full',
  passengers_delete:        'passengers_view_basic',
  passengers_download_docs: 'passengers_view_full',
  passengers_upload_docs:   'passengers_view_full',
  passengers_view_logs:     'passengers_view_basic',

  lists_edit:              'lists_view',
  lists_delete:            'lists_view',
  lists_view_logs:         'lists_view',
  lists_download:          'lists_view',
  lists_csv_upload:        'lists_view',
  lists_passengers_add:    'lists_view',
  lists_passengers_edit:   'lists_view',
  lists_passengers_remove: 'lists_view',

  agencies_edit:      'agencies_view',
  agencies_delete:    'agencies_view',
  agencies_view_logs: 'agencies_view',

  calendar_view_birthdays:     'calendar_view',
  calendar_view_all_deadlines: 'calendar_view',

  email_log_preview:    'email_log_view',
  email_resend_actions: 'email_log_preview',

  users_edit:               'users_view',
  users_delete:             'users_view',
  users_manage_permissions: 'users_view',
  users_set_password:       'users_view',

  settings_professions:      'settings_view',
  settings_languages:        'settings_view',
  settings_countries:        'settings_view',
  settings_genders:          'settings_view',
  settings_vaccines:         'settings_view',
  settings_doc_types:        'settings_view',
  settings_prof_cards:       'settings_view',
  settings_destinations:     'settings_view',
  settings_list_additionals: 'settings_view',
  settings_crew_roles:       'settings_view',

  log_passengers: 'log_view',
  log_lists:      'log_view',
  log_agencies:   'log_view',
  log_users:      'log_view',
  log_settings:   'log_view',
}

/* Zera permissões dependentes cuja permissão base não está marcada (evita estado inconsistente).
   A ordem de PERM_DEPENDENCIES importa: "passengers_view_full" precisa ser avaliado antes de
   "passengers_edit" etc., para que a cascata de 2 níveis funcione numa única passada. */
const sanitizePerms = perms => {
  const out = { ...perms }
  for (const [depKey, baseKey] of Object.entries(PERM_DEPENDENCIES)) {
    if (!out[baseKey]) out[depKey] = false
  }
  return out
}

/* Aplica um conjunto de mudanças de permissões (sem propagações especiais — dependências
   são controladas pelo accordion via sanitizePerms) */
const applyPermChanges = (permissions, changes) => sanitizePerms({ ...permissions, ...changes })

/* Retorna a lista plana de [key, label, icon?] de um grupo, vindo de `items` ou de `sections` */
const groupItems = g => g.items ?? g.sections.flatMap(s => s.items)

const ALL_PERM_KEYS = PERM_GROUPS.flatMap(g => groupItems(g).map(([k]) => k))

/* Grupos administrativos — excluídos do preset "Usuário padrão" */
const ADMIN_TITLES    = ['Usuários', 'Configurações', 'Log do Sistema']
const ADMIN_PERM_KEYS = PERM_GROUPS
  .filter(g => ADMIN_TITLES.includes(g.title))
  .flatMap(g => groupItems(g).map(([k]) => k))

const EMPTY_PERMISSIONS = Object.fromEntries(ALL_PERM_KEYS.map(k => [k, false]))
const PRESET_ADMIN      = Object.fromEntries(ALL_PERM_KEYS.map(k => [k, true]))
/* "Ver prazos de todos" expõe dados de outras pessoas: mesmo no preset "Usuário" começa desligada */
const PRESET_USER_OFF   = ['calendar_view_all_deadlines']
const PRESET_USER       = Object.fromEntries(ALL_PERM_KEYS.map(k => [k, !ADMIN_PERM_KEYS.includes(k) && !PRESET_USER_OFF.includes(k)]))

const EMPTY = { first_name:'', last_name:'', email:'', password:'', is_active:true, is_superuser:false, permissions: { ...EMPTY_PERMISSIONS } }

/* ── Toggle (switch) ── */
function Toggle({ checked, onChange, disabled }) {
  return (
    <label className="toggle-wrap" style={disabled ? { opacity:.5, cursor:'not-allowed' } : undefined}>
      <span className="toggle">
        <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
        <span className="toggle-slider" />
      </span>
      <span className="toggle-label">{checked ? 'Sim' : 'Não'}</span>
    </label>
  )
}

/* ── Célula com clique-para-copiar ── */
function CopyCell({ value, muted, bold }) {
  const [ok, setOk] = useState(false)
  if (!value) return <span style={{ color:'#cbd5e1' }}>—</span>
  const copy = async (e) => {
    e.stopPropagation()
    try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1400) } catch {}
  }
  return (
    <span onClick={copy} title={`Clique para copiar: ${value}`}
      style={{ cursor:'pointer', position:'relative', display:'inline-block', maxWidth:'100%', verticalAlign:'bottom' }}>
      <span style={{
        display:'block', maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
        color:muted?'#94a3b8':'#1e293b', fontWeight:bold?500:400, fontSize:bold?13:11.5,
      }}>
        {value}
      </span>
      {ok && (
        <span style={{ position:'absolute', top:-18, left:'50%', transform:'translateX(-50%)', background:'#059669', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4, whiteSpace:'nowrap', pointerEvents:'none', animation:'fadeUp .2s ease' }}>✓ Copiado</span>
      )}
    </span>
  )
}

/* ── Badge com tooltip (via portal), usado p/ os badges de perfil (Superusuário/Administrador/Usuário) ── */
function BadgeTooltip({ badge, children }) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const ref = useRef(null)

  const show = () => { setRect(ref.current.getBoundingClientRect()); setOpen(true) }
  const hide = () => setOpen(false)

  return (
    <span ref={ref} onMouseEnter={show} onMouseLeave={hide} style={{ display:'inline-block' }}>
      {badge}
      {open && rect && createPortal(
        <div style={{
          position:'fixed',
          top: Math.min(rect.bottom + 6, window.innerHeight - 12),
          left: Math.min(rect.left, window.innerWidth - 296),
          zIndex:9999, background:'#fff', border:'1px solid #e2e8f0', borderRadius:8,
          boxShadow:'0 12px 32px rgba(15,23,42,.18)', padding:'10px 12px',
          width:280, maxHeight:340, overflowY:'auto', pointerEvents:'none',
        }}>
          {children}
        </div>,
        document.body
      )}
    </span>
  )
}

/* ── Conteúdo do tooltip: lista de permissões concedidas, agrupadas ── */
function PermsTooltipContent({ permissions }) {
  const groups = PERM_GROUPS
    .map(g => ({ ...g, granted: groupItems(g).filter(([key]) => !!permissions?.[key]) }))
    .filter(g => g.granted.length > 0)

  return (
    <>
      <p style={{fontSize:11,fontWeight:700,color:'#1a2d4f',textTransform:'uppercase',letterSpacing:'.04em',margin:'0 0 8px'}}>Permissões concedidas</p>
      {groups.length === 0 ? (
        <p style={{fontSize:12,color:'#94a3b8',margin:0}}>Nenhuma permissão concedida.</p>
      ) : groups.map(g => (
        <div key={g.title} style={{marginBottom:8}}>
          <p style={{display:'flex',alignItems:'center',gap:6,fontSize:10.5,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'.04em',margin:'0 0 4px'}}>
            {g.icon && <span style={{display:'flex'}}><Ic n={g.icon} s={11}/></span>}
            {g.title}
          </p>
          {g.granted.map(([key, label]) => (
            <p key={key} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#1e293b',margin:'2px 0'}}>
              <span style={{color:'#059669',display:'flex'}}><Ic n="check" s={12}/></span>
              {label}
            </p>
          ))}
        </div>
      ))}
    </>
  )
}

/* ── Conteúdo do tooltip: superusuário tem acesso irrestrito, independente das permissões ── */
function SuperuserTooltipContent() {
  return (
    <>
      <p style={{fontSize:11,fontWeight:700,color:'#1a2d4f',textTransform:'uppercase',letterSpacing:'.04em',margin:'0 0 8px'}}>Superusuário</p>
      <p style={{fontSize:12,color:'#1e293b',margin:0,lineHeight:1.5}}>
        Este usuário pode fazer qualquer coisa no sistema — tem acesso total, independente das permissões configuradas.
      </p>
    </>
  )
}

/* ── Barra de presets de permissões ── */
function PermPresetBar({ setForm }) {
  const btnBase = { padding:'4px 11px', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', fontSize:12, cursor:'pointer', fontFamily:'inherit', transition:'all .12s' }
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', paddingBottom:2 }}>
      <span style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.04em', whiteSpace:'nowrap' }}>Preset:</span>
      {[
        { label:'Usuário padrão', perms: PRESET_USER },
        { label:'Administrador',  perms: PRESET_ADMIN },
      ].map(({ label, perms }) => (
        <button key={label} type="button"
          style={{ ...btnBase, color:'#475569' }}
          onClick={() => setForm(f => ({ ...f, permissions: applyPermChanges(EMPTY_PERMISSIONS, perms) }))}
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

/* ── Accordion de grupo de permissões ── */
function PermAccordionItem({ group, permissions, onToggle, onToggleAll }) {
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

/* ── Card de grupo de permissões, com "Marcar todos" ── */
function PermGroupCard({ group, permissions, onToggle, onToggleAll, horizontal }) {
  const keys         = groupItems(group).map(([k]) => k)
  const checkedCount = keys.filter(k => permissions?.[k]).length
  const allChecked   = checkedCount === keys.length
  const someChecked  = checkedCount > 0 && !allChecked

  const itemsStyle = horizontal
    ? {display:'flex',flexDirection:'row',flexWrap:'wrap',gap:'8px 24px'}
    : {display:'flex',flexDirection:'column',gap:6}

  /* Oculta itens cuja permissão-base ainda não está marcada */
  const visibleItems = items => items.filter(([key]) => {
    const baseKey = PERM_DEPENDENCIES[key]
    return !baseKey || !!permissions?.[baseKey]
  })

  const renderItems = (items) => (
    <div style={itemsStyle}>
      {visibleItems(items).map(([key, label, icon]) => (
        <label key={key} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12.5,color:'#1e293b',whiteSpace:horizontal ? 'nowrap' : undefined}}>
          <input type="checkbox" checked={!!permissions?.[key]}
            onChange={e => onToggle(key, e.target.checked)}
            style={{accentColor:'#1a2d4f',width:15,height:15}} />
          {icon && <span style={{color:'#64748b',display:'flex'}}><Ic n={icon} s={13}/></span>}
          {label}
        </label>
      ))}
    </div>
  )

  return (
    <div style={{border:'1px solid #e2e8f0',borderRadius:8,padding:'10px 12px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8,gap:8}}>
        <p style={{display:'flex',alignItems:'center',gap:6,fontSize:11,fontWeight:700,color:'#1a2d4f',textTransform:'uppercase',letterSpacing:'.04em',margin:0}}>
          {group.icon && <Ic n={group.icon} s={12}/>}
          {group.title}
        </p>
        <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:11,color:'#64748b',fontWeight:600,whiteSpace:'nowrap'}}>
          <input type="checkbox" checked={allChecked}
            ref={el => { if (el) el.indeterminate = someChecked }}
            onChange={e => onToggleAll(keys, e.target.checked)}
            style={{accentColor:'#1a2d4f',width:14,height:14}} />
          Marcar todos
        </label>
      </div>
      {group.sections ? group.sections.map((section, i) => (
        visibleItems(section.items).length === 0 ? null : (
          <div key={section.label} style={i > 0 ? {marginTop:10,paddingTop:10,borderTop:'1px dashed #e2e8f0'} : undefined}>
            <p style={{fontSize:10,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.05em',margin:'0 0 6px'}}>
              {section.label}
            </p>
            {renderItems(section.items)}
          </div>
        )
      )) : renderItems(group.items)}
    </div>
  )
}

function UserModal({ user, onClose, onSaved }) {
  const { user: me } = useAuth()
  const [form,       setForm]       = useState(user
    ? { ...user, password:'', is_superuser: !!user.is_superuser, permissions: sanitizePerms({ ...EMPTY_PERMISSIONS, ...user.permissions }) }
    : { ...EMPTY })
  const [saving,     setSaving]     = useState(false)
  const [fe,         setFe]         = useState({})
  const [emailPrefs, setEmailPrefs] = useState({ receive_deadline_emails: false, receive_task_emails: false, receive_birthday_emails: false })
  const isEdit  = !!user
  const isSelf  = isEdit && user?.id === me?.id
  const targetIsSuperuser = isEdit && !!user?.is_superuser
  const myPeM = me?.permissions ?? {}
  const canManagePerms = !!me?.is_superuser || !!myPeM.manage_users || !!myPeM.users_manage_permissions
  const set = k => e => { setForm(f => ({ ...f, [k]: e.target.value })); setFe(p => { const n={...p}; delete n[k]; return n }) }
  const setPerm    = (key, val)  => setForm(f => ({ ...f, permissions: applyPermChanges(f.permissions, { [key]: val }) }))
  const setPermAll = (keys, val) => setForm(f => ({ ...f, permissions: applyPermChanges(f.permissions, Object.fromEntries(keys.map(k => [k, val]))) }))

  useEffect(() => {
    if (isEdit && user?.id) {
      agendaApi.getUserPrefs(user.id)
        .then(r => setEmailPrefs({ receive_deadline_emails: !!r.data.receive_deadline_emails, receive_task_emails: !!r.data.receive_task_emails, receive_birthday_emails: !!r.data.receive_birthday_emails }))
        .catch(() => {})
    }
  }, [isEdit, user?.id])

  const save = async () => {
    const errs = {}
    if (!form.email?.trim()) errs.email = true
    if (Object.keys(errs).length) { setFe(errs); return }
    setSaving(true)
    try {
      let savedId = user?.id
      if (isEdit) {
        const payload = canManagePerms ? form : { ...form, permissions: undefined }
        await usersApi.update(user.id, payload)
        toast.success('Usuário atualizado.')
      } else {
        const payload = canManagePerms ? { ...form } : { ...form, permissions: undefined }
        const r = await usersApi.create(payload)
        savedId = r.data.id
        toast.success('Usuário criado. Convite enviado por e-mail.')
      }
      if (savedId) {
        agendaApi.updateUserPrefs(savedId, emailPrefs).catch(() => {})
      }
      onSaved()
    } catch (e) {
      toast.error(e.response?.data?.error ?? 'Erro ao salvar.')
    } finally { setSaving(false) }
  }

  const lbl = { fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em', display:'block', marginBottom:5 }
  const inp = { width:'100%', padding:'7px 10px', border:'1px solid #e2e8f0', borderRadius:6, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b', boxSizing:'border-box' }

  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose()}}
      style={{position:'fixed',inset:0,background:'rgba(15,23,42,.45)',backdropFilter:'blur(3px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:400,padding:20}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:'#fff',borderRadius:12,width:'100%',maxWidth:760,maxHeight:'90vh',display:'flex',flexDirection:'column',boxShadow:'0 24px 64px rgba(0,0,0,.24)',animation:'mIn .15s ease'}}>
        <div style={{padding:'16px 20px 14px',borderBottom:'1px solid #e2e8f0',flexShrink:0}}>
          <p style={{fontSize:14,fontWeight:600,color:'#1e293b',margin:0}}>{isEdit ? 'Editar usuário' : 'Novo usuário'}</p>
        </div>
        <div style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:12,overflowY:'auto'}}>
          <div className="grid2">
            <div><label style={lbl}>Primeiro nome</label><input style={inp} value={form.first_name} onChange={set('first_name')} placeholder="Ana" /></div>
            <div><label style={lbl}>Sobrenome</label><input style={inp} value={form.last_name} onChange={set('last_name')} placeholder="Silva" /></div>
          </div>
          <div>
            <label style={lbl}>E-mail * <span style={{fontWeight:400,textTransform:'none',color:'#94a3b8'}}>(será o login)</span></label>
            <input style={{...inp, ...(fe.email ? {border:'1px solid #ef4444',background:'#fef2f2'} : {})}} type="email" value={form.email} onChange={set('email')} placeholder="ana@uneworld.com.br" />
            {fe.email && <p style={{fontSize:11,color:'#dc2626',margin:'3px 0 0',fontWeight:500}}>E-mail obrigatório</p>}
          </div>

          {!isEdit && (
            <div style={{padding:'9px 11px',borderRadius:7,border:'1px solid #e2e8f0',background:'#f0fdf4',fontSize:12.5,color:'#166534',display:'flex',alignItems:'center',gap:8}}>
              <Ic n="mail" s={14}/>
              Será enviado um convite por e-mail para a pessoa criar a própria senha.
            </div>
          )}

          {isEdit && (
            <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,color:'#1e293b'}}>
              <input type="checkbox" checked={form.is_active} onChange={e=>setForm(f=>({...f,is_active:e.target.checked}))} style={{accentColor:'#1a2d4f',width:15,height:15}} />
              Ativo
            </label>
          )}

          {/* ── Notificações por e-mail ── */}
          <div style={{borderTop:'1px solid #f1f5f9',paddingTop:12}}>
            <label style={lbl}>Notificações por e-mail</label>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {[
                { key:'receive_deadline_emails', label:'Prazos de confirmação', desc:'Recebe e-mail quando passageiros têm prazo vencendo hoje ou em 2 dias' },
                { key:'receive_task_emails',     label:'Pendências',            desc:'Recebe e-mail quando tarefas têm prazo vencendo hoje' },
                ...(targetIsSuperuser || form.permissions?.passengers_view_full ? [{ key:'receive_birthday_emails', label:'Aniversários de passageiros', desc:'Recebe e-mail com passageiros que fazem aniversário hoje' }] : []),
              ].map(({ key, label, desc }) => (
                <label key={key} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'10px 12px',borderRadius:8,border:'1px solid #e2e8f0',background:'#f8fafc',cursor:'pointer'}}>
                  <div>
                    <p style={{margin:'0 0 2px',fontSize:13,fontWeight:600,color:'#1e293b'}}>{label}</p>
                    <p style={{margin:0,fontSize:11.5,color:'#94a3b8'}}>{desc}</p>
                  </div>
                  <Toggle checked={emailPrefs[key]} onChange={v => setEmailPrefs(p => ({ ...p, [key]: v }))} />
                </label>
              ))}
            </div>
          </div>

          {me?.is_superuser ? (
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'10px 12px',borderRadius:8,border:'1px solid #e2e8f0',background:'#f8fafc'}}>
                <div>
                  <p style={{fontSize:13,fontWeight:700,color:'#1e293b',margin:'0 0 2px'}}>Super usuário</p>
                  <p style={{fontSize:11.5,color:'#94a3b8',margin:0}}>
                    {isSelf
                      ? 'Você não pode alterar sua própria permissão de superusuário.'
                      : 'Acesso total e irrestrito a todas as áreas do sistema, ignorando as permissões abaixo.'}
                  </p>
                </div>
                <Toggle checked={form.is_superuser} disabled={isSelf}
                  onChange={v => setForm(f => ({ ...f, is_superuser: v }))} />
              </div>

              {form.is_superuser ? (
                <div style={{padding:'10px 12px',borderRadius:8,background:'#eff6ff',border:'1px solid #bfdbfe',fontSize:12.5,color:'#1d4ed8'}}>
                  Superusuário tem acesso total e irrestrito a todo o sistema — as permissões abaixo não se aplicam.
                </div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  <PermPresetBar setForm={setForm}/>
                  {PERM_GROUPS.map(g => (
                    <PermAccordionItem key={g.title} group={g} permissions={form.permissions} onToggle={setPerm} onToggleAll={setPermAll} />
                  ))}
                </div>
              )}
            </div>
          ) : targetIsSuperuser ? (
            <div style={{padding:'10px 12px',borderRadius:8,background:'#eff6ff',border:'1px solid #bfdbfe',fontSize:12.5,color:'#1d4ed8'}}>
              Superusuário: acesso total a todas as permissões do sistema.
            </div>
          ) : canManagePerms ? (
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              <PermPresetBar setForm={setForm}/>
              {PERM_GROUPS.map(g => (
                <PermAccordionItem key={g.title} group={g} permissions={form.permissions} onToggle={setPerm} onToggleAll={setPermAll} />
              ))}
            </div>
          ) : null}
        </div>
        <div style={{padding:'12px 20px',borderTop:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between'}}>
          <button onClick={onClose} className="btn btn-outline">Cancelar</button>
          <button onClick={save} disabled={saving} className="btn btn-primary">
            <Ic n="check" s={13}/>{saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar usuário'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PermModal({ count, onPick, onClose, saving }) {
  const opt = { display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', padding:'12px 14px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#1e293b', fontSize:13, fontWeight:600, cursor: saving ? 'default' : 'pointer', fontFamily:'inherit', textAlign:'left', transition:'all .12s' }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="mbox" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">Mudar permissões — {count} usuário{count !== 1 ? 's' : ''}</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="mbody" style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <button type="button" disabled={saving} style={opt} onClick={() => onPick(false)}
            onMouseEnter={e => !saving && (e.currentTarget.style.borderColor = '#2e6db4')}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#e2e8f0'}>
            <span>Usuário</span>
            <span style={{ fontSize:11, fontWeight:400, color:'#94a3b8' }}>Sem acesso administrativo</span>
          </button>
          <button type="button" disabled={saving} style={opt} onClick={() => onPick(true)}
            onMouseEnter={e => !saving && (e.currentTarget.style.borderColor = '#2e6db4')}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#e2e8f0'}>
            <span>Administrador</span>
            <span style={{ fontSize:11, fontWeight:400, color:'#94a3b8' }}>Acesso total ao painel</span>
          </button>
        </div>
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}

/* ── Modal de gerenciamento de senha ── */
function KeyMenuModal({ user, canSetPwd, onClose }) {
  const [step,       setStep]       = useState('menu')
  const [pwd,        setPwd]        = useState('')
  const [pwdConfirm, setPwdConfirm] = useState('')
  const [adminPwd,   setAdminPwd]   = useState('')
  const [busy,       setBusy]       = useState(false)

  const sendEmail = async () => {
    setBusy(true)
    try {
      if (user.has_account) {
        await usersApi.sendReset(user.id)
        toast.success(`E-mail de redefinição de senha enviado para ${user.email}.`)
      } else {
        await usersApi.sendInvite(user.id)
        toast.success(`Convite enviado para ${user.email}.`)
      }
      onClose()
    } catch (e) { toast.error(e.response?.data?.error ?? 'Erro ao enviar.') }
    finally { setBusy(false) }
  }

  const doSetPwd = async () => {
    if (pwd.length < 8)       { toast.error('A nova senha deve ter pelo menos 8 caracteres.'); return }
    if (pwd !== pwdConfirm)   { toast.error('As senhas não coincidem.'); return }
    if (!adminPwd)            { toast.error('Digite sua própria senha para confirmar.'); return }
    setBusy(true)
    try {
      await usersApi.setPassword(user.id, pwd, adminPwd)
      toast.success('Senha definida com sucesso.')
      onClose()
    } catch (e) { toast.error(e.response?.data?.error ?? 'Erro.') }
    finally { setBusy(false) }
  }

  const optBtn = {
    display:'flex', alignItems:'center', gap:12, padding:'11px 14px', borderRadius:8,
    border:'1px solid #e2e8f0', background:'#f8fafc', cursor:'pointer', textAlign:'left',
    fontSize:13, color:'#1e293b', fontFamily:'inherit', transition:'border-color .12s', width:'100%',
  }
  const fldStyle = { width:'100%', padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:6, fontSize:13, fontFamily:'inherit', color:'#1e293b', boxSizing:'border-box', outline:'none' }
  const lbl = { fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em', display:'block', marginBottom:4 }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.4)', backdropFilter:'blur(2px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:400, padding:20 }}>
      <div style={{ background:'#fff', borderRadius:12, width:370, boxShadow:'0 8px 32px rgba(0,0,0,.18)' }}>
        <div style={{ padding:'16px 20px 12px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <p style={{ margin:'0 0 2px', fontSize:14, fontWeight:700, color:'#1e293b' }}>Gerenciar senha</p>
            <p style={{ margin:0, fontSize:12, color:'#94a3b8' }}>{user.full_name || user.email}</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', padding:4 }}><Ic n="x" s={15}/></button>
        </div>
        <div style={{ padding:16, display:'flex', flexDirection:'column', gap:8 }}>
          {step === 'menu' ? (<>
            <button style={optBtn} onClick={sendEmail} disabled={busy}
              onMouseEnter={e => e.currentTarget.style.borderColor='#1a2d4f'}
              onMouseLeave={e => e.currentTarget.style.borderColor='#e2e8f0'}>
              <Ic n="mail" s={16}/>
              <span>
                <b style={{display:'block'}}>{user.has_account ? 'Enviar e-mail de redefinição de senha' : 'Enviar convite por e-mail'}</b>
                <span style={{fontSize:11.5,color:'#94a3b8'}}>{user.has_account ? 'Conta já criada — envia link para redefinir' : 'Conta ainda não criada — envia link para definir senha'}</span>
              </span>
            </button>
            {canSetPwd && (
              <button style={optBtn} onClick={() => setStep('setpwd')} disabled={busy}
                onMouseEnter={e => e.currentTarget.style.borderColor='#1a2d4f'}
                onMouseLeave={e => e.currentTarget.style.borderColor='#e2e8f0'}>
                <Ic n="key" s={16}/>
                <span>
                  <b style={{display:'block'}}>Definir senha via admin</b>
                  <span style={{fontSize:11.5,color:'#94a3b8'}}>Define sem notificar o usuário</span>
                </span>
              </button>
            )}
          </>) : (<>
            <div>
              <label style={lbl}>Nova senha</label>
              <PasswordInput style={fldStyle} value={pwd} onChange={e => setPwd(e.target.value)} placeholder="Mínimo 8 caracteres" />
            </div>
            <div>
              <label style={lbl}>Confirmar nova senha</label>
              <PasswordInput style={fldStyle} value={pwdConfirm} onChange={e => setPwdConfirm(e.target.value)} placeholder="Repita a nova senha" />
            </div>
            <div style={{ borderTop:'1px solid #f1f5f9', paddingTop:10, marginTop:2 }}>
              <label style={lbl}>Sua senha (confirmação)</label>
              <PasswordInput style={fldStyle} value={adminPwd} onChange={e => setAdminPwd(e.target.value)} placeholder="Digite sua própria senha para confirmar" />
            </div>
            <div style={{ display:'flex', gap:8, marginTop:4 }}>
              <button onClick={() => setStep('menu')} disabled={busy}
                style={{ flex:1, padding:'8px 0', borderRadius:7, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
                Voltar
              </button>
              <button onClick={doSetPwd} disabled={busy}
                style={{ flex:2, padding:'8px 0', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                {busy ? 'Salvando…' : 'Definir senha'}
              </button>
            </div>
          </>)}
        </div>
      </div>
    </div>
  )
}

/* ── Dropdown de filtro simples (estilo Log/Passageiros) ── */
function FDrop({ label, value, onChange, options }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const active = value !== options[0].value
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7,
          border: `1px solid ${active ? '#2e6db4' : '#e2e8f0'}`,
          background: active ? '#eff6ff' : '#fff',
          color: active ? '#2e6db4' : '#475569',
          fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit',
          whiteSpace: 'nowrap', transition: 'all .12s',
        }}>
        {label}{active && selected ? `: ${selected.label}` : ''}
        <span style={{ fontSize: 9, opacity: .7 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 300,
          background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0',
          boxShadow: '0 8px 24px rgba(0,0,0,.10)', minWidth: 180, overflow: 'hidden',
        }}>
          {options.map(opt => {
            const sel = value === opt.value
            return (
              <button key={opt.value} type="button"
                onClick={() => { onChange(opt.value); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '9px 14px', gap: 10,
                  background: sel ? '#eff6ff' : 'transparent', border: 'none',
                  borderBottom: '1px solid #f8fafc', color: sel ? '#2e6db4' : '#1e293b',
                  fontSize: 13, fontWeight: sel ? 600 : 400, cursor: 'pointer',
                  fontFamily: 'inherit', textAlign: 'left',
                }}
                onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f8fafc' }}
                onMouseLeave={e => { if (!sel) e.currentTarget.style.background = sel ? '#eff6ff' : 'transparent' }}
              >
                <span>{opt.label}</span>
                {sel && <span style={{ color: '#2e6db4' }}>✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Dropdown multi-seleção: filtra usuários que têm UMA ou VÁRIAS permissões específicas (AND) ── */
function PermFilterDrop({ selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const active = selected.size > 0

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const toggle = key => {
    const next = new Set(selected)
    next.has(key) ? next.delete(key) : next.add(key)
    onChange(next)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7,
          border: `1px solid ${active ? '#2e6db4' : '#e2e8f0'}`,
          background: active ? '#eff6ff' : '#fff',
          color: active ? '#2e6db4' : '#475569',
          fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit',
          whiteSpace: 'nowrap', transition: 'all .12s',
        }}>
        Permissões{active ? `: ${selected.size}` : ''}
        <span style={{ fontSize: 9, opacity: .7 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 300,
          background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0',
          boxShadow: '0 8px 24px rgba(0,0,0,.10)', width: 300, maxHeight: 380,
          overflowY: 'auto', padding: 10,
        }}>
          {active && (
            <button type="button" onClick={() => onChange(new Set())}
              style={{ display:'block', width:'100%', textAlign:'left', padding:'7px 10px', marginBottom:8, fontSize:12, fontWeight:600, color:'#dc2626', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:6, cursor:'pointer', fontFamily:'inherit' }}>
              ✕ Limpar seleção
            </button>
          )}
          {PERM_GROUPS.map(g => (
            <div key={g.title} style={{ marginBottom: 10 }}>
              <p style={{display:'flex',alignItems:'center',gap:6,fontSize:10.5,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'.04em',margin:'0 0 5px'}}>
                {g.icon && <span style={{display:'flex'}}><Ic n={g.icon} s={11}/></span>}
                {g.title}
              </p>
              {groupItems(g).map(([key, label]) => (
                <label key={key} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 6px',fontSize:12.5,color:'#1e293b',cursor:'pointer',borderRadius:5}}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)}
                    style={{ accentColor:'#2e6db4', width:14, height:14, flexShrink:0 }} />
                  {label}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Dropdown de intervalo de datas (Criação / Modificação) ── */
function DateRangeDrop({ label, from, to, onFrom, onTo }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const active = !!from || !!to

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7,
          border: `1px solid ${active ? '#2e6db4' : '#e2e8f0'}`,
          background: active ? '#eff6ff' : '#fff',
          color: active ? '#2e6db4' : '#475569',
          fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit',
          whiteSpace: 'nowrap', transition: 'all .12s',
        }}>
        {label}{active ? ': período' : ''}
        <span style={{ fontSize: 9, opacity: .7 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 300,
          background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0',
          boxShadow: '0 8px 24px rgba(0,0,0,.10)', width: 230, padding: 12,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.04em', display:'block', marginBottom:5 }}>De</label>
            <DatePicker value={from} onChange={onFrom} placeholder="DD/MM/AAAA" />
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.04em', display:'block', marginBottom:5 }}>Até</label>
            <DatePicker value={to} onChange={onTo} placeholder="DD/MM/AAAA" />
          </div>
          {active && (
            <button type="button" onClick={() => { onFrom(''); onTo('') }}
              style={{ padding:'7px 10px', fontSize:12, fontWeight:600, color:'#dc2626', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:6, cursor:'pointer', fontFamily:'inherit' }}>
              ✕ Limpar
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function Users() {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState(null)
  const [delUser, setDelUser] = useState(null)
  const [keyMenu, setKeyMenu] = useState(null)
  const [q,       setQ]       = useState('')
  const [sel,     setSel]     = useState(new Set())
  const [permModal, setPermModal] = useState(false)
  const [bulkDel,   setBulkDel]   = useState(false)
  const [bulkBusy,  setBulkBusy]  = useState(false)
  const [roleFilter,    setRoleFilter]    = useState('')
  const [permFilter,    setPermFilter]    = useState(new Set())
  const [createdFrom,   setCreatedFrom]   = useState('')
  const [createdTo,     setCreatedTo]     = useState('')
  const [modifiedFrom,  setModifiedFrom]  = useState('')
  const [modifiedTo,    setModifiedTo]    = useState('')
  const { user: me } = useAuth()
  const navigate = useNavigate()
  const myP        = me?.permissions ?? {}
  const isSu       = !!me?.is_superuser
  const canCreate      = isSu || !!myP.manage_users || !!myP.users_edit
  const canEdit        = isSu || !!myP.manage_users || !!myP.users_edit || !!myP.users_manage_permissions
  const canDeleteU     = isSu || !!myP.manage_users || !!myP.users_delete
  const canSetPassword = isSu || !!myP.manage_users || !!myP.users_set_password
  const canViewLog     = isSu || !!myP.view_audit_log || !!myP.log_users || !!myP.log_view
  const canKeyMenu     = canCreate || canSetPassword

  const load = () => {
    setLoading(true)
    usersApi.list()
      .then(r => setUsers(r.data))
      .catch(() => toast.error('Erro ao carregar usuários.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const silentReload = useCallback(() => {
    usersApi.list()
      .then(r => setUsers(r.data))
      .catch(() => {})
  }, [])

  const wsUrl = me ? `ws://${window.location.hostname}:8000/ws/dashboard/` : null
  useWebSocket(wsUrl, useCallback(({ scope }) => {
    if (scope === 'users' || scope === 'all') silentReload()
  }, [silentReload]))

  const handleDelete = async () => {
    await usersApi.remove(delUser.id).catch(e => toast.error(e.response?.data?.error ?? 'Erro ao excluir.'))
    toast.success('Usuário excluído.')
    setDelUser(null)
    load()
  }

  const initials = u => `${u.first_name?.[0]??''}${u.last_name?.[0]??''}`.toUpperCase() || u.username[0].toUpperCase()
  const PALETTE  = ['#2B3A8F','#0369A1','#0D6E6E','#6B3FA0','#B45309']

  const roleOf = u => u.is_superuser ? 'superuser' : u.is_staff ? 'admin' : 'user'

  const hasFilters = !!roleFilter || permFilter.size > 0 || createdFrom || createdTo || modifiedFrom || modifiedTo
  const clearFilters = () => {
    setRoleFilter('')
    setPermFilter(new Set())
    setCreatedFrom(''); setCreatedTo('')
    setModifiedFrom(''); setModifiedTo('')
  }

  const filtered = users.filter(u => {
    const s = q.trim().toLowerCase()
    if (s) {
      const matchQ = (u.full_name || '').toLowerCase().includes(s)
          || (u.username  || '').toLowerCase().includes(s)
          || (u.email     || '').toLowerCase().includes(s)
      if (!matchQ) return false
    }
    if (roleFilter && roleOf(u) !== roleFilter) return false
    if (permFilter.size > 0) {
      const ok = [...permFilter].every(k => u.is_superuser || !!u.permissions?.[k])
      if (!ok) return false
    }
    if (createdFrom || createdTo) {
      const d = (u.date_joined || '').slice(0, 10)
      if (createdFrom && d < createdFrom) return false
      if (createdTo   && d > createdTo)   return false
    }
    if (modifiedFrom || modifiedTo) {
      const d = (u.updated_at || '').slice(0, 10)
      if (modifiedFrom && d < modifiedFrom) return false
      if (modifiedTo   && d > modifiedTo)   return false
    }
    return true
  })

  // Apenas usuários que podem ser alvo de ações em massa (nunca o próprio usuário logado)
  const selectable = filtered.filter(u => u.id !== me?.id)
  const allSel = selectable.length > 0 && selectable.every(u => sel.has(u.id))
  const togAll = () => {
    const s = new Set(sel)
    allSel ? selectable.forEach(u => s.delete(u.id)) : selectable.forEach(u => s.add(u.id))
    setSel(s)
  }
  const tog1 = (id) => {
    const s = new Set(sel)
    s.has(id) ? s.delete(id) : s.add(id)
    setSel(s)
  }
  const clearSel = () => setSel(new Set())

  const selUsers = users.filter(u => sel.has(u.id))

  const bulkSetStaff = async (isStaff) => {
    setBulkBusy(true)
    const permissions = isStaff ? PRESET_ADMIN : PRESET_USER
    let ok = 0, fail = 0
    for (const u of selUsers) {
      try { await usersApi.update(u.id, { permissions }); ok++ }
      catch { fail++ }
    }
    setBulkBusy(false)
    setPermModal(false)
    clearSel()
    toast.success(`${ok} usuário${ok !== 1 ? 's' : ''} atualizado${ok !== 1 ? 's' : ''}.${fail ? ` ${fail} com erro.` : ''}`)
    load()
  }

  const bulkDelete = async () => {
    setBulkBusy(true)
    let ok = 0, fail = 0
    for (const u of selUsers) {
      try { await usersApi.remove(u.id); ok++ }
      catch { fail++ }
    }
    setBulkBusy(false)
    setBulkDel(false)
    clearSel()
    toast.success(`${ok} usuário${ok !== 1 ? 's' : ''} excluído${ok !== 1 ? 's' : ''}.${fail ? ` ${fail} com erro.` : ''}`)
    load()
  }

  return (
    <div>
      <div className="ph">
        <h1 className="ph-title">Usuários</h1>
        <div className="ph-actions">
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setModal('new')}>
              <Ic n="plus" s={13}/>Novo usuário
            </button>
          )}
        </div>
      </div>

      <div className="search-row">
        <div className="search-wrap">
          <span className="search-ico"><Ic n="search" s={14}/></span>
          <input className="search-in" placeholder="Buscar por nome, e-mail ou login…" value={q} onChange={e => setQ(e.target.value)} />
        </div>

        <FDrop label="Perfil" value={roleFilter} onChange={setRoleFilter} options={ROLE_OPTS} />
        <PermFilterDrop selected={permFilter} onChange={setPermFilter} />
        <DateRangeDrop label="Criado" from={createdFrom} to={createdTo} onFrom={setCreatedFrom} onTo={setCreatedTo} />
        <DateRangeDrop label="Modificado" from={modifiedFrom} to={modifiedTo} onFrom={setModifiedFrom} onTo={setModifiedTo} />

        {hasFilters && (
          <button type="button" onClick={clearFilters}
            style={{ padding:'7px 12px', borderRadius:7, border:'1px solid #e2e8f0', background:'#fff', color:'#64748b', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
            ✕ Limpar filtros
          </button>
        )}

        {canViewLog && (
          <button
            type="button"
            onClick={() => navigate('/log?model=User')}
            title="Ver log de atividades"
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 7,
              border: '1.5px solid #e2e8f0', background: '#fff',
              color: '#475569', fontSize: 13, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all .12s', whiteSpace: 'nowrap', flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#1a2d4f'; e.currentTarget.style.color = '#1a2d4f' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#475569' }}
          >
            <Ic n="list" s={13} /> Log
          </button>
        )}
      </div>

      {sel.size > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', marginBottom:12, background:'#eff6ff', border:'1.5px solid #bfdbfe', borderRadius:10 }}>
          <span style={{ fontSize:13, fontWeight:700, color:'#1d4ed8', flex:1 }}>
            {sel.size} selecionado{sel.size > 1 ? 's' : ''}
          </span>
          <button type="button" onClick={() => setPermModal(true)} disabled={bulkBusy}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            <Ic n="users" s={12}/> Mudar permissões
          </button>
          {me?.is_superuser && (
            <button type="button" onClick={() => setBulkDel(true)} disabled={bulkBusy}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:7, border:'1.5px solid #fecaca', background:'#fee2e2', color:'#dc2626', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              <Ic n="trash" s={12}/> Excluir selecionados
            </button>
          )}
          <button type="button" onClick={clearSel} disabled={bulkBusy}
            style={{ padding:'6px 12px', borderRadius:7, border:'1px solid #e2e8f0', background:'#fff', color:'#64748b', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
        </div>
      )}

      <div className="tcard">
        {loading ? (
          <div className="empty-state"><p style={{color:'#94a3b8'}}>Carregando…</p></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div style={{ color:'#cbd5e1' }}><Ic n="search" s={28}/></div>
            <p>Nenhum resultado encontrado</p>
          </div>
        ) : (
          <table className="dt">
            <thead>
              <tr>
                <th style={{width:40,textAlign:'center'}}>
                  <input type="checkbox" className="chk" checked={allSel} onChange={togAll} disabled={selectable.length === 0} />
                </th>
                <th>Usuário</th>
                <th style={{textAlign:'center'}}>E-mail</th>
                <th style={{textAlign:'center'}}>Perfil</th>
                <th style={{textAlign:'center'}}>Status</th>
                <th style={{width:110,textAlign:'center'}}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <tr key={u.id}>
                  <td style={{textAlign:'center'}}>
                    {u.id !== me?.id && (
                      <input type="checkbox" className="chk" checked={sel.has(u.id)} onChange={() => tog1(u.id)} />
                    )}
                  </td>
                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <div style={{width:32,height:32,borderRadius:'50%',background:PALETTE[i%PALETTE.length],display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:12,fontWeight:700,flexShrink:0}}>
                        {initials(u)}
                      </div>
                      <div>
                        <p className="t-name" style={{margin:0}}><CopyCell value={u.full_name || u.username} bold /></p>
                      </div>
                    </div>
                  </td>
                  <td className="t-muted" style={{textAlign:'center'}}><CopyCell value={u.email} muted /></td>
                  <td style={{textAlign:'center'}}>
                    {u.is_superuser
                      ? <BadgeTooltip badge={<span className="badge bg-blue" style={{ cursor:'help' }}>Superusuário</span>}>
                          <SuperuserTooltipContent />
                        </BadgeTooltip>
                      : u.is_staff
                        ? <BadgeTooltip badge={<span className="badge bg-green" style={{ cursor:'help' }}>Administrador</span>}>
                            <PermsTooltipContent permissions={u.permissions} />
                          </BadgeTooltip>
                        : <BadgeTooltip badge={<span className="badge bg-amber" style={{ cursor:'help' }}>Usuário</span>}>
                            <PermsTooltipContent permissions={u.permissions} />
                          </BadgeTooltip>
                    }
                  </td>
                  <td style={{textAlign:'center'}}>
                    {!u.is_active
                      ? <span className="badge bg-red">Bloqueada</span>
                      : !u.has_account
                        ? <span className="badge bg-amber">Pendente</span>
                        : !u.last_login
                          ? <span className="badge bg-blue">Configurada</span>
                          : <span className="badge bg-green">Ativa</span>
                    }
                  </td>
                  <td style={{textAlign:'center'}}>
                    <div className="r-acts">
                      {canEdit && <button className="r-btn edit" title="Editar" onClick={() => setModal(u)}><Ic n="edit" s={13}/></button>}
                      {canKeyMenu && (
                        <button className="r-btn" title="Gerenciar senha" style={{color:'#475569'}} onClick={() => setKeyMenu(u)}>
                          <Ic n="key" s={13}/>
                        </button>
                      )}
                      {canDeleteU && u.id !== me?.id && (
                        <button className="r-btn del" title="Excluir" onClick={() => setDelUser(u)}><Ic n="trash" s={13}/></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <UserModal
          user={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
      {delUser && (
        <DelModal name={delUser.full_name || delUser.username} onOk={handleDelete} onCancel={() => setDelUser(null)} />
      )}
      {permModal && (
        <PermModal count={sel.size} saving={bulkBusy} onPick={bulkSetStaff} onClose={() => !bulkBusy && setPermModal(false)} />
      )}
      {keyMenu && (
        <KeyMenuModal user={keyMenu} canSetPwd={canSetPassword} onClose={() => setKeyMenu(null)} />
      )}
      {bulkDel && (
        <DelModal name={`${sel.size} usuário${sel.size !== 1 ? 's' : ''} selecionado${sel.size !== 1 ? 's' : ''}`} onOk={bulkDelete} onCancel={() => !bulkBusy && setBulkDel(false)} />
      )}
    </div>
  )
}
