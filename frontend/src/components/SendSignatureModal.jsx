import { useState } from 'react'
import { Ic } from './Icon'

/** Confirmação de "Enviar para assinatura" — pede confirmação e deixa escolher
 * Física ou Digital (bem destacado) antes de enviar.
 * Props: contract, onConfirm(type), onClose, sending
 */
export default function SendSignatureModal({ contract, onConfirm, onClose, sending = false }) {
  const [type, setType] = useState(contract?.signature_type === 'digital' ? 'digital' : 'fisica')
  const label = contract?.reservation_number ? `Reserva ${contract.reservation_number}` : `Contrato #${contract?.id}`

  const OPTIONS = [
    { v: 'fisica',  icon: 'feather', title: 'Física',  desc: 'Imprimir, assinar à mão e anexar o PDF.' },
    { v: 'digital', icon: 'shield',  title: 'Digital', desc: 'Assinatura eletrônica via Autentique (link por e-mail/WhatsApp).' },
  ]

  return (
    <div onClick={e => { if (e.target === e.currentTarget && !sending) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 560, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 540, boxShadow: '0 24px 64px rgba(0,0,0,.28)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n="feather" s={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Enviar para assinatura</div>
            <div style={{ fontSize: 12.5, color: '#64748b' }}>{label}</div>
          </div>
          <button type="button" onClick={() => !sending && onClose()} title="Fechar"
            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e6eaf1', background: '#fff', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n="x" s={16} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, margin: '0 0 6px' }}>
            Você realmente quer enviar este documento para <strong>assinatura</strong>?
          </p>
          <p style={{ fontSize: 12.5, color: '#94a3b8', margin: '0 0 16px' }}>
            Depois de enviado, o contrato sai da edição e vai para a etapa de assinatura.
          </p>

          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 8 }}>Forma de assinatura</div>
          <div style={{ display: 'flex', gap: 12 }}>
            {OPTIONS.map(o => {
              const sel = type === o.v
              return (
                <button key={o.v} type="button" onClick={() => setType(o.v)} disabled={sending}
                  style={{ flex: 1, textAlign: 'left', cursor: sending ? 'default' : 'pointer', padding: '13px 14px', borderRadius: 12, border: `2px solid ${sel ? '#2563eb' : '#e2e8f0'}`, background: sel ? '#eff6ff' : '#fff', fontFamily: 'inherit', transition: 'border-color .12s, background .12s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ width: 15, height: 15, borderRadius: '50%', border: `2px solid ${sel ? '#2563eb' : '#cbd5e1'}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {sel && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2563eb' }} />}
                    </span>
                    <Ic n={o.icon} s={15} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: sel ? '#1e40af' : '#1e293b' }}>{o.title}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45, paddingLeft: 23 }}>{o.desc}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid #eef2f7', padding: '14px 20px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={() => !sending && onClose()} disabled={sending}
            style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
          <button type="button" onClick={() => onConfirm(type)} disabled={sending}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: sending ? .6 : 1 }}>
            <Ic n="feather" s={15} /> {sending ? 'Enviando…' : 'Enviar para assinatura'}
          </button>
        </div>
      </div>
    </div>
  )
}
