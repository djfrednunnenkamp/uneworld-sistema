import { useState } from 'react'
import { StatusBadge } from './DataTable'
import { Ic } from './Icon'

const DIET_PT = {
  standard:'Padrão', vegetarian:'Vegetariano', vegan:'Vegano',
  gluten_free:'Sem glúten', lactose_free:'Sem lactose',
  kosher:'Kosher', halal:'Halal', low_sodium:'Baixo sódio',
  diabetic:'Diabético', seafood_free:'Sem frutos do mar',
  nut_free:'Sem oleaginosas', low_fat:'Baixo teor de gordura', raw:'Crudívoro',
}

const PALETTE = ['#2B3A8F','#0369A1','#0D6E6E','#6B3FA0','#B45309','#9B3A2A','#2D6A4F','#1E5799']

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

/* Row definido FORA do componente para não criar novo tipo a cada render */
function Row({ label, value, copied, onCopy }) {
  if (!value) return null
  const isCopied = copied === label
  return (
    <div onClick={() => onCopy(label, value)} title="Clique para copiar"
      style={{ position:'relative', display:'flex', alignItems:'center', gap:12, padding:'8px 10px', borderRadius:6, borderBottom:'1px solid #f8fafc', cursor:'pointer', transition:'background .1s' }}
      onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
      onMouseLeave={e => e.currentTarget.style.background='transparent'}>
      <span style={{ fontSize:12, fontWeight:700, color:'#94a3b8', minWidth:110, flexShrink:0 }}>{label}</span>
      <span title={value} style={{ fontSize:13, color:'#1e293b', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{value}</span>
      {isCopied && (
        <span style={{ position:'absolute', top:-18, left:'50%', transform:'translateX(-50%)', background:'#059669', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4, whiteSpace:'nowrap', pointerEvents:'none', zIndex:10 }}>
          ✓ Copiado
        </span>
      )}
    </div>
  )
}

/**
 * Props:
 *   passenger     — objeto completo do passageiro
 *   onClose       — fecha o modal
 *   onOpenProfile — navega para a página de detalhes do passageiro (sempre disponível)
 *   canEdit       — se true, o botão mostra "Editar"; caso contrário, "Ver perfil completo" (somente leitura)
 *   canViewLog    — se true, mostra o botão "Log" (log de atividades deste passageiro)
 *   onViewLog     — navega para o log de atividades deste passageiro
 */
export default function PassengerPreviewModal({ passenger, onClose, onOpenProfile, canEdit, canViewLog, onViewLog }) {
  const [copied, setCopied] = useState(null)

  if (!passenger) return null

  const initials = (n) => (n || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const color    = PALETTE[(passenger.id ?? 0) % PALETTE.length]
  const fmtDate  = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' }) : null

  const handleCopy = async (label, value) => {
    if (!value) return
    try { await navigator.clipboard.writeText(value); setCopied(label); setTimeout(() => setCopied(null), 1800) } catch {}
  }

  const bInfo = birthdayInfo(passenger.birth_date)
  const age   = calcAge(passenger.birth_date)

  // agency_names pode vir como array de objetos [{id, name}] ou já como string
  const agencyNames = Array.isArray(passenger.agency_names)
    ? passenger.agency_names.map(a => (typeof a === 'string' ? a : a?.name)).filter(Boolean).join(', ')
    : (passenger.agency_names || null)

  const rowProps = { copied, onCopy: handleCopy }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:900, padding:20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:460, boxShadow:'0 24px 64px rgba(0,0,0,.24)', animation:'mIn .15s ease' }}>

        {/* Header */}
        <div style={{ padding:'20px 22px 16px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ width:48, height:48, borderRadius:'50%', background:color, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:17, fontWeight:700, flexShrink:0 }}>
            {initials(passenger.full_name)}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <span style={{ position:'relative', display:'block', minWidth:0 }}>
              <p onClick={() => handleCopy('Nome', passenger.full_name)} title={passenger.full_name}
                style={{ fontSize:16, fontWeight:700, color:'#1e293b', margin:0, cursor:'pointer', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {passenger.full_name}
              </p>
              {copied === 'Nome' && (
                <span style={{ position:'absolute', top:-18, left:'50%', transform:'translateX(-50%)', background:'#059669', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4, whiteSpace:'nowrap', pointerEvents:'none' }}>
                  ✓ Copiado
                </span>
              )}
            </span>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:4 }}>
              <StatusBadge value={passenger.status} />
              {passenger.is_foreign && <span style={{ fontSize:11, fontWeight:600, color:'#0891b2', background:'#e0f2fe', padding:'1px 6px', borderRadius:6 }}>Estrangeiro</span>}
            </div>
          </div>
          <button onClick={onClose}
            style={{ width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#94a3b8', cursor:'pointer', flexShrink:0 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor='#1e293b'; e.currentTarget.style.color='#1e293b' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.color='#94a3b8' }}>
            <Ic n="x" s={14} />
          </button>
        </div>

        {/* Dados */}
        <div style={{ padding:'8px 12px 12px' }}>
          <p style={{ fontSize:10, fontWeight:700, color:'#cbd5e1', textTransform:'uppercase', letterSpacing:'.05em', margin:'0 10px 4px', paddingTop:4 }}>
            Clique em qualquer linha para copiar
          </p>
          <Row label="E-mail"      value={passenger.email}                                              {...rowProps} />
          <Row label="Celular"     value={passenger.mobile || passenger.phone1}                         {...rowProps} />
          <Row label="Telefone"    value={passenger.mobile && passenger.phone1 ? passenger.phone1 : null} {...rowProps} />
          <Row label="CPF"         value={passenger.cpf}                                                {...rowProps} />
          <Row label="Data nasc."  value={passenger.birth_date ? `${fmtDate(passenger.birth_date)} — ${age} anos` : null} {...rowProps} />
          {passenger.birth_date && bInfo && (
            <div style={{ padding:'6px 10px', borderRadius:6, margin:'2px 0', borderBottom:'1px solid #f8fafc', background: bInfo.bg ?? '#f8fafc', color: bInfo.color ?? '#64748b', fontSize:12.5, fontWeight:500 }}>
              {bInfo.detail}
            </div>
          )}
          <Row label="Alimentação" value={passenger.diet_type ? (DIET_PT[passenger.diet_type] ?? passenger.diet_type) : null} {...rowProps} />
          <Row label="Agências"    value={agencyNames || null}                                          {...rowProps} />
          <Row label="Cidade / UF" value={passenger.city ? `${passenger.city}${passenger.state ? ` / ${passenger.state}` : ''}` : null} {...rowProps} />
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 22px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'space-between' }}>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={onOpenProfile}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 16px', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:500, cursor:'pointer', fontFamily:'inherit', transition:'all .12s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='#2e6db4'; e.currentTarget.style.color='#2e6db4' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.color='#475569' }}>
              <Ic n={canEdit ? 'edit' : 'eye'} s={13} /> {canEdit ? 'Editar' : 'Ver perfil completo'}
            </button>
            {canViewLog && (
              <button onClick={onViewLog} title="Ver log de atividades deste passageiro"
                style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 16px', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:500, cursor:'pointer', fontFamily:'inherit', transition:'all .12s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='#7c3aed'; e.currentTarget.style.color='#7c3aed' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.color='#475569' }}>
                <Ic n="list" s={13} /> Log
              </button>
            )}
          </div>
          <button onClick={onClose}
            style={{ padding:'7px 24px', borderRadius:6, border:'none', background:'#2e6db4', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}
            onMouseEnter={e => e.currentTarget.style.background='#275fa0'}
            onMouseLeave={e => e.currentTarget.style.background='#2e6db4'}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
