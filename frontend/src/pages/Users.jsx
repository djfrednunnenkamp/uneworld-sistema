import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { usersApi } from '../api'
import { useAuth } from '../context/AuthContext'
import DelModal from '../components/DelModal'
import { Ic } from '../components/Icon'

const EMPTY = { username:'', first_name:'', last_name:'', email:'', password:'', is_staff:false, is_active:true }

function UserModal({ user, onClose, onSaved }) {
  const [form,   setForm]   = useState(user ? { ...user, password:'' } : { ...EMPTY })
  const [saving, setSaving] = useState(false)
  const isEdit = !!user
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    if (!form.username?.trim()) { toast.error('Nome de usuário obrigatório.'); return }
    if (!isEdit && !form.password) { toast.error('Senha obrigatória para novo usuário.'); return }
    setSaving(true)
    try {
      if (isEdit) await usersApi.update(user.id, form)
      else        await usersApi.create(form)
      toast.success(isEdit ? 'Usuário atualizado.' : 'Usuário criado.')
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
        style={{background:'#fff',borderRadius:12,width:'100%',maxWidth:440,boxShadow:'0 24px 64px rgba(0,0,0,.24)',animation:'mIn .15s ease'}}>
        <div style={{padding:'16px 20px 14px',borderBottom:'1px solid #e2e8f0'}}>
          <p style={{fontSize:14,fontWeight:600,color:'#1e293b',margin:0}}>{isEdit ? 'Editar usuário' : 'Novo usuário'}</p>
        </div>
        <div style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:12}}>
          <div className="grid2">
            <div><label style={lbl}>Primeiro nome</label><input style={inp} value={form.first_name} onChange={set('first_name')} placeholder="Ana" /></div>
            <div><label style={lbl}>Sobrenome</label><input style={inp} value={form.last_name} onChange={set('last_name')} placeholder="Silva" /></div>
          </div>
          <div><label style={lbl}>Nome de usuário *</label><input style={inp} value={form.username} onChange={set('username')} placeholder="ana.silva" /></div>
          <div><label style={lbl}>E-mail</label><input style={inp} type="email" value={form.email} onChange={set('email')} placeholder="ana@uneworld.com.br" /></div>
          <div>
            <label style={lbl}>{isEdit ? 'Nova senha (deixe vazio para manter)' : 'Senha *'}</label>
            <input style={inp} type="password" value={form.password} onChange={set('password')} placeholder={isEdit ? '••••••••' : 'Mínimo 8 caracteres'} />
          </div>
          <div style={{display:'flex',gap:16}}>
            <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,color:'#1e293b'}}>
              <input type="checkbox" checked={form.is_staff} onChange={e=>setForm(f=>({...f,is_staff:e.target.checked}))} style={{accentColor:'#1a2d4f',width:15,height:15}} />
              Administrador (staff)
            </label>
            {isEdit && (
              <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,color:'#1e293b'}}>
                <input type="checkbox" checked={form.is_active} onChange={e=>setForm(f=>({...f,is_active:e.target.checked}))} style={{accentColor:'#1a2d4f',width:15,height:15}} />
                Ativo
              </label>
            )}
          </div>
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

export default function Users() {
  const [users,  setUsers]  = useState([])
  const [loading,setLoading]= useState(true)
  const [modal,  setModal]  = useState(null)
  const [delUser,setDelUser] = useState(null)
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

      <div className="tcard">
        {loading ? (
          <div className="empty-state"><p style={{color:'#94a3b8'}}>Carregando…</p></div>
        ) : (
          <table className="dt">
            <thead>
              <tr>
                <th>Usuário</th>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Status</th>
                <th style={{width:80}}></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.id}>
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
    </div>
  )
}
