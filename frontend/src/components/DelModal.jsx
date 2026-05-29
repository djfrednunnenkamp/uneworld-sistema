import { Ic } from './Icon'

export default function DelModal({ name, onOk, onCancel }) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="mbox" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">Confirmar exclusão</span>
          <button className="mclose" onClick={onCancel}><Ic n="x" s={15}/></button>
        </div>
        <div className="mbody">
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }}><Ic n="warn" s={20}/></div>
            <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.7 }}>
              Tem certeza que deseja excluir <strong style={{ color: '#1e293b' }}>{name}</strong>?<br/>
              Esta ação não pode ser desfeita.
            </p>
          </div>
        </div>
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-danger"  onClick={onOk}>Excluir</button>
        </div>
      </div>
    </div>
  )
}
