import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { usersApi } from '../api'
import { useAuth } from '../context/AuthContext'
import DelModal from '../components/DelModal'
import PasswordInput from '../components/PasswordInput'
import { Ic } from '../components/Icon'

const PERM_GROUPS = [
  {
    title: 'Passageiros',
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
    title: 'Passageiros na Lista',
    items: [
      ['lists_passengers_add',    'Adicionar passageiro à lista'],
      ['lists_passengers_edit',   'Editar passageiro na lista'],
      ['lists_passengers_remove', 'Remover passageiro da lista'],
    ],
  },
  {
    title: 'Agências',
    items: [
      ['agencies_view',      'Ver agências'],
      ['agencies_edit',      'Criar / Editar'],
      ['agencies_delete',    'Excluir'],
      ['agencies_view_logs', 'Ver log de atividades da agência'],
    ],
  },
  {
    title: 'Administração',
    items: [
      ['manage_users',    'Gerenciar usuários e permissões'],
      ['manage_settings', 'Acessar Configurações'],
      ['view_audit_log',  'Ver Log do Sistema (global)'],
    ],
  },
]

const ALL_PERM_KEYS   = PERM_GROUPS.flatMap(g => g.items.map(([k]) => k))
const ADMIN_GROUP     = PERM_GROUPS.find(g => g.title === 'Administração')
const GRID_GROUPS     = PERM_GROUPS.filter(g => g.title !== 'Administração')
const ADMIN_PERM_KEYS = ADMIN_GROUP.items.map(([k]) => k)
const EMPTY_PERMISSIONS = Object.fromEntries(ALL_PERM_KEYS.map(k => [k, false]))
const PRESET_ADMIN      = Object.fromEntries(ALL_PERM_KEYS.map(k => [k, true]))
const PRESET_USER       = Object.fromEntries(ALL_PERM_KEYS.map(k => [k, !ADMIN_PERM_KEYS.includes(k)]))

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

/* ── Card de grupo de permissões, com "Marcar todos" ── */
function PermGroupCard({ group, permissions, onToggle, onToggleAll, horizontal }) {
  const keys         = group.items.map(([k]) => k)
  const checkedCount = keys.filter(k => permissions?.[k]).length
  const allChecked   = checkedCount === keys.length
  const someChecked  = checkedCount > 0 && !allChecked

  return (
    <div style={{border:'1px solid #e2e8f0',borderRadius:8,padding:'10px 12px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8,gap:8}}>
        <p style={{fontSize:11,fontWeight:700,color:'#1a2d4f',textTransform:'uppercase',letterSpacing:'.04em',margin:0}}>{group.title}</p>
        <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:11,color:'#64748b',fontWeight:600,whiteSpace:'nowrap'}}>
          <input type="checkbox" checked={allChecked}
            ref={el => { if (el) el.indeterminate = someChecked }}
            onChange={e => onToggleAll(keys, e.target.checked)}
            style={{accentColor:'#1a2d4f',width:14,height:14}} />
          Marcar todos
        </label>
      </div>
      <div style={horizontal
        ? {display:'flex',flexDirection:'row',flexWrap:'wrap',gap:'8px 24px'}
        : {display:'flex',flexDirection:'column',gap:6}}>
        {group.items.map(([key, label]) => (
          <label key={key} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12.5,color:'#1e293b',whiteSpace:horizontal ? 'nowrap' : undefined}}>
            <input type="checkbox" checked={!!permissions?.[key]}
              onChange={e => onToggle(key, e.target.checked)}
              style={{accentColor:'#1a2d4f',width:15,height:15}} />
            {label}
          </label>
        ))}
      </div>
    </div>
  )
}

function UserModal({ user, onClose, onSaved }) {
  const { user: me } = useAuth()
  const [form,       setForm]       = useState(user
    ? { ...user, password:'', is_superuser: !!user.is_superuser, permissions: { ...EMPTY_PERMISSIONS, ...user.permissions } }
    : { ...EMPTY })
  const [skipPwd,    setSkipPwd]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const isEdit  = !!user
  const isSelf  = isEdit && user?.id === me?.id
  const targetIsSuperuser = isEdit && !!user?.is_superuser
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const setPerm    = (key, val)  => setForm(f => ({ ...f, permissions: { ...f.permissions, [key]: val } }))
  const setPermAll = (keys, val) => setForm(f => ({ ...f, permissions: { ...f.permissions, ...Object.fromEntries(keys.map(k => [k, val])) } }))

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
                    <div className="grid2" style={{marginBottom:0}}>
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
                <div className="grid2" style={{marginBottom:0}}>
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
  const { user: me } = useAuth()

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

  const filtered = users.filter(u => {
    const s = q.trim().toLowerCase()
    if (!s) return true
    return (u.full_name || '').toLowerCase().includes(s)
        || (u.username  || '').toLowerCase().includes(s)
        || (u.email     || '').toLowerCase().includes(s)
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
                        <p className="t-name" style={{margin:0}}>{u.full_name || u.username}</p>
                        <p style={{fontSize:11.5,color:'#94a3b8',margin:0}}>@{u.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="t-muted">{u.email || '—'}</td>
                  <td>
                    {u.is_superuser
                      ? <span className="badge bg-blue">Superusuário</span>
                      : u.is_staff
                        ? <span className="badge bg-green">Administrador</span>
                        : <span className="badge bg-amber">Usuário</span>
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
