import { useState } from 'react'
import { toast } from 'sonner'
import { Ic } from './Icon'

/**
 * Popup de mesclagem de registros duplicados (Passageiros, Agências).
 * Um dos registros selecionados é o "principal" (sobrevive); pra cada campo
 * que diverge entre os registros, a pessoa escolhe de qual registro vem o
 * valor final. Os demais registros vão pra aba "Excluídos" no final.
 *
 * Props:
 *   records   – array de registros selecionados (>=2), cada um com `id`
 *   fields    – [{ key, label, format?(value) }] campos comparáveis
 *   getLabel  – (record) => string — nome exibido de cada registro
 *   onMerge   – ({ winner_id, loser_ids, fields }) => Promise
 *   onClose   – () => void
 *   onDone    – () => void — chamado após mesclar com sucesso
 */
export default function MergeModal({ records, fields, getLabel, onMerge, onClose, onDone }) {
  const [winnerId, setWinnerId] = useState(records[0].id)
  const [choices,  setChoices]  = useState({}) // { fieldKey: recordId }
  const [busy,      setBusy]    = useState(false)

  const winner = records.find(r => r.id === winnerId)
  const others = records.filter(r => r.id !== winnerId)

  const valueOf = (rec, key) => {
    const raw = rec[key]
    const field = fields.find(f => f.key === key)
    if (raw == null || raw === '') return <span style={{ color:'#cbd5e1' }}>— vazio —</span>
    return field?.format ? field.format(raw) : String(raw)
  }

  const diffFields = fields.filter(f => {
    const vals = records.map(r => r[f.key] ?? '')
    return new Set(vals.map(v => String(v))).size > 1
  })

  const pickedSource = (key) => choices[key] ?? winnerId

  const handleMerge = async () => {
    setBusy(true)
    const fieldMap = {}
    diffFields.forEach(f => { fieldMap[f.key] = pickedSource(f.key) })
    try {
      await onMerge({ winner_id: winnerId, loser_ids: others.map(r => r.id), fields: fieldMap })
      toast.success('Registros mesclados com sucesso.')
      onDone?.()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Erro ao mesclar registros.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }} style={{ zIndex:800 }}>
      <div className="mbox" style={{ maxWidth:640, width:'100%' }} onClick={e => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">Mesclar {records.length} registros</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>

        <div className="mbody" style={{ maxHeight:'70vh', overflowY:'auto', display:'flex', flexDirection:'column', gap:16 }}>

          <div>
            <p style={{ fontSize:12.5, fontWeight:700, color:'#64748b', margin:'0 0 8px' }}>
              Qual registro vai sobreviver? (os outros vão pra aba "Excluídos")
            </p>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {records.map(r => (
                <label key={r.id} style={{
                  display:'flex', alignItems:'center', gap:10, padding:'9px 12px',
                  borderRadius:8, border:`1.5px solid ${winnerId === r.id ? '#2e6db4' : '#e2e8f0'}`,
                  background: winnerId === r.id ? '#eff6ff' : '#fff', cursor:'pointer',
                }}>
                  <input type="radio" name="winner" checked={winnerId === r.id} onChange={() => setWinnerId(r.id)} />
                  <span style={{ fontSize:13.5, fontWeight:600, color:'#1e293b' }}>{getLabel(r)}</span>
                  <span style={{ fontSize:11.5, color:'#94a3b8' }}>#{r.id}</span>
                </label>
              ))}
            </div>
          </div>

          {diffFields.length > 0 ? (
            <div>
              <p style={{ fontSize:12.5, fontWeight:700, color:'#64748b', margin:'0 0 8px' }}>
                Esses campos têm valores diferentes — escolha de qual registro manter cada um:
              </p>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {diffFields.map(f => (
                  <div key={f.key} style={{ border:'1px solid #e2e8f0', borderRadius:8, padding:'10px 12px' }}>
                    <p style={{ fontSize:12.5, fontWeight:700, color:'#1e293b', margin:'0 0 8px' }}>{f.label}</p>
                    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                      {records.map(r => (
                        <label key={r.id} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                          <input
                            type="radio"
                            name={`field-${f.key}`}
                            checked={pickedSource(f.key) === r.id}
                            onChange={() => setChoices(c => ({ ...c, [f.key]: r.id }))}
                          />
                          <span style={{ fontSize:12, color:'#94a3b8', minWidth:90 }}>{getLabel(r)}:</span>
                          <span style={{ fontSize:13, color:'#1e293b' }}>{valueOf(r, f.key)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p style={{ fontSize:12.5, color:'#94a3b8' }}>Todos os campos comparados já são iguais entre os registros.</p>
          )}
        </div>

        <div className="mfoot">
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleMerge} disabled={busy}>
            {busy ? 'Mesclando…' : 'Mesclar'}
          </button>
        </div>
      </div>
    </div>
  )
}
