import { useState, useEffect } from 'react'
import { contractsApi, auditApi } from '../api'
import { generateContractPDF } from '../utils/generateContractPDF'
import SignedFileViewer from './SignedFileViewer'
import { Ic } from './Icon'

/* Pré-visualização do contrato (PDF gerado) num popup elegante — mesma cara do
 * documento final. Tem "Baixar" e, opcionalmente, uma ação extra no rodapé (ex.:
 * "Enviar para assinatura"). Editar o contrato continua possível por trás. */
export default function ContractPdfPreviewModal({ contractId, title = 'Pré-visualização do contrato', onClose, footerExtra }) {
  const [blobUrl, setBlobUrl] = useState(null)
  const [reservation, setReservation] = useState('')
  const [status, setStatus] = useState('loading')   // loading | ready | error

  useEffect(() => {
    let url, cancelled = false
    contractsApi.get(contractId)
      .then(async r => {
        if (cancelled) return
        setReservation(r.data.reservation_number || '')
        url = await generateContractPDF(r.data, { output: 'bloburl' })
        if (cancelled) { URL.revokeObjectURL(url); return }
        setBlobUrl(url); setStatus('ready')
      })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [contractId])

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 600, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 920, height: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.32)' }}>
        <div style={{ padding: '13px 16px 13px 18px', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#eff6ff', color: '#2e6db4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Ic n="docs" s={18} /></div>
            <div>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{title}</p>
              <p style={{ margin: 0, fontSize: 11.5, color: '#94a3b8' }}>Pré-visualização — você ainda pode editar o contrato</p>
            </div>
          </div>
          <button onClick={onClose} title="Fechar" style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#1e293b'; e.currentTarget.style.color = '#1e293b' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#94a3b8' }}><Ic n="x" s={15} /></button>
        </div>

        {status === 'loading' && <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#3f4651', color: '#cbd5e1', fontSize: 13 }}>Gerando o documento…</div>}
        {status === 'error'   && <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#3f4651', color: '#fca5a5', fontSize: 13 }}>Não foi possível gerar o documento.</div>}
        {status === 'ready'   && <SignedFileViewer url={blobUrl} />}

        <div style={{ padding: '12px 18px', borderTop: '1px solid #eef2f7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
          <div>{footerExtra}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {blobUrl && <a href={blobUrl} download={`contrato_${reservation || contractId}.pdf`}
              onClick={() => auditApi.logDownload({
                label: `Baixou o PDF do ${reservation ? `Contrato ${reservation}` : `Contrato #${contractId}`}`,
                model_name: 'Contract', model_label: 'Contrato', object_id: contractId,
              }).catch(() => {})}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, textDecoration: 'none', fontFamily: 'inherit' }}>Baixar</a>}
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Fechar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
