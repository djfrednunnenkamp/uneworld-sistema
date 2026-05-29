import { useLocation, useNavigate } from 'react-router-dom'
import { Ic } from './Icon'

const NAV = [
  { id: '/',           icon: 'grid',     label: 'Visão Geral', group: null     },
  { id: '/passageiros',icon: 'users',    label: 'Passageiros', group: 'GESTÃO' },
  { id: '/agencias',   icon: 'building', label: 'Agências',    group: 'GESTÃO' },
  { id: '/viagens',    icon: 'plane',    label: 'Viagens',     group: 'GESTÃO' },
  { id: '/reunioes',   icon: 'calendar', label: 'Reuniões',    group: 'GESTÃO' },
]

export default function Sidebar() {
  const { pathname } = useLocation()
  const navigate     = useNavigate()
  let lastGroup      = null

  return (
    <div className="sidebar">
      {/* Logo */}
      <div className="sb-logo">
        <div className="sb-logo-text">
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 20, letterSpacing: '-.02em' }}>
            une<span style={{ color: '#6BA3C8' }}> world</span>
          </span>
        </div>
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
        <div className="user-row">
          <div className="ava">FN</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="u-name">Frederico N.</div>
            <div className="u-role">Administrador</div>
          </div>
          <div style={{ color: 'rgba(255,255,255,.3)' }}>
            <Ic n="logout" s={14} />
          </div>
        </div>
      </div>
    </div>
  )
}
