import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { agenciesApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'
import TrashRowActions from '../components/TrashRowActions'
import MergeModal from '../components/MergeModal'
import NewAgencyModal from '../components/NewAgencyModal'
import { Ic } from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import { useWebSocket } from '../hooks/useWebSocket'
import { dashboardWsUrl } from '../utils/ws'

/* ── CopyCell ── */
function CopyCell({ value, muted, bold }) {
  const [ok, setOk] = useState(false)
  if (!value) return <span style={{ color: '#cbd5e1' }}>—</span>
  const copy = async (e) => {
    e.stopPropagation()
    try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1400) } catch {}
  }
  return (
    <span onClick={copy} title={value}
      style={{ cursor: 'pointer', position: 'relative', display: 'inline-block', maxWidth: '100%', verticalAlign: 'bottom' }}>
      <span style={{
        display: 'block', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: muted ? '#64748b' : '#1e293b', fontWeight: bold ? 500 : 400,
      }}>
        {value}
      </span>
      {ok && (
        <span style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', background: '#059669', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          ✓ Copiado
        </span>
      )}
    </span>
  )
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
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 6, border: `1px solid ${active ? '#2e6db4' : '#e2e8f0'}`, background: active ? '#eff6ff' : '#fff', color: active ? '#2e6db4' : '#475569', fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
        {label}{selected && value !== options[0].value ? `: ${selected.label}` : ''}
        <span style={{ fontSize: 9, opacity: .7 }}>▼</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200, background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px rgba(0,0,0,.10)', minWidth: 160, overflow: 'hidden' }}>
          {options.map(opt => {
            const sel = value === opt.value
            return (
              <button key={opt.value} type="button" onClick={() => { onChange(opt.value); setOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '9px 14px', background: sel ? '#eff6ff' : 'transparent', border: 'none', borderBottom: '1px solid #f8fafc', color: sel ? '#2e6db4' : '#1e293b', fontSize: 13, fontWeight: sel ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f8fafc' }}
                onMouseLeave={e => { e.currentTarget.style.background = sel ? '#eff6ff' : 'transparent' }}>
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

/* ── AgencyPreview — popup de visualização rápida ── */
function AgencyPreview({ agency, onClose, onEdit, onViewLog }) {
  const [copied, setCopied] = useState(null)
  const PALETTE = ['#2B3A8F', '#0369A1', '#0D6E6E', '#6B3FA0', '#B45309', '#9B3A2A', '#2D6A4F', '#1E5799']
  const color   = PALETTE[(agency.id ?? 0) % PALETTE.length]
  const initials = (n) => (n || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()

  const copy = async (label, value) => {
    if (!value) return
    try { await navigator.clipboard.writeText(value); setCopied(label); setTimeout(() => setCopied(null), 1800) } catch {}
  }

  const Row = ({ label, value }) => {
    if (!value) return null
    const isCopied = copied === label
    return (
      <div onClick={() => copy(label, value)} title="Clique para copiar"
        style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 6, borderBottom: '1px solid #f8fafc', cursor: 'pointer' }}
        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', minWidth: 120, flexShrink: 0 }}>{label}</span>
        <span title={value} style={{ fontSize: 13, color: '#1e293b', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        {isCopied && <span style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', background: '#059669', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 10 }}>✓ Copiado</span>}
      </div>
    )
  }

  const displayName = agency.company_name || agency.name || '—'
  const address = [agency.street, agency.number, agency.neighborhood, agency.city, agency.state, agency.country]
    .filter(Boolean).join(', ')

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 480, boxShadow: '0 24px 64px rgba(0,0,0,.24)', animation: 'mIn .15s ease' }}>

        {/* Header */}
        <div style={{ padding: '20px 22px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: 10, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
            {initials(displayName)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
              onClick={() => copy('Nome', displayName)} title="Clique para copiar">
              {displayName}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusBadge value={agency.status} />
              {agency.agency_type && agency.agency_type !== 'agencia' && (
                <span style={{ fontSize: 11, fontWeight: 600, color: '#0891b2', background: '#e0f2fe', padding: '1px 6px', borderRadius: 6, textTransform: 'capitalize' }}>
                  {agency.agency_type}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose}
            style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', cursor: 'pointer', flexShrink: 0 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#1e293b'; e.currentTarget.style.color = '#1e293b' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#94a3b8' }}>
            <Ic n="x" s={14} />
          </button>
        </div>

        {/* Campos */}
        <div style={{ padding: '8px 12px 12px' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '.05em', margin: '0 10px 4px', paddingTop: 4 }}>
            Clique em qualquer linha para copiar
          </p>
          <Row label="Razão Social"  value={agency.person_type === 'fisica' ? [agency.name, agency.last_name].filter(Boolean).join(' ') : agency.company_name} />
          <Row label="Nome Fantasma" value={agency.person_type === 'fisica' ? agency.company_name : agency.name} />
          {agency.person_type === 'fisica'
            ? <Row label="CPF" value={agency.cpf} />
            : <Row label="CNPJ" value={agency.cnpj} />
          }
          <Row label="Telefone"      value={agency.phone} />
          <Row label="Celular"       value={agency.mobile} />
          <Row label="E-mail"        value={agency.email} />
          <Row label="Website"       value={agency.website} />
          <Row label="Endereço"      value={address || null} />
          <Row label="Comissão"      value={agency.commission_rate ? `${agency.commission_rate}%` : null} />
          {agency.pix_key && <Row label="PIX" value={`${agency.pix_key_type ? agency.pix_key_type.toUpperCase() + ' · ' : ''}${agency.pix_key}`} />}
        </div>

        {/* Rodapé */}
        <div style={{ padding: '12px 22px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: (onEdit || onViewLog) ? 'space-between' : 'flex-end' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {onEdit && (
              <button onClick={onEdit}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#2e6db4'; e.currentTarget.style.color = '#2e6db4' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#475569' }}>
                <Ic n="edit" s={13} /> Editar
              </button>
            )}
            {onViewLog && (
              <button onClick={onViewLog} title="Ver log de atividades desta agência"
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.color = '#7c3aed' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#475569' }}>
                <Ic n="list" s={13} /> Log
              </button>
            )}
          </div>
          <button onClick={onClose}
            style={{ padding: '7px 24px', borderRadius: 6, border: 'none', background: '#2e6db4', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            onMouseEnter={e => e.currentTarget.style.background = '#275fa0'}
            onMouseLeave={e => e.currentTarget.style.background = '#2e6db4'}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── PersonCell: mostra tipo de pessoa + CPF ou CNPJ ── */
function PersonCell({ row }) {
  const isFisica = row.person_type === 'fisica'
  const doc      = isFisica ? row.cpf : row.cnpj
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase',
        padding: '1px 7px', borderRadius: 20,
        background: isFisica ? '#f0fdf4' : '#eff6ff',
        color:      isFisica ? '#16a34a' : '#2563eb',
      }}>
        {isFisica ? 'Pessoa Física' : 'Pessoa Jurídica'}
      </span>
      <CopyCell value={doc} muted />
    </div>
  )
}

/* ── Colunas ── */
const COLS = [
  { key: 'company_name', label: 'Razão Social',  align: 'center', render: (v, row) => <CopyCell value={row.person_type === 'fisica' ? [row.name, row.last_name].filter(Boolean).join(' ') : (v || row.name)} bold /> },
  { key: 'name',         label: 'Nome Fantasma', align: 'center', render: (v, row) => <CopyCell value={row.person_type === 'fisica' ? row.company_name : v} muted /> },
  { key: 'cnpj',         label: 'CNPJ / CPF',   align: 'center', render: (_, row) => <PersonCell row={row} /> },
  { key: 'phone',        label: 'Telefone',      align: 'center', render: (v) => <CopyCell value={v} muted /> },
  { key: 'email',        label: 'E-mail',        align: 'center', render: (v) => <CopyCell value={v} muted /> },
  { key: 'commission_rate', label: 'Comissão', align: 'center', render: (v) => v ? <CopyCell value={`${v}%`} muted /> : <span style={{ color: '#cbd5e1' }}>—</span> },
  { key: 'status',       label: 'Status',        align: 'center', render: (v) => <StatusBadge value={v} /> },
]

const STATUS_OPTS = [
  { value: 'all',      label: 'Todos'    },
  { value: 'active',   label: 'Ativa'    },
  { value: 'pending',  label: 'Pendente' },
  { value: 'inactive', label: 'Inativa'  },
]

const MERGE_FIELDS = [
  { key:'company_name',   label:'Razão social' },
  { key:'name',            label:'Nome fantasia' },
  { key:'last_name',       label:'Sobrenome' },
  { key:'cnpj',            label:'CNPJ' },
  { key:'cpf',             label:'CPF' },
  { key:'phone',           label:'Telefone' },
  { key:'mobile',          label:'Celular' },
  { key:'email',           label:'E-mail' },
  { key:'website',         label:'Website' },
  { key:'commission_rate', label:'Comissão %' },
  { key:'cep',             label:'CEP' },
  { key:'street',          label:'Endereço' },
  { key:'number',          label:'Número' },
  { key:'complement',      label:'Complemento' },
  { key:'neighborhood',    label:'Bairro' },
  { key:'city',            label:'Cidade' },
  { key:'state',           label:'Estado' },
  { key:'country',         label:'País' },
  { key:'pix_key_type',    label:'Tipo de chave PIX' },
  { key:'pix_key',         label:'Chave PIX' },
]

export default function Agencies() {
  const navigate  = useNavigate()
  const { user }  = useAuth()
  const perms     = user?.permissions ?? {}
  const canEdit    = !!user?.is_superuser || perms.agencies_edit
  const canDelete  = !!user?.is_superuser || perms.agencies_delete
  const canViewLog = !!user?.is_superuser || perms.view_audit_log || perms.agencies_view_logs || perms.log_view
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [delRow,  setDelRow]  = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [viewRow, setViewRow] = useState(null)
  const [statusF, setStatusF] = useState('all')
  const [showTrash, setShowTrash] = useState(false)
  const [deletedRows, setDeletedRows] = useState([])
  const [mergeRows, setMergeRows] = useState(null)

  const load = () => {
    setLoading(true)
    agenciesApi.list()
      .then(r => setRows(r.data.results ?? r.data))
      .catch(() => toast.error('Erro ao carregar agências.'))
      .finally(() => setLoading(false))
  }
  const loadDeleted = useCallback(() => {
    if (!canDelete) return
    agenciesApi.deleted().then(r => setDeletedRows(r.data.results ?? r.data)).catch(() => {})
  }, [canDelete])
  useEffect(() => { load() }, [])
  useEffect(() => { loadDeleted() }, [loadDeleted, showTrash])
  const deletedCount = deletedRows.length
  const canPurge = !!user?.is_superuser && !!user?.allow_hard_delete
  const reloadAll = () => { load(); loadDeleted() }

  const silentReload = useCallback(() => {
    agenciesApi.list()
      .then(r => setRows(r.data.results ?? r.data))
      .catch(() => {})
  }, [])

  const wsUrl = user ? dashboardWsUrl() : null
  useWebSocket(wsUrl, useCallback(({ scope }) => {
    if (scope === 'agencies' || scope === 'all') silentReload()
  }, [silentReload]))

  const handleDelete = async () => {
    await agenciesApi.remove(delRow.id).catch(() => toast.error('Erro ao excluir.'))
    toast.success('Agência excluída.')
    setDelRow(null)
    reloadAll()
  }

  // Aba Excluídos usa a MESMA tabela/filtros — só muda a fonte (itens excluídos).
  const filterSource = showTrash ? deletedRows : rows
  const filtered = statusF === 'all' ? filterSource : filterSource.filter(r => r.status === statusF)
  const getLabel = (row) => row.company_name || row.name || `#${row.id}`

  const filterBar = (
    <FDrop label="Status" value={statusF} onChange={setStatusF} options={STATUS_OPTS} active={statusF !== 'all'} />
  )

  const trashTabBar = canDelete && (
    <div style={{ display:'flex', gap:0, borderBottom:'1.5px solid #e2e8f0', marginBottom:4 }}>
      {[{ key:false, label:'Agências', color:'#2563eb' }, { key:true, label:'Excluídos', color:'#dc2626' }].map(t => {
        const sel = showTrash === t.key
        return (
          <button key={String(t.key)} type="button" onClick={() => setShowTrash(t.key)}
            style={{
              display:'flex', alignItems:'center', gap:8,
              padding:'10px 20px', border:'none', cursor:'pointer', fontFamily:'inherit',
              background:'transparent', fontSize:13.5, fontWeight: sel ? 600 : 400,
              color: sel ? t.color : '#94a3b8',
              borderBottom: sel ? `2px solid ${t.color}` : '2px solid transparent',
              marginBottom:'-1.5px', transition:'color .15s, border-color .15s',
              outline:'none',
            }}>
            {t.label}
            {t.key && (
              <span style={{
                fontSize:11, fontWeight:600, padding:'1px 8px', borderRadius:20,
                background: sel ? '#fee2e2' : '#f1f5f9',
                color:      sel ? t.color : '#94a3b8',
              }}>
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
      <DataTable
          title="Agências"
          addLabel="Adicionar Agência"
          data={filtered}
          cols={COLS}
          searchKeys={['name', 'company_name', 'email', 'cnpj', 'city', 'phone']}
          extraFilters={filterBar}
          onAdd={canEdit && !showTrash ? () => setShowNew(true) : undefined}
          onLog={canViewLog ? () => navigate('/log?scope=agencies') : undefined}
          onView={(row) => setViewRow(row)}
          onDelete={canDelete && !showTrash ? (row) => setDelRow(row) : undefined}
          extraActions={showTrash
            ? (row) => <TrashRowActions row={row} getLabel={getLabel} onRestore={agenciesApi.restore} onPurge={agenciesApi.purge} canPurge={canPurge} onChanged={reloadAll} />
            : undefined}
          loading={loading}
          bulkBar={(canEdit && canDelete && !showTrash) ? (selRows, { clearSelection }) => selRows.length >= 2 && (
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'#eff6ff', border:'1.5px solid #bfdbfe', borderRadius:10 }}>
              <span style={{ fontSize:13, fontWeight:700, color:'#1d4ed8', flex:1 }}>
                {selRows.length} selecionados
              </span>
              <button type="button" onClick={() => setMergeRows({ rows: selRows, clearSelection })}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                <Ic n="merge" s={12}/> Mesclar
              </button>
              <button type="button" onClick={clearSelection}
                style={{ padding:'6px 12px', borderRadius:7, border:'1px solid #e2e8f0', background:'#fff', color:'#64748b', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
                Cancelar
              </button>
            </div>
          ) : undefined}
        />

      {mergeRows && (
        <MergeModal
          records={mergeRows.rows}
          fields={MERGE_FIELDS}
          getLabel={r => r.company_name || r.name}
          onMerge={(payload) => agenciesApi.merge(payload)}
          onClose={() => setMergeRows(null)}
          onDone={() => { mergeRows.clearSelection(); setMergeRows(null); load() }}
        />
      )}

      {viewRow && (
        <AgencyPreview
          agency={viewRow}
          onClose={() => setViewRow(null)}
          onEdit={canEdit ? () => { setViewRow(null); navigate(`/agencias/${viewRow.id}`) } : undefined}
          onViewLog={canViewLog ? () => { setViewRow(null); navigate(`/log?agency_id=${viewRow.id}`) } : undefined}
        />
      )}
      {showNew && <NewAgencyModal onClose={() => setShowNew(false)} />}
      {delRow && (
        <DelModal name={delRow.company_name || delRow.name} onOk={handleDelete} onCancel={() => setDelRow(null)} recoverable />
      )}
    </>
  )
}
