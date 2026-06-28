import { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { contractsApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'
import TrashTab from '../components/TrashTab'
import ContractFormModal from '../components/ContractFormModal'
import ContractViewModal from '../components/ContractViewModal'
import SignedFileViewer from '../components/SignedFileViewer'
import ContractPdfPreviewModal from '../components/ContractPdfPreviewModal'
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

function FDrop({ label, value, onChange, options, active }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 6, border: `1px solid ${active ? '#2e6db4' : '#e2e8f0'}`, background: active ? '#eff6ff' : '#fff', color: active ? '#2e6db4' : '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
        {label}<span style={{ fontSize: 9, opacity: .7 }}>▼</span>
      </button>
      {open && (
        <div onMouseLeave={() => setOpen(false)}
          style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200, background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px rgba(0,0,0,.10)', minWidth: 160, overflow: 'hidden' }}>
          {options.map(opt => (
            <button key={opt.value} type="button" onClick={() => { onChange(opt.value); setOpen(false) }}
              style={{ display: 'block', width: '100%', padding: '9px 14px', background: value === opt.value ? '#eff6ff' : 'transparent', border: 'none', color: value === opt.value ? '#2e6db4' : '#1e293b', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const STATUS_OPTS = [
  { value: 'all',       label: 'Todos' },
  { value: 'ativo',     label: 'Ativo' },
  { value: 'cancelado', label: 'Cancelado' },
]

const STAGE_META = {
  em_edicao: { label: 'Em edição',       color: '#2563eb', bg: '#eff6ff' },
  enviado:   { label: 'Para assinatura', color: '#b45309', bg: '#fffbeb' },
  assinado:  { label: 'Assinado',        color: '#047857', bg: '#ecfdf5' },
}
function StageBadge({ stage }) {
  const m = STAGE_META[stage] || { label: stage || '—', color: '#64748b', bg: '#f1f5f9' }
  return <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 11px', borderRadius: 20, background: m.bg, color: m.color }}>{m.label}</span>
}

const COLS = [
  { key: 'reservation_number', label: 'Reserva',     align: 'center', render: (v) => v || <span style={{ color: '#cbd5e1' }}>—</span> },
  { key: 'contratante_name',   label: 'Contratante', align: 'center' },
  { key: 'agency_name',        label: 'Agência',     align: 'center' },
  { key: 'package_name',       label: 'Pacote',      align: 'center', render: (v) => v || <span style={{ color: '#cbd5e1' }}>—</span> },
  { key: 'departure_date',     label: 'Data viagem',  align: 'center', render: (v) => v ? fmtDateBR(v) : <span style={{ color: '#cbd5e1' }}>—</span> },
  { key: 'total_brl',          label: 'Total (BRL)',  align: 'center', render: (v) => v ? fmtBRL(v) : <span style={{ color: '#cbd5e1' }}>—</span> },
  { key: 'stage',              label: 'Etapa',        align: 'center', render: (v, row) => <StageBadge stage={row.stage} /> },
]

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
function SignedFileModal({ url, onClose }) {
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
            <a href={rel} download style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 8, background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'none', fontFamily: 'inherit' }}>Baixar</a>
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

export default function Contracts() {
  const { user } = useAuth()
  const perms    = user?.permissions ?? {}
  const canEdit   = !!user?.is_superuser || perms.contracts_edit
  const canDelete = !!user?.is_superuser || perms.contracts_delete
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [delRow,  setDelRow]  = useState(null)
  const [modal,   setModal]   = useState(null)   // null | 'new' | contractId
  const [viewId,  setViewId]  = useState(null)   // id do contrato em visualização
  const [statusF, setStatusF] = useState('all')
  const [tab, setTab] = useState('em_edicao')   // em_edicao | enviado | assinado | trash
  const [deletedCount, setDeletedCount] = useState(0)
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
  useEffect(() => { load() }, [])

  useEffect(() => {
    if (canDelete) {
      contractsApi.deleted().then(r => setDeletedCount((r.data.results ?? r.data).length)).catch(() => {})
    }
  }, [canDelete, tab])

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
    load()
    setDeletedCount(c => c + 1)
  }

  const handleDownloadPdf = async (row) => {
    setDownloadingId(row.id)
    try {
      const r = await contractsApi.get(row.id)
      await generateContractPDF(r.data)
    } catch {
      toast.error('Erro ao gerar o PDF do contrato.')
    } finally {
      setDownloadingId(null)
    }
  }

  // Baixar/ver: "assinado" → arquivo assinado anexado; senão → pré-visualiza o PDF
  // gerado num popup (com opção de baixar lá dentro).
  const handleDocs = (row) => {
    if (row.stage === 'assinado' && row.signed_file) { setSignedUrl(row.signed_file); return }
    setPreviewId(row.id)
  }

  const handlePublish = async (id) => {
    try {
      await contractsApi.sendForSignature(id)
      toast.success('Contrato enviado para assinatura.')
      setModal(null)
      setTab('enviado')
      load()
    } catch { toast.error('Erro ao enviar para assinatura.') }
  }

  // Enviar para assinatura → muda a etapa E leva o usuário para a aba "Para assinatura".
  const handleSend = async (row) => {
    try {
      await contractsApi.sendForSignature(row.id)
      toast.success('Contrato enviado para assinatura.')
      setTab('enviado')   // segue o contrato para a aba de destino
      load()
    } catch { toast.error('Erro ao enviar para assinatura.') }
  }

  const handleReopen = async (row) => {
    try {
      await contractsApi.reopen(row.id)
      toast.success('Contrato voltou para edição.')
      setTab('em_edicao')   // segue o contrato de volta para a aba de edição
      load()
    } catch { toast.error('Erro ao voltar o contrato para edição.') }
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

  const stageRows = tab === 'trash' ? [] : rows.filter(r => r.stage === tab)
  const filtered  = statusF === 'all' ? stageRows : stageRows.filter(r => r.status === statusF)
  const stageCount = (s) => rows.filter(r => r.stage === s).length

  const filterBar = (
    <FDrop label="Status" value={statusF} onChange={setStatusF} options={STATUS_OPTS} active={statusF !== 'all'} />
  )

  const TABS = [
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

  const actBtn = (title, icon, color, onClick) => (
    <button type="button" title={title} onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: `1px solid ${color}33`, background: `${color}14`, color, cursor: 'pointer', flexShrink: 0 }}>
      <Ic n={icon} s={13} />
    </button>
  )

  return (
    <>
      {tabBar}
      {tab === 'trash' ? (
        <TrashTab
          fetchDeleted={() => contractsApi.deleted().then(r => r.data.results ?? r.data)}
          onRestore={(id) => contractsApi.restore(id)}
          onPurge={(id) => contractsApi.purge(id)}
          getLabel={row => row.reservation_number ? `Contrato ${row.reservation_number}` : `Contrato #${row.id}`}
          getSubtitle={row => row.contratante_name}
          isSuperuser={!!user?.is_superuser}
          emptyText="Nenhum contrato excluído."
          onCountChange={setDeletedCount}
        />
      ) : (
        <DataTable
          title={TABS.find(t => t.key === tab)?.label || 'Contratos'}
          addLabel="Adicionar Contrato"
          data={filtered}
          cols={COLS}
          searchKeys={['reservation_number', 'contratante_name', 'agency_name', 'package_name']}
          extraFilters={filterBar}
          onAdd={canEdit && tab === 'em_edicao' ? () => setModal('new') : undefined}
          onView={(row) => setViewId(row.id)}
          onDocs={handleDocs}
          showDocs={(row) =>
            row.stage === 'enviado' ? row.signature_type === 'fisica'
            : row.stage === 'assinado' ? !!row.signed_file
            : false}
          docsTitle={tab === 'assinado' ? 'Ver contrato assinado' : 'Ver / baixar contrato'}
          extraActions={canEdit ? (row) => (
            tab === 'em_edicao' ? actBtn('Enviar para assinatura', 'mail', '#2563eb', () => handleSend(row))
            : tab === 'enviado' ? (
              <>
                {actBtn('Voltar para edição', 'rotate', '#b45309', () => handleReopen(row))}
                {actBtn('Anexar contrato assinado', 'check', '#059669', () => setUploadRow(row))}
              </>
            )
            : null
          ) : undefined}
          onDelete={canDelete ? (row) => setDelRow(row) : undefined}
          loading={loading}
        />
      )}

      {uploadRow && (
        <SignedUploadModal contractId={uploadRow.id} onClose={() => setUploadRow(null)} onUpload={handleUploadFile} />
      )}
      {signedUrl && (
        <SignedFileModal url={signedUrl} onClose={() => setSignedUrl(null)} />
      )}
      {previewId && (
        <ContractPdfPreviewModal contractId={previewId} onClose={() => setPreviewId(null)} />
      )}
      {viewId && (
        <ContractViewModal
          contractId={viewId}
          canEdit={canEdit}
          onClose={() => setViewId(null)}
          onEdit={() => { const id = viewId; setViewId(null); setModal(id) }}
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
    </>
  )
}
