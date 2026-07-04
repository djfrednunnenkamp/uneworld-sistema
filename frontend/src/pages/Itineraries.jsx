import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { itinerariesApi } from '../api'
import DataTable from '../components/DataTable'
import DelModal from '../components/DelModal'
import TrashRowActions from '../components/TrashRowActions'
import ItineraryCreateModal from '../components/ItineraryCreateModal'
import { useAuth } from '../context/AuthContext'
import { useWebSocket } from '../hooks/useWebSocket'
import { dashboardWsUrl } from '../utils/ws'

const fmtDateBR = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const TYPE_LABEL = { aereo: 'Aéreo', terrestre: 'Terrestre' }

const COLS = [
  { key: 'name',           label: 'Nome da viagem', align: 'left' },
  { key: 'category_name',  label: 'Categoria',  align: 'center', render: (v) => v || <span style={{ color: '#cbd5e1' }}>—</span> },
  { key: 'continent_name', label: 'Continente', align: 'center', render: (v) => v || <span style={{ color: '#cbd5e1' }}>—</span> },
  { key: 'trip_type',      label: 'Tipo',       align: 'center', render: (v) => TYPE_LABEL[v] || v },
  { key: 'start_date',     label: 'Início',     align: 'center', render: (v) => v ? fmtDateBR(v) : <span style={{ color: '#cbd5e1' }}>—</span> },
  { key: 'end_date',       label: 'Término',    align: 'center', render: (v) => v ? fmtDateBR(v) : <span style={{ color: '#cbd5e1' }}>—</span> },
]

export default function Itineraries() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const perms    = user?.permissions ?? {}
  const canEdit   = !!user?.is_superuser || perms.roteiros_edit
  const canDelete = !!user?.is_superuser || perms.roteiros_delete
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [delRow,  setDelRow]  = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [view, setView] = useState('ativos')   // 'ativos' | 'rascunhos' | 'excluidos'
  const [deletedRows, setDeletedRows] = useState([])
  const [draftRows, setDraftRows] = useState([])

  const load = () => {
    setLoading(true)
    itinerariesApi.list()
      .then(r => setRows(r.data.results ?? r.data))
      .catch(() => toast.error('Erro ao carregar roteiros.'))
      .finally(() => setLoading(false))
  }
  const loadDeleted = useCallback(() => {
    if (!canDelete) return
    itinerariesApi.deleted().then(r => setDeletedRows(r.data.results ?? r.data)).catch(() => {})
  }, [canDelete])
  const loadDrafts = useCallback(() => {
    itinerariesApi.drafts().then(r => setDraftRows(r.data.results ?? r.data)).catch(() => {})
  }, [])
  useEffect(() => { load(); loadDrafts() }, [loadDrafts])
  useEffect(() => { loadDeleted() }, [loadDeleted, view])
  const deletedCount = deletedRows.length
  const draftCount = draftRows.length
  const canPurge = !!user?.is_superuser && !!user?.allow_hard_delete
  const reloadAll = () => { load(); loadDeleted(); loadDrafts() }

  const silentReload = useCallback(() => {
    itinerariesApi.list().then(r => setRows(r.data.results ?? r.data)).catch(() => {})
    itinerariesApi.drafts().then(r => setDraftRows(r.data.results ?? r.data)).catch(() => {})
  }, [])

  const wsUrl = user ? dashboardWsUrl() : null
  useWebSocket(wsUrl, useCallback(({ scope }) => {
    if (scope === 'itineraries' || scope === 'all') silentReload()
  }, [silentReload]))

  const handleDelete = async () => {
    await itinerariesApi.remove(delRow.id).catch(() => toast.error('Erro ao excluir.'))
    toast.success('Roteiro excluído.')
    setDelRow(null)
    reloadAll()
  }

  const getLabel = (row) => row.name || `#${row.id}`

  const TABS = [
    { key: 'ativos',    label: 'Roteiros',  color: '#2563eb', count: null },
    { key: 'rascunhos', label: 'Rascunhos', color: '#b45309', count: draftCount },
    ...(canDelete ? [{ key: 'excluidos', label: 'Excluídos', color: '#dc2626', count: deletedCount }] : []),
  ]
  const tabBar = (
    <div style={{ display: 'flex', gap: 0, borderBottom: '1.5px solid #e2e8f0', marginBottom: 4 }}>
      {TABS.map(t => {
        const sel = view === t.key
        return (
          <button key={t.key} type="button" onClick={() => setView(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', background: 'transparent', fontSize: 13.5, fontWeight: sel ? 600 : 400,
              color: sel ? t.color : '#94a3b8', borderBottom: sel ? `2px solid ${t.color}` : '2px solid transparent',
              marginBottom: '-1.5px', transition: 'color .15s, border-color .15s', outline: 'none',
            }}>
            {t.label}
            {t.count != null && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 20, background: sel ? `${t.color}1a` : '#f1f5f9', color: sel ? t.color : '#94a3b8' }}>
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )

  const isTrash = view === 'excluidos'
  const data = view === 'ativos' ? rows : view === 'rascunhos' ? draftRows : deletedRows
  const title = view === 'ativos' ? 'Roteiros' : view === 'rascunhos' ? 'Rascunhos' : 'Excluídos'

  return (
    <>
      {tabBar}
      <DataTable
        title={title}
        addLabel="Adicionar Roteiro"
        data={data}
        cols={COLS}
        searchKeys={['name', 'slug']}
        onAdd={!isTrash && canEdit ? () => setShowCreate(true) : undefined}
        onEdit={!isTrash && canEdit ? (row) => navigate(`/roteiros/${row.id}`) : undefined}
        onView={(row) => navigate(`/roteiros/${row.id}`)}
        onDelete={!isTrash && canDelete ? (row) => setDelRow(row) : undefined}
        extraActions={isTrash
          ? (row) => <TrashRowActions row={row} getLabel={getLabel} onRestore={itinerariesApi.restore} onPurge={itinerariesApi.purge} canPurge={canPurge} onChanged={reloadAll} />
          : undefined}
        loading={loading}
      />

      {showCreate && (
        <ItineraryCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(data) => { setShowCreate(false); navigate(`/roteiros/${data.id}`) }}
        />
      )}
      {delRow && (
        <DelModal
          name={delRow.name}
          onOk={handleDelete} onCancel={() => setDelRow(null)} recoverable
        />
      )}
    </>
  )
}
