import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { contractsApi, auditApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'
import TrashRowActions from '../components/TrashRowActions'
import ContractFormModal from '../components/ContractFormModal'
import ContractViewModal from '../components/ContractViewModal'
import SignedFileViewer from '../components/SignedFileViewer'
import ContractPdfPreviewModal from '../components/ContractPdfPreviewModal'
import ContractReviewModal from '../components/ContractReviewModal'
import ContractInvoiceModal from '../components/ContractInvoiceModal'
import SendSignatureModal from '../components/SendSignatureModal'
import ContractSignatureModal from '../components/ContractSignatureModal'
import ConfirmModal from '../components/ConfirmModal'
import DateRangeDrop from '../components/DateRangeDrop'
import { Ic } from '../components/Icon'
import { generateContractPDF } from '../utils/generateContractPDF'
import { useAuth } from '../context/AuthContext'
import { useWebSocket } from '../hooks/useWebSocket'
import { dashboardWsUrl } from '../utils/ws'

const fmtDateBR = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const fmtBRL = (v) => v == null ? '' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

const DASH = <span style={{ color: '#cbd5e1' }}>—</span>
const fmtDateTimeBR = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR') }

// Tempo relativo desde a criação ("há 5 minutos", "há 2 horas"). Passou de 1 dia
// → retorna null (aí a coluna mostra só a data).
const relCreatedBR = (iso) => {
  if (!iso) return null
  const t = new Date(iso); if (isNaN(t)) return null
  const secs = Math.floor((Date.now() - t.getTime()) / 1000)
  if (secs < 60) return 'agora mesmo'
  const min = Math.floor(secs / 60)
  if (min < 60) return `há ${min} ${min === 1 ? 'minuto' : 'minutos'}`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} ${h === 1 ? 'hora' : 'horas'}`
  return null
}

// Célula de data com o tempo relativo ("há X min/horas") acima — até 1 dia; depois
// mostra só a data. `dateStr` = data já formatada; `iso` = timestamp p/ o relativo.
const dateCell = (dateStr, iso) => {
  const rel = relCreatedBR(iso)
  const date = dateStr || DASH
  return rel ? (
    <div style={{ lineHeight: 1.2 }}>
      <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>{rel}</div>
      <div style={{ fontSize: 12.5, color: '#64748b' }}>{date}</div>
    </div>
  ) : date
}

// Etapas do contrato — rótulo e cor compartilhados entre as abas e a coluna
// "Status" da aba Geral.
const STAGE_META = {
  em_edicao: { label: 'Em edição',      color: '#2563eb' },
  enviado:   { label: 'Para assinatura', color: '#d97706' },
  assinado:  { label: 'Assinado',        color: '#0891b2' },
  revisao:   { label: 'Em revisão',      color: '#7c3aed' },
  aprovado:  { label: 'Aprovado',        color: '#059669' },
  a_faturar: { label: 'Em faturamento',  color: '#ca8a04' },
  faturado:  { label: 'Faturado',        color: '#059669' },
}
function StageBadge({ stage }) {
  const m = STAGE_META[stage] || { label: stage || '—', color: '#94a3b8' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: m.color, background: `${m.color}14`, border: `1px solid ${m.color}33`, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
      {m.label}
    </span>
  )
}

// Contrato reprovado na revisão: voltou p/ edição com um motivo registrado.
const isReproved = (r) => r?.stage === 'em_edicao' && !!(r?.review_note || '').trim()
function ReprovedBadge({ note }) {
  return (
    <span title={note ? `Motivo: ${note}` : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      <Ic n="warn" s={12} /> Reprovado
    </span>
  )
}

// Forma de assinatura do contrato — física (impresso e assinado à mão) ou
// digital (via Autentique).
const SIGNATURE_META = {
  fisica:  { label: 'Física',  color: '#7c3aed', ic: 'edit' },
  digital: { label: 'Digital', color: '#0891b2', ic: 'shield' },
}
function SignatureBadge({ type }) {
  const m = SIGNATURE_META[type] || { label: '—', color: '#94a3b8', ic: null }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: m.color, background: `${m.color}14`, border: `1px solid ${m.color}33`, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      {m.ic && <Ic n={m.ic} s={12} />}
      {m.label}
    </span>
  )
}

const VALUE_OPTS = [
  { value: '',            label: 'Qualquer valor' },
  { value: '0-5000',      label: 'Até R$ 5.000' },
  { value: '5000-20000',  label: 'R$ 5.000 – 20.000' },
  { value: '20000-50000', label: 'R$ 20.000 – 50.000' },
  { value: '50000+',      label: 'Acima de R$ 50.000' },
]
const valueInRange = (v, key) => {
  if (!key) return true
  if (v == null) return false
  v = Number(v)
  if (key === '0-5000')      return v <= 5000
  if (key === '5000-20000')  return v > 5000 && v <= 20000
  if (key === '20000-50000') return v > 20000 && v <= 50000
  if (key === '50000+')      return v > 50000
  return true
}

function initialsOf(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase()
}
function Avatar({ name, size = 22 }) {
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: !name ? '#94a3b8' : '#2e6db4', color: '#fff', fontSize: size * 0.4, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '.02em' }}>
      {initialsOf(name)}
    </span>
  )
}

/* ── FDrop — filtro no mesmo estilo do filtro "Usuário" da página de Logs:
 * botão fixo → dropdown logo abaixo com busca, avatar (iniciais) por item e
 * navegação por teclado (↑↓ + Enter). options[0] é a opção "Todos" (value ''). ── */
function FDrop({ label, value, onChange, options, icon = 'list', avatar = false, searchPlaceholder = 'Buscar…' }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hl, setHl] = useState(-1)
  const ref = useRef(null)
  const active = !!value
  const selected = options.find(o => o.value === value)
  // Avatares (Pagante/Viajante/Agência) sempre têm busca no topo; senão, só
  // quando a lista é grande.
  const searchable = avatar || options.length > 8

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  useEffect(() => { if (!open) { setQ(''); setHl(-1) } }, [open])

  const filtered = q ? options.filter(o => o.value === '' || o.label.toLowerCase().includes(q.toLowerCase())) : options
  const pick = (v) => { onChange(v); setOpen(false) }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl(h => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered.length) pick((hl >= 0 ? filtered[hl] : filtered[0]).value) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 8, border: `1.5px solid ${active ? '#2e6db4' : '#e2e8f0'}`, background: active ? '#eff6ff' : '#fff', color: active ? '#2e6db4' : '#475569', fontSize: 13, fontWeight: active ? 600 : 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', maxWidth: 220, transition: 'all .12s' }}>
        {active && avatar ? <Avatar name={selected?.label} size={18} /> : <Ic n={icon} s={13} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{active && selected ? selected.label : label}</span>
        <span style={{ fontSize: 9, opacity: .6, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>▼</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 300, background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 12px 28px rgba(15,23,42,.12)', width: 300, maxWidth: '90vw', overflow: 'hidden' }}>
          {searchable && (
            <div style={{ padding: 8, borderBottom: '1px solid #f1f5f9' }}>
              <input autoFocus value={q} onChange={e => { setQ(e.target.value); setHl(-1) }} onKeyDown={onKey}
                placeholder={searchPlaceholder}
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12.5, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            </div>
          )}
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <p style={{ padding: 14, margin: 0, fontSize: 12.5, color: '#94a3b8', textAlign: 'center' }}>Nada encontrado.</p>
            ) : filtered.map((opt, idx) => {
              const sel = value === opt.value
              const isHl = idx === hl
              const isAll = opt.value === ''
              return (
                <button key={opt.value || 'all'} type="button" onClick={() => pick(opt.value)} onMouseEnter={() => setHl(idx)}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: isAll ? '8px 14px' : '7px 14px', background: sel ? '#eff6ff' : (isHl ? '#f8fafc' : 'transparent'), border: 'none', color: sel ? '#2e6db4' : '#1e293b', fontSize: 13, fontWeight: sel ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  {isAll ? <Ic n={icon} s={13} /> : (avatar ? <Avatar name={opt.label} size={22} /> : <span style={{ width: 13 }} />)}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                  {sel && <Ic n="check" s={13} />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Popup de upload do contrato assinado (arrastar e soltar + pré-visualização) ──
 * Mostra o documento ao lado para conferência VISUAL (humana) e pede confirmação
 * manual de que está assinado. A conferência automática (OCR/IA) está pausada —
 * ver backend contracts/verify.py para retomar no futuro. */
function SignedUploadModal({ contractId, onClose, onUploaded }) {
  const [file, setFile] = useState(null)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sigOk, setSigOk] = useState(false)
  const [objUrl, setObjUrl] = useState(null)
  const [overridePrompt, setOverridePrompt] = useState(null)  // {message} quando o QR não pôde ser lido
  const inputRef = useRef(null)

  // Enquanto o popup está aberto, impede o navegador de abrir o arquivo solto
  // fora da zona de drop (comportamento padrão que abria o PDF numa página nova).
  useEffect(() => {
    const prevent = (e) => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => { window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent) }
  }, [])

  // URL local do arquivo selecionado, para o visualizador.
  useEffect(() => {
    if (!file) { setObjUrl(null); return }
    const u = URL.createObjectURL(file)
    setObjUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  const pick = (f) => { setFile(f); setSigOk(false) }

  // Upload + verificação dos QR. Se o QR não pôde ser lido (scan ruim), o backend
  // devolve can_override → abre a confirmação ("tem certeza que é o documento?").
  // Se a pessoa confirmar, reenvia com override e segue (marcado não verificado).
  const doUpload = async (override = false) => {
    if (!file) return
    setBusy(true)
    const toastId = toast.loading(override ? 'Anexando o documento…' : 'Enviando e verificando o contrato assinado…')
    try {
      await contractsApi.uploadSigned(contractId, file, { override })
      toast.success(override ? 'Documento anexado (sem verificação). Movido para "Em revisão".'
                             : 'Contrato assinado anexado. Movido para "Em revisão".', { id: toastId })
      setOverridePrompt(null)
      onUploaded()
    } catch (e) {
      const data = e?.response?.data || {}
      if (data.can_override && !override) {
        toast.dismiss(toastId)
        setOverridePrompt({ message: data.error })
      } else {
        toast.error(data.error || 'Erro ao anexar o contrato assinado.', { id: toastId })
      }
    } finally { setBusy(false) }
  }
  const submit = () => doUpload(false)

  const canSend = !!file && !busy && sigOk

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: file ? 1040 : 520, height: file ? '90vh' : 'auto', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.24)', overflow: 'hidden', transition: 'max-width .15s' }}>
        <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>Anexar contrato assinado</span>
          <button onClick={onClose} style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', cursor: 'pointer' }}><Ic n="x" s={14} /></button>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Pré-visualização do documento enviado */}
          {file && (
            <div style={{ flex: 1.35, display: 'flex', minWidth: 0, minHeight: 0, borderRight: '1px solid #e2e8f0' }}>
              {objUrl ? <SignedFileViewer url={objUrl} /> : <div style={{ flex: 1, background: '#3f4651' }} />}
            </div>
          )}

          {/* Painel de upload */}
          <div style={{ width: file ? 412 : '100%', flexShrink: 0, padding: 20, overflowY: 'auto' }}>
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#64748b', lineHeight: 1.5 }}>
              Envie o contrato que a pessoa assinou (PDF ou foto/imagem). Confira o documento ao lado antes de anexar. Ao confirmar, ele vai para a aba <strong>Assinados</strong>.
            </p>
            <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f) }} />
            <div onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) pick(f) }}
              style={{ border: `2px dashed ${drag ? '#2e6db4' : '#cbd5e1'}`, borderRadius: 12, padding: file ? '16px 16px' : '32px 20px', textAlign: 'center', cursor: 'pointer', background: drag ? '#eff6ff' : '#fafbfc', transition: 'all .12s' }}>
              <div style={{ color: drag ? '#2e6db4' : '#94a3b8', display: 'flex', justifyContent: 'center', marginBottom: 8 }}><Ic n="ul" s={file ? 22 : 30} /></div>
              {file ? (
                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</p>
              ) : (
                <>
                  <p style={{ margin: '0 0 4px', fontSize: 13.5, fontWeight: 600, color: '#475569' }}>Arraste o arquivo aqui</p>
                  <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>ou clique para escolher (PDF ou imagem)</p>
                </>
              )}
            </div>
            {file && <p style={{ margin: '8px 2px 0', fontSize: 11.5, color: '#2e6db4', cursor: 'pointer' }} onClick={() => inputRef.current?.click()}>Trocar arquivo</p>}

            {/* Confirmação manual da assinatura */}
            {file && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 16, padding: '11px 13px', background: '#f8fafc', border: `1px solid ${sigOk ? '#2e6db4' : '#e2e8f0'}`, borderRadius: 9, cursor: 'pointer' }}>
                <input type="checkbox" checked={sigOk} onChange={e => setSigOk(e.target.checked)} style={{ marginTop: 1, accentColor: '#2e6db4', width: 15, height: 15, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: '#334155', lineHeight: 1.45 }}>Confirmo que conferi o documento e que ele está <strong>assinado</strong>.</span>
              </label>
            )}
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button onClick={onClose} disabled={busy} style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
          <button onClick={submit} disabled={!canSend} title={!file ? 'Escolha um arquivo' : !sigOk ? 'Confirme a assinatura' : ''}
            style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: !canSend ? '#94a3b8' : '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: !canSend ? 'default' : 'pointer', fontFamily: 'inherit' }}>{busy ? 'Enviando…' : 'Enviar'}</button>
        </div>
      </div>

      {overridePrompt && (
        <ConfirmModal
          title="Não foi possível verificar o documento"
          message="Não conseguimos ler o código de autenticação (QR) do documento enviado. Você tem certeza de que este é o documento correto e assinado?"
          detail="Se confirmar, ele será anexado e seguirá para a revisão MARCADO COMO NÃO VERIFICADO, e a operadora verá um aviso para conferir à mão. Se não, você volta para escolher o arquivo."
          okLabel="Sim, tenho certeza — anexar"
          danger
          zIndex={600}
          onOk={() => doUpload(true)}
          onCancel={() => !busy && setOverridePrompt(null)}
        />
      )}
    </div>
  )
}

/* ── Popup de visualização do contrato assinado ── */
function SignedFileModal({ url, contractId, contractLabel, onClose }) {
  const logDl = () => auditApi.logDownload({
    label: `Baixou o contrato assinado — ${contractLabel || `Contrato #${contractId}`}`,
    model_name: 'Contract', model_label: 'Contrato', object_id: contractId,
  }).catch(() => {})
  // O backend devolve URL absoluta (ex.: http://localhost:8000/media/...) que
  // quebra quando o app é acessado de outro host. Usamos só o caminho relativo,
  // servido pela própria origem do app (proxy /media em dev, nginx em prod).
  let rel = url
  try { const u = new URL(url, window.location.origin); rel = u.pathname + u.search } catch { /* já é relativo */ }
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 920, height: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.32)' }}>
        <div style={{ padding: '13px 16px 13px 18px', background: '#fff', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#eff6ff', color: '#2e6db4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Ic n="docs" s={18} /></div>
            <div>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Contrato assinado</p>
              <p style={{ margin: 0, fontSize: 11.5, color: '#94a3b8' }}>Documento enviado pelo cliente</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <a href={rel} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Abrir em nova aba</a>
            <a href={rel} download onClick={logDl} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 8, background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'none', fontFamily: 'inherit' }}>Baixar</a>
            <button onClick={onClose} title="Fechar" style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#1e293b'; e.currentTarget.style.color = '#1e293b' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#94a3b8' }}><Ic n="x" s={15} /></button>
          </div>
        </div>
        <SignedFileViewer url={rel} />
      </div>
    </div>
  )
}

/* ── Status de cada signatário (Autentique) ──
 * Rotula cada signatário pelo e-mail: casa com o do cliente (pagador) ou o da
 * agência para mostrar o nome; senão, mostra o próprio e-mail (ou "Signatário N"
 * quando a entrega é por WhatsApp/telefone e não há e-mail). */
function contractSignersStatus(c) {
  const signers = c?.autentique_data?.signers || []
  const payerEmail  = (c?.payer_email || '').trim().toLowerCase()
  const agencyEmail = (c?.agency_data?.email || '').trim().toLowerCase()
  return signers.map((s, i) => {
    const email = (s.email || '').trim()
    const lc = email.toLowerCase()
    let name = email || `Signatário ${i + 1}`
    let role = ''
    if (lc && lc === payerEmail)        { role = 'Cliente'; if (c.payer_name)        name = c.payer_name }
    else if (lc && lc === agencyEmail)  { role = 'Agência'; if (c.agency_data?.name) name = c.agency_data.name }
    const status = s.rejected ? 'rejected' : s.signed ? 'signed' : s.viewed ? 'viewed' : 'waiting'
    return { name, role, email, status }
  })
}

const SIGNER_STATUS = {
  signed:   { txt: 'Assinou',                 bg: '#dcfce7', fg: '#15803d', ic: 'check' },
  viewed:   { txt: 'Visualizou, não assinou', bg: '#fef3c7', fg: '#b45309', ic: 'eye'   },
  waiting:  { txt: 'Aguardando',              bg: '#f1f5f9', fg: '#64748b', ic: 'clock' },
  rejected: { txt: 'Recusou',                 bg: '#fee2e2', fg: '#dc2626', ic: 'x'     },
}

/* ── Popup "quem assinou / quem falta" — aberto ao verificar uma assinatura que
 * ainda não está completa. ── */
function SignersStatusModal({ data, contractLabel, onClose }) {
  const signers = contractSignersStatus(data)
  const signedCount = signers.filter(s => s.status === 'signed').length
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, boxShadow: '0 24px 64px rgba(0,0,0,.26)', overflow: 'hidden' }}>
        <div style={{ padding: '15px 18px', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fff7ed', color: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Ic n="users" s={18} /></div>
            <div>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Aguardando assinaturas</p>
              <p style={{ margin: 0, fontSize: 11.5, color: '#94a3b8' }}>{contractLabel} · {signedCount} de {signers.length} assinaram</p>
            </div>
          </div>
          <button onClick={onClose} title="Fechar" style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', cursor: 'pointer' }}><Ic n="x" s={15} /></button>
        </div>
        <div style={{ padding: '12px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {signers.length === 0 ? (
            <p style={{ margin: '8px 0', fontSize: 13, color: '#64748b', textAlign: 'center' }}>Nenhum signatário encontrado na Autentique.</p>
          ) : signers.map((s, i) => {
            const st = SIGNER_STATUS[s.status]
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', border: '1px solid #eef2f7', borderRadius: 9, background: '#fff' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.role && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#7c3aed', background: '#f3e8ff', padding: '1px 7px', borderRadius: 10, marginRight: 6 }}>{s.role}</span>}
                    {s.name}
                  </div>
                  {s.email && s.email !== s.name && <div style={{ fontSize: 11.5, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.email}</div>}
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: st.fg, background: st.bg, padding: '4px 9px', borderRadius: 20, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  <Ic n={st.ic} s={12} />{st.txt}
                </span>
              </div>
            )
          })}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #eef2f7', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Entendi</button>
        </div>
      </div>
    </div>
  )
}

export default function Contracts() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const perms    = user?.permissions ?? {}
  const canEdit   = !!user?.is_superuser || perms.contracts_edit
  const canDelete = !!user?.is_superuser || perms.contracts_delete
  const canReview = !!user?.is_superuser || perms.contracts_review
  const canInvoiceView = !!user?.is_superuser || perms.contracts_invoice_view
  const canInvoice = !!user?.is_superuser || perms.contracts_invoice
  // Usuário de agência acompanha o contrato até o fim (Em faturamento / Faturado),
  // mas só VÊ o estado — não fatura (o botão Faturar exige contracts_invoice, que
  // ele não tem, e o backend também bloqueia as ações de avanço de etapa).
  const isAgencyUser = !!user?.is_agency_user
  const canViewLog = !!user?.is_superuser || perms.contracts_view_logs
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [delRow,  setDelRow]  = useState(null)
  const [bulkDel, setBulkDel] = useState(null)   // { rows, after } — confirmação de exclusão em massa
  const [draftSel, setDraftSel] = useState(new Set())   // ids de rascunhos selecionados no popup
  const [reopenRow, setReopenRow] = useState(null)   // contrato a voltar p/ edição (confirma antes)
  const [modal,   setModal]   = useState(null)   // null | 'new' | contractId
  const [viewId,  setViewId]  = useState(null)   // id do contrato em visualização
  const [fPayer, setFPayer] = useState('')
  const [fTraveler, setFTraveler] = useState('')
  const [fAgency, setFAgency] = useState('')
  const [fValue, setFValue] = useState('')
  const [fSignature, setFSignature] = useState('')
  const [fDateFrom, setFDateFrom] = useState('')
  const [fDateTo, setFDateTo] = useState('')
  const [fSort, setFSort] = useState('recent')   // ordem da aba Geral: recent (mais recentes) | old (mais antigos)
  const [tab, setTab] = useState('geral')   // geral | em_edicao | enviado | assinado | trash
  const [sendingIds, setSendingIds] = useState(() => new Set())   // contratos sendo enviados p/ assinatura (desabilita o botão)
  const sendingRef = useRef(new Set())   // guarda contra clique duplo (sem depender do re-render)
  const [checkingIds, setCheckingIds] = useState(() => new Set())   // contratos com verificação de assinatura em andamento
  const checkingRef = useRef(new Set())
  const [signersModal, setSignersModal] = useState(null)   // { data, label } — popup de quem assinou / falta
  const [deletedRows, setDeletedRows] = useState([])
  const [draftRows, setDraftRows] = useState([])   // rascunhos (autosave) — fora da lista normal
  const [showDrafts, setShowDrafts] = useState(false)   // popup de rascunhos (botão ao lado de Adicionar)
  const [downloadingId, setDownloadingId] = useState(null)
  const [uploadRow, setUploadRow] = useState(null)   // contrato p/ anexar assinado (abre popup)
  const [reviewId, setReviewId] = useState(null)     // id do contrato em revisão (abre popup)
  const [invoiceId, setInvoiceId] = useState(null)   // id do contrato p/ faturar (abre popup)
  const [sendRow, setSendRow] = useState(null)       // contrato p/ confirmar envio à assinatura
  const [signRow, setSignRow] = useState(null)       // contrato p/ o popup de assinatura (enviado)
  const [signedUrl, setSignedUrl] = useState(null)   // url do assinado em visualização
  const [previewId, setPreviewId] = useState(null)   // contrato p/ pré-visualizar o PDF gerado

  const load = () => {
    setLoading(true)
    contractsApi.list()
      .then(r => setRows(r.data.results ?? r.data))
      .catch(() => toast.error('Erro ao carregar contratos.'))
      .finally(() => setLoading(false))
  }
  const loadDeleted = useCallback(() => {
    if (!canDelete) return
    contractsApi.deleted().then(r => setDeletedRows(r.data.results ?? r.data)).catch(() => {})
  }, [canDelete])
  const loadDrafts = useCallback(() => {
    if (!canEdit) return
    contractsApi.list({ status: 'rascunho' }).then(r => setDraftRows(r.data.results ?? r.data)).catch(() => {})
  }, [canEdit])
  useEffect(() => { load() }, [])
  useEffect(() => { loadDeleted() }, [loadDeleted, tab])
  useEffect(() => { loadDrafts() }, [loadDrafts, tab])
  const deletedCount = deletedRows.length
  const canPurge = !!user?.is_superuser && !!user?.allow_hard_delete
  const reloadAll = () => { load(); loadDeleted(); loadDrafts() }

  const silentReload = useCallback(() => {
    contractsApi.list().then(r => setRows(r.data.results ?? r.data)).catch(() => {})
  }, [])

  const wsUrl = user ? dashboardWsUrl() : null
  useWebSocket(wsUrl, useCallback(({ scope }) => {
    if (scope === 'contracts' || scope === 'all') silentReload()
  }, [silentReload]))

  const handleDelete = async () => {
    await contractsApi.remove(delRow.id).catch(() => toast.error('Erro ao excluir.'))
    toast.success('Contrato excluído.')
    setDelRow(null)
    reloadAll()
  }

  const handleBulkDelete = async () => {
    const { rows, after, purge } = bulkDel
    const call = purge ? contractsApi.purge : contractsApi.remove
    const results = await Promise.allSettled(rows.map(r => call(r.id)))
    const failed = results.filter(x => x.status === 'rejected').length
    const ok = rows.length - failed
    if (ok) toast.success(purge ? `${ok} contrato(s) excluído(s) permanentemente.` : `${ok} contrato(s) excluído(s).`)
    if (failed) toast.error(`${failed} não puderam ser excluídos.`)
    setBulkDel(null)
    after?.()
    reloadAll()
  }

  const handleDownloadPdf = async (row) => {
    setDownloadingId(row.id)
    try {
      const r = await contractsApi.get(row.id)
      await generateContractPDF(r.data)
      auditApi.logDownload({
        label: `Baixou o PDF do ${getLabel(row)}`,
        model_name: 'Contract', model_label: 'Contrato', object_id: row.id,
      }).catch(() => {})
    } catch {
      toast.error('Erro ao gerar o PDF do contrato.')
    } finally {
      setDownloadingId(null)
    }
  }

  // Baixar/ver: "assinado" → arquivo assinado anexado; senão → pré-visualiza o PDF
  // gerado num popup (com opção de baixar lá dentro).
  const handleDocs = (row) => {
    if (['assinado', 'revisao', 'aprovado'].includes(row.stage) && row.signed_file) { setSignedUrl({ url: row.signed_file, id: row.id, label: getLabel(row) }); return }
    setPreviewId(row.id)
  }

  // Envia para assinatura. Digital: gera o PDF do contrato no front e manda junto
  // (a Autentique precisa do arquivo) — daí a assinatura corre pela Autentique.
  // Física: só muda a etapa. `knownType` evita um GET extra quando já sabemos.
  const sendForSignatureFlow = async (id, knownType) => {
    let type = knownType, data = null
    if (type !== 'fisica') {
      const r = await contractsApi.get(id); data = r.data; type = data.signature_type
    }
    if (type === 'digital') {
      const blob = await generateContractPDF(data, { output: 'blob' })
      const file = new File([blob], `contrato_${data.reservation_number || id}.pdf`, { type: 'application/pdf' })
      const r = await contractsApi.sendForSignatureDigital(id, file)
      return r.data
    }
    const r = await contractsApi.sendForSignature(id)
    return r.data
  }

  // Mensagem de progresso enquanto o documento é gerado e enviado à Autentique
  // (digital) — o envio demora alguns segundos e o usuário precisa ver que o
  // clique funcionou. `type === 'fisica'` é instantâneo, mas o aviso não atrapalha.
  const sendingMessage = (type) => type === 'digital'
    ? 'Gerando e enviando o documento para assinatura...'
    : 'Enviando contrato para assinatura...'

  // Marca/desmarca um contrato como "em envio" (estado p/ desabilitar o botão +
  // ref p/ barrar reentrância no mesmo tick antes do re-render).
  const markSending = (id, on) => {
    if (on) sendingRef.current.add(id); else sendingRef.current.delete(id)
    setSendingIds(prev => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n })
  }

  const handlePublish = async (id) => {
    if (sendingRef.current.has(id)) return
    markSending(id, true)
    const toastId = toast.loading(sendingMessage())
    try {
      const c = await sendForSignatureFlow(id)
      toast.success(c?.signature_type === 'digital'
        ? 'Enviado para assinatura digital (Autentique).'
        : 'Contrato enviado para assinatura.', { id: toastId })
      setModal(null)
      setTab('enviado')
      load()
    } catch (e) { toast.error(e?.response?.data?.error || 'Erro ao enviar para assinatura.', { id: toastId }) }
    finally { markSending(id, false) }
  }

  // Enviar para assinatura → confirma no popup (com escolha física/digital) e envia.
  const confirmSend = async (type) => {
    const row = sendRow
    if (!row || sendingRef.current.has(row.id)) return
    markSending(row.id, true)
    const toastId = toast.loading(sendingMessage(type))
    try {
      // Ajusta a forma de assinatura escolhida no popup, se mudou.
      if (type !== row.signature_type) await contractsApi.patch(row.id, { signature_type: type })
      await sendForSignatureFlow(row.id, type)
      toast.success(type === 'digital'
        ? 'Enviado para assinatura digital (Autentique).'
        : 'Contrato enviado para assinatura.', { id: toastId })
      setSendRow(null)
      setTab('enviado')   // segue o contrato para a aba de destino
      load()
    } catch (e) { toast.error(e?.response?.data?.error || 'Erro ao enviar para assinatura.', { id: toastId }) }
    finally { markSending(row.id, false) }
  }

  const markChecking = (id, on) => {
    if (on) checkingRef.current.add(id); else checkingRef.current.delete(id)
    setCheckingIds(prev => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n })
  }

  // Verifica na Autentique se o contrato digital já foi assinado por todos. Mostra
  // a barra de progresso (como no envio) enquanto consulta; se ainda faltar alguém,
  // abre um popup dizendo quem já assinou e quem está pendente.
  const handleCheckSignature = async (row) => {
    if (checkingRef.current.has(row.id)) return
    markChecking(row.id, true)
    const toastId = toast.loading('Verificando assinatura...')
    try {
      const r = await contractsApi.checkSignature(row.id)
      if (r.data?.stage === 'revisao') {
        toast.success('Contrato assinado! Movido para "Em revisão".', { id: toastId })
        setTab('revisao')
      } else {
        toast.info('Ainda faltam assinaturas.', { id: toastId })
        setSignersModal({ data: r.data, label: getLabel(row) })
      }
      load()
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Erro ao verificar a assinatura.', { id: toastId })
    } finally { markChecking(row.id, false) }
  }

  const handleReopen = async () => {
    if (!reopenRow) return
    const wasDigital = reopenRow.signature_type === 'digital' && !!reopenRow.autentique_document_id
    try {
      await contractsApi.reopen(reopenRow.id)
      toast.success(wasDigital
        ? 'Contrato voltou para edição. Assinatura na Autentique cancelada.'
        : 'Contrato voltou para edição.')
      setReopenRow(null)
      setTab('em_edicao')   // segue o contrato de volta para a aba de edição
      load()
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Erro ao voltar o contrato para edição.')
    }
  }

  // O upload (e o fluxo de confirmação quando o QR não pôde ser lido) fica dentro
  // do SignedUploadModal; aqui só navegamos após o sucesso.
  const handleUploaded = () => {
    setUploadRow(null)
    setTab('revisao')   // assinado → segue para a revisão da operadora
    load()
  }

  // Aba Excluídos usa a MESMA tabela/filtros — só muda a fonte (itens excluídos).
  // Aba Geral mostra TODOS os contratos, ordenados por data de criação — mais
  // recentes primeiro por padrão; o filtro "Ordenar" inverte para mais antigos.
  const stageRows = tab === 'trash'
    ? deletedRows
    : tab === 'rascunho'
    ? draftRows
    : tab === 'geral'
    // "Geral" mostra tudo MENOS os já finalizados (faturados/prontos) — esses
    // vivem só na aba "Faturados".
    ? rows.filter(r => r.stage !== 'faturado').sort((a, b) => {
        const av = a.created_at || '', bv = b.created_at || ''
        const cmp = av !== bv ? (av < bv ? -1 : 1) : (a.id || 0) - (b.id || 0)
        return fSort === 'recent' ? -cmp : cmp
      })
    : rows.filter(r => r.stage === tab)
  const filterSource = tab === 'trash' ? deletedRows : tab === 'rascunho' ? draftRows : rows
  const stageCount = (s) => rows.filter(r => r.stage === s).length

  const namesOpts = (values, allLabel) => [
    { value: '', label: allLabel },
    ...[...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)).map(n => ({ value: n, label: n })),
  ]
  const agencyOpts   = useMemo(() => namesOpts(filterSource.map(r => r.agency_name), 'Todas'), [filterSource])
  const payerOpts    = useMemo(() => namesOpts(filterSource.map(r => r.contratante_name), 'Todos'), [filterSource])
  const travelerOpts = useMemo(() => namesOpts(filterSource.flatMap(r => r.guest_names || []), 'Todos'), [filterSource])

  const filtered = stageRows.filter(r => {
    if (fPayer && r.contratante_name !== fPayer) return false
    if (fTraveler && !(r.guest_names || []).includes(fTraveler)) return false
    if (fAgency && r.agency_name !== fAgency) return false
    if (!valueInRange(r.total_brl, fValue)) return false
    if (fSignature && r.signature_type !== fSignature) return false
    if (fDateFrom && (!r.contract_date || r.contract_date < fDateFrom)) return false
    if (fDateTo && (!r.contract_date || r.contract_date > fDateTo)) return false
    return true
  })

  const activeFilters = [fPayer, fTraveler, fAgency, fValue, fSignature, !!fDateFrom, !!fDateTo].filter(Boolean).length
  const clearFilters = () => { setFPayer(''); setFTraveler(''); setFAgency(''); setFValue(''); setFSignature(''); setFDateFrom(''); setFDateTo('') }

  // Coluna de data muda conforme a aba: criado / enviado / assinado / excluído.
  const cols = useMemo(() => {
    // Em todas as abas, a coluna de data mostra o tempo relativo acima (via dateCell).
    const dateCol = tab === 'enviado'
      ? { key: 'sent_at',   label: 'Enviado em',  align: 'center', render: (v) => dateCell(v ? fmtDateTimeBR(v) : null, v) }
      : tab === 'revisao'
      ? { key: 'signed_at', label: 'Assinado em', align: 'center', render: (v) => dateCell(v ? fmtDateTimeBR(v) : null, v) }
      : tab === 'a_faturar'
      ? { key: 'reviewed_at', label: 'Aprovado em', align: 'center', render: (v) => dateCell(v ? fmtDateTimeBR(v) : null, v) }
      : tab === 'faturado'
      ? { key: 'invoiced_at', label: 'Faturado em', align: 'center', render: (v) => dateCell(v ? fmtDateTimeBR(v) : null, v) }
      : tab === 'trash'
      ? { key: 'deleted_at', label: 'Excluído em', align: 'center', render: (v) => dateCell(v ? fmtDateTimeBR(v) : null, v) }
      // "Criado em": a data é a do contrato, mas o relativo vem de created_at (timestamp real).
      : { key: 'contract_date', label: 'Criado em', align: 'center', render: (v, row) => dateCell(v ? fmtDateBR(v) : null, row.created_at) }
    return [
      { key: 'reservation_number', label: 'Reserva', align: 'center', render: (v, row) => (
        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <span>{v || DASH}</span>
          {isReproved(row) && <ReprovedBadge note={row.review_note} />}
        </div>
      ) },
      { key: 'contratante_name',   label: 'Pagante',     align: 'center' },
      // Na visão da agência não faz sentido a coluna "Agência" (é sempre a dele).
      ...(isAgencyUser ? [] : [{ key: 'agency_name', label: 'Agência', align: 'center' }]),
      { key: 'package_name',       label: 'Viagem',      align: 'center', render: (v) => v || DASH },
      { key: 'departure_date',     label: 'Data viagem', align: 'center', render: (v) => v ? fmtDateBR(v) : DASH },
      { key: 'total_brl',          label: 'Total (BRL)', align: 'center', render: (v) => v ? fmtBRL(v) : DASH },
      { key: 'signature_type',     label: 'Assinatura',  align: 'center', render: (v) => <SignatureBadge type={v} /> },
      // Nº da fatura só na aba Faturados.
      ...(tab === 'faturado' ? [{ key: 'invoice_number', label: 'Nº fatura', align: 'center', render: (v, row) => (
        <span>{v || DASH}{row.invoice_date ? <span style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}>{fmtDateBR(row.invoice_date)}</span> : null}</span>
      ) }] : []),
      // Coluna de status só na aba Geral (nas demais a aba já define a etapa).
      ...(tab === 'geral' ? [{ key: 'stage', label: 'Status', align: 'center', render: (v, row) => isReproved(row) ? <ReprovedBadge note={row.review_note} /> : <StageBadge stage={v} /> }] : []),
      dateCol,
    ]
  }, [tab, isAgencyUser])

  const filterBar = (
    <>
      {tab === 'geral' && (
        <FDrop label="Ordenar" value={fSort} onChange={setFSort} icon="list"
          options={[{ value: 'recent', label: 'Mais recentes' }, { value: 'old', label: 'Mais antigos' }]} />
      )}
      <FDrop label="Pagante"  value={fPayer}    onChange={setFPayer}    options={payerOpts}    icon="users"    avatar searchPlaceholder="Buscar pagante…" />
      <FDrop label="Viajante" value={fTraveler} onChange={setFTraveler} options={travelerOpts}  icon="users"    avatar searchPlaceholder="Buscar viajante…" />
      {!isAgencyUser && (
        <FDrop label="Agência"  value={fAgency}   onChange={setFAgency}   options={agencyOpts}    icon="building" avatar searchPlaceholder="Buscar agência…" />
      )}
      <FDrop label="Valor"    value={fValue}    onChange={setFValue}    options={VALUE_OPTS}    icon="card" />
      <FDrop label="Assinatura" value={fSignature} onChange={setFSignature} icon="edit"
        options={[{ value: '', label: 'Qualquer assinatura' }, { value: 'fisica', label: 'Física' }, { value: 'digital', label: 'Digital' }]} />
      <DateRangeDrop label="Período" from={fDateFrom} to={fDateTo} onFrom={setFDateFrom} onTo={setFDateTo} />
      {activeFilters > 0 && (
        <button onClick={clearFilters} title="Limpar todos os filtros"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#fca5a5'; e.currentTarget.style.color = '#dc2626' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#64748b' }}>
          <Ic n="x" s={13} /> Limpar filtros
          <span style={{ fontSize: 11, fontWeight: 700, padding: '0 6px', borderRadius: 10, background: '#eff6ff', color: '#2e6db4' }}>{activeFilters}</span>
        </button>
      )}
      {activeFilters > 0 && (
        <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>{filtered.length}/{stageRows.length}</span>
      )}
    </>
  )

  const TABS = [
    { key: 'geral',     label: 'Geral',            color: '#1a2d4f', count: rows.filter(r => r.stage !== 'faturado').length },
    { key: 'em_edicao', label: 'Em edição',       color: '#2563eb', count: stageCount('em_edicao') },
    { key: 'enviado',   label: 'Para assinatura',  color: '#d97706', count: stageCount('enviado') },
    { key: 'revisao',   label: 'Em revisão',       color: '#7c3aed', count: stageCount('revisao') },
    ...((canInvoiceView || isAgencyUser) ? [
      { key: 'a_faturar', label: 'Em faturamento',  color: '#ca8a04', count: stageCount('a_faturar') },
      { key: 'faturado',  label: 'Faturados',       color: '#059669', count: stageCount('faturado') },
    ] : []),
    ...(canDelete ? [{ key: 'trash', label: 'Excluídos', color: '#dc2626', count: deletedCount }] : []),
  ]
  const tabBar = (
    <div style={{ display: 'flex', gap: 0, borderBottom: '1.5px solid #e2e8f0', marginBottom: 4, flexWrap: 'wrap' }}>
      {TABS.map(t => {
        const sel = tab === t.key
        return (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', background: 'transparent', fontSize: 13.5, fontWeight: sel ? 600 : 400,
              color: sel ? t.color : '#94a3b8', borderBottom: sel ? `2px solid ${t.color}` : '2px solid transparent',
              marginBottom: '-1.5px', transition: 'color .15s, border-color .15s', outline: 'none',
            }}>
            {t.label}
            <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 20, background: sel ? `${t.color}1a` : '#f1f5f9', color: sel ? t.color : '#94a3b8' }}>
              {t.count}
            </span>
          </button>
        )
      })}
    </div>
  )

  const actBtn = (title, icon, color, onClick, disabled = false) => (
    <button type="button" title={title} onClick={onClick} disabled={disabled}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: `1px solid ${color}33`, background: `${color}14`, color, cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.5 : 1, flexShrink: 0 }}>
      <Ic n={disabled ? 'clock' : icon} s={13} />
    </button>
  )

  const getLabel = (row) => row.reservation_number ? `Contrato ${row.reservation_number}` : `Contrato #${row.id}`

  // Assinatura digital: o PDF só pode ser BAIXADO depois de assinado. Antes
  // disso (em edição / aguardando assinatura) ele é apenas visto online.
  const canDownloadPdf = (c) => !c || c.signature_type !== 'digital' || ['assinado', 'revisao', 'aprovado'].includes(c.stage)

  // Botão "Rascunhos" ao lado de Adicionar — abre um popup com os rascunhos
  // (autosave) pra retomar de onde parou. Só aparece quando há rascunhos.
  const draftsBtn = (canEdit && draftRows.length > 0) ? (
    <button type="button" onClick={() => setShowDrafts(true)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 7, border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#6d28d9', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
      <Ic n="edit" s={14} /> Rascunhos
      <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: '#ede9fe', color: '#7c3aed' }}>{draftRows.length}</span>
    </button>
  ) : null

  return (
    <>
      {tabBar}
      <DataTable
        title={TABS.find(t => t.key === tab)?.label || 'Contratos'}
        addLabel="Adicionar Contrato"
        data={filtered}
        cols={cols}
        searchKeys={['reservation_number', 'contratante_name', 'agency_name', 'package_name']}
        extraFilters={filterBar}
        onLog={canViewLog ? () => navigate('/log?scope=contracts') : undefined}
        headerExtra={draftsBtn}
        bulkBar={(tab === 'trash' ? canPurge : canDelete) ? (selRows, { clearSelection }) => selRows.length >= 2 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#b91c1c', flex: 1 }}>{selRows.length} selecionados</span>
            <button type="button" onClick={() => setBulkDel({ rows: selRows, after: clearSelection, purge: tab === 'trash' })}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 7, border: 'none', background: '#dc2626', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Ic n="trash" s={12} /> {tab === 'trash' ? 'Excluir permanentemente' : 'Excluir selecionados'}
            </button>
            <button type="button" onClick={clearSelection}
              style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancelar
            </button>
          </div>
        ) : undefined}
        onAdd={canEdit && (tab === 'em_edicao' || tab === 'geral') ? () => setModal('new') : undefined}
        onDocs={tab === 'trash' ? undefined : handleDocs}
        showDocs={(row) =>
          // Enviado, Em revisão e Em faturamento não têm ícone de PDF na linha (via popup/olhinho).
          ['assinado', 'aprovado', 'faturado'].includes(row.stage) ? !!row.signed_file
          : false}
        docsTitle={['assinado', 'revisao', 'aprovado', 'a_faturar', 'faturado'].includes(tab) ? 'Ver contrato assinado'
          : 'Ver contrato'}
        extraActions={
          tab === 'trash'
            ? (row) => <TrashRowActions row={row} getLabel={getLabel} onRestore={contractsApi.restore} onPurge={contractsApi.purge} canPurge={canPurge} onChanged={reloadAll} />
            : tab === 'rascunho'
            ? (row) => actBtn('Continuar editando', 'edit', '#7c3aed', () => setModal(row.id))
            : (row) => {
              // Na aba Geral cada linha segue a SUA própria etapa; nas demais, a aba.
              const stage = tab === 'geral' ? row.stage : tab
              // "Para assinatura": só 3 ações — Assinatura (popup), Visão geral, Excluir.
              if (stage === 'enviado' && canEdit) {
                return (
                  <>
                    {actBtn('Assinatura', 'arrow-right', '#16a34a', () => setSignRow(row))}
                    {actBtn('Visão geral', 'eye', '#475569', () => setViewId(row.id))}
                  </>
                )
              }
              // "Em revisão": só 3 ações — Revisar (check), Visão geral, Excluir.
              if (stage === 'revisao' && canReview) {
                return (
                  <>
                    {actBtn('Revisar contrato', 'check', '#7c3aed', () => setReviewId(row.id))}
                    {actBtn('Visão geral', 'eye', '#475569', () => setViewId(row.id))}
                  </>
                )
              }
              // "Em faturamento": só 3 ações — Faturar (cartão), Visão geral, Excluir.
              if (stage === 'a_faturar' && canInvoice) {
                return (
                  <>
                    {actBtn('Faturar', 'card', '#ca8a04', () => setInvoiceId(row.id))}
                    {actBtn('Visão geral', 'eye', '#475569', () => setViewId(row.id))}
                  </>
                )
              }
              const editable = canEdit && stage === 'em_edicao'
              // Ícone primário: editável → lápis (entra na edição); senão → olho.
              const primary = editable
                ? actBtn('Editar contrato', 'edit', '#1a2d4f', () => setModal(row.id))
                : actBtn('Visão geral', 'eye', '#475569', () => setViewId(row.id))
              // Ação específica da etapa.
              let stageAction = null
              if (canEdit && stage === 'em_edicao') stageAction = actBtn(sendingIds.has(row.id) ? 'Enviando...' : 'Enviar para assinatura', 'arrow-right', '#16a34a', () => setSendRow(row), sendingIds.has(row.id))
              return <>{primary}{stageAction}</>
            }}
        onDelete={tab !== 'trash' && canDelete ? (row) => setDelRow(row) : undefined}
        loading={loading}
      />

      {uploadRow && (
        <SignedUploadModal contractId={uploadRow.id} onClose={() => setUploadRow(null)} onUploaded={handleUploaded} />
      )}
      {signedUrl && (
        <SignedFileModal url={signedUrl.url} contractId={signedUrl.id} contractLabel={signedUrl.label} onClose={() => setSignedUrl(null)} />
      )}
      {signersModal && (
        <SignersStatusModal data={signersModal.data} contractLabel={signersModal.label} onClose={() => setSignersModal(null)} />
      )}
      {previewId && (
        <ContractPdfPreviewModal contractId={previewId} allowDownload={canDownloadPdf(rows.find(r => r.id === previewId))} onClose={() => setPreviewId(null)} />
      )}
      {reviewId && (
        <ContractReviewModal contractId={reviewId} onClose={() => setReviewId(null)} onDone={reloadAll} />
      )}
      {invoiceId && (
        <ContractInvoiceModal contractId={invoiceId} onClose={() => setInvoiceId(null)} onDone={reloadAll} />
      )}
      {sendRow && (
        <SendSignatureModal
          contract={sendRow}
          sending={sendingIds.has(sendRow.id)}
          onConfirm={confirmSend}
          onClose={() => { if (!sendingIds.has(sendRow.id)) setSendRow(null) }}
        />
      )}
      {signRow && (
        <ContractSignatureModal
          contract={signRow}
          onDone={(nextTab) => { setSignRow(null); if (nextTab) setTab(nextTab); reloadAll() }}
          onClose={() => setSignRow(null)}
        />
      )}
      {viewId && (
        <ContractViewModal
          contractId={viewId}
          canEdit={canEdit && !['enviado', 'revisao', 'a_faturar', 'faturado'].includes((rows.find(r => r.id === viewId) || {}).stage)}
          onClose={() => setViewId(null)}
          onEdit={() => { const id = viewId; setViewId(null); setModal(id) }}
          onReopen={canEdit ? () => { const row = rows.find(r => r.id === viewId); setViewId(null); if (row) setReopenRow(row) } : undefined}
          onViewLog={canViewLog ? () => navigate(`/log?contract_id=${viewId}`) : undefined}
        />
      )}
      {showDrafts && (() => {
        const closeDrafts = () => { setShowDrafts(false); setDraftSel(new Set()) }
        const allSel = draftRows.length > 0 && draftRows.every(d => draftSel.has(d.id))
        const togAll = () => setDraftSel(allSel ? new Set() : new Set(draftRows.map(d => d.id)))
        const tog1 = (id) => setDraftSel(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
        const selCount = draftSel.size
        return (
        <div className="overlay" onClick={closeDrafts} style={{ zIndex: 550 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 580, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.24)' }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Ic n="edit" s={15} /> Rascunhos
                <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 20, background: '#ede9fe', color: '#7c3aed' }}>{draftRows.length}</span>
              </span>
              <button type="button" onClick={closeDrafts}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4, display: 'flex' }}>
                <Ic n="x" s={16} />
              </button>
            </div>
            {/* Barra de seleção: selecionar todos + excluir selecionados */}
            {canDelete && draftRows.length > 0 && (
              <div style={{ padding: '8px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#475569', cursor: 'pointer', fontWeight: 500 }}>
                  <input type="checkbox" checked={allSel} onChange={togAll}
                    style={{ width: 15, height: 15, accentColor: '#7c3aed', cursor: 'pointer' }} />
                  Selecionar todos
                </label>
                <span style={{ flex: 1 }} />
                {selCount > 0 && (
                  <button type="button"
                    onClick={() => { const rows = draftRows.filter(d => draftSel.has(d.id)); setShowDrafts(false); setBulkDel({ rows, after: () => setDraftSel(new Set()) }) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 7, border: 'none', background: '#dc2626', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    <Ic n="trash" s={12} /> Excluir selecionados ({selCount})
                  </button>
                )}
              </div>
            )}
            <div style={{ padding: '12px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {draftRows.length === 0 ? (
                <span style={{ fontSize: 13, color: '#94a3b8', padding: '8px 0' }}>Nenhum rascunho no momento.</span>
              ) : draftRows.map(d => (
                <div key={d.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, background: draftSel.has(d.id) ? '#faf5ff' : '#fff', border: `1px solid ${draftSel.has(d.id) ? '#ddd6fe' : '#ede9fe'}`, borderRadius: 8, padding: '8px 8px 8px 12px', cursor: 'pointer' }}
                  onClick={() => { setShowDrafts(false); setDraftSel(new Set()); setModal(d.id) }}>
                  {canDelete && (
                    <input type="checkbox" checked={draftSel.has(d.id)} onClick={e => e.stopPropagation()} onChange={() => tog1(d.id)}
                      style={{ width: 15, height: 15, accentColor: '#7c3aed', cursor: 'pointer', flexShrink: 0 }} />
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[d.contratante_name, isAgencyUser ? null : d.agency_name, d.package_name].filter(Boolean).join('  ·  ') || 'Sem informações ainda'}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
                      {d.reservation_number || `#${d.id}`}{d.updated_at ? `  ·  editado ${fmtDateTimeBR(d.updated_at)}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    {actBtn('Continuar editando', 'edit', '#7c3aed', () => { setShowDrafts(false); setDraftSel(new Set()); setModal(d.id) })}
                    {canDelete && actBtn('Excluir rascunho', 'trash', '#dc2626', () => { setShowDrafts(false); setDraftSel(new Set()); setDelRow(d) })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) })()}
      {modal && (
        <ContractFormModal
          contractId={modal === 'new' ? null : modal}
          onClose={() => { setModal(null); loadDrafts() }}
          onSaved={() => { setModal(null); load(); loadDrafts() }}
          onPublish={handlePublish}
        />
      )}
      {delRow && (
        <DelModal
          name={delRow.reservation_number ? `Contrato ${delRow.reservation_number}` : `Contrato #${delRow.id}`}
          onOk={handleDelete} onCancel={() => setDelRow(null)} recoverable
        />
      )}
      {bulkDel && (
        <DelModal
          name={`${bulkDel.rows.length} contratos selecionados${bulkDel.purge ? ' (permanentemente)' : ''}`}
          onOk={handleBulkDelete} onCancel={() => setBulkDel(null)} recoverable={!bulkDel.purge}
        />
      )}
      {reopenRow && (
        <div className="overlay" onClick={() => setReopenRow(null)}>
          <div className="mbox" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="mhead">
              <span className="mtitle">Voltar para edição</span>
              <button className="mclose" onClick={() => setReopenRow(null)}><Ic n="x" s={15} /></button>
            </div>
            <div className="mbody">
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }}><Ic n="warn" s={20} /></div>
                <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.7 }}>
                  Tem certeza que deseja voltar o <strong style={{ color: '#1e293b' }}>{reopenRow.reservation_number ? `Contrato ${reopenRow.reservation_number}` : `Contrato #${reopenRow.id}`}</strong> para <strong style={{ color: '#1e293b' }}>Em edição</strong>?<br />
                  Ele sai da aba "Para assinatura" e você poderá editá-lo de novo.
                  {reopenRow.signature_type === 'digital' && reopenRow.autentique_document_id && (
                    <><br /><strong style={{ color: '#b45309' }}>O documento será cancelado na Autentique</strong> e o pedido de assinatura enviado aos signatários deixará de valer.</>
                  )}
                </p>
              </div>
            </div>
            <div className="mfoot">
              <button className="btn btn-outline" onClick={() => setReopenRow(null)}>Cancelar</button>
              <button className="btn" style={{ background: '#1a2d4f', color: '#fff', border: 'none' }} onClick={handleReopen}>Voltar para edição</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
