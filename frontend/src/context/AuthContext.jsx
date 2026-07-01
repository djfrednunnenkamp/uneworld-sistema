import { createContext, useContext, useState, useEffect } from 'react'
import { authApi, auditApi } from '../api'
import { onSessionChanged } from '../utils/authChannel'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)   // null = não carregado, false = não logado
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    authApi.me()
      .then(r  => setUser(r.data))
      .catch(() => setUser(false))
      .finally(() => setLoading(false))
  }, [])

  // F-06: quando outra aba (reset/convite) troca a sessão, recarrega o /me aqui
  // em vez de a outra aba mexer nesta via window.opener. Só entre abas da mesma
  // origem (BroadcastChannel/storage), então página externa não dispara isto.
  useEffect(() => onSessionChanged(() => {
    authApi.me().then(r => setUser(r.data)).catch(() => setUser(false))
  }), [])

  const login = async (email, password) => {
    const r = await authApi.login(email, password)
    setUser(r.data)
    // Localização precisa do navegador é opcional — só refina o pino do
    // login no Log do Sistema (já tem a aproximada via IP); se a pessoa
    // negar a permissão, o login segue normal, sem nenhum aviso ou erro.
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          auditApi.refineLoginLocation(pos.coords.latitude, pos.coords.longitude)
            .catch(err => { if (import.meta.env.DEV) console.warn('[geo] falha ao enviar localização:', err) })
        },
        (err) => { if (import.meta.env.DEV) console.warn('[geo] navigator.geolocation falhou:', err.code, err.message) },
        { timeout: 8000, maximumAge: 60000 }
      )
    }
    return r.data
  }

  const logout = async () => {
    await authApi.logout().catch(() => {})
    setUser(false)
  }

  const refreshUser = async () => {
    const r = await authApi.me()
    setUser(r.data)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
