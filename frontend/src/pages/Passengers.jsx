import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { passengersApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'
import NewPassengerModal from '../components/NewPassengerModal'
import { Ic } from '../components/Icon'

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
    <span onClick={copy} title="Clique para copiar"
      style={{ cursor:'pointer', position:'relative', color:muted?'#64748b':'#1e293b', fontWeight:name?500:400 }}>
      {value}
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
  { key:'full_name',  label:'Nome',        align:'center', render:(v) => <CopyCell value={v} name /> },
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

/* ── Popup visualização rápida ── */
function PassengerPreview({ passenger, onClose, onEdit }) {
  const [copied, setCopied] = useState(null)
  const initials = (n) => (n||'').split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()
  const PALETTE  = ['#2B3A8F','#0369A1','#0D6E6E','#6B3FA0','#B45309','#9B3A2A','#2D6A4F','#1E5799']
  const color    = PALETTE[(passenger.id??0) % PALETTE.length]
  const fmtDate  = (d) => d ? new Date(d+'T00:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}) : null

  const copyToClipboard = async (label, value) => {
    if (!value) return
    try { await navigator.clipboard.writeText(value); setCopied(label); setTimeout(()=>setCopied(null),1800) } catch {}
  }

  const Row = ({ label, value }) => {
    if (!value) return null
    const isCopied = copied === label
    return (
      <div onClick={() => copyToClipboard(label, value)} title="Clique para copiar"
        style={{ position:'relative', display:'flex', alignItems:'center', gap:12, padding:'8px 10px', borderRadius:6, borderBottom:'1px solid #f8fafc', cursor:'pointer', transition:'background .1s' }}
        onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
        onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
        <span style={{ fontSize:12, fontWeight:700, color:'#94a3b8', minWidth:110, flexShrink:0 }}>{label}</span>
        <span style={{ fontSize:13, color:'#1e293b', flex:1 }}>{value}</span>
        {isCopied && <span style={{ position:'absolute', top:-18, left:'50%', transform:'translateX(-50%)', background:'#059669', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4, whiteSpace:'nowrap', pointerEvents:'none', animation:'fadeUp .2s ease', zIndex:10 }}>✓ Copiado</span>}
      </div>
    )
  }

  const bInfo = birthdayInfo(passenger.birth_date)
  const age   = calcAge(passenger.birth_date)

  return (
    <div onClick={(e)=>{if(e.target===e.currentTarget)onClose()}}
      style={{position:'fixed',inset:0,background:'rgba(15,23,42,.45)',backdropFilter:'blur(3px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300,padding:20}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:'#fff',borderRadius:12,width:'100%',maxWidth:460,boxShadow:'0 24px 64px rgba(0,0,0,.24)',animation:'mIn .15s ease'}}>
        <div style={{padding:'20px 22px 16px',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',gap:14}}>
          <div style={{width:48,height:48,borderRadius:'50%',background:color,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:17,fontWeight:700,flexShrink:0}}>
            {initials(passenger.full_name)}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <span style={{position:'relative',display:'inline-block'}}>
              <p onClick={() => copyToClipboard('Nome', passenger.full_name)} title="Clique para copiar"
                style={{fontSize:16,fontWeight:700,color:'#1e293b',margin:0,cursor:'pointer'}}>
                {passenger.full_name}
              </p>
              {copied==='Nome' && <span style={{position:'absolute',top:-18,left:'50%',transform:'translateX(-50%)',background:'#059669',color:'#fff',fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:4,whiteSpace:'nowrap',pointerEvents:'none',animation:'fadeUp .2s ease'}}>✓ Copiado</span>}
            </span>
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:4}}>
              <StatusBadge value={passenger.status} />
              {passenger.is_foreign && <span style={{fontSize:11,fontWeight:600,color:'#0891b2',background:'#e0f2fe',padding:'1px 6px',borderRadius:6}}>Estrangeiro</span>}
            </div>
          </div>
          <button onClick={onClose} style={{width:30,height:30,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:6,border:'1px solid #e2e8f0',background:'#fff',color:'#94a3b8',cursor:'pointer',flexShrink:0}} onMouseEnter={e=>{e.currentTarget.style.borderColor='#1e293b';e.currentTarget.style.color='#1e293b'}} onMouseLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.color='#94a3b8'}}>
            <Ic n="x" s={14}/>
          </button>
        </div>
        <div style={{padding:'8px 12px 12px'}}>
          <p style={{fontSize:10,fontWeight:700,color:'#cbd5e1',textTransform:'uppercase',letterSpacing:'.05em',margin:'0 10px 4px',paddingTop:4}}>Clique em qualquer linha para copiar</p>
          <Row label="E-mail"      value={passenger.email} />
          <Row label="Celular"     value={passenger.mobile||passenger.phone1} />
          <Row label="Telefone"    value={passenger.mobile&&passenger.phone1?passenger.phone1:null} />
          <Row label="CPF"         value={passenger.cpf} />
          <Row label="Data nasc."  value={passenger.birth_date ? `${fmtDate(passenger.birth_date)} — ${age} anos` : null} />
          {passenger.birth_date && bInfo && (
            <div style={{padding:'6px 10px',borderRadius:6,margin:'2px 0',borderBottom:'1px solid #f8fafc',background:bInfo.bg??'#f8fafc',color:bInfo.color??'#64748b',fontSize:12.5,fontWeight:500}}>
              {bInfo.detail}
            </div>
          )}
          <Row label="Alimentação" value={passenger.diet_type?DIET_PT[passenger.diet_type]??passenger.diet_type:null} />
          <Row label="Agências"    value={passenger.agency_names} />
          <Row label="Cidade / UF" value={passenger.city?`${passenger.city}${passenger.state?` / ${passenger.state}`:''}`:null} />
        </div>
        <div style={{padding:'12px 22px',borderTop:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between'}}>
          <button onClick={onEdit} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 16px',borderRadius:6,border:'1px solid #e2e8f0',background:'#fff',color:'#475569',fontSize:13,fontWeight:500,cursor:'pointer',fontFamily:'inherit',transition:'all .12s'}} onMouseEnter={e=>{e.currentTarget.style.borderColor='#2e6db4';e.currentTarget.style.color='#2e6db4'}} onMouseLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.color='#475569'}}>
            <Ic n="edit" s={13}/> Editar
          </button>
          <button onClick={onClose} style={{padding:'7px 24px',borderRadius:6,border:'none',background:'#2e6db4',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}} onMouseEnter={e=>e.currentTarget.style.background='#275fa0'} onMouseLeave={e=>e.currentTarget.style.background='#2e6db4'}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Página principal ── */
export default function Passengers() {
  const [rows,      setRows]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [delRow,    setDelRow]    = useState(null)
  const [viewRow,   setViewRow]   = useState(null)
  const [showNew,   setShowNew]   = useState(false)
  const navigate                  = useNavigate()

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

  useEffect(() => { load() }, [])

  const handleDelete = async () => {
    await passengersApi.remove(delRow.id).catch(() => toast.error('Erro ao excluir.'))
    toast.success('Passageiro excluído.')
    setDelRow(null)
    load()
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

  return (
    <>
      <DataTable
        title="Passageiros"
        addLabel="Adicionar Passageiro"
        data={filtered}
        cols={COLS}
        searchKeys={['full_name','email','cpf','phone1']}
        extraFilters={filterBar}
        onAdd={() => setShowNew(true)}
        onView={(row) => setViewRow(row)}
        onDelete={(row) => setDelRow(row)}
        loading={loading}
      />

      {viewRow && (
        <PassengerPreview
          passenger={viewRow}
          onClose={() => setViewRow(null)}
          onEdit={() => { setViewRow(null); navigate(`/passageiros/${viewRow.id}`) }}
        />
      )}
      {delRow && (
        <DelModal name={delRow.full_name} onOk={handleDelete} onCancel={() => setDelRow(null)} />
      )}
      {showNew && <NewPassengerModal onClose={() => setShowNew(false)} />}
    </>
  )
}
