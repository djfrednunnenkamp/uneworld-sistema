import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { passengersApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'
import { Ic } from '../components/Icon'

/* Calcula idade atual */
function calcAge(birthDate) {
  if (!birthDate) return null
  const today = new Date()
  const b     = new Date(birthDate + 'T00:00:00')
  let age = today.getFullYear() - b.getFullYear()
  if (today.getMonth() < b.getMonth() || (today.getMonth() === b.getMonth() && today.getDate() < b.getDate())) age--
  return age
}

/* Calcula info de aniversário */
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

/* Copia texto ao clicar — mantém o texto original, mostra ✓ flutuante */
function CopyCell({ value, muted, name }) {
  const [ok, setOk] = useState(false)
  if (!value) return <span style={{ color: '#cbd5e1' }}>—</span>
  const copy = async (e) => {
    e.stopPropagation()
    try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1400) } catch {}
  }
  return (
    <span onClick={copy} title="Clique para copiar"
      style={{ cursor: 'pointer', position: 'relative', color: muted ? '#64748b' : '#1e293b', fontWeight: name ? 500 : 400 }}>
      {value}
      {ok && (
        <span style={{
          position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)',
          background: '#059669', color: '#fff', fontSize: 10, fontWeight: 700,
          padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap',
          pointerEvents: 'none', animation: 'fadeUp .2s ease',
        }}>✓ Copiado</span>
      )}
    </span>
  )
}

const COLS = [
  { key: 'full_name',  label: 'Nome',        align: 'center', render: (v) => <CopyCell value={v} name /> },
  { key: 'email',      label: 'E-mail',      align: 'center', render: (v) => <CopyCell value={v} muted /> },
  { key: 'phone1',     label: 'Telefone',    align: 'center', render: (v) => <CopyCell value={v} muted /> },
  { key: 'cpf',        label: 'CPF',         align: 'center', render: (v) => <CopyCell value={v} muted /> },
  { key: 'birth_date', label: 'Aniversário', align: 'center', render: (v) => {
    if (!v) return <span style={{ color:'#cbd5e1' }}>—</span>
    const info     = birthdayInfo(v)
    const age      = calcAge(v)
    const fullDate = new Date(v + 'T00:00:00').toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' })
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:2, alignItems:'center' }}>
        {/* Badge chamativo quando próximo */}
        {info?.badge && (
          <span style={{
            display:'inline-flex', alignItems:'center', gap:3,
            padding:'2px 7px', borderRadius:6,
            fontSize:11, fontWeight:800, letterSpacing:'.01em',
            background: info.bg, color: info.color,
            whiteSpace:'nowrap', width:'fit-content',
            boxShadow: `0 0 0 1.5px ${info.color}40`,
          }}>
            {info.badge}
          </span>
        )}
        {/* Data sempre visível */}
        <span style={{ fontSize:13, color: info?.badge ? info.color : '#1e293b', fontWeight: info?.badge ? 600 : 400 }}>
          {fullDate}
        </span>
        <span style={{ fontSize:11, color:'#94a3b8' }}>
          {age} ano{age !== 1 ? 's' : ''}
        </span>
      </div>
    )
  }},
  { key: 'status',     label: 'Status',      render: (v) => <StatusBadge value={v} /> },
]

/* ── Popup de visualização rápida ── */
function PassengerPreview({ passenger, onClose, onEdit }) {
  const [copied, setCopied] = useState(null)
  const initials = (n) => (n || '').split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()
  const PALETTE  = ['#2B3A8F','#0369A1','#0D6E6E','#6B3FA0','#B45309','#9B3A2A','#2D6A4F','#1E5799']
  const color    = PALETTE[(passenger.id ?? 0) % PALETTE.length]

  const copyToClipboard = async (label, value) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      setTimeout(() => setCopied(null), 1800)
    } catch { /* silently fail */ }
  }

  const fmtDate = (d) => d
    ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' })
    : null

  const DIET_LABELS = {
    standard:'Padrão', vegetarian:'Vegetariano', vegan:'Vegano',
    gluten_free:'Sem glúten', lactose_free:'Sem lactose',
    kosher:'Kosher', halal:'Halal', low_sodium:'Baixo teor de sódio',
    diabetic:'Diabético', seafood_free:'Sem frutos do mar',
    nut_free:'Sem oleaginosas', low_fat:'Baixo teor de gordura', raw:'Crudívoro',
  }

  const Row = ({ label, value }) => {
    if (!value) return null
    const isCopied = copied === label
    return (
      <div
        onClick={() => copyToClipboard(label, value)}
        title="Clique para copiar"
        style={{ position:'relative', display:'flex', alignItems:'center', gap:12, padding:'8px 10px', borderRadius:6, borderBottom:'1px solid #f8fafc', cursor:'pointer', transition:'background .1s' }}
        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span style={{ fontSize:12, fontWeight:700, color:'#94a3b8', minWidth:110, flexShrink:0 }}>{label}</span>
        <span style={{ fontSize:13, color:'#1e293b', flex:1 }}>{value}</span>
        {isCopied && (
          <span style={{position:'absolute',top:-18,left:'50%',transform:'translateX(-50%)',background:'#059669',color:'#fff',fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:4,whiteSpace:'nowrap',pointerEvents:'none',animation:'fadeUp .2s ease',zIndex:10}}>✓ Copiado</span>
        )}
      </div>
    )
  }

  return (
    <div onClick={(e)=>{if(e.target===e.currentTarget)onClose()}}
      style={{position:'fixed',inset:0,background:'rgba(15,23,42,.45)',backdropFilter:'blur(3px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300,padding:20}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:'#fff',borderRadius:12,width:'100%',maxWidth:460,boxShadow:'0 24px 64px rgba(0,0,0,.24)',animation:'mIn .15s ease'}}>

        {/* Header — avatar + nome + status */}
        <div style={{padding:'20px 22px 16px',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',gap:14}}>
          <div style={{width:48,height:48,borderRadius:'50%',background:color,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:17,fontWeight:700,flexShrink:0}}>
            {initials(passenger.full_name)}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <span style={{position:'relative',display:'inline-block'}}>
              <p onClick={() => copyToClipboard('Nome', passenger.full_name)} title="Clique para copiar o nome"
                style={{fontSize:16,fontWeight:700,color:'#1e293b',margin:0,cursor:'pointer'}}>
                {passenger.full_name}
              </p>
              {copied==='Nome' && (
                <span style={{position:'absolute',top:-18,left:'50%',transform:'translateX(-50%)',background:'#059669',color:'#fff',fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:4,whiteSpace:'nowrap',pointerEvents:'none',animation:'fadeUp .2s ease'}}>✓ Copiado</span>
              )}
            </span>
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:4}}>
              <StatusBadge value={passenger.status} />
            </div>
          </div>
          <button onClick={onClose}
            style={{width:30,height:30,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:6,border:'1px solid #e2e8f0',background:'#fff',color:'#94a3b8',cursor:'pointer',flexShrink:0}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='#1e293b';e.currentTarget.style.color='#1e293b'}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.color='#94a3b8'}}>
            <Ic n="x" s={14}/>
          </button>
        </div>

        {/* Informações — clique em qualquer linha para copiar */}
        <div style={{padding:'8px 12px 12px'}}>
          <p style={{fontSize:10,fontWeight:700,color:'#cbd5e1',textTransform:'uppercase',letterSpacing:'.05em',margin:'0 10px 4px',paddingTop:4}}>
            Clique em qualquer linha para copiar
          </p>
          <Row label="E-mail"           value={passenger.email} />
          <Row label="Celular"          value={passenger.mobile || passenger.phone1} />
          <Row label="Telefone"         value={passenger.mobile && passenger.phone1 ? passenger.phone1 : null} />
          <Row label="CPF"              value={passenger.cpf} />
          <Row label="Data nasc." value={passenger.birth_date
            ? `${fmtDate(passenger.birth_date)} — ${calcAge(passenger.birth_date)} anos`
            : null} />
          {passenger.birth_date && (() => {
            const info = birthdayInfo(passenger.birth_date)
            if (!info) return null
            return (
              <div style={{ padding:'6px 10px', borderRadius:6, margin:'2px 0', borderBottom:'1px solid #f8fafc',
                background: info.bg ?? '#f8fafc', color: info.color ?? '#64748b', fontSize:12.5, fontWeight:500 }}>
                {info.detail}
              </div>
            )
          })()}
          <Row label="Alimentação"      value={passenger.diet_type ? DIET_LABELS[passenger.diet_type] ?? passenger.diet_type : null} />
          <Row label="Agências"         value={passenger.agency_names} />
          <Row label="Cidade / UF"      value={passenger.city ? `${passenger.city}${passenger.state ? ` / ${passenger.state}` : ''}` : null} />
        </div>

        {/* Rodapé — Editar (esq) + Fechar (dir) */}
        <div style={{padding:'12px 22px',borderTop:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between'}}>
          <button onClick={onEdit}
            style={{display:'flex',alignItems:'center',gap:6,padding:'7px 16px',borderRadius:6,border:'1px solid #e2e8f0',background:'#fff',color:'#475569',fontSize:13,fontWeight:500,cursor:'pointer',fontFamily:'inherit',transition:'all .12s'}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='#2e6db4';e.currentTarget.style.color='#2e6db4'}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.color='#475569'}}>
            <Ic n="edit" s={13}/> Editar
          </button>
          <button onClick={onClose}
            style={{padding:'7px 24px',borderRadius:6,border:'none',background:'#2e6db4',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
            onMouseEnter={e=>e.currentTarget.style.background='#275fa0'}
            onMouseLeave={e=>e.currentTarget.style.background='#2e6db4'}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Passengers() {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [delRow,  setDelRow]  = useState(null)
  const [viewRow, setViewRow] = useState(null)
  const navigate              = useNavigate()

  const load = () => {
    setLoading(true)
    passengersApi.list()
      .then((r) => setRows(r.data.results ?? r.data))
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

  return (
    <>
      <DataTable
        title="Passageiros"
        addLabel="Adicionar Passageiro"
        data={rows}
        cols={COLS}
        searchKeys={['full_name', 'email', 'cpf', 'mobile']}
        filterKey="status"
        filterOpts={['active', 'inactive']}
        onAdd={() => navigate('/passageiros/novo')}
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
        <DelModal
          name={delRow.full_name}
          onOk={handleDelete}
          onCancel={() => setDelRow(null)}
        />
      )}
    </>
  )
}
