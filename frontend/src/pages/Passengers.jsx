import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { passengersApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'
import { Ic } from '../components/Icon'

const COLS = [
  { key: 'full_name', label: 'Nome',   render: (v) => <span className="t-name">{v}</span> },
  { key: 'email',     label: 'E-mail', render: (v) => <span className="t-muted">{v}</span> },
  { key: 'mobile',    label: 'Celular' },
  { key: 'cpf',       label: 'CPF' },
  { key: 'status',    label: 'Status', render: (v) => <StatusBadge value={v} /> },
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
        style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 10px', borderRadius:6, borderBottom:'1px solid #f8fafc', cursor:'pointer', transition:'background .1s' }}
        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span style={{ fontSize:12, fontWeight:700, color:'#94a3b8', minWidth:110, flexShrink:0 }}>{label}</span>
        <span style={{ fontSize:13, color:'#1e293b', flex:1 }}>{value}</span>
        <span style={{ fontSize:11, fontWeight:600, color: isCopied ? '#059669' : 'transparent', flexShrink:0, transition:'color .15s', minWidth:60, textAlign:'right' }}>
          {isCopied ? '✓ Copiado!' : 'copiar'}
        </span>
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
            <p
              onClick={() => copyToClipboard('Nome', passenger.full_name)}
              title="Clique para copiar o nome"
              style={{fontSize:16,fontWeight:700,color:'#1e293b',margin:0,cursor:'pointer'}}
            >
              {passenger.full_name}
            </p>
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:4}}>
              <StatusBadge value={passenger.status} />
              <span style={{fontSize:11,fontWeight:600,color: copied==='Nome' ? '#059669' : '#cbd5e1',transition:'color .15s'}}>
                {copied==='Nome' ? '✓ Copiado!' : 'copiar nome'}
              </span>
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
          <Row label="Data nasc."       value={fmtDate(passenger.birth_date)} />
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
