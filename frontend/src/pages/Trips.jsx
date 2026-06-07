import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { listsApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'
import ListModal from '../components/ListModal'

const fmt = (d) => {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

const TYPE_LABEL = {
  aereo: 'Via Aéreo', terrestre: 'Via Terrestre',
}

/* ── FDrop ── */
function FDrop({ label, value, onChange, options, active }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selected = options.find(o => o.value === value)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 11px', borderRadius:6, border:`1px solid ${active ? '#2e6db4' : '#e2e8f0'}`, background: active ? '#eff6ff' : '#fff', color: active ? '#2e6db4' : '#475569', fontSize:13, fontWeight: active ? 600 : 400, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
        {label}{selected && value !== options[0].value ? `: ${selected.label}` : ''}
        <span style={{ fontSize:9, opacity:.7 }}>▼</span>
      </button>
      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 6px)', left:0, zIndex:200, background:'#fff', borderRadius:8, border:'1px solid #e2e8f0', boxShadow:'0 8px 24px rgba(0,0,0,.10)', minWidth:160, overflow:'hidden' }}>
          {options.map(opt => {
            const sel = value === opt.value
            return (
              <button key={opt.value} type="button" onClick={() => { onChange(opt.value); setOpen(false) }}
                style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', padding:'9px 14px', background: sel ? '#eff6ff' : 'transparent', border:'none', borderBottom:'1px solid #f8fafc', color: sel ? '#2e6db4' : '#1e293b', fontSize:13, fontWeight: sel ? 600 : 400, cursor:'pointer', fontFamily:'inherit', textAlign:'left' }}
                onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f8fafc' }}
                onMouseLeave={e => { e.currentTarget.style.background = sel ? '#eff6ff' : 'transparent' }}>
                <span>{opt.label}</span>
                {sel && <span style={{ color:'#2e6db4' }}>✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const STATUS_OPTS = [
  { value: 'all',     label: 'Todos'   },
  { value: 'aberta',  label: 'Aberta'  },
  { value: 'fechada', label: 'Fechada' },
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
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [delRow,  setDelRow]  = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [statusF, setStatusF] = useState('all')

  const load = () => {
    setLoading(true)
    listsApi.list()
      .then(r => setRows(r.data.results ?? r.data))
      .catch(() => toast.error('Erro ao carregar listas.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const handleDelete = async () => {
    await listsApi.remove(delRow.id).catch(() => toast.error('Erro ao excluir.'))
    toast.success('Lista de passageiros excluída.')
    setDelRow(null)
    load()
  }

  // Após salvar no modal → navega para a página completa da lista
  const handleSaved = (data) => {
    setShowNew(false)
    navigate(`/viagens/${data.id}`)
  }

  const filtered = statusF === 'all' ? rows : rows.filter(r => r.status === statusF)

  const filterBar = (
    <FDrop label="Status" value={statusF} onChange={setStatusF} options={STATUS_OPTS} active={statusF !== 'all'} />
  )

  return (
    <>
      <DataTable
        title="Listas de Passageiros"
        addLabel="Adicionar Lista de Passageiros"
        data={filtered}
        cols={COLS}
        searchKeys={['name']}
        extraFilters={filterBar}
        onAdd={() => setShowNew(true)}
        onView={(row) => navigate(`/viagens/${row.id}`)}
        onDelete={(row) => setDelRow(row)}
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
