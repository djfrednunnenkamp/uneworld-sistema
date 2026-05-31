import { useLocation, useNavigate } from 'react-router-dom'
import { Ic } from './Icon'
import { useAuth } from '../context/AuthContext'

const NAV_BASE = [
  { id: '/',           icon: 'grid',     label: 'Visão Geral', group: null,     adminOnly: false },
  { id: '/passageiros',icon: 'users',    label: 'Passageiros', group: 'GESTÃO', adminOnly: false },
  { id: '/agencias',   icon: 'building', label: 'Agências',    group: 'GESTÃO', adminOnly: false },
  { id: '/viagens',    icon: 'plane',    label: 'Viagens',     group: 'GESTÃO', adminOnly: false },
  { id: '/reunioes',   icon: 'calendar', label: 'Reuniões',    group: 'GESTÃO', adminOnly: false },
  { id: '/usuarios',   icon: 'users',    label: 'Usuários',    group: 'SISTEMA',adminOnly: true  },
]

export default function Sidebar() {
  const { pathname } = useLocation()
  const navigate     = useNavigate()
  const { user, logout } = useAuth()
  let lastGroup      = null

  const NAV = NAV_BASE.filter(item => !item.adminOnly || user?.is_staff)

  return (
    <div className="sidebar">
      {/* Logo */}
      <div className="sb-logo" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <img src="/logo.png" alt="UneWorld Turismo" style={{ height: 48, width: 'auto', display: 'block' }} />
      </div>

      {/* Nav */}
      <nav className="sb-nav">
        {NAV.map((item) => {
          const showGroup = item.group && item.group !== lastGroup
          if (item.group) lastGroup = item.group
          const isActive  = item.id === '/'
            ? pathname === '/'
            : pathname.startsWith(item.id)

          return (
            <div key={item.id}>
              {showGroup && <div className="sb-group">{item.group}</div>}
              <button
                className={`sb-item${isActive ? ' active' : ''}`}
                onClick={() => navigate(item.id)}
              >
                <Ic n={item.icon} s={16} />
                {item.label}
              </button>
            </div>
          )
        })}
      </nav>

      {/* User */}
      <div className="sb-foot">
        <div className="user-row" onClick={logout} title="Sair" style={{ cursor:'pointer' }}>
          <div className="ava">
            {user ? `${user.first_name?.[0]??''}${user.last_name?.[0]??''}`.toUpperCase() || user.username?.[0]?.toUpperCase() : '?'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="u-name">{user?.full_name || user?.username || 'Usuário'}</div>
            <div className="u-role">{user?.is_superuser ? 'Superusuário' : user?.is_staff ? 'Administrador' : 'Usuário'}</div>
          </div>
          <div style={{ color: 'rgba(255,255,255,.3)' }}>
            <Ic n="logout" s={14} />
          </div>
        </div>
      </div>
    </div>
  )
}
