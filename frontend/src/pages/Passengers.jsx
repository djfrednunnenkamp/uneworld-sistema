import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { passengersApi } from '../api'
import { useAuth } from '../context/AuthContext'
import { useWebSocket } from '../hooks/useWebSocket'
import DataTable, { StatusBadge } from '../components/DataTable'
import { Ic } from '../components/Icon'
import DelModal from '../components/DelModal'
import TrashTab from '../components/TrashTab'
import MergeModal from '../components/MergeModal'
import NewPassengerModal from '../components/NewPassengerModal'
import PassengerDocsPopup from '../components/PassengerDocsPopup'
import PassengerPreviewModal from '../components/PassengerPreviewModal'

/* Colunas com dados sensíveis — só aparecem para quem tem passengers_view_full */
const SENSITIVE_COLS = ['email', 'phone1', 'cpf', 'birth_date']

/* ── Helpers ── */
function calcAge(birthDate) {
  if (!birthDate) return null
  const today = new Date()
  const b     = new Date(birthDate + 'T00:00:00')
  let age = today.getFullYear() - b.getFullYear()
  if (today.getMonth() < b.getMonth() || (today.getMonth() === b.getMonth() && today.getDate() < b.getDate())) age--
  return age
}

function birthdayInfo(birthDate) {
  if (!birthDate) return null
  const today = new Date(); today.setHours(0,0,0,0)
  const b = new Date(birthDate + 'T00:00:00')
  let next = new Date(today.getFullYear(), b.getMonth(), b.getDate())
  if (next < today) next = new Date(today.getFullYear() + 1, b.getMonth(), b.getDate())
  const days = Math.round((next - today) / 86400000)
  const label = b.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' })
  if (days === 0) return { badge:'🎂 Hoje!',      color:'#dc2626', bg:'#fee2e2', label, detail:'🎂 É o aniversário hoje!' }
  if (days <= 7)  return { badge:`🎉 Em ${days}d`, color:'#7c3aed', bg:'#ede9fe', label, detail:`🎉 Falta ${days} dia${days>1?'s':''} para o aniversário!` }
  if (days <= 31) return { badge:`📅 Em ${days}d`, color:'#2563eb', bg:'#dbeafe', label, detail:`📅 Falta ${days} dias para o aniversário` }
  const months = Math.floor(days/30), rem = days - months*30
  const detail = months > 0
    ? `Falta${months>1?'m':''} ${months} mês${months>1?'es':''} e ${rem} dia${rem!==1?'s':''} para o aniversário`
    : `Falta ${days} dias para o aniversário`
  return { badge: null, color: null, bg: null, label, detail }
}

/* ── CopyCell ── */
function CopyCell({ value, muted, name }) {
  const [ok, setOk] = useState(false)
  if (!value) return <span style={{ color:'#cbd5e1' }}>—</span>
  const copy = async (e) => {
    e.stopPropagation()
    try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1400) } catch {}
  }
  return (
    <span onClick={copy} title={value}
      style={{ cursor:'pointer', position:'relative', display:'inline-block', maxWidth:'100%', verticalAlign:'bottom' }}>
      <span style={{
        display:'block', maxWidth:260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
        color:muted?'#64748b':'#1e293b', fontWeight:name?500:400,
      }}>
        {value}
      </span>
      {ok && (
        <span style={{ position:'absolute', top:-18, left:'50%', transform:'translateX(-50%)', background:'#059669', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4, whiteSpace:'nowrap', pointerEvents:'none', animation:'fadeUp .2s ease' }}>✓ Copiado</span>
      )}
    </span>
  )
}

/* ── FilterDropdown reutilizável ── */
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
    <div ref={ref} style={{ position:'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 11px', borderRadius:6,
          border:`1px solid ${active ? '#2e6db4' : '#e2e8f0'}`,
          background: active ? '#eff6ff' : '#fff',
          color: active ? '#2e6db4' : '#475569',
          fontSize:13, fontWeight:active?600:400, cursor:'pointer', fontFamily:'inherit',
          transition:'all .12s', whiteSpace:'nowrap' }}>
        {label}{selected && value !== options[0].value ? `: ${selected.label}` : ''}
        <span style={{ fontSize:9, opacity:.7 }}>▼</span>
      </button>
      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 6px)', left:0, zIndex:200, background:'#fff',
          borderRadius:8, border:'1px solid #e2e8f0', boxShadow:'0 8px 24px rgba(0,0,0,.10)',
          minWidth:180, overflow:'hidden', animation:'mIn .12s ease' }}>
          {options.map(opt => {
            const sel = value === opt.value
            return (
              <button key={opt.value} type="button"
                onClick={() => { onChange(opt.value); setOpen(false) }}
                style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%',
                  padding:'9px 14px', gap:10, background:sel?'#eff6ff':'transparent',
                  border:'none', borderBottom:'1px solid #f8fafc',
                  color:sel?'#2e6db4':'#1e293b', fontSize:13, fontWeight:sel?600:400,
                  cursor:'pointer', fontFamily:'inherit', textAlign:'left', transition:'background .1s' }}
                onMouseEnter={e => { if(!sel) e.currentTarget.style.background='#f8fafc' }}
                onMouseLeave={e => { if(!sel) e.currentTarget.style.background='transparent' }}>
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

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

const DIET_PT = {
  standard:'Padrão', vegetarian:'Vegetariano', vegan:'Vegano',
  gluten_free:'Sem glúten', lactose_free:'Sem lactose',
  kosher:'Kosher', halal:'Halal', low_sodium:'Baixo sódio',
  diabetic:'Diabético', seafood_free:'Sem frutos do mar',
  nut_free:'Sem oleaginosas', low_fat:'Baixo teor de gordura', raw:'Crudívoro',
}

/* ── Colunas da tabela ── */
const COLS = [
  { key:'full_name',  label:'Nome',        align:'center', render:(v, row) => (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
      <CopyCell value={v} name />
      {row.is_verified && (
        <span title="Cadastro verificado"
          style={{ flexShrink:0, width:18, height:18, borderRadius:'50%', background:'#dcfce7', border:'1.5px solid #4ade80', color:'#16a34a', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>
          ✓
        </span>
      )}
    </div>
  ) },
  { key:'email',      label:'E-mail',      align:'center', render:(v) => <CopyCell value={v} muted /> },
  { key:'phone1',     label:'Telefone',    align:'center', render:(v) => <CopyCell value={v} muted /> },
  { key:'cpf',        label:'CPF',         align:'center', render:(v) => <CopyCell value={v} muted /> },
  { key:'birth_date', label:'Aniversário', align:'center', render:(v) => {
    if (!v) return <span style={{ color:'#cbd5e1' }}>—</span>
    const info = birthdayInfo(v)
    const age  = calcAge(v)
    const full = new Date(v+'T00:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:2, alignItems:'center' }}>
        {info?.badge && (
          <span style={{ padding:'2px 7px', borderRadius:6, fontSize:11, fontWeight:800, background:info.bg, color:info.color, whiteSpace:'nowrap', width:'fit-content', boxShadow:`0 0 0 1.5px ${info.color}40` }}>
            {info.badge}
          </span>
        )}
        <span style={{ fontSize:13, color:info?.badge?info.color:'#1e293b', fontWeight:info?.badge?600:400 }}>{full}</span>
        <span style={{ fontSize:11, color:'#94a3b8' }}>{age} ano{age!==1?'s':''}</span>
      </div>
    )
  }},
  { key:'status', label:'Status', render:(v) => <StatusBadge value={v} /> },
]

const fmtDate = (v) => new Date(v + 'T00:00:00').toLocaleDateString('pt-BR')

const MERGE_FIELDS = [
  { key:'full_name',   label:'Nome completo' },
  { key:'email',        label:'E-mail' },
  { key:'cpf',          label:'CPF' },
  { key:'phone1',       label:'Telefone' },
  { key:'mobile',       label:'Celular' },
  { key:'birth_date',   label:'Nascimento', format: fmtDate },
  { key:'gender',       label:'Gênero' },
  { key:'nationality',  label:'Nacionalidade' },
  { key:'cep',          label:'CEP' },
  { key:'street',       label:'Endereço' },
  { key:'number',       label:'Número' },
  { key:'neighborhood', label:'Bairro' },
  { key:'city',         label:'Cidade' },
  { key:'state',        label:'Estado' },
  { key:'country',      label:'País' },
]

/* ── Página principal ── */
export default function Passengers() {
  const [rows,      setRows]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [delRow,    setDelRow]    = useState(null)
  const [viewRow,   setViewRow]   = useState(null)
  const [showNew,   setShowNew]   = useState(false)
  const [docsRow,   setDocsRow]   = useState(null)
  const [mergeRows, setMergeRows] = useState(null)
  const [showTrash, setShowTrash] = useState(false)
  const [deletedCount, setDeletedCount] = useState(0)
  const navigate                  = useNavigate()
  const { user } = useAuth()
  const perms      = user?.permissions ?? {}
  const canFull    = !!user?.is_superuser || perms.passengers_view_full
  const canEdit    = !!user?.is_superuser || perms.passengers_edit
  const canDelete  = !!user?.is_superuser || perms.passengers_delete
  const canDocs    = !!user?.is_superuser || perms.passengers_download_docs
  const canViewLog = !!user?.is_superuser || perms.view_audit_log || perms.passengers_view_logs || perms.log_view
  const canViewPassengerLog = !!user?.is_superuser || perms.passengers_view_logs || perms.view_audit_log
  const cols       = canFull ? COLS : COLS.map(c => SENSITIVE_COLS.includes(c.key)
    ? { ...c, render: () => <span style={{ color:'#cbd5e1' }}>—</span> }
    : c)

  // Filtros
  const [statusF,   setStatusF]   = useState('all')
  const [birthdayF, setBirthdayF] = useState('all')
  const [foreignF,  setForeignF]  = useState('all')
  const [genderF,   setGenderF]   = useState('all')
  const [dietF,     setDietF]     = useState('all')

  const load = () => {
    setLoading(true)
    passengersApi.list()
      .then(r => setRows(r.data.results ?? r.data))
      .catch(() => toast.error('Erro ao carregar passageiros.'))
      .finally(() => setLoading(false))
  }

  // Versão silenciosa para atualização via WebSocket (sem spinner)
  const silentReload = useCallback(() => {
    passengersApi.list()
      .then(r => setRows(r.data.results ?? r.data))
      .catch(() => {})
  }, [])

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (canDelete) {
      passengersApi.deleted().then(r => setDeletedCount((r.data.results ?? r.data).length)).catch(() => {})
    }
  }, [canDelete, showTrash])

  const wsUrl = user ? `ws://${window.location.hostname}:8000/ws/dashboard/` : null
  useWebSocket(wsUrl, useCallback((msg) => {
    if (msg.type !== 'refresh') return
    const scope = msg.scope ?? 'all'
    if (scope === 'stats' || scope === 'all') silentReload()
  }, [silentReload]), { enabled: !!user })

  const handleDelete = async () => {
    await passengersApi.remove(delRow.id).catch(() => toast.error('Erro ao excluir.'))
    toast.success('Passageiro excluído.')
    setDelRow(null)
    load()
    setDeletedCount(c => c + 1)
  }

  /* Aplica filtros client-side */
  const todayMonth = new Date().getMonth() + 1
  const filtered = rows.filter(p => {
    if (statusF !== 'all' && p.status !== statusF) return false
    if (foreignF === 'foreign'  &&  !p.is_foreign) return false
    if (foreignF === 'national' &&   p.is_foreign) return false
    if (genderF !== 'all' && p.gender !== genderF) return false
    if (dietF   !== 'all' && p.diet_type !== dietF) return false

    if (birthdayF !== 'all' && p.birth_date) {
      const b = new Date(p.birth_date + 'T00:00:00')
      const today = new Date(); today.setHours(0,0,0,0)
      let next = new Date(today.getFullYear(), b.getMonth(), b.getDate())
      if (next < today) next = new Date(today.getFullYear()+1, b.getMonth(), b.getDate())
      const days = Math.round((next - today) / 86400000)

      if (birthdayF === 'today'  && days !== 0) return false
      if (birthdayF === 'week'   && (days < 0 || days > 7)) return false
      if (birthdayF === 'month'  && (days < 0 || days > 31)) return false
      if (/^\d+$/.test(birthdayF) && b.getMonth()+1 !== parseInt(birthdayF)) return false
    } else if (birthdayF !== 'all' && !p.birth_date) return false

    return true
  })

  const activeFilters = [statusF,birthdayF,foreignF,genderF,dietF].filter(v=>v!=='all').length

  const resetFilters = () => { setStatusF('all');setBirthdayF('all');setForeignF('all');setGenderF('all');setDietF('all') }

  /* Opções dos dropdowns */
  const birthdayOpts = [
    { value:'all',   label:'Todos os aniversários' },
    { value:'today', label:'🎂 Aniversário hoje' },
    { value:'week',  label:'🎉 Próximos 7 dias' },
    { value:'month', label:'📅 Este mês' },
    ...MESES.map((m,i) => ({ value:String(i+1), label:m })),
  ]

  const statusOpts = [
    { value:'all',      label:'Todos os status' },
    { value:'active',   label:'Ativo' },
    { value:'inactive', label:'Inativo' },
  ]

  const foreignOpts = [
    { value:'all',      label:'Nacional e estrangeiro' },
    { value:'national', label:'🇧🇷 Nacional' },
    { value:'foreign',  label:'🌍 Estrangeiro' },
  ]

  const genderOpts = [
    { value:'all', label:'Todos os gêneros' },
    { value:'F',   label:'Feminino' },
    { value:'M',   label:'Masculino' },
    { value:'O',   label:'Outro' },
  ]

  const dietOpts = [
    { value:'all', label:'Todas as dietas' },
    ...Object.entries(DIET_PT).map(([k,v]) => ({ value:k, label:v })),
  ]

  const filterBar = (
    <>
      <FDrop label="Status"      value={statusF}   onChange={setStatusF}   options={statusOpts}   active={statusF!=='all'} />
      <FDrop label="Aniversário" value={birthdayF} onChange={setBirthdayF} options={birthdayOpts}  active={birthdayF!=='all'} />
      <FDrop label="Origem"      value={foreignF}  onChange={setForeignF}  options={foreignOpts}  active={foreignF!=='all'} />
      <FDrop label="Gênero"      value={genderF}   onChange={setGenderF}   options={genderOpts}   active={genderF!=='all'} />
      <FDrop label="Alimentação" value={dietF}     onChange={setDietF}     options={dietOpts}     active={dietF!=='all'} />
      {activeFilters > 0 && (
        <button onClick={resetFilters}
          style={{ padding:'6px 11px', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#94a3b8', fontSize:13, cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:4 }}>
          ✕ <span style={{ background:'#dc2626', color:'#fff', fontSize:10, fontWeight:700, borderRadius:10, padding:'0 5px' }}>{activeFilters}</span>
        </button>
      )}
      {activeFilters > 0 && (
        <span style={{ fontSize:12, color:'#94a3b8', whiteSpace:'nowrap' }}>
          {filtered.length}/{rows.length}
        </span>
      )}
    </>
  )

  const trashTabBar = canDelete && (
    <div style={{ display:'flex', gap:0, borderBottom:'1.5px solid #e2e8f0', marginBottom:4 }}>
      {[{ key:false, label:'Passageiros', color:'#2563eb' }, { key:true, label:'Excluídos', color:'#dc2626' }].map(t => {
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
      {showTrash ? (
        <TrashTab
          fetchDeleted={() => passengersApi.deleted().then(r => r.data.results ?? r.data)}
          onRestore={(id) => passengersApi.restore(id)}
          onPurge={(id) => passengersApi.purge(id)}
          getLabel={row => row.full_name}
          getSubtitle={row => row.email}
          isSuperuser={!!user?.is_superuser}
          emptyText="Nenhum passageiro excluído."
          onCountChange={setDeletedCount}
        />
      ) : (
        <DataTable
          title="Passageiros"
          addLabel="Adicionar Passageiro"
          data={filtered}
          cols={cols}
          searchKeys={['full_name','email','cpf','phone1']}
          extraFilters={filterBar}
          onAdd={(canEdit && canFull) ? () => setShowNew(true) : undefined}
          onLog={canViewLog ? () => navigate('/log?scope=passengers') : undefined}
          onDocs={canDocs ? (row) => setDocsRow(row) : undefined}
          onView={(row) => setViewRow(row)}
          onDelete={canDelete ? (row) => setDelRow(row) : undefined}
          loading={loading}
          bulkBar={(canEdit && canDelete) ? (selRows, { clearSelection }) => selRows.length >= 2 && (
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
      )}

      {mergeRows && (
        <MergeModal
          records={mergeRows.rows}
          fields={MERGE_FIELDS}
          getLabel={r => r.full_name}
          onMerge={(payload) => passengersApi.merge(payload)}
          onClose={() => setMergeRows(null)}
          onDone={() => { mergeRows.clearSelection(); setMergeRows(null); load() }}
        />
      )}

      {viewRow && (
        <PassengerPreviewModal
          passenger={viewRow}
          onClose={() => setViewRow(null)}
          onOpenProfile={() => { setViewRow(null); navigate(`/passageiros/${viewRow.id}`) }}
          canEdit={canEdit}
          canViewLog={canViewPassengerLog}
          onViewLog={() => { setViewRow(null); navigate(`/log?passenger_id=${viewRow.id}`) }}
        />
      )}
      {delRow && (
        <DelModal name={delRow.full_name} onOk={handleDelete} onCancel={() => setDelRow(null)} recoverable />
      )}
      {showNew && <NewPassengerModal onClose={() => setShowNew(false)} />}
      {docsRow && <PassengerDocsPopup passenger={docsRow} onClose={() => setDocsRow(null)} />}
    </>
  )
}
