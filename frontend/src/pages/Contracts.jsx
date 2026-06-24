import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { contractsApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'
import TrashTab from '../components/TrashTab'
import ContractFormModal from '../components/ContractFormModal'
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
  const [statusF, setStatusF] = useState('all')
  const [showTrash, setShowTrash] = useState(false)
  const [deletedCount, setDeletedCount] = useState(0)
  const [downloadingId, setDownloadingId] = useState(null)

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
  }, [canDelete, showTrash])

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

  const filtered = statusF === 'all' ? rows : rows.filter(r => r.status === statusF)

  const filterBar = (
    <FDrop label="Status" value={statusF} onChange={setStatusF} options={STATUS_OPTS} active={statusF !== 'all'} />
  )

  const trashTabBar = canDelete && (
    <div style={{ display: 'flex', gap: 0, borderBottom: '1.5px solid #e2e8f0', marginBottom: 4 }}>
      {[{ key: false, label: 'Contratos', color: '#2563eb' }, { key: true, label: 'Excluídos', color: '#dc2626' }].map(t => {
        const sel = showTrash === t.key
        return (
          <button key={String(t.key)} type="button" onClick={() => setShowTrash(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', background: 'transparent', fontSize: 13.5, fontWeight: sel ? 600 : 400,
              color: sel ? t.color : '#94a3b8', borderBottom: sel ? `2px solid ${t.color}` : '2px solid transparent',
              marginBottom: '-1.5px', transition: 'color .15s, border-color .15s', outline: 'none',
            }}>
            {t.label}
            {t.key && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 20, background: sel ? '#fee2e2' : '#f1f5f9', color: sel ? t.color : '#94a3b8' }}>
                {deletedCount}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )

  return (
    <>
      {canDelete && trashTabBar}
      {showTrash ? (
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
          title="Contratos"
          addLabel="Adicionar Contrato"
          data={filtered}
          cols={COLS}
          searchKeys={['reservation_number', 'contratante_name', 'agency_name', 'package_name']}
          extraFilters={filterBar}
          onAdd={canEdit ? () => setModal('new') : undefined}
          onEdit={canEdit ? (row) => setModal(row.id) : undefined}
          onView={(row) => setModal(row.id)}
          onDocs={(row) => handleDownloadPdf(row)}
          onDelete={canDelete ? (row) => setDelRow(row) : undefined}
          loading={loading}
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
