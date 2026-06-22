import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { listsApi } from '../api'
import { useAuth } from '../context/AuthContext'
import DataTable from '../components/DataTable'
import DelModal from '../components/DelModal'
import ListModal from '../components/ListModal'
import { useWebSocket } from '../hooks/useWebSocket'

const fmt = (d) => {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

const TYPE_LABEL = {
  aereo: 'Via Aéreo', terrestre: 'Via Terrestre',
}

const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d }

const getPhase = (row) => {
  const now   = today()
  const start = row.start_date ? new Date(row.start_date + 'T00:00:00') : null
  const end   = row.end_date   ? new Date(row.end_date   + 'T00:00:00') : null
  if (!start || now < start) return 'criacao'
  if (!end   || now <= end)  return 'andamento'
  return 'finalizada'
}

const PHASES = [
  { key:'criacao',    label:'Em criação',   color:'#2563eb', bg:'#eff6ff', dot:'#93c5fd' },
  { key:'andamento',  label:'Em andamento', color:'#16a34a', bg:'#f0fdf4', dot:'#86efac' },
  { key:'finalizada', label:'Finalizadas',  color:'#64748b', bg:'#f1f5f9', dot:'#cbd5e1' },
]

const COLS = [
  {
    key: 'name', label: 'Nome da Lista de Passageiros', align: 'left',
    render: (v) => <span style={{ fontWeight:600, color:'#1e293b' }}>{v}</span>,
  },
  {
    key: 'list_type', label: 'Tipo', align: 'center',
    render: (v) => <span style={{ fontSize:12, color:'#475569' }}>{TYPE_LABEL[v] || v}</span>,
  },
  {
    key: 'category', label: 'Categoria', align: 'center',
    render: (v) => <span style={{ fontSize:12, color:'#475569' }}>{v}</span>,
  },
  {
    key: 'start_date', label: 'Início', align: 'center',
    render: (v) => <span style={{ fontSize:13, color:'#64748b' }}>{fmt(v) || '—'}</span>,
  },
  {
    key: 'end_date', label: 'Término', align: 'center',
    render: (v) => <span style={{ fontSize:13, color:'#64748b' }}>{fmt(v) || '—'}</span>,
  },
  {
    key: 'enrolled_count', label: 'Passageiros', align: 'center',
    render: (v) => (
      <span style={{ background:'#eff6ff', color:'#2563eb', fontWeight:700, fontSize:13, padding:'2px 10px', borderRadius:20 }}>
        {v}
      </span>
    ),
  },
  {
    key: 'block_capacity', label: 'Capacidade', align: 'center',
    render: (v) => <span style={{ fontSize:13, color:'#64748b' }}>{v}</span>,
  },
  {
    key: 'status', label: 'Status', align: 'center',
    render: (v) => (
      <span style={{
        fontSize:11, fontWeight:700, padding:'2px 10px', borderRadius:20,
        background: v === 'aberta' ? '#dcfce7' : '#f1f5f9',
        color:      v === 'aberta' ? '#16a34a' : '#64748b',
      }}>
        {v === 'aberta' ? 'Aberta' : 'Fechada'}
      </span>
    ),
  },
]

export default function Trips() {
  const navigate  = useNavigate()
  const { user } = useAuth()
  const perms     = user?.permissions ?? {}
  const canEdit   = !!user?.is_superuser || perms.lists_edit
  const canDelete = !!user?.is_superuser || perms.lists_delete
  const canViewLog = !!user?.is_superuser || perms.view_audit_log || perms.log_lists || perms.log_view
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [delRow,  setDelRow]  = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [phase,   setPhase]   = useState('criacao')

  const load = () => {
    setLoading(true)
    listsApi.list()
      .then(r => setRows(r.data.results ?? r.data))
      .catch(() => toast.error('Erro ao carregar listas.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const silentReload = useCallback(() => {
    listsApi.list()
      .then(r => setRows(r.data.results ?? r.data))
      .catch(() => {})
  }, [])

  const wsUrl = user ? `ws://${window.location.hostname}:8000/ws/dashboard/` : null
  useWebSocket(wsUrl, useCallback((msg) => {
    if (msg.type !== 'refresh') return
    const scope = msg.scope ?? 'all'
    if (scope === 'lists' || scope === 'all') silentReload()
  }, [silentReload]), { enabled: !!user })

  const handleDelete = async () => {
    await listsApi.remove(delRow.id).catch(() => toast.error('Erro ao excluir.'))
    toast.success('Lista de passageiros excluída.')
    setDelRow(null)
    load()
  }

  const handleSaved = (data) => {
    setShowNew(false)
    navigate(`/viagens/${data.id}`)
  }

  const counts  = { criacao: 0, andamento: 0, finalizada: 0 }
  rows.forEach(r => { const p = getPhase(r); if (counts[p] !== undefined) counts[p]++ })

  const filtered = rows.filter(r => getPhase(r) === phase)

  const activePhase = PHASES.find(p => p.key === phase)

  const tabBar = (
    <div style={{ display:'flex', gap:0, borderBottom:'1.5px solid #e2e8f0', marginBottom:4 }}>
      {PHASES.map(p => {
        const sel = phase === p.key
        return (
          <button key={p.key} type="button" onClick={() => setPhase(p.key)}
            style={{
              display:'flex', alignItems:'center', gap:8,
              padding:'10px 20px', border:'none', cursor:'pointer', fontFamily:'inherit',
              background:'transparent', fontSize:13.5, fontWeight: sel ? 600 : 400,
              color: sel ? p.color : '#94a3b8',
              borderBottom: sel ? `2px solid ${p.color}` : '2px solid transparent',
              marginBottom:'-1.5px', transition:'color .15s, border-color .15s',
              outline:'none',
            }}>
            {p.label}
            <span style={{
              fontSize:11, fontWeight:600, padding:'1px 8px', borderRadius:20,
              background: sel ? p.bg : '#f1f5f9',
              color:      sel ? p.color : '#94a3b8',
              transition:'background .15s, color .15s',
            }}>
              {counts[p.key]}
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <>
      <DataTable
        title="Listas de Passageiros"
        addLabel="Adicionar Lista de Passageiros"
        data={filtered}
        cols={COLS}
        searchKeys={['name']}
        topBar={tabBar}
        onAdd={canEdit ? () => setShowNew(true) : undefined}
        onView={(row) => navigate(`/viagens/${row.id}`)}
        onDelete={canDelete ? (row) => setDelRow(row) : undefined}
        onLog={canViewLog ? () => navigate('/log?scope=lists') : undefined}
        loading={loading}
      />

      {showNew && (
        <ListModal onClose={() => setShowNew(false)} onSaved={handleSaved} />
      )}
      {delRow && (
        <DelModal name={delRow.name} onOk={handleDelete} onCancel={() => setDelRow(null)} />
      )}
    </>
  )
}
