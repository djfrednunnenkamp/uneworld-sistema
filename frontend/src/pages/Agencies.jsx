import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { agenciesApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'
import NewAgencyModal from '../components/NewAgencyModal'

/* ── CopyCell — igual aos passageiros ── */
function CopyCell({ value, muted, bold }) {
  const [ok, setOk] = useState(false)
  if (!value) return <span style={{ color: '#cbd5e1' }}>—</span>
  const copy = async (e) => {
    e.stopPropagation()
    try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1400) } catch {}
  }
  return (
    <span onClick={copy} title="Clique para copiar"
      style={{ cursor: 'pointer', position: 'relative', color: muted ? '#64748b' : '#1e293b', fontWeight: bold ? 500 : 400 }}>
      {value}
      {ok && (
        <span style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', background: '#059669', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          ✓ Copiado
        </span>
      )}
    </span>
  )
}

/* ── FDrop — filtro estilo passageiros ── */
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
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 6,
          border: `1px solid ${active ? '#2e6db4' : '#e2e8f0'}`,
          background: active ? '#eff6ff' : '#fff',
          color: active ? '#2e6db4' : '#475569',
          fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit',
          transition: 'all .12s', whiteSpace: 'nowrap',
        }}>
        {label}{selected && value !== options[0].value ? `: ${selected.label}` : ''}
        <span style={{ fontSize: 9, opacity: .7 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200,
          background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0',
          boxShadow: '0 8px 24px rgba(0,0,0,.10)', minWidth: 160, overflow: 'hidden',
        }}>
          {options.map(opt => {
            const sel = value === opt.value
            return (
              <button key={opt.value} type="button"
                onClick={() => { onChange(opt.value); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '9px 14px', gap: 10,
                  background: sel ? '#eff6ff' : 'transparent', border: 'none',
                  borderBottom: '1px solid #f8fafc', color: sel ? '#2e6db4' : '#1e293b',
                  fontSize: 13, fontWeight: sel ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                }}
                onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f8fafc' }}
                onMouseLeave={e => { if (!sel) e.currentTarget.style.background = sel ? '#eff6ff' : 'transparent' }}
              >
                <span>{opt.label}</span>
                {sel && <span style={{ color: '#2e6db4' }}>✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Colunas com CopyCell e alinhamento centralizado ── */
const COLS = [
  { key: 'company_name', label: 'Razão Social',  align: 'center', render: (v, row) => <CopyCell value={v || row.name} bold /> },
  { key: 'name',         label: 'Nome Fantasia', align: 'center', render: (v, row) => <CopyCell value={v !== (row.company_name || v) ? v : v} muted /> },
  { key: 'cnpj',         label: 'CNPJ',          align: 'center', render: (v) => <CopyCell value={v} muted /> },
  { key: 'phone',        label: 'Telefone',      align: 'center', render: (v) => <CopyCell value={v} muted /> },
  { key: 'email',        label: 'E-mail',        align: 'center', render: (v) => <CopyCell value={v} muted /> },
  { key: 'city',         label: 'Cidade',        align: 'center', render: (v) => <CopyCell value={v} muted /> },
  { key: 'status',       label: 'Status',        align: 'center', render: (v) => <StatusBadge value={v} /> },
]

const STATUS_OPTS = [
  { value: 'all',      label: 'Todos'    },
  { value: 'active',   label: 'Ativa'    },
  { value: 'pending',  label: 'Pendente' },
  { value: 'inactive', label: 'Inativa'  },
]

export default function Agencies() {
  const navigate    = useNavigate()
  const [rows,      setRows]    = useState([])
  const [loading,   setLoading] = useState(true)
  const [delRow,    setDelRow]  = useState(null)
  const [showNew,   setShowNew] = useState(false)
  const [statusF,   setStatusF] = useState('all')

  const load = () => {
    setLoading(true)
    agenciesApi.list()
      .then(r => setRows(r.data.results ?? r.data))
      .catch(() => toast.error('Erro ao carregar agências.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleDelete = async () => {
    await agenciesApi.remove(delRow.id).catch(() => toast.error('Erro ao excluir.'))
    toast.success('Agência excluída.')
    setDelRow(null)
    load()
  }

  // Filtragem por status no frontend
  const filtered = statusF === 'all' ? rows : rows.filter(r => r.status === statusF)

  const filterBar = (
    <FDrop
      label="Status"
      value={statusF}
      onChange={setStatusF}
      options={STATUS_OPTS}
      active={statusF !== 'all'}
    />
  )

  return (
    <>
      <DataTable
        title="Agências"
        addLabel="Adicionar Agência"
        data={filtered}
        cols={COLS}
        searchKeys={['name', 'company_name', 'email', 'cnpj', 'city', 'phone']}
        extraFilters={filterBar}
        onAdd={() => setShowNew(true)}
        onEdit={(row) => navigate(`/agencias/${row.id}`)}
        onDelete={(row) => setDelRow(row)}
        loading={loading}
      />

      {showNew && <NewAgencyModal onClose={() => setShowNew(false)} />}
      {delRow && (
        <DelModal
          name={delRow.company_name || delRow.name}
          onOk={handleDelete}
          onCancel={() => setDelRow(null)}
        />
      )}
    </>
  )
}
