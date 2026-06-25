import { useState } from 'react'
import { toast } from 'sonner'
import { itinerariesApi } from '../api'
import DatePicker from './DatePicker'
import { Ic } from './Icon'

const lbl = { fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 5 }
const inp = { padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b', boxSizing: 'border-box', width: '100%' }

export default function ItineraryCreateModal({ onClose, onCreated }) {
  const [name,      setName]      = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate,   setEndDate]   = useState('')
  const [saving,    setSaving]    = useState(false)

  const save = async () => {
    if (!name.trim()) { toast.error('Informe o nome da viagem.'); return }
    setSaving(true)
    try {
      const r = await itinerariesApi.create({ name: name.trim(), start_date: startDate || null, end_date: endDate || null })
      toast.success('Roteiro criado.')
      onCreated(r.data)
    } catch {
      toast.error('Erro ao criar roteiro.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mbox" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">Novo roteiro</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15} /></button>
        </div>
        <div className="mbody" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={lbl}>Nome da viagem *</label>
            <input style={inp} autoFocus value={name} onChange={e => setName(e.target.value)}
              placeholder="Ex: Sicília, Itália e Malta Duas Ilhas Memoráveis" />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Data de início</label>
              <DatePicker value={startDate} relatedDate={endDate || null} onChange={setStartDate} fixed />
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Data de término</label>
              <DatePicker value={endDate} relatedDate={startDate || null} onChange={setEndDate} fixed />
            </div>
          </div>
        </div>
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Criando…' : 'Criar roteiro →'}
          </button>
        </div>
      </div>
    </div>
  )
}
