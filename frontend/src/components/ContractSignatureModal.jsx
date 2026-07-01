import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { contractsApi } from '../api'
import { Ic } from './Icon'

/** Popup de ASSINATURA (etapa "Para assinatura"). Centraliza: ver/baixar o
 * documento, anexar o contrato assinado (física) ou verificar a assinatura
 * (digital), e voltar para edição.
 * Props: contract, onClose, onDone(tab?), onViewDoc(), onReopen()
 */
export default function ContractSignatureModal({ contract, onClose, onDone, onViewDoc, onReopen }) {
  const isDigital = contract?.signature_type === 'digital'
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const label = contract?.reservation_number ? `Reserva ${contract.reservation_number}` : `Contrato #${contract?.id}`

  const upload = async () => {
    if (!file) { toast.error('Selecione o arquivo assinado.'); return }
    setBusy(true)
    try {
      await contractsApi.uploadSigned(contract.id, file)
      toast.success('Contrato assinado anexado. Movido para "Em revisão".')
      onDone?.('revisao')
    } catch (e) { toast.error(e?.response?.data?.error || 'Erro ao anexar o contrato assinado.') }
    finally { setBusy(false) }
  }

  const check = async () => {
    setBusy(true)
    const toastId = toast.loading('Verificando assinatura…')
    try {
      const r = await contractsApi.checkSignature(contract.id)
      if (r.data?.stage === 'revisao') {
        toast.success('Contrato assinado! Movido para "Em revisão".', { id: toastId })
        onDone?.('revisao')
      } else {
        toast.dismiss(toastId)
        const signers = r.data?.autentique_data?.signers || []
        const done = signers.filter(s => s.signed).length
        toast.info(`Ainda faltam assinaturas (${done}/${signers.length} assinaram).`)
      }
    } catch (e) { toast.error(e?.response?.data?.error || 'Erro ao verificar a assinatura.', { id: toastId }) }
    finally { setBusy(false) }
  }

  const box = { border: '1px solid #e9edf3', borderRadius: 10, padding: '14px 16px', background: '#fff' }
  const secTitle = { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 8 }

  return (
    <div onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 560, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 560, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.28)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n="feather" s={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Assinatura</div>
            <div style={{ fontSize: 12.5, color: '#64748b' }}>{label} · {isDigital ? 'Digital' : 'Física'}</div>
          </div>
          <button type="button" onClick={() => !busy && onClose()} title="Fechar"
            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e6eaf1', background: '#fff', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n="x" s={16} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
          {/* Documento */}
          <div style={box}>
            <div style={secTitle}>Documento</div>
            <p style={{ fontSize: 13, color: '#475569', margin: '0 0 10px', lineHeight: 1.5 }}>Veja e baixe o PDF do contrato para assinar.</p>
            <button type="button" onClick={onViewDoc}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#1a2d4f', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Ic n="eye" s={14} /> Ver / baixar documento
            </button>
          </div>

          {/* Física: anexar assinado · Digital: verificar */}
          {isDigital ? (
            <div style={box}>
              <div style={secTitle}>Assinatura digital (Autentique)</div>
              <p style={{ fontSize: 13, color: '#475569', margin: '0 0 10px', lineHeight: 1.5 }}>
                O cliente e a agência assinam pelo link enviado (e-mail/WhatsApp). Verifique se todos já assinaram.
              </p>
              <button type="button" onClick={check} disabled={busy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? .6 : 1 }}>
                <Ic n="check" s={14} /> {busy ? 'Verificando…' : 'Verificar assinatura'}
              </button>
            </div>
          ) : (
            <div style={box}>
              <div style={secTitle}>Contrato assinado</div>
              <p style={{ fontSize: 13, color: '#475569', margin: '0 0 10px', lineHeight: 1.5 }}>Depois de assinado à mão, anexe o PDF (ou foto) aqui.</p>
              <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png" style={{ display: 'none' }}
                onChange={e => setFile(e.target.files?.[0] || null)} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Ic n="ul" s={14} /> Escolher arquivo
                </button>
                {file && <span style={{ fontSize: 12.5, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{file.name}</span>}
              </div>
              <button type="button" onClick={upload} disabled={busy || !file}
                style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, border: 'none', background: (busy || !file) ? '#94a3b8' : '#059669', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: (busy || !file) ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                <Ic n="check" s={15} /> {busy ? 'Enviando…' : 'Enviar contrato assinado'}
              </button>
            </div>
          )}

          {/* Voltar para edição */}
          <button type="button" onClick={onReopen} disabled={busy}
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#b45309', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: '4px 0' }}>
            <Ic n="rotate" s={13} /> Voltar para edição
          </button>
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid #eef2f7', padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button type="button" onClick={() => !busy && onClose()}
            style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Fechar</button>
        </div>
      </div>
    </div>
  )
}
