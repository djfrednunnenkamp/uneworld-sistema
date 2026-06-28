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
  const [pendingUploadId, setPendingUploadId] = useState(null)
  const fileInputRef = useRef(null)

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

  // Baixar: na etapa "assinado" baixa o arquivo assinado; senão gera o PDF.
  const handleDocs = (row) => {
    if (row.stage === 'assinado' && row.signed_file) { window.open(row.signed_file, '_blank'); return }
    handleDownloadPdf(row)
  }

  const handleSend = async (row) => {
    try { await contractsApi.sendForSignature(row.id); toast.success('Contrato enviado para assinatura.'); load() }
    catch { toast.error('Erro ao enviar para assinatura.') }
  }

  const handleUploadClick = (row) => { setPendingUploadId(row.id); fileInputRef.current?.click() }
  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !pendingUploadId) return
    try { await contractsApi.uploadSigned(pendingUploadId, file); toast.success('Contrato assinado anexado.'); load() }
    catch { toast.error('Erro ao anexar o contrato assinado.') }
    finally { setPendingUploadId(null) }
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
      <input ref={fileInputRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={handleFileChosen} />
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
            : tab === 'enviado' ? actBtn('Anexar contrato assinado', 'check', '#059669', () => handleUploadClick(row))
            : null
          ) : undefined}
          onDelete={canDelete ? (row) => setDelRow(row) : undefined}
          loading={loading}
        />
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
