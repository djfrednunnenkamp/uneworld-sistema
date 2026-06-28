import { useState } from 'react'
import { toast } from 'sonner'
import { Ic } from './Icon'

/**
 * Ações de uma linha na aba "Excluídos": Restaurar (volta o item) e, quando
 * permitido, Excluir definitivamente (purge). O botão de purge só aparece para
 * superusuário com ALLOW_HARD_DELETE ligado no .env (controlado via canPurge).
 *
 * Props:
 *   row, getLabel(row)  — item e seu nome (para a confirmação)
 *   onRestore(id)       — () => Promise
 *   onPurge(id)         — () => Promise
 *   canPurge            — bool
 *   onChanged()         — recarrega as listas após a ação
 */
export default function TrashRowActions({ row, getLabel, onRestore, onPurge, canPurge, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const restore = async () => {
    setBusy(true)
    try { await onRestore(row.id); toast.success('Restaurado com sucesso.'); onChanged?.() }
    catch { toast.error('Erro ao restaurar.') }
    finally { setBusy(false) }
  }
  const purge = async () => {
    setBusy(true)
    try { await onPurge(row.id); toast.success('Excluído definitivamente.'); setConfirm(false); onChanged?.() }
    catch (e) { toast.error(e?.response?.data?.error || 'Erro ao excluir definitivamente.') }
    finally { setBusy(false) }
  }

  const btn = (title, icon, color, onClick) => (
    <button type="button" title={title} onClick={onClick} disabled={busy}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: `1px solid ${color}33`, background: `${color}14`, color, cursor: busy ? 'default' : 'pointer', flexShrink: 0, opacity: busy ? .6 : 1 }}>
      <Ic n={icon} s={13} />
    </button>
  )
  const name = getLabel?.(row) || `#${row.id}`

  return (
    <>
      {btn('Restaurar', 'rotate', '#059669', restore)}
      {canPurge && btn('Excluir definitivamente', 'trash', '#dc2626', () => setConfirm(true))}
      {confirm && (
        <div className="overlay" onClick={() => setConfirm(false)}>
          <div className="mbox" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="mhead">
              <span className="mtitle">Excluir definitivamente</span>
              <button className="mclose" onClick={() => setConfirm(false)}><Ic n="x" s={15} /></button>
            </div>
            <div className="mbody">
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ color: '#dc2626', flexShrink: 0, marginTop: 2 }}><Ic n="warn" s={20} /></div>
                <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.7 }}>
                  Excluir <strong style={{ color: '#1e293b' }}>{name}</strong> de forma <strong style={{ color: '#dc2626' }}>definitiva</strong>?<br />
                  Esta ação remove o registro do banco e <strong>não pode ser desfeita</strong>.
                </p>
              </div>
            </div>
            <div className="mfoot">
              <button className="btn btn-outline" onClick={() => setConfirm(false)} disabled={busy}>Cancelar</button>
              <button className="btn btn-danger" onClick={purge} disabled={busy}>{busy ? 'Excluindo…' : 'Excluir definitivamente'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
