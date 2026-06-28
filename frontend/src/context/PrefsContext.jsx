import { createContext, useContext, useState, useEffect } from 'react'
import { agendaApi } from '../api'
import { useAuth } from './AuthContext'

const PrefsContext = createContext({ timeFormat: '24h', setTimeFormat: () => {} })

export function PrefsProvider({ children }) {
  const { user } = useAuth()
  const [timeFormat, setTimeFormatState] = useState('24h')
  const [contractCreateLayout, setContractCreateLayout] = useState('steps')
  const [contractEditLayout, setContractEditLayout]     = useState('full')

  useEffect(() => {
    if (!user) return
    agendaApi.getPrefs()
      .then(r => {
        setTimeFormatState(r.data.time_format || '24h')
        setContractCreateLayout(r.data.contract_create_layout || 'steps')
        setContractEditLayout(r.data.contract_edit_layout || 'full')
      })
      .catch(() => {})
  }, [user])

  const setTimeFormat = (fmt) => {
    setTimeFormatState(fmt)
  }

  // Salva o layout preferido do contrato (separado para criar/editar) no perfil.
  const setContractLayout = (isEdit, value) => {
    if (isEdit) setContractEditLayout(value)
    else setContractCreateLayout(value)
    agendaApi.updatePrefs(isEdit ? { contract_edit_layout: value } : { contract_create_layout: value }).catch(() => {})
  }

  return (
    <PrefsContext.Provider value={{ timeFormat, setTimeFormat, contractCreateLayout, contractEditLayout, setContractLayout }}>
      {children}
    </PrefsContext.Provider>
  )
}

export const usePrefs = () => useContext(PrefsContext)
