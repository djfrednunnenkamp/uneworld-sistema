import { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { contractsApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'
import TrashTab from '../components/TrashTab'
import ContractFormModal from '../components/ContractFormModal'
import ContractViewModal from '../components/ContractViewModal'
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

const COLS = [
  { key: 'reservation_number', label: 'Reserva',     align: 'center', render: (v) => v || <span style={{ color: '#cbd5e1' }}>—</span> },
  { key: 'contratante_name',   label: 'Contratante', align: 'center' },
  { key: 'agency_name',        label: 'Agência',     align: 'center' },
  { key: 'package_name',       label: 'Pacote',      align: 'center', render: (v) => v || <span style={{ color: '#cbd5e1' }}>—</span> },
  { key: 'departure_date',     label: 'Data viagem',  align: 'center', render: (v) => v ? fmtDateBR(v) : <span style={{ color: '#cbd5e1' }}>—</span> },
  { key: 'total_brl',          label: 'Total (BRL)',  align: 'center', render: (v) => v ? fmtBRL(v) : <span style={{ color: '#cbd5e1' }}>—</span> },
  { key: 'status',             label: 'Status',       align: 'center', render: (v) => <StatusBadge value={v} /> },
]

/* ── Popup de upload do contrato assinado (arrastar e soltar) ── */
function SignedUploadModal({ onClose, onUpload }) {
  const [file, setFile] = useState(null)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  const submit = async () => {
    if (!file) return
    setBusy(true)
    try { await onUpload(file) } finally { setBusy(false) }
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 480, boxShadow: '0 24px 64px rgba(0,0,0,.24)' }}>
        <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>Anexar contrato assinado</span>
          <button onClick={onClose} style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', cursor: 'pointer' }}><Ic n="x" s={14} /></button>
        </div>
        <div style={{ padding: 20 }}>
          <input ref={inputRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setFile(f) }} />
          <div onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f) }}
            style={{ border: `2px dashed ${drag ? '#2e6db4' : '#cbd5e1'}`, borderRadius: 12, padding: '32px 20px', textAlign: 'center', cursor: 'pointer', background: drag ? '#eff6ff' : '#fafbfc', transition: 'all .12s' }}>
            <div style={{ color: drag ? '#2e6db4' : '#94a3b8', display: 'flex', justifyContent: 'center', marginBottom: 8 }}><Ic n="docs" s={28} /></div>
            {file ? (
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{file.name}</p>
            ) : (
              <>
                <p style={{ margin: '0 0 4px', fontSize: 13.5, fontWeight: 600, color: '#475569' }}>Arraste o arquivo aqui</p>
                <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>ou clique para escolher (PDF ou imagem)</p>
              </>
            )}
          </div>
          {file && <p style={{ margin: '8px 2px 0', fontSize: 11.5, color: '#2e6db4', cursor: 'pointer' }} onClick={() => inputRef.current?.click()}>Trocar arquivo</p>}
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} disabled={busy} style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
          <button onClick={submit} disabled={!file || busy} style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: (!file || busy) ? '#94a3b8' : '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: (!file || busy) ? 'default' : 'pointer', fontFamily: 'inherit' }}>{busy ? 'Enviando…' : 'Enviar'}</button>
        </div>
      </div>
    </div>
  )
}

/* ── Popup de visualização do contrato assinado ── */
function SignedFileModal({ url, onClose }) {
  const isPdf = /\.pdf(\?|$)/i.test(url)
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 860, height: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.24)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>Contrato assinado</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => window.open(url, '_blank')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Abrir em nova aba</button>
            <a href={url} download style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 7, background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'none', fontFamily: 'inherit' }}>Baixar</a>
            <button onClick={onClose} style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', cursor: 'pointer' }}><Ic n="x" s={15} /></button>
          </div>
        </div>
        <div style={{ flex: 1, background: '#f1f5f9', overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {isPdf
            ? <iframe title="Contrato assinado" src={url} style={{ width: '100%', height: '100%', border: 'none' }} />
            : <img src={url} alt="Contrato assinado" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
        </div>
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

  // Baixar/ver: na etapa "assinado" abre o arquivo assinado num popup; senão gera o PDF.
  const handleDocs = (row) => {
    if (row.stage === 'assinado' && row.signed_file) { setSignedUrl(row.signed_file); return }
    handleDownloadPdf(row)
  }

  // Enviar para assinatura → muda a etapa E leva o usuário para a aba "Para assinatura".
  const handleSend = async (row) => {
    try {
      await contractsApi.sendForSignature(row.id)
      toast.success('Contrato enviado para assinatura.')
      await new Promise(res => contractsApi.list().then(r => { setRows(r.data.results ?? r.data); res() }).catch(res))
      setTab('enviado')
    } catch { toast.error('Erro ao enviar para assinatura.') }
  }

  const handleUploadFile = async (file) => {
    try {
      await contractsApi.uploadSigned(uploadRow.id, file)
      toast.success('Contrato assinado anexado.')
      setUploadRow(null)
      await new Promise(res => contractsApi.list().then(r => { setRows(r.data.results ?? r.data); res() }).catch(res))
      setTab('assinado')
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
          docsTitle={tab === 'assinado' ? 'Baixar contrato assinado' : 'Baixar PDF'}
          extraActions={canEdit ? (row) => (
            tab === 'em_edicao' ? actBtn('Enviar para assinatura', 'mail', '#2563eb', () => handleSend(row))
            : tab === 'enviado' ? actBtn('Anexar contrato assinado', 'check', '#059669', () => setUploadRow(row))
            : null
          ) : undefined}
          onDelete={canDelete ? (row) => setDelRow(row) : undefined}
          loading={loading}
        />
      )}

      {uploadRow && (
        <SignedUploadModal onClose={() => setUploadRow(null)} onUpload={handleUploadFile} />
      )}
      {signedUrl && (
        <SignedFileModal url={signedUrl} onClose={() => setSignedUrl(null)} />
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
