import { Outlet } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <div className="topbar">
          <img src="/logo.png" alt="UneWorld" style={{ height: 28, width: 'auto', display: 'block' }} />
          <div className="topbar-r">
            <span className="topbar-role">Administrador</span>
            <div className="topbar-ava">FN</div>
          </div>
        </div>
        <div className="page">
          <Outlet />
        </div>
      </div>
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          style: { borderRadius: 8, fontSize: 13, fontFamily: 'inherit' },
        }}
      />
    </div>
  )
}
