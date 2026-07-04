import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { itinerariesApi } from '../api'
import DataTable from '../components/DataTable'
import DelModal from '../components/DelModal'
import TrashRowActions from '../components/TrashRowActions'
import ItineraryCreateModal from '../components/ItineraryCreateModal'
import { Ic } from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import { useWebSocket } from '../hooks/useWebSocket'
import { dashboardWsUrl } from '../utils/ws'

const fmtDateBR = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
const fmtDateTimeBR = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR') }

const TYPE_LABEL = { aereo: 'Aéreo', terrestre: 'Terrestre', maritimo: 'Marítimo' }

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
  const [view, setView] = useState('ativos')   // 'ativos' | 'excluidos'
  const [deletedRows, setDeletedRows] = useState([])
  const [draftRows, setDraftRows] = useState([])
  const [showDrafts, setShowDrafts] = useState(false)   // popup de rascunhos
  const [draftSel, setDraftSel] = useState(new Set())    // ids selecionados no popup
  const [bulkDel, setBulkDel] = useState(null)           // rascunhos p/ excluir em massa

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
  const handleBulkDelete = async () => {
    await Promise.all(bulkDel.map(d => itinerariesApi.remove(d.id).catch(() => {})))
    toast.success(`${bulkDel.length} rascunho(s) excluído(s).`)
    setBulkDel(null); setDraftSel(new Set()); reloadAll()
  }

  const getLabel = (row) => row.name || `#${row.id}`
  const actBtn = (title, icon, color, onClick) => (
    <button type="button" title={title} onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: `1px solid ${color}33`, background: `${color}14`, color, cursor: 'pointer', flexShrink: 0 }}>
      <Ic n={icon} s={13} />
    </button>
  )

  const TABS = [
    { key: 'ativos',    label: 'Roteiros',  color: '#2563eb', count: null },
    ...(canDelete ? [{ key: 'excluidos', label: 'Excluídos', color: '#dc2626', count: deletedCount }] : []),
  ]
  const tabBar = TABS.length > 1 && (
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
  const data = isTrash ? deletedRows : rows
  const title = isTrash ? 'Excluídos' : 'Roteiros'

  // Botão "Rascunhos" ao lado de Adicionar — abre um popup com os rascunhos (igual
  // aos contratos). Só aparece quando há rascunhos e não estamos na lixeira.
  const draftsBtn = (canEdit && !isTrash && draftRows.length > 0) ? (
    <button type="button" onClick={() => setShowDrafts(true)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 7, border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#6d28d9', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
      <Ic n="feather" s={14} /> Rascunhos
      <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: '#ede9fe', color: '#7c3aed' }}>{draftRows.length}</span>
    </button>
  ) : null

  return (
    <>
      {tabBar}
      <DataTable
        title={title}
        addLabel="Adicionar Roteiro"
        data={data}
        cols={COLS}
        searchKeys={['name', 'slug']}
        headerExtra={draftsBtn}
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

      {/* Popup de rascunhos (igual aos contratos) */}
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
                  <Ic n="feather" s={15} /> Rascunhos
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 20, background: '#ede9fe', color: '#7c3aed' }}>{draftRows.length}</span>
                </span>
                <button type="button" onClick={closeDrafts} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4, display: 'flex' }}><Ic n="x" s={16} /></button>
              </div>
              {canDelete && draftRows.length > 0 && (
                <div style={{ padding: '8px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#475569', cursor: 'pointer', fontWeight: 500 }}>
                    <input type="checkbox" checked={allSel} onChange={togAll} style={{ width: 15, height: 15, accentColor: '#7c3aed', cursor: 'pointer' }} />
                    Selecionar todos
                  </label>
                  <span style={{ flex: 1 }} />
                  {selCount > 0 && (
                    <button type="button" onClick={() => { const rows = draftRows.filter(d => draftSel.has(d.id)); setShowDrafts(false); setBulkDel(rows) }}
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
                    onClick={() => { closeDrafts(); navigate(`/roteiros/${d.id}`) }}>
                    {canDelete && (
                      <input type="checkbox" checked={draftSel.has(d.id)} onClick={e => e.stopPropagation()} onChange={() => tog1(d.id)}
                        style={{ width: 15, height: 15, accentColor: '#7c3aed', cursor: 'pointer', flexShrink: 0 }} />
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.name || 'Sem nome ainda'}
                      </div>
                      <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
                        {d.slug || `#${d.id}`}{d.updated_at ? `  ·  editado ${fmtDateTimeBR(d.updated_at)}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      {actBtn('Continuar editando', 'edit', '#7c3aed', () => { closeDrafts(); navigate(`/roteiros/${d.id}`) })}
                      {canDelete && actBtn('Excluir rascunho', 'trash', '#dc2626', () => { closeDrafts(); setDelRow(d) })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {bulkDel && (
        <DelModal
          name={`${bulkDel.length} rascunho(s)`}
          onOk={handleBulkDelete} onCancel={() => setBulkDel(null)} recoverable
        />
      )}
    </>
  )
}
