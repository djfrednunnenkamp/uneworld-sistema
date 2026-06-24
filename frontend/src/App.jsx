import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { PrefsProvider } from './context/PrefsContext'
import { canAccess } from './utils/permissions'
import Layout          from './components/Layout'
import Login           from './pages/Login'
import ForgotPassword  from './pages/ForgotPassword'
import ResetPassword   from './pages/ResetPassword'
import AcceptInvite    from './pages/AcceptInvite'
import Dashboard       from './pages/Dashboard'
import Passengers      from './pages/Passengers'
import PassengerDetail from './pages/PassengerDetail'
import Agencies        from './pages/Agencies'
import AgencyDetail    from './pages/AgencyDetail'
import Contracts       from './pages/Contracts'
import Trips           from './pages/Trips'
import TripDetail      from './pages/TripDetail'
import Users           from './pages/Users'
import Settings        from './pages/Settings'
import GeoImport       from './pages/GeoImport'
import AuditLog        from './pages/AuditLog'
import FlatImport      from './pages/FlatImport'
import CalendarPage    from './pages/Calendar'

/* Bloqueia rotas por permissão — redireciona para / se sem acesso */
function RequirePermission({ children }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  if (user && !canAccess(user, pathname)) return <Navigate to="/" replace />
  return children
}

/* Protege rotas — redireciona para /login se não autenticado */
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#eef1f6' }}>
      <div style={{ width:28, height:28, border:'3px solid #e2e8f0', borderTopColor:'#2e6db4', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AppRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login"           element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/esqueci-senha"   element={<ForgotPassword />} />
      <Route path="/redefinir-senha" element={<ResetPassword />} />
      <Route path="/aceitar-convite" element={<AcceptInvite />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index                      element={<Dashboard       />} />
        <Route path="passageiros"         element={<RequirePermission><Passengers      /></RequirePermission>} />
        <Route path="passageiros/:id"     element={<RequirePermission><PassengerDetail /></RequirePermission>} />
        <Route path="agencias"            element={<RequirePermission><Agencies        /></RequirePermission>} />
        <Route path="agencias/:id"        element={<RequirePermission><AgencyDetail    /></RequirePermission>} />
        <Route path="contratos"           element={<RequirePermission><Contracts       /></RequirePermission>} />
        <Route path="viagens"             element={<RequirePermission><Trips           /></RequirePermission>} />
        <Route path="viagens/:id"         element={<RequirePermission><TripDetail      /></RequirePermission>} />
        <Route path="calendario"          element={<RequirePermission><CalendarPage    /></RequirePermission>} />
        <Route path="usuarios"            element={<RequirePermission><Users           /></RequirePermission>} />
        <Route path="configuracoes"        element={<RequirePermission><Settings        /></RequirePermission>} />
        <Route path="configuracoes/geo-import"   element={<RequirePermission><GeoImport   /></RequirePermission>} />
        <Route path="log"                        element={<RequirePermission><AuditLog    /></RequirePermission>} />
        <Route path="configuracoes/import"      element={<RequirePermission><FlatImport  /></RequirePermission>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PrefsProvider>
          <AppRoutes />
        </PrefsProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
