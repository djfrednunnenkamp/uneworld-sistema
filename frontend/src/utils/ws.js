/* URL do WebSocket de dashboard — relativa ao host atual (sem porta fixa),
 * pra funcionar tanto em dev (proxiado pelo Vite) quanto em produção
 * (proxiado pelo nginx, atrás de Cloudflare/HTTPS). */
export function dashboardWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/dashboard/`
}
