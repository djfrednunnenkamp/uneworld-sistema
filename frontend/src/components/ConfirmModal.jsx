import { Ic } from './Icon'

/**
 * Modal de confirmação reutilizável.
 * Props:
 *   title   — título (default: "Confirmar exclusão")
 *   message — mensagem principal
 *   detail  — detalhe secundário (opcional)
 *   okLabel — texto do botão de confirmar (default: "Excluir")
 *   onOk    — callback ao confirmar
 *   onCancel— callback ao cancelar / fechar
 *   danger  — destaque vermelho mais forte (cabeçalho/ícone), pra ações
 *             realmente destrutivas (ex: apagar tudo de uma importação CSV)
 */
export default function ConfirmModal({ title = 'Confirmar exclusão', message, detail, okLabel = 'Excluir', onOk, onCancel, danger = false, zIndex }) {
  return (
    <div className="overlay" style={zIndex ? { zIndex } : undefined} onClick={onCancel}>
      <div className="mbox" style={{ maxWidth: 400, border: danger ? '1.5px solid #fecaca' : undefined }} onClick={e => e.stopPropagation()}>
        <div className="mhead" style={danger ? { background:'#fef2f2', borderBottom:'1px solid #fecaca' } : undefined}>
          <span className="mtitle" style={danger ? { color:'#b91c1c' } : undefined}>{title}</span>
          <button className="mclose" onClick={onCancel}><Ic n="x" s={15}/></button>
        </div>
        <div className="mbody">
          <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
            <div style={{ color: danger ? '#dc2626' : '#f59e0b', flexShrink:0, marginTop:2 }}><Ic n="warn" s={20}/></div>
            <div>
              <p style={{ fontSize:14, color: danger ? '#991b1b' : '#475569', fontWeight: danger ? 600 : 400, lineHeight:1.7, margin:'0 0 4px' }}>{message}</p>
              {detail && <p style={{ fontSize:13, color:'#94a3b8', margin:0 }}>{detail}</p>}
              <p style={{ fontSize:13, color: danger ? '#dc2626' : '#94a3b8', fontWeight: danger ? 600 : 400, margin:'8px 0 0' }}>Esta ação não pode ser desfeita.</p>
            </div>
          </div>
        </div>
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-danger"  onClick={onOk}>{okLabel}</button>
        </div>
      </div>
    </div>
  )
}
