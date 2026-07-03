import { memo } from 'react'
import { Ic } from '../Icon'
import { TabCard } from './ui'
import { inp } from './constants'

/* Aba "Regras": as cláusulas do contrato definidas pelo roteiro. Mantém a
   funcionalidade original (cláusulas cadastradas em Config + específicas do roteiro).
   O contrato feito com este roteiro herda o que estiver marcado/escrito aqui. */
function ClausesTab({ data, setData, canEdit, clauseList }) {
  const toggleClause      = (cid) => setData(d => { const cur = d.clauses || []; return { ...d, clauses: cur.includes(cid) ? cur.filter(x => x !== cid) : [...cur, cid] } })
  const addCustomClause   = () => setData(d => ({ ...d, custom_clauses: [...(d.custom_clauses || []), { name: '', content: '' }] }))
  const updateCustomClause = (i, k, v) => setData(d => ({ ...d, custom_clauses: (d.custom_clauses || []).map((c, j) => j === i ? { ...c, [k]: v } : c) }))
  const removeCustomClause = (i) => setData(d => ({ ...d, custom_clauses: (d.custom_clauses || []).filter((_, j) => j !== i) }))

  return (
    <TabCard style={{ padding: '18px 24px' }}>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
        As cláusulas marcadas/escritas aqui são as que o contrato feito com este roteiro vai usar.
      </p>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a2d4f', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Cláusulas cadastradas</div>
      {clauseList.length === 0 ? (
        <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 18px' }}>Nenhuma cláusula cadastrada em Configurações → Cláusulas de Contrato.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 22, maxHeight: 240, overflowY: 'auto' }}>
          {clauseList.map(c => (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: canEdit ? 'pointer' : 'default' }}>
              <input type="checkbox" checked={(data.clauses || []).includes(c.id)} disabled={!canEdit}
                onChange={() => toggleClause(c.id)} style={{ width: 15, height: 15, accentColor: '#1a2d4f' }} />
              <span style={{ fontSize: 13, color: '#1e293b' }}>{c.name}</span>
            </label>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a2d4f', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Cláusulas específicas deste roteiro</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(data.custom_clauses || []).map((c, i) => (
          <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...inp, flex: 1 }} value={c.name || ''} disabled={!canEdit} placeholder="Título da cláusula"
                onChange={e => updateCustomClause(i, 'name', e.target.value)} />
              {canEdit && (
                <button type="button" onClick={() => removeCustomClause(i)}
                  style={{ padding: 8, borderRadius: 6, border: '1px solid #fee2e2', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', flexShrink: 0 }}>
                  <Ic n="trash" s={14} />
                </button>
              )}
            </div>
            <textarea style={{ ...inp, minHeight: 80, resize: 'vertical' }} value={c.content || ''} disabled={!canEdit} placeholder="Texto da cláusula"
              onChange={e => updateCustomClause(i, 'content', e.target.value)} />
          </div>
        ))}
        {canEdit && (
          <button type="button" onClick={addCustomClause}
            style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 7, border: '1px dashed #cbd5e1', background: '#fafbfc', color: '#1a2d4f', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            + Adicionar cláusula específica
          </button>
        )}
      </div>
    </TabCard>
  )
}

export default memo(ClausesTab)
