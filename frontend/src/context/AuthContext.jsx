import { createContext, useContext, useState, useEffect } from 'react'
import { authApi, auditApi } from '../api'

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
            .catch(err => console.warn('[geo] falha ao enviar localização pro backend:', err))
        },
        (err) => console.warn('[geo] navigator.geolocation falhou:', err.code, err.message),
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
