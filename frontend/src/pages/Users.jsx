import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { usersApi } from '../api'
import { useAuth } from '../context/AuthContext'
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
    items: [
      ['dashboard_view_passengers',  'Ver total de passageiros'],
      ['dashboard_view_lists',       'Ver total de listas abertas'],
      ['dashboard_view_enrollments', 'Ver total de inscrições'],
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
    title: 'Calendário',
    icon: 'calendar',
    items: [
      ['calendar_view',               'Acessar o calendário'],
      ['calendar_view_birthdays',     'Ver aniversários de passageiros'],
      ['calendar_view_all_deadlines', 'Ver prazos de confirmação de todos os usuários'],
    ],
  },
  {
    title: 'Administração',
    icon: 'settings',
    items: [
      ['manage_users',    'Gerenciar usuários e permissões', 'users'],
      ['manage_settings', 'Acessar Configurações',           'settings'],
      ['view_audit_log',  'Ver Log do Sistema (global)',     'list'],
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

/* "Ver Log do Sistema (global)" implica acesso aos logs (e à visualização) de cada área */
const AUDIT_LOG_IMPLIES = {
  passengers_view_logs: 'passengers_view_basic',
  lists_view_logs:      'lists_view',
  agencies_view_logs:   'agencies_view',
}

/* Aplica um conjunto de mudanças de permissões, propagando dependências automáticas
   (ex.: marcar "Ver Log do Sistema (global)" marca também os logs e a visualização de cada área) */
const applyPermChanges = (permissions, changes) => {
  const out = { ...permissions, ...changes }
  if (changes.view_audit_log === true) {
    for (const [logKey, baseKey] of Object.entries(AUDIT_LOG_IMPLIES)) {
      out[logKey]  = true
      out[baseKey] = true
    }
  }
  return sanitizePerms(out)
}

/* Retorna a lista plana de [key, label, icon?] de um grupo, vindo de `items` ou de `sections` */
const groupItems = g => g.items ?? g.sections.flatMap(s => s.items)

const ALL_PERM_KEYS   = PERM_GROUPS.flatMap(g => groupItems(g).map(([k]) => k))
const ADMIN_GROUP     = PERM_GROUPS.find(g => g.title === 'Administração')
const GRID_GROUPS     = PERM_GROUPS.filter(g => g.title !== 'Administração')
const ADMIN_PERM_KEYS = groupItems(ADMIN_GROUP).map(([k]) => k)
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
  const [skipPwd,    setSkipPwd]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const isEdit  = !!user
  const isSelf  = isEdit && user?.id === me?.id
  const targetIsSuperuser = isEdit && !!user?.is_superuser
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const setPerm    = (key, val)  => setForm(f => ({ ...f, permissions: applyPermChanges(f.permissions, { [key]: val }) }))
  const setPermAll = (keys, val) => setForm(f => ({ ...f, permissions: applyPermChanges(f.permissions, Object.fromEntries(keys.map(k => [k, val]))) }))

  const save = async () => {
    if (!form.email?.trim()) { toast.error('E-mail obrigatório.'); return }
    if (!isEdit && !skipPwd && !form.password) { toast.error('Defina uma senha ou marque para enviar convite por e-mail.'); return }
    setSaving(true)
    try {
      if (isEdit) {
        await usersApi.update(user.id, form)
        toast.success('Usuário atualizado.')
      } else {
        const payload = { ...form, password: skipPwd ? '' : form.password }
        const r = await usersApi.create(payload)
        if (skipPwd) {
          try { await usersApi.sendInvite(r.data.id); toast.success('Usuário criado e convite enviado por e-mail.') }
          catch { toast.success('Usuário criado.'); toast.error('Não foi possível enviar o convite por e-mail.') }
        } else {
          toast.success('Usuário criado.')
        }
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
        style={{background:'#fff',borderRadius:12,width:'100%',maxWidth:720,maxHeight:'90vh',display:'flex',flexDirection:'column',boxShadow:'0 24px 64px rgba(0,0,0,.24)',animation:'mIn .15s ease'}}>
        <div style={{padding:'16px 20px 14px',borderBottom:'1px solid #e2e8f0',flexShrink:0}}>
          <p style={{fontSize:14,fontWeight:600,color:'#1e293b',margin:0}}>{isEdit ? 'Editar usuário' : 'Novo usuário'}</p>
        </div>
        <div style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:12,overflowY:'auto'}}>
          <div className="grid2">
            <div><label style={lbl}>Primeiro nome</label><input style={inp} value={form.first_name} onChange={set('first_name')} placeholder="Ana" /></div>
            <div><label style={lbl}>Sobrenome</label><input style={inp} value={form.last_name} onChange={set('last_name')} placeholder="Silva" /></div>
          </div>
          <div><label style={lbl}>E-mail * <span style={{fontWeight:400,textTransform:'none',color:'#94a3b8'}}>(será o login)</span></label><input style={inp} type="email" value={form.email} onChange={set('email')} placeholder="ana@uneworld.com.br" /></div>

          {!isEdit && (
            <label style={{display:'flex',alignItems:'flex-start',gap:8,cursor:'pointer',fontSize:12.5,color:'#475569',padding:'9px 11px',borderRadius:7,border:'1px solid #e2e8f0',background:'#f8fafc'}}>
              <input type="checkbox" checked={skipPwd} onChange={e=>setSkipPwd(e.target.checked)} style={{accentColor:'#1a2d4f',width:15,height:15,marginTop:1,flexShrink:0}} />
              <span>Não definir senha agora — enviar um convite por e-mail para a pessoa criar a própria senha</span>
            </label>
          )}

          {!skipPwd && (
            <div>
              <label style={lbl}>{isEdit ? 'Nova senha (deixe vazio para manter)' : 'Senha *'}</label>
              <PasswordInput style={inp} value={form.password} onChange={set('password')} placeholder={isEdit ? '••••••••' : 'Mínimo 8 caracteres'} />
            </div>
          )}

          {isEdit && (
            <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,color:'#1e293b'}}>
              <input type="checkbox" checked={form.is_active} onChange={e=>setForm(f=>({...f,is_active:e.target.checked}))} style={{accentColor:'#1a2d4f',width:15,height:15}} />
              Ativo
            </label>
          )}

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
                <div style={{display:'flex',flexDirection:'column',gap:12}}>
                  <PermGroupCard group={ADMIN_GROUP} permissions={form.permissions} onToggle={setPerm} onToggleAll={setPermAll} horizontal />
                  <div>
                    <label style={lbl}>Permissões</label>
                    <div className="grid2" style={{marginBottom:0,alignItems:'start'}}>
                      {GRID_GROUPS.map(g => (
                        <PermGroupCard key={g.title} group={g} permissions={form.permissions} onToggle={setPerm} onToggleAll={setPermAll} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : targetIsSuperuser ? (
            <div style={{padding:'10px 12px',borderRadius:8,background:'#eff6ff',border:'1px solid #bfdbfe',fontSize:12.5,color:'#1d4ed8'}}>
              Superusuário: acesso total a todas as permissões do sistema.
            </div>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <PermGroupCard group={ADMIN_GROUP} permissions={form.permissions} onToggle={setPerm} onToggleAll={setPermAll} horizontal />
              <div>
                <label style={lbl}>Permissões</label>
                <div className="grid2" style={{marginBottom:0,alignItems:'start'}}>
                  {GRID_GROUPS.map(g => (
                    <PermGroupCard key={g.title} group={g} permissions={form.permissions} onToggle={setPerm} onToggleAll={setPermAll} />
                  ))}
                </div>
              </div>
            </div>
          )}
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
  const canViewLog = !!me?.is_superuser || !!me?.permissions?.view_audit_log

  const load = () => {
    setLoading(true)
    usersApi.list()
      .then(r => setUsers(r.data))
      .catch(() => toast.error('Erro ao carregar usuários.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

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
          <button className="btn btn-primary" onClick={() => setModal('new')}>
            <Ic n="plus" s={13}/>Novo usuário
          </button>
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
                <th style={{width:40}}>
                  <input type="checkbox" className="chk" checked={allSel} onChange={togAll} disabled={selectable.length === 0} />
                </th>
                <th>Usuário</th>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Status</th>
                <th style={{width:110}}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <tr key={u.id}>
                  <td>
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
                  <td className="t-muted"><CopyCell value={u.email} muted /></td>
                  <td>
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
                  <td>
                    {u.is_active
                      ? <span className="badge bg-green">Ativo</span>
                      : <span className="badge bg-red">Inativo</span>
                    }
                  </td>
                  <td>
                    <div className="r-acts">
                      <button className="r-btn edit" title="Editar" onClick={() => setModal(u)}><Ic n="edit" s={13}/></button>
                      <button className="r-btn view" title="Enviar convite por e-mail"
                        onClick={async () => {
                          try {
                            await usersApi.sendInvite(u.id)
                            toast.success(`Convite enviado para ${u.email}`)
                          } catch (e) {
                            toast.error(e.response?.data?.error ?? 'Erro ao enviar convite.')
                          }
                        }}>
                        <Ic n="ul" s={13}/>
                      </button>
                      {me?.is_superuser && u.id !== me?.id && (
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
      {bulkDel && (
        <DelModal name={`${sel.size} usuário${sel.size !== 1 ? 's' : ''} selecionado${sel.size !== 1 ? 's' : ''}`} onOk={bulkDelete} onCancel={() => !bulkBusy && setBulkDel(false)} />
      )}
    </div>
  )
}
