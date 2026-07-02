/* Campos de um Modelo/Sugestão de pagamento: entrada (% do total) + nº de
 * parcelas + forma de pagamento + agenda de vencimentos. Usado nas Configurações
 * (PaymentPlanManager) e no roteiro (ItineraryDetail). */
const lbl = { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }

export default function PaymentPlanFields({ value, onChange, methodOptions = [], showName = false }) {
  const v = value || {}
  const set = (k, val) => onChange({ ...v, [k]: val })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {showName && (
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={lbl}>Nome do modelo</label>
          <input className="fi" value={v.name || ''} onChange={e => set('name', e.target.value)}
            placeholder="Ex.: 20% + 10x boleto" />
        </div>
      )}
      <div>
        <label style={lbl}>Entrada (% do total)</label>
        <input className="fi" type="number" min="0" max="100" step="0.01"
          value={v.down_payment_percent ?? ''} onChange={e => set('down_payment_percent', e.target.value)}
          placeholder="Ex.: 20" />
      </div>
      <div>
        <label style={lbl}>Nº de parcelas</label>
        <input className="fi" type="number" min="0" max="360"
          value={v.installments_count ?? ''} onChange={e => set('installments_count', e.target.value)}
          placeholder="Ex.: 10 (0 = à vista)" />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={lbl}>Forma de pagamento</label>
        <input className="fi" list="payment-plan-methods" value={v.payment_method || ''}
          onChange={e => set('payment_method', e.target.value)} placeholder="Ex.: Boleto, Cartão, PIX" />
        <datalist id="payment-plan-methods">
          {methodOptions.map(m => <option key={m} value={m} />)}
        </datalist>
      </div>
      <div>
        <label style={lbl}>1º vencimento (dias após aplicar)</label>
        <input className="fi" type="number" min="0" value={v.first_due_days ?? ''}
          onChange={e => set('first_due_days', e.target.value)} placeholder="Ex.: 30" />
      </div>
      <div>
        <label style={lbl}>Intervalo entre parcelas (dias)</label>
        <input className="fi" type="number" min="0" value={v.interval_days ?? ''}
          onChange={e => set('interval_days', e.target.value)} placeholder="Ex.: 30" />
      </div>
    </div>
  )
}
