import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { contractsApi } from '../api'
import { generateContractPDF } from '../utils/generateContractPDF'
import SignedFileViewer from './SignedFileViewer'
import ConfirmModal from './ConfirmModal'
import { Ic } from './Icon'

/** Popup de ASSINATURA (etapa "Para assinatura"), em duas colunas:
 *  - Esquerda: o contrato (PDF gerado) com botão de baixar; ao anexar o assinado,
 *    passa a mostrar o arquivo enviado.
 *  - Direita: física → escolher arquivo + confirmar + enviar; digital → verificar.
 * Props: contract, onClose, onDone(tab?)
 */
export default function ContractSignatureModal({ contract, onClose, onDone }) {
  const isDigital = contract?.signature_type === 'digital'
  const [file, setFile] = useState(null)
  const [fileUrl, setFileUrl] = useState(null)      // preview do arquivo enviado (esquerda)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)   // arraste-e-solte
  const [docUrl, setDocUrl] = useState(null)        // PDF do contrato (blob)
  const [docStatus, setDocStatus] = useState('loading')  // loading | ready | error
  const [overridePrompt, setOverridePrompt] = useState(null)  // {message} quando o QR não pôde ser lido
  const inputRef = useRef(null)
  const label = contract?.reservation_number ? `Reserva ${contract.reservation_number}` : `Contrato #${contract?.id}`

  // Gera o PDF do contrato para a coluna da esquerda.
  useEffect(() => {
    let url, cancelled = false
    contractsApi.get(contract.id)
      .then(async r => {
        if (cancelled) return
        // Física: embute o QR de segurança por página (assinado no backend).
        url = await generateContractPDF(r.data, { output: 'bloburl', signing: r.data.signature_type !== 'digital' })
        if (cancelled) { URL.revokeObjectURL(url); return }
        setDocUrl(url); setDocStatus('ready')
      })
      .catch(() => { if (!cancelled) setDocStatus('error') })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [contract.id])

  const pickFile = (f) => {
    if (f) {
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')
      if (!isPdf) { toast.error('Apenas arquivos PDF são aceitos.'); return }
      if (f.size > 15 * 1024 * 1024) { toast.error('Arquivo muito grande (máx. 15 MB).'); return }
    }
    if (fileUrl) URL.revokeObjectURL(fileUrl)
    setFile(f || null)
    setFileUrl(f ? URL.createObjectURL(f) : null)
    setConfirmed(false)
  }
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl) }, [fileUrl])

  const upload = async (override = false) => {
    if (!file) { toast.error('Selecione o arquivo assinado.'); return }
    if (!confirmed) { toast.error('Confirme que o contrato está assinado e correto.'); return }
    setBusy(true)
    // Progresso na notificação: o upload + verificação dos QR pode demorar; assim
    // a pessoa vê que está andando (igual ao "Verificando assinatura…" do digital).
    const toastId = toast.loading(override ? 'Anexando o documento…' : 'Enviando e verificando o contrato assinado…')
    try {
      await contractsApi.uploadSigned(contract.id, file, { override })
      toast.success(override ? 'Documento anexado (sem verificação). Movido para "Em revisão".'
                             : 'Contrato assinado anexado. Movido para "Em revisão".', { id: toastId })
      setOverridePrompt(null)
      onDone?.('revisao')
    } catch (e) {
      const data = e?.response?.data || {}
      // QR ilegível (scan ruim): o backend permite anexar mesmo assim se a pessoa
      // confirmar que é o documento certo. Abre a confirmação em vez de só o erro.
      if (data.can_override && !override) {
        toast.dismiss(toastId)
        setOverridePrompt({ message: data.error })
      } else {
        toast.error(data.error || 'Erro ao anexar o contrato assinado.', { id: toastId })
      }
    } finally { setBusy(false) }
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

  // Arrastar-e-soltar em qualquer área do popup (só física).
  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false)
    if (isDigital || busy) return
    const f = e.dataTransfer?.files?.[0]
    if (f) pickFile(f)
  }
  const onDragOver = (e) => { if (isDigital || busy) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dragOver) setDragOver(true) }
  const onDragLeave = (e) => { if (e.currentTarget === e.target) setDragOver(false) }

  const leftUrl = fileUrl || docUrl
  const secTitle = { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 8 }

  return (
    <div onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 560, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        onDragOver={onDragOver} onDragEnter={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
        style={{ position: 'relative', background: '#fff', borderRadius: 14, width: '100%', maxWidth: 980, height: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.28)', overflow: 'hidden' }}>
        {dragOver && !isDigital && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'rgba(37,99,235,.10)', border: '3px dashed #2563eb', borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, pointerEvents: 'none', backdropFilter: 'blur(1px)' }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: '#dbeafe', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n="ul" s={26} /></div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1e40af' }}>Solte o contrato assinado aqui</div>
            <div style={{ fontSize: 12.5, color: '#3b82f6' }}>Somente PDF</div>
          </div>
        )}
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n="feather" s={19} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Assinatura</div>
            <div style={{ fontSize: 12.5, color: '#64748b' }}>{label} · {isDigital ? 'Digital' : 'Física'}</div>
          </div>
          <button type="button" onClick={() => !busy && onClose()} title="Fechar"
            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e6eaf1', background: '#fff', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n="x" s={16} /></button>
        </div>

        {/* Corpo em duas colunas */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {/* Esquerda: documento / arquivo enviado */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #eef2f7' }}>
            <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0, borderBottom: `1px solid ${fileUrl ? '#bbf7d0' : '#eef2f7'}`, background: fileUrl ? '#f0fdf4' : '#fff' }}>
              {fileUrl ? (
                <span title={file?.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, color: '#15803d', minWidth: 0 }}>
                  <Ic n="check" s={14} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Documento enviado — {file?.name || 'contrato assinado'}</span>
                </span>
              ) : (
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#475569' }}>Contrato (para assinar)</span>
              )}
              {/* Baixar só faz sentido antes de anexar o assinado (baixar o contrato p/ assinar). */}
              {!fileUrl && docUrl && (
                <a href={docUrl} download={`contrato_${contract.reservation_number || contract.id}.pdf`}
                  style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#1a2d4f', fontSize: 12.5, fontWeight: 700, textDecoration: 'none', fontFamily: 'inherit' }}>
                  <Ic n="dl" s={14} /> Baixar PDF
                </a>
              )}
            </div>
            {leftUrl ? (
              <SignedFileViewer url={leftUrl} />
            ) : (
              <div style={{ flex: 1, minHeight: 0, background: '#3f4651', display: 'flex', alignItems: 'center', justifyContent: 'center', color: docStatus === 'error' ? '#fca5a5' : '#cbd5e1', fontSize: 13 }}>
                {docStatus === 'error' ? 'Não foi possível gerar o documento.' : 'Gerando o documento…'}
              </div>
            )}
          </div>

          {/* Direita: ações */}
          <div style={{ width: 320, flexShrink: 0, padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {isDigital ? (
              <div>
                <div style={secTitle}>Assinatura digital (Autentique)</div>
                <p style={{ fontSize: 13, color: '#475569', margin: '0 0 12px', lineHeight: 1.5 }}>
                  O cliente e a agência assinam pelo link enviado (e-mail/WhatsApp). Verifique se todos já assinaram.
                </p>
                <button type="button" onClick={check} disabled={busy}
                  style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? .6 : 1 }}>
                  <Ic n="check" s={15} /> {busy ? 'Verificando…' : 'Verificar assinatura'}
                </button>
              </div>
            ) : (
              <div>
                <div style={secTitle}>Anexar contrato assinado</div>
                <p style={{ fontSize: 13, color: '#475569', margin: '0 0 12px', lineHeight: 1.5 }}>Depois de assinado à mão, anexe o <strong>PDF</strong> (arraste para qualquer área ou escolha). Ele aparece à esquerda para conferir.</p>
                <input ref={inputRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
                  onChange={e => pickFile(e.target.files?.[0] || null)} />
                <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
                  style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Ic n="ul" s={14} /> {file ? 'Trocar arquivo' : 'Escolher arquivo'}
                </button>
                {file && <p style={{ fontSize: 12, color: '#334155', margin: '8px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</p>}

                {file && (
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 16, cursor: 'pointer' }}>
                    <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
                      style={{ width: 16, height: 16, marginTop: 1, accentColor: '#059669', cursor: 'pointer', flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.45 }}>Confiro que o arquivo à esquerda é o contrato <strong>assinado</strong> e está correto.</span>
                  </label>
                )}

                <button type="button" onClick={upload} disabled={busy || !file || !confirmed}
                  style={{ width: '100%', marginTop: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 18px', borderRadius: 8, border: 'none', background: (busy || !file || !confirmed) ? '#94a3b8' : '#059669', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: (busy || !file || !confirmed) ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                  <Ic n="check" s={15} /> {busy ? 'Enviando…' : 'Enviar contrato assinado'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid #eef2f7', padding: '12px 18px', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button type="button" onClick={() => !busy && onClose()}
            style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Fechar</button>
        </div>
      </div>

      {overridePrompt && (
        <ConfirmModal
          title="Não foi possível verificar o documento"
          message={overridePrompt.message}
          detail="Você confirma que este é o documento correto e assinado? Ele seguirá para a revisão MARCADO COMO NÃO VERIFICADO, e a operadora verá um aviso para conferir à mão."
          okLabel="Sim, anexar mesmo assim"
          danger
          onOk={() => upload(true)}
          onCancel={() => !busy && setOverridePrompt(null)}
        />
      )}
    </div>
  )
}
