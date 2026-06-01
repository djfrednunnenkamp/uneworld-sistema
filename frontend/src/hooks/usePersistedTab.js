import { useState } from 'react'

/**
 * Hook que persiste a aba ativa no localStorage.
 * Ao recarregar a página, volta para a última aba visitada.
 *
 * @param {string} key        - Chave única no localStorage (ex: 'tab_passenger_detail')
 * @param {*}      defaultTab - Valor padrão se não houver nada salvo
 * @returns {[value, setter]} - Igual ao useState, mas com persistência automática
 */
export default function usePersistedTab(key, defaultTab) {
  const [tab, _setTab] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored === null) return defaultTab
      // Tenta converter para número se o default for número
      if (typeof defaultTab === 'number') {
        const n = parseInt(stored, 10)
        return isNaN(n) ? defaultTab : n
      }
      return stored
    } catch {
      return defaultTab
    }
  })

  const setTab = (value) => {
    _setTab(value)
    try { localStorage.setItem(key, String(value)) } catch {}
  }

  return [tab, setTab]
}
