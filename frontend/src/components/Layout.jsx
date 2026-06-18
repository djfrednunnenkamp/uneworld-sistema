import { useState, useRef, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Toaster } from 'sonner'
import Sidebar from './Sidebar'
import AccountModal from './AccountModal'
import ChangePasswordModal from './ChangePasswordModal'
import { useAuth } from '../context/AuthContext'

const menuItemStyle = {
  display: 'block', width: '100%', padding: '9px 16px', background: 'none',
  border: 'none', textAlign: 'left', fontSize: 13, color: '#0f172a', cursor: 'pointer',
  fontFamily: 'inherit', transition: 'background .1s',
}

export default function Layout() {
  const { user, logout, refreshUser } = useAuth()
  const [menuOpen,      setMenuOpen]      = useState(false)
  const [showAccount,   setShowAccount]   = useState(false)
  const [showChangePw,  setShowChangePw]  = useState(false)
  const menuRef = useRef(null)

  const initials = user
    ? (`${user.first_name?.[0]??''}${user.last_name?.[0]??''}`).toUpperCase() || user.username?.[0]?.toUpperCase()
    : '?'

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <div className="topbar">
          <img src="/logo.png" alt="UneWorld" style={{ height: 28, width: 'auto', display: 'block' }}
            onError={e => { e.target.style.display='none' }} />
          <div className="topbar-r">
            <span className="topbar-role">{user?.full_name || user?.username || 'Administrador'}</span>
            <div ref={menuRef} style={{ position: 'relative' }}>
              <div
                className="topbar-ava"
                onClick={() => setMenuOpen(o => !o)}
                title="Menu do usuário"
              >
                {initials}
              </div>
              {menuOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                  background: '#fff', borderRadius: 10,
                  boxShadow: '0 8px 32px rgba(0,0,0,.14)',
                  border: '1px solid #e2e8f0', minWidth: 210, zIndex: 200,
                  padding: '6px 0',
                }}>
                  {/* cabeçalho com info do usuário */}
                  <div style={{ padding: '10px 16px 10px', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>
                      {user?.full_name || user?.username}
                    </div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>
                      {user?.email || user?.username}
                    </div>
                  </div>
                  {/* opções */}
                  <button
                    style={menuItemStyle}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    onClick={() => { setMenuOpen(false); setShowAccount(true) }}
                  >
                    Minha conta
                  </button>
                  <button
                    style={menuItemStyle}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    onClick={() => { setMenuOpen(false); setShowChangePw(true) }}
                  >
                    Alterar senha
                  </button>
                  <div style={{ borderTop: '1px solid #f1f5f9', margin: '4px 0' }} />
                  <button
                    style={{ ...menuItemStyle, color: '#dc2626' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    onClick={logout}
                  >
                    Sair
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="page">
          <Outlet />
        </div>
      </div>

      <Toaster
        position="bottom-right"
        richColors
        expand={false}
        toastOptions={{ duration: 4000, style: { fontFamily: 'inherit', fontSize: 13 } }}
      />

      {showAccount  && <AccountModal        onClose={() => setShowAccount(false)}  onSaved={refreshUser} />}
      {showChangePw && <ChangePasswordModal  onClose={() => setShowChangePw(false)} />}
    </div>
  )
}
