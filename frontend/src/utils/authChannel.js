/* Comunicação entre abas do MESMO domínio para o fluxo de troca de sessão
 * (reset/convite abrem em nova aba e, ao entrar com o novo usuário, a aba
 * principal precisa recarregar a sessão). Antes isso era feito via
 * window.opener.top.location.reload(), que expõe reverse tabnabbing (F-06).
 *
 * Aqui usamos BroadcastChannel (com fallback em localStorage) — só funciona
 * entre abas da MESMA origem, então uma página externa não consegue disparar
 * nem controlar a aba principal. */
const CHANNEL = 'uneworld:auth'
const LS_KEY = 'uneworld:session-changed'

export function notifySessionChanged() {
  try {
    const bc = new BroadcastChannel(CHANNEL)
    bc.postMessage({ type: 'session-changed', at: Date.now() })
    bc.close()
  } catch {
    // BroadcastChannel indisponível → fallback: o evento 'storage' dispara nas
    // OUTRAS abas da mesma origem (nunca cross-origin).
    try { localStorage.setItem(LS_KEY, String(Date.now())) } catch { /* ignore */ }
  }
}

/** Assina o sinal de "sessão mudou". Devolve uma função de cleanup. */
export function onSessionChanged(cb) {
  let bc
  try {
    bc = new BroadcastChannel(CHANNEL)
    bc.onmessage = (e) => { if (e.data?.type === 'session-changed') cb() }
  } catch { /* usa só o fallback abaixo */ }

  const onStorage = (e) => { if (e.key === LS_KEY) cb() }
  window.addEventListener('storage', onStorage)

  return () => {
    try { bc && bc.close() } catch { /* ignore */ }
    window.removeEventListener('storage', onStorage)
  }
}
