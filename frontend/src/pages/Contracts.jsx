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

// Etapas do contrato — rótulo e cor compartilhados entre as abas e a coluna
// "Status" da aba Geral.
const STAGE_META = {
  em_edicao: { label: 'Em edição',      color: '#2563eb' },
  enviado:   { label: 'Para assinatura', color: '#d97706' },
  assinado:  { label: 'Assinado',        color: '#059669' },
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
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 300, background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 12px 28px rgba(15,23,42,.12)', minWidth: 240, overflow: 'hidden' }}>
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
function SignedUploadModal({ contractId, onClose, onUpload }) {
  const [file, setFile] = useState(null)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sigOk, setSigOk] = useState(false)
  const [objUrl, setObjUrl] = useState(null)
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

  const submit = async () => {
    if (!file) return
    setBusy(true)
    try { await onUpload(file) } finally { setBusy(false) }
  }

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
  const canViewLog = !!user?.is_superuser || perms.contracts_view_logs
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [delRow,  setDelRow]  = useState(null)
  const [reopenRow, setReopenRow] = useState(null)   // contrato a voltar p/ edição (confirma antes)
  const [modal,   setModal]   = useState(null)   // null | 'new' | contractId
  const [viewId,  setViewId]  = useState(null)   // id do contrato em visualização
  const [fPayer, setFPayer] = useState('')
  const [fTraveler, setFTraveler] = useState('')
  const [fAgency, setFAgency] = useState('')
  const [fValue, setFValue] = useState('')
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
  const [downloadingId, setDownloadingId] = useState(null)
  const [uploadRow, setUploadRow] = useState(null)   // contrato p/ anexar assinado (abre popup)
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
  useEffect(() => { load() }, [])
  useEffect(() => { loadDeleted() }, [loadDeleted, tab])
  const deletedCount = deletedRows.length
  const canPurge = !!user?.is_superuser && !!user?.allow_hard_delete
  const reloadAll = () => { load(); loadDeleted() }

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
    if (row.stage === 'assinado' && row.signed_file) { setSignedUrl({ url: row.signed_file, id: row.id, label: getLabel(row) }); return }
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

  // Enviar para assinatura → muda a etapa E leva o usuário para a aba "Para assinatura".
  const handleSend = async (row) => {
    if (sendingRef.current.has(row.id)) return
    markSending(row.id, true)
    const toastId = toast.loading(sendingMessage(row.signature_type))
    try {
      await sendForSignatureFlow(row.id, row.signature_type)
      toast.success(row.signature_type === 'digital'
        ? 'Enviado para assinatura digital (Autentique).'
        : 'Contrato enviado para assinatura.', { id: toastId })
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
      if (r.data?.stage === 'assinado') {
        toast.success('Contrato assinado! Movido para "Assinados".', { id: toastId })
        setTab('assinado')
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

  const handleUploadFile = async (file) => {
    try {
      await contractsApi.uploadSigned(uploadRow.id, file)
      toast.success('Contrato assinado anexado.')
      setUploadRow(null)
      setTab('assinado')   // segue o contrato para "Assinados"
      load()
    } catch { toast.error('Erro ao anexar o contrato assinado.') }
  }

  // Aba Excluídos usa a MESMA tabela/filtros — só muda a fonte (itens excluídos).
  // Aba Geral mostra TODOS os contratos, ordenados por data de criação — mais
  // recentes primeiro por padrão; o filtro "Ordenar" inverte para mais antigos.
  const stageRows = tab === 'trash'
    ? deletedRows
    : tab === 'geral'
    ? [...rows].sort((a, b) => {
        const av = a.created_at || '', bv = b.created_at || ''
        const cmp = av !== bv ? (av < bv ? -1 : 1) : (a.id || 0) - (b.id || 0)
        return fSort === 'recent' ? -cmp : cmp
      })
    : rows.filter(r => r.stage === tab)
  const filterSource = tab === 'trash' ? deletedRows : rows
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
    if (fDateFrom && (!r.contract_date || r.contract_date < fDateFrom)) return false
    if (fDateTo && (!r.contract_date || r.contract_date > fDateTo)) return false
    return true
  })

  const activeFilters = [fPayer, fTraveler, fAgency, fValue, !!fDateFrom, !!fDateTo].filter(Boolean).length
  const clearFilters = () => { setFPayer(''); setFTraveler(''); setFAgency(''); setFValue(''); setFDateFrom(''); setFDateTo('') }

  // Coluna de data muda conforme a aba: criado / enviado / assinado / excluído.
  const cols = useMemo(() => {
    const dateCol = tab === 'enviado'
      ? { key: 'sent_at',   label: 'Enviado em',  align: 'center', render: (v) => v ? fmtDateTimeBR(v) : DASH }
      : tab === 'assinado'
      ? { key: 'signed_at', label: 'Assinado em', align: 'center', render: (v) => v ? fmtDateTimeBR(v) : DASH }
      : tab === 'trash'
      ? { key: 'deleted_at', label: 'Excluído em', align: 'center', render: (v) => v ? fmtDateTimeBR(v) : DASH }
      : { key: 'contract_date', label: 'Criado em', align: 'center', render: (v) => v ? fmtDateBR(v) : DASH }
    return [
      { key: 'reservation_number', label: 'Reserva',     align: 'center', render: (v) => v || DASH },
      { key: 'contratante_name',   label: 'Pagante',     align: 'center' },
      { key: 'agency_name',        label: 'Agência',     align: 'center' },
      { key: 'package_name',       label: 'Viagem',      align: 'center', render: (v) => v || DASH },
      { key: 'departure_date',     label: 'Data viagem', align: 'center', render: (v) => v ? fmtDateBR(v) : DASH },
      { key: 'total_brl',          label: 'Total (BRL)', align: 'center', render: (v) => v ? fmtBRL(v) : DASH },
      { key: 'signature_type',     label: 'Assinatura',  align: 'center', render: (v) => <SignatureBadge type={v} /> },
      // Coluna de status só na aba Geral (nas demais a aba já define a etapa).
      ...(tab === 'geral' ? [{ key: 'stage', label: 'Status', align: 'center', render: (v) => <StageBadge stage={v} /> }] : []),
      dateCol,
    ]
  }, [tab])

  const filterBar = (
    <>
      {tab === 'geral' && (
        <FDrop label="Ordenar" value={fSort} onChange={setFSort} icon="list"
          options={[{ value: 'recent', label: 'Mais recentes' }, { value: 'old', label: 'Mais antigos' }]} />
      )}
      <FDrop label="Pagante"  value={fPayer}    onChange={setFPayer}    options={payerOpts}    icon="users"    avatar searchPlaceholder="Buscar pagante…" />
      <FDrop label="Viajante" value={fTraveler} onChange={setFTraveler} options={travelerOpts}  icon="users"    avatar searchPlaceholder="Buscar viajante…" />
      <FDrop label="Agência"  value={fAgency}   onChange={setFAgency}   options={agencyOpts}    icon="building" avatar searchPlaceholder="Buscar agência…" />
      <FDrop label="Valor"    value={fValue}    onChange={setFValue}    options={VALUE_OPTS}    icon="card" />
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
    { key: 'geral',     label: 'Geral',            color: '#1a2d4f', count: rows.length },
    { key: 'em_edicao', label: 'Em edição',       color: '#2563eb', count: stageCount('em_edicao') },
    { key: 'enviado',   label: 'Para assinatura',  color: '#d97706', count: stageCount('enviado') },
    { key: 'assinado',  label: 'Assinados',        color: '#059669', count: stageCount('assinado') },
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
  const canDownloadPdf = (c) => !c || c.signature_type !== 'digital' || c.stage === 'assinado'

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
        onAdd={canEdit && (tab === 'em_edicao' || tab === 'geral') ? () => setModal('new') : undefined}
        onView={(row) => setViewId(row.id)}
        onDocs={tab === 'trash' ? undefined : handleDocs}
        showDocs={(row) =>
          // Enviado: sempre dá para ver online (física = ver/imprimir; digital = só ver).
          row.stage === 'enviado' ? true
          : row.stage === 'assinado' ? !!row.signed_file
          : false}
        docsTitle={tab === 'assinado' ? 'Ver contrato assinado'
          : 'Ver contrato'}
        extraActions={
          tab === 'trash'
            ? (row) => <TrashRowActions row={row} getLabel={getLabel} onRestore={contractsApi.restore} onPurge={contractsApi.purge} canPurge={canPurge} onChanged={reloadAll} />
            : canEdit ? (row) => {
              // Na aba Geral cada linha segue a SUA própria etapa; nas demais, a aba.
              const stage = tab === 'geral' ? row.stage : tab
              return (
                stage === 'em_edicao' ? actBtn(sendingIds.has(row.id) ? 'Enviando...' : 'Enviar para assinatura', 'mail', '#2563eb', () => handleSend(row), sendingIds.has(row.id))
                : stage === 'enviado' ? (
                  row.signature_type === 'digital' ? (
                    <>
                      {actBtn(checkingIds.has(row.id) ? 'Verificando...' : 'Verificar assinatura', 'check', '#2563eb', () => handleCheckSignature(row), checkingIds.has(row.id))}
                      {actBtn('Voltar para edição', 'rotate', '#b45309', () => setReopenRow(row))}
                    </>
                  ) : (
                    <>
                      {actBtn('Voltar para edição', 'rotate', '#b45309', () => setReopenRow(row))}
                      {actBtn('Anexar contrato assinado', 'ul', '#059669', () => setUploadRow(row))}
                    </>
                  )
                )
                : null
              )
            } : undefined}
        onDelete={tab !== 'trash' && canDelete ? (row) => setDelRow(row) : undefined}
        loading={loading}
      />

      {uploadRow && (
        <SignedUploadModal contractId={uploadRow.id} onClose={() => setUploadRow(null)} onUpload={handleUploadFile} />
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
      {viewId && (
        <ContractViewModal
          contractId={viewId}
          canEdit={canEdit}
          onClose={() => setViewId(null)}
          onEdit={() => { const id = viewId; setViewId(null); setModal(id) }}
          onViewLog={canViewLog ? () => navigate(`/log?contract_id=${viewId}`) : undefined}
        />
      )}
      {modal && (
        <ContractFormModal
          contractId={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
          onPublish={handlePublish}
        />
      )}
      {delRow && (
        <DelModal
          name={delRow.reservation_number ? `Contrato ${delRow.reservation_number}` : `Contrato #${delRow.id}`}
          onOk={handleDelete} onCancel={() => setDelRow(null)} recoverable
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
