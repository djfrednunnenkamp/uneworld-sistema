import { useLocation, useNavigate } from 'react-router-dom'
import { Ic } from './Icon'
import { useAuth } from '../context/AuthContext'

const NAV_BASE = [
  { id: '/',           icon: 'grid',     label: 'Visão Geral', group: null,     adminOnly: false },
  { id: '/passageiros',icon: 'users',    label: 'Passageiros', group: 'GESTÃO', adminOnly: false },
  { id: '/agencias',   icon: 'building', label: 'Agências',    group: 'GESTÃO', adminOnly: false },
  { id: '/viagens',    icon: 'plane',    label: 'Viagens',     group: 'GESTÃO', adminOnly: false },
  { id: '/reunioes',   icon: 'calendar', label: 'Reuniões',    group: 'GESTÃO', adminOnly: false },
  { id: '/usuarios',      icon: 'users',    label: 'Usuários',      group: 'SISTEMA',adminOnly: true  },
  { id: '/configuracoes', icon: 'settings', label: 'Configurações',  group: 'SISTEMA',adminOnly: true  },
  { id: '/log',           icon: 'list',    label: 'Log do Sistema',  group: 'SISTEMA',adminOnly: true  },
]

export default function Sidebar() {
  const { pathname } = useLocation()
  const navigate     = useNavigate()
  const { user } = useAuth()
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

    </div>
  )
}
