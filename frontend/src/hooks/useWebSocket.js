import { useEffect, useRef } from 'react'

/**
 * Abre uma conexão WebSocket e reconecta automaticamente quando cai.
 * onMessage é sempre chamado com a versão mais recente via ref (sem re-criar o efeito).
 */
export function useWebSocket(url, onMessage, { enabled = true } = {}) {
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    if (!enabled || !url) return

    let ws
    let timer
    let destroyed = false

    function connect() {
      if (destroyed) return
      ws = new WebSocket(url)

      ws.onopen = () => {
        // conexão estabelecida — sem log para não poluir o console
      }

      ws.onmessage = (e) => {
        try {
          onMessageRef.current(JSON.parse(e.data))
        } catch {}
      }

      ws.onclose = () => {
        if (!destroyed) timer = setTimeout(connect, 3000)
      }

      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      destroyed = true
      clearTimeout(timer)
      ws?.close()
    }
  }, [url, enabled])
}
