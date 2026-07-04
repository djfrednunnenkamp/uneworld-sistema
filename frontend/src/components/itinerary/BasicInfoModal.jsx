import { Ic } from '../Icon'
import BasicInfoTab from './BasicInfoTab'

/* Pop-up de "Informações básicas" do roteiro. Reaproveita o formulário do
   BasicInfoTab (agora em duas colunas) e é aberto pelo botão ao lado de Salvar. */
export default function BasicInfoModal({ data, setData, canEdit, categoryOptions, onClose }) {
  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mbox" style={{ maxWidth: 860, width: '100%' }} onClick={e => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">Informações básicas</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15} /></button>
        </div>
        <div className="mbody">
          <BasicInfoTab data={data} setData={setData} canEdit={canEdit} categoryOptions={categoryOptions} />
        </div>
        <div className="mfoot">
          <button className="btn btn-primary" onClick={onClose}>Concluir</button>
        </div>
      </div>
    </div>
  )
}
