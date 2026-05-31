import { createContext, useContext, useState, useEffect } from 'react'
import { authApi } from '../api'

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

  const login = async (username, password) => {
    const r = await authApi.login(username, password)
    setUser(r.data)
    return r.data
  }

  const logout = async () => {
    await authApi.logout().catch(() => {})
    setUser(false)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
