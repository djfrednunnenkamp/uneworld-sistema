import { createContext, useContext, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

const NavGuardCtx = createContext(null)

/**
 * Guardião de navegação (sem data router). Uma página com alterações não salvas
 * registra um guard com setGuard({ when, attempt }). A navegação da sidebar e dos
 * botões passa por `guardedNavigate`: se o guard estiver ativo (when()), chama
 * `attempt(proceed)` (a página mostra o "deseja sair?") em vez de navegar direto.
 */
export function NavGuardProvider({ children }) {
  const navigate = useNavigate()
  const guardRef = useRef(null)   // { when: () => bool, attempt: (proceed) => void }

  const setGuard = useCallback((g) => { guardRef.current = g }, [])
  const clearGuard = useCallback(() => { guardRef.current = null }, [])
  const guardedNavigate = useCallback((to, opts) => {
    const g = guardRef.current
    if (g && g.when && g.when()) {
      g.attempt(() => { guardRef.current = null; navigate(to, opts) })
    } else {
      navigate(to, opts)
    }
  }, [navigate])

  return (
    <NavGuardCtx.Provider value={{ setGuard, clearGuard, guardedNavigate }}>
      {children}
    </NavGuardCtx.Provider>
  )
}

export function useNavGuard() {
  return useContext(NavGuardCtx) || { setGuard: () => {}, clearGuard: () => {}, guardedNavigate: null }
}
