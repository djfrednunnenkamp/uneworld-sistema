/* Constantes/helpers de UI das abas do roteiro (sem componentes React — mantidos
   fora de ui.jsx para não quebrar o fast-refresh). */

export const inp = { padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b', boxSizing: 'border-box', width: '100%' }

export const CURRENCY_OPTS = [
  { value: 'EUR', label: 'Euro' },
  { value: 'USD', label: 'Dólar' },
  { value: 'BRL', label: 'Real' },
]

export const TYPE_OPTS = [
  { value: 'aereo',     label: 'Aéreo' },
  { value: 'terrestre', label: 'Terrestre' },
  { value: 'maritimo',  label: 'Marítimo' },
]

export const fmtDateBR = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
