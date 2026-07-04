import { Ic } from './Icon'

/** "Realmente deseja sair?" — alterações não salvas.
 * Props: onDiscard, onSaveDraft?, onSave?, onStay, saving, entity.
 * - onSaveDraft: "Salvar nos rascunhos" (quando aplicável).
 * - onSave: "Salvar" (finalizar) — só quando tudo obrigatório está preenchido. */
export default function LeaveGuardModal({ onDiscard, onSaveDraft, onSave, onStay, saving = false, entity = 'cadastro' }) {
  return (
    <div onClick={e => { if (e.target === e.currentTarget && !saving) onStay() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 700, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 540, boxShadow: '0 24px 64px rgba(0,0,0,.28)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: '#fffbeb', color: '#b45309', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Ic n="warn" s={19} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Sair sem salvar?</div>
            <div style={{ fontSize: 12.5, color: '#64748b' }}>Você tem alterações não salvas no {entity}.</div>
          </div>
          <button type="button" onClick={() => !saving && onStay()} title="Continuar editando"
            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e6eaf1', background: '#fff', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n="x" s={16} /></button>
        </div>
        <div style={{ padding: '16px 20px', fontSize: 13.5, color: '#475569', lineHeight: 1.6 }}>
          {onSave
            ? 'O que você quer fazer antes de sair?'
            : 'Ainda faltam campos obrigatórios para finalizar. Você pode salvar como rascunho e continuar depois.'}
        </div>
        <div style={{ borderTop: '1px solid #eef2f7', padding: '14px 20px', display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={onDiscard} disabled={saving}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: '1px solid #fecaca', background: '#fff', color: '#dc2626', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Ic n="trash" s={14} /> Descartar
          </button>
          {onSaveDraft && (
            <button type="button" onClick={onSaveDraft} disabled={saving}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: '1px solid #ddd6fe', background: '#faf5ff', color: '#7c3aed', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: saving ? .6 : 1 }}>
              <Ic n="edit" s={14} /> {saving ? 'Salvando…' : 'Salvar nos rascunhos'}
            </button>
          )}
          {onSave && (
            <button type="button" onClick={onSave} disabled={saving}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: saving ? .6 : 1 }}>
              <Ic n="check" s={15} /> {saving ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
