import { useState } from 'react'
import { Ic } from './Icon'

/** Popup de RASCUNHOS reutilizável (igual ao de contratos). Lista os rascunhos
 * com "Continuar" e "Excluir". Props:
 *   title, drafts[], onResume(d), onDiscard(d):Promise, onClose,
 *   getLabel(d), getSubtitle(d), accent (cor)
 */
export default function DraftsPopup({ title = 'Rascunhos', drafts = [], onResume, onDiscard, onClose, getLabel, getSubtitle, accent = '#7c3aed' }) {
  const [busyId, setBusyId] = useState(null)
  const discard = async (d) => {
    setBusyId(d.id)
    try { await onDiscard(d) } finally { setBusyId(null) }
  }
  const chip = { fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 20, background: `${accent}22`, color: accent }
  return (
    <div className="overlay" onClick={onClose} style={{ zIndex: 550 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 580, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.24)' }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Ic n="edit" s={15} /> {title}
            <span style={chip}>{drafts.length}</span>
          </span>
          <button type="button" onClick={onClose} title="Fechar"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4, display: 'flex' }}>
            <Ic n="x" s={16} />
          </button>
        </div>
        <div style={{ padding: '12px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {drafts.length === 0 ? (
            <span style={{ fontSize: 13, color: '#94a3b8', padding: '8px 0' }}>Nenhum rascunho no momento.</span>
          ) : drafts.map(d => (
            <div key={d.id}
              style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: `1px solid ${accent}33`, borderRadius: 8, padding: '8px 8px 8px 12px', cursor: 'pointer' }}
              onClick={() => onResume(d)}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {getLabel(d) || 'Sem informações ainda'}
                </div>
                {getSubtitle && getSubtitle(d) && <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{getSubtitle(d)}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                <button type="button" className="r-btn edit" title="Continuar editando" onClick={() => onResume(d)}><Ic n="edit" s={13} /></button>
                <button type="button" className="r-btn del" title="Excluir rascunho" disabled={busyId === d.id} onClick={() => discard(d)}><Ic n="trash" s={13} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
