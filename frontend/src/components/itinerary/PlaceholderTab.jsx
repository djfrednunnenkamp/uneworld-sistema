import { memo } from 'react'
import { Ic } from '../Icon'

/* Aba genérica "em breve" — usada pelas seções ainda sem campos (Imagens,
   Destaques, Roteiro Dia a Dia, Inclusos, Não Inclusos, Opcionais, Dicas,
   Documentos, Cruzeiro). A estrutura de abas já existe; os campos entram depois. */
function PlaceholderTab({ title, note }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '52px 24px', boxShadow: '0 1px 4px rgba(0,0,0,.04)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10 }}>
      <div style={{ width: 46, height: 46, borderRadius: 12, background: '#eef2f8', color: '#1a2d4f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Ic n="feather" s={22} />
      </div>
      <p style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: 0 }}>{title}</p>
      <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, maxWidth: 420 }}>
        {note || 'Esta seção faz parte da nova estrutura de roteiros e será implementada em breve.'}
      </p>
    </div>
  )
}

export default memo(PlaceholderTab)
