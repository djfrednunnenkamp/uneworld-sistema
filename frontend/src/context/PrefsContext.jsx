import { createContext, useContext, useState, useEffect } from 'react'
import { agendaApi } from '../api'
import { useAuth } from './AuthContext'

const PrefsContext = createContext({ timeFormat: '24h', setTimeFormat: () => {} })

export function PrefsProvider({ children }) {
  const { user } = useAuth()
  const [timeFormat, setTimeFormatState] = useState('24h')

  useEffect(() => {
    if (!user) return
    agendaApi.getPrefs()
      .then(r => setTimeFormatState(r.data.time_format || '24h'))
      .catch(() => {})
  }, [user])

  const setTimeFormat = (fmt) => {
    setTimeFormatState(fmt)
  }

  return (
    <PrefsContext.Provider value={{ timeFormat, setTimeFormat }}>
      {children}
    </PrefsContext.Provider>
  )
}

export const usePrefs = () => useContext(PrefsContext)
