import { memo } from 'react'

/* Componentes de UI compartilhados pelas abas do roteiro. Mantêm o design system
   (cards brancos, borda #e2e8f0, acento #1a2d4f). Constantes/helpers ficam em
   ./constants para não quebrar o fast-refresh. */

/* Chip de resumo (igual ao usado em Listas de Passageiros). */
export function Chip({ label, value }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</span>
      <span style={{ fontSize: 13, color: '#1e293b', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

/* Linha "label | campo" com divisor. */
export function FormRow({ label, children, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28, padding: '16px 0', borderBottom: last ? 'none' : '1px solid #f1f5f9' }}>
      <div style={{ width: 200, flexShrink: 0, fontSize: 13, fontWeight: 600, color: '#475569' }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

/* Card branco padrão que envolve o conteúdo de uma aba. */
export function TabCard({ children, style }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '4px 24px', boxShadow: '0 1px 4px rgba(0,0,0,.04)', ...style }}>
      {children}
    </div>
  )
}

/* Barra de abas — memoizada: só re-renderiza quando a aba ativa muda (não a cada
   tecla digitada nos campos). Rola na horizontal para acomodar muitas abas. */
export const TabBar = memo(function TabBar({ tabs, active, onSelect }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', borderBottom: '2px solid #e2e8f0', marginBottom: 20, overflowX: 'auto' }}>
      {tabs.map(t => (
        <button key={t.key} type="button" onClick={() => onSelect(t.key)}
          style={{ flex: '0 0 auto', whiteSpace: 'nowrap', padding: '10px 18px', background: 'none', border: 'none', borderBottom: active === t.key ? '2px solid #1a2d4f' : '2px solid transparent', marginBottom: -2, color: active === t.key ? '#1a2d4f' : '#64748b', fontSize: 14, fontWeight: active === t.key ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit', transition: 'color .15s' }}>
          {t.label}
        </button>
      ))}
    </div>
  )
})
