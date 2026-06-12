import { useLocation, useNavigate } from 'react-router-dom'
import { Ic } from './Icon'
import { useAuth } from '../context/AuthContext'

const NAV_BASE = [
  { id: '/',           icon: 'grid',     label: 'Visão Geral', group: null,     perms: null },
  { id: '/passageiros',icon: 'users',    label: 'Passageiros', group: 'GESTÃO', perms: ['passengers_view_basic', 'passengers_view_full'] },
  { id: '/agencias',   icon: 'building', label: 'Agências',    group: 'GESTÃO', perms: null },
  { id: '/viagens',    icon: 'plane',    label: 'Listas de Passageiros',      group: 'GESTÃO', perms: ['lists_view'] },
  { id: '/reunioes',   icon: 'calendar', label: 'Reuniões',    group: 'GESTÃO', perms: null },
  { id: '/usuarios',      icon: 'users',    label: 'Usuários',      group: 'SISTEMA', perms: ['manage_users']    },
  { id: '/configuracoes', icon: 'settings', label: 'Configurações',  group: 'SISTEMA', perms: ['manage_settings'] },
  { id: '/log',           icon: 'list',    label: 'Log do Sistema',  group: 'SISTEMA', perms: ['view_audit_log']  },
]

export default function Sidebar() {
  const { pathname } = useLocation()
  const navigate     = useNavigate()
  const { user } = useAuth()
  let lastGroup      = null

  const hasAccess = (perms) =>
    !perms || user?.is_superuser || perms.some(p => user?.permissions?.[p])

  const NAV = NAV_BASE.filter(item => hasAccess(item.perms))

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

    </div>
  )
}
