import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout          from './components/Layout'
import Login           from './pages/Login'
import ForgotPassword  from './pages/ForgotPassword'
import ResetPassword   from './pages/ResetPassword'
import AcceptInvite    from './pages/AcceptInvite'
import Dashboard       from './pages/Dashboard'
import Passengers      from './pages/Passengers'
import PassengerDetail from './pages/PassengerDetail'
import Agencies        from './pages/Agencies'
import Trips           from './pages/Trips'
import Meetings        from './pages/Meetings'
import Users           from './pages/Users'
import Settings        from './pages/Settings'
import GeoImport       from './pages/GeoImport'

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
        <Route path="passageiros"         element={<Passengers      />} />
        <Route path="passageiros/:id"     element={<PassengerDetail />} />
        <Route path="agencias"            element={<Agencies        />} />
        <Route path="viagens"             element={<Trips           />} />
        <Route path="reunioes"            element={<Meetings        />} />
        <Route path="usuarios"            element={<Users           />} />
        <Route path="configuracoes"        element={<Settings        />} />
        <Route path="configuracoes/geo-import" element={<GeoImport   />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
