import { Outlet } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Sidebar from './Sidebar'
import { useAuth } from '../context/AuthContext'

export default function Layout() {
  const { user } = useAuth()
  const initials = user
    ? (`${user.first_name?.[0]??''}${user.last_name?.[0]??''}`).toUpperCase() || user.username?.[0]?.toUpperCase()
    : '?'

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <div className="topbar">
          <img src="/logo.png" alt="UneWorld" style={{ height: 28, width: 'auto', display: 'block' }}
            onError={e => { e.target.style.display='none' }} />
          <div className="topbar-r">
            <span className="topbar-role">{user?.full_name || user?.username || 'Administrador'}</span>
            <div className="topbar-ava">{initials}</div>
          </div>
        </div>
        <div className="page">
          <Outlet />
        </div>
      </div>
      <Toaster
        position="bottom-right"
        toastOptions={{ duration: 4000, style: { borderRadius: 8, fontSize: 13, fontFamily: 'inherit' } }}
      />
    </div>
  )
}
