import { useState } from 'react'
import toast from 'react-hot-toast'
import { configApi } from '../api'
import ConfirmModal from './ConfirmModal'

const inp = { padding:'7px 10px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b' }
const onF  = e => e.target.style.borderColor = '#1a2d4f'
const onB  = e => e.target.style.borderColor = '#e2e8f0'

function Row({ item, onSave, onDelete }) {
  const [edit,     setEdit]     = useState(false)
  const [name,     setName]     = useState(item.name)
  const [capacity, setCapacity] = useState(item.capacity ?? 1)
  const [couple,   setCouple]   = useState(item.is_couple ?? false)
  const [saving,   setSaving]   = useState(false)
  const [confirm,  setConfirm]  = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await configApi.updateAccommodation(item.id, { name: name.trim(), capacity: Number(capacity), is_couple: couple })
      toast.success('Atualizado.')
      onSave()
      setEdit(false)
    } catch { toast.error('Erro ao salvar.') }
    finally { setSaving(false) }
  }

  if (edit) return (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', borderBottom:'1px solid #f1f5f9', background:'#fffbeb', flexWrap:'wrap' }}>
      <input value={name} onChange={e => setName(e.target.value)}
        style={{ ...inp, flex:1, minWidth:120 }} onFocus={onF} onBlur={onB} />
      <div style={{ display:'flex', alignItems:'center', gap:4 }}>
        <label style={{ fontSize:12, color:'#64748b', fontWeight:600 }}>Pessoas:</label>
        <input type="number" min="1" max="20" value={capacity} onChange={e => setCapacity(e.target.value)}
          style={{ ...inp, width:54, textAlign:'center' }} onFocus={onF} onBlur={onB} />
      </div>
      <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', userSelect:'none', fontSize:13 }}>
        <input type="checkbox" checked={couple} onChange={e => setCouple(e.target.checked)}
          style={{ width:15, height:15, accentColor:'#1a2d4f', cursor:'pointer' }} />
        Casal
      </label>
      <button onClick={save} disabled={saving || !name.trim()}
        style={{ padding:'6px 14px', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
        {saving ? '…' : 'Salvar'}
      </button>
      <button onClick={() => setEdit(false)}
        style={{ padding:'6px 12px', borderRadius:7, border:'1px solid #e2e8f0', background:'#fff', color:'#64748b', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
        Cancelar
      </button>
    </div>
  )

  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderBottom:'1px solid #f1f5f9', background:'#fff' }}
      onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
      onMouseLeave={e => e.currentTarget.style.background='#fff'}>
      <span style={{ flex:1, fontSize:13, color:'#1e293b', fontWeight:500 }}>{item.name}</span>
      <span style={{ fontSize:12, color:'#64748b', background:'#f1f5f9', padding:'2px 8px', borderRadius:20 }}>
        {item.capacity} pessoa{item.capacity !== 1 ? 's' : ''}
      </span>
      {item.is_couple && (
        <span style={{ fontSize:11, color:'#7c3aed', background:'#ede9fe', padding:'2px 8px', borderRadius:20, fontWeight:600 }}>
          Casal
        </span>
      )}
      <button onClick={() => setEdit(true)}
        style={{ padding:'4px 10px', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#64748b', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}
        onMouseEnter={e => { e.currentTarget.style.borderColor='#1a2d4f'; e.currentTarget.style.color='#1a2d4f' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.color='#64748b' }}>
        Editar
      </button>
      <button onClick={() => setConfirm(true)}
        style={{ padding:'4px 10px', borderRadius:6, border:'1px solid #fecaca', background:'#fff', color:'#dc2626', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}
        onMouseEnter={e => e.currentTarget.style.background='#fee2e2'}
        onMouseLeave={e => e.currentTarget.style.background='#fff'}>
        ×
      </button>
      {confirm && (
        <ConfirmModal
          message={`Remover "${item.name}"?`}
          onOk={() => { onDelete(item.id); setConfirm(false) }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  )
}

export default function AccommodationManager({ items, loading, onRefresh }) {
  const [name,     setName]     = useState('')
  const [capacity, setCapacity] = useState(1)
  const [couple,   setCouple]   = useState(false)
  const [adding,   setAdding]   = useState(false)
  const [search,   setSearch]   = useState('')

  const filtered = items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))

  const add = async () => {
    if (!name.trim()) return
    setAdding(true)
    try {
      await configApi.addAccommodation({ name: name.trim(), capacity: Number(capacity), is_couple: couple })
      setName(''); setCapacity(1); setCouple(false)
      toast.success('Acomodação adicionada.')
      onRefresh()
    } catch { toast.error('Erro ao adicionar.') }
    finally { setAdding(false) }
  }

  const del = async (id) => {
    await configApi.delAccommodation(id).catch(() => toast.error('Erro ao remover.'))
    onRefresh()
  }

  return (
    <div>
      {/* Busca */}
      <div style={{ marginBottom:10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
          style={{ ...inp, width:'100%', boxSizing:'border-box' }} onFocus={onF} onBlur={onB} />
      </div>

      {/* Adicionar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, flexWrap:'wrap', padding:'10px 14px', background:'#f8fafc', borderRadius:8, border:'1px solid #e2e8f0' }}>
        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key==='Enter' && add()}
          placeholder="Nome da acomodação…" style={{ ...inp, flex:1, minWidth:140 }} onFocus={onF} onBlur={onB} />
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          <label style={{ fontSize:12, color:'#64748b', fontWeight:600 }}>Pessoas:</label>
          <input type="number" min="1" max="20" value={capacity} onChange={e => setCapacity(e.target.value)}
            style={{ ...inp, width:54, textAlign:'center' }} onFocus={onF} onBlur={onB} />
        </div>
        <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', userSelect:'none', fontSize:13 }}>
          <input type="checkbox" checked={couple} onChange={e => setCouple(e.target.checked)}
            style={{ width:15, height:15, accentColor:'#1a2d4f', cursor:'pointer' }} />
          Casal
        </label>
        <button onClick={add} disabled={adding || !name.trim()}
          style={{ padding:'7px 18px', borderRadius:7, border:'none', background: adding||!name.trim() ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor: adding||!name.trim() ? 'default' : 'pointer', fontFamily:'inherit' }}>
          + Adicionar
        </button>
      </div>

      <p style={{ fontSize:12, color:'#94a3b8', margin:'0 0 8px' }}>
        {loading ? 'Carregando…' : `${filtered.length} de ${items.length} tipo${items.length !== 1 ? 's' : ''}`}
      </p>

      <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden' }}>
        {loading ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
        ) : filtered.length === 0 ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>
            {items.length === 0 ? 'Nenhuma acomodação.' : 'Nenhum resultado.'}
          </p>
        ) : filtered.map(item => (
          <Row key={item.id} item={item} onSave={onRefresh} onDelete={del} />
        ))}
      </div>
    </div>
  )
}
