import { memo, useState } from 'react'
import { toast } from 'sonner'
import { configApi } from '../../api'
import { Ic } from '../Icon'
import PaymentPlanFields, { PaymentPlanTester } from '../PaymentPlanFields'
import { FormRow, TabCard } from './ui'
import { BLANK_PLAN, planUid, planAutoName, planSummary, planFromModel, planToConfigPayload } from './paymentPlan'

/* Aba "Pagamentos": modelos de pagamento que o roteiro oferece ao contrato.
   Cada modelo pode vir das Configurações (global) ou ser exclusivo do roteiro. */
function PaymentsTab({ data, setData, canEdit, paymentPlanOpts, paymentMethodOpts, reloadPaymentPlans }) {
  const [planEditor, setPlanEditor]         = useState(null)   // { index, plan, isNew, makeGlobal } | null
  const [planTesting, setPlanTesting]       = useState(false)
  const [showPlanPicker, setShowPlanPicker] = useState(false)
  const [pickerSel, setPickerSel]           = useState([])

  const plans = data.payment_plans || []

  const openPlanPicker = () => {
    setPickerSel(plans.filter(p => p._cfgId).map(p => p._cfgId))
    setShowPlanPicker(true)
  }
  // Sincroniza a seleção: adiciona os recém-marcados e remove os desmarcados vindos
  // das Configurações. Itens exclusivos do roteiro (sem _cfgId) não são tocados.
  const applyPlanPicker = () => {
    setData(d => {
      const current = d.payment_plans || []
      const currentCfgIds = new Set(current.filter(p => p._cfgId).map(p => p._cfgId))
      const kept  = current.filter(p => !p._cfgId || pickerSel.includes(p._cfgId))
      const toAdd = pickerSel.filter(cid => !currentCfgIds.has(cid))
        .map(cid => paymentPlanOpts.find(x => x.id === cid)).filter(Boolean)
        .map(p => ({ ...planFromModel(p), _cfgId: p.id }))
      return { ...d, payment_plans: [...kept, ...toAdd] }
    })
    setShowPlanPicker(false); setPickerSel([])
  }
  const openNewPlan  = () => setPlanEditor({ index: null, plan: { ...BLANK_PLAN, _uid: planUid() }, isNew: true, makeGlobal: false })
  const openEditPlan = (i) => setPlanEditor({ index: i, plan: { ...plans[i] }, isNew: false, makeGlobal: false })
  const removePlan   = (i) => setData(d => ({ ...d, payment_plans: (d.payment_plans || []).filter((_, j) => j !== i) }))

  const savePlanEditor = async () => {
    const ed = planEditor
    const plan = { ...ed.plan, name: (ed.plan.name || '').trim() || planAutoName(ed.plan) }
    setData(d => {
      const list = [...(d.payment_plans || [])]
      if (ed.isNew) list.push(plan); else list[ed.index] = plan
      return { ...d, payment_plans: list }
    })
    // "Global" → também cria um Modelo em Configurações, disponível em outros roteiros.
    if (ed.makeGlobal) {
      try {
        await configApi.addPaymentPlan(planToConfigPayload(plan))
        reloadPaymentPlans?.()
        toast.success('Salvo no roteiro e como modelo global.')
      } catch { toast.error('Salvo no roteiro, mas falhou ao salvar como global.') }
    }
    setPlanEditor(null)
  }

  return (
    <TabCard>
      <FormRow label="Formas de pagamento (aplicáveis no contrato)" last>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: plans.length ? 12 : 0 }}>
          <button type="button" disabled={!canEdit} onClick={openPlanPicker}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: canEdit ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
            <Ic n="plus" s={13} /> Adicionar das Configurações
          </button>
          <button type="button" disabled={!canEdit} onClick={openNewPlan}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', fontSize: 13, fontWeight: 700, cursor: canEdit ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
            <Ic n="plus" s={13} /> Criar exclusiva deste roteiro
          </button>
        </div>
        {plans.length === 0 ? (
          <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Nenhuma forma de pagamento definida. Adicione um modelo das Configurações ou crie uma exclusiva deste roteiro.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {plans.map((p, i) => (
              <div key={p._uid || i} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', background: '#fff' }}>
                <div style={{ flex: 1, minWidth: 0, cursor: canEdit ? 'pointer' : 'default' }} onClick={() => canEdit && openEditPlan(i)}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || planAutoName(p)}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{planSummary(p)}</div>
                </div>
                {canEdit && (
                  <div className="r-acts" style={{ flexShrink: 0 }}>
                    <button className="r-btn edit" title="Editar (só neste roteiro)" onClick={() => openEditPlan(i)}><Ic n="edit" s={13} /></button>
                    <button className="r-btn del"  title="Remover deste roteiro"      onClick={() => removePlan(i)}><Ic n="trash" s={13} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </FormRow>

      {/* Popup: adicionar modelos das Configurações (multi-seleção) */}
      {showPlanPicker && (
        <div onMouseDown={e => { if (e.target === e.currentTarget) setShowPlanPicker(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onMouseDown={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 460, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.28)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Adicionar modelos das Configurações</span>
              <button type="button" onClick={() => setShowPlanPicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex', padding: 2 }}><Ic n="x" s={16} /></button>
            </div>
            <div style={{ padding: '8px 0', overflowY: 'auto', flex: 1 }}>
              {paymentPlanOpts.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '24px 0' }}>Nenhum modelo global cadastrado em Configurações › Modelos de Pagamento.</p>
              ) : paymentPlanOpts.map(p => {
                const sel = pickerSel.includes(p.id)
                return (
                  <div key={p.id} onClick={() => setPickerSel(s => s.includes(p.id) ? s.filter(x => x !== p.id) : [...s, p.id])}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', cursor: 'pointer', background: sel ? '#f0f6ff' : 'transparent' }}>
                    <input type="checkbox" readOnly checked={sel} style={{ width: 15, height: 15, accentColor: '#2e6db4', pointerEvents: 'none', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: sel ? 700 : 500, color: '#1e293b' }}>{p.name}</div>
                      <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{planSummary(p)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
              <button type="button" onClick={() => setShowPlanPicker(false)} className="btn btn-outline">Cancelar</button>
              <button type="button" onClick={applyPlanPicker} className="btn btn-primary">
                Confirmar{pickerSel.length ? ` (${pickerSel.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: criar/editar um modelo exclusivo do roteiro */}
      {planEditor && (
        <div onMouseDown={e => { if (e.target === e.currentTarget) setPlanEditor(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onMouseDown={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 840, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.25)' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                {planEditor.isNew ? 'Nova forma de pagamento (deste roteiro)' : 'Editar forma de pagamento (deste roteiro)'}
              </div>
              <button type="button" onClick={() => setPlanTesting(true)}
                style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#dbeafe' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#eff6ff' }}>
                <Ic n="card" s={14} /> Testar forma de pagamento
              </button>
              <button type="button" onClick={() => setPlanEditor(null)} title="Fechar" style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex', padding: 2 }}><Ic n="x" s={18} /></button>
            </div>
            <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>Nome do modelo</label>
                <input className="fi" value={planEditor.plan.name || ''} onChange={e => setPlanEditor(ed => ({ ...ed, plan: { ...ed.plan, name: e.target.value } }))} placeholder="Deixe em branco para gerar automaticamente (ex.: Entrada 20% + 10x)" autoFocus />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 16px', background: '#f8fafc' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>Também salvar como modelo global</div>
                  <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{planEditor.makeGlobal ? 'Fica disponível em Configurações e em outros roteiros.' : 'Exclusivo deste roteiro (só aqui).'}</div>
                </div>
                <label className="toggle-wrap">
                  <span className="toggle">
                    <input type="checkbox" checked={!!planEditor.makeGlobal} onChange={e => setPlanEditor(ed => ({ ...ed, makeGlobal: e.target.checked }))} />
                    <span className="toggle-slider" />
                  </span>
                  <span className="toggle-label">{planEditor.makeGlobal ? 'Global' : 'Só aqui'}</span>
                </label>
              </div>
              <PaymentPlanFields value={planEditor.plan} methodOptions={paymentMethodOpts} showTestButton={false}
                onChange={pp => setPlanEditor(ed => ({ ...ed, plan: pp }))} />
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
              <button type="button" onClick={() => setPlanEditor(null)} className="btn btn-outline">Cancelar</button>
              <button type="button" onClick={savePlanEditor} className="btn btn-primary">Salvar</button>
            </div>
          </div>
          {planTesting && <PaymentPlanTester value={planEditor.plan} onClose={() => setPlanTesting(false)} />}
        </div>
      )}
    </TabCard>
  )
}

export default memo(PaymentsTab)
