/* Campos de um Modelo/Sugestão de pagamento: entrada opcional (valor em R$ OU %
 * do total) + nº de parcelas + forma de pagamento + agenda de vencimentos (em
 * dias). Usado nas Configurações (PaymentPlanManager) e no roteiro (ItineraryDetail). */
const lbl = { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }

export default function PaymentPlanFields({ value, onChange, methodOptions = [] }) {
  const v = value || {}
  const set = (k, val) => onChange({ ...v, [k]: val })
  const mode = v.down_payment_mode || 'percent'
  const modeBtn = (m, label) => (
    <button type="button" onClick={() => set('down_payment_mode', m)}
      style={{ padding: '8px 14px', border: 'none', background: mode === m ? '#1a2d4f' : '#fff', color: mode === m ? '#fff' : '#475569', fontSize: 13, fontWeight: mode === m ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
      {label}
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Entrada — checkbox liga/desliga */}
      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!v.has_down_payment}
            onChange={e => set('has_down_payment', e.target.checked)}
            style={{ width: 15, height: 15, accentColor: '#1a2d4f', cursor: 'pointer' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Tem entrada?</span>
        </label>
        {v.has_down_payment && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>{mode === 'valor' ? 'Valor da entrada (R$)' : 'Entrada (% do total)'}</label>
              <input className="fi" type="number" min="0" step="0.01"
                value={v.down_payment_value ?? ''} onChange={e => set('down_payment_value', e.target.value)}
                placeholder={mode === 'valor' ? 'Ex.: 10000' : 'Ex.: 20'} />
            </div>
            <div style={{ display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
              {modeBtn('valor', 'R$')}
              {modeBtn('percent', '%')}
            </div>
          </div>
        )}
      </div>

      {/* Parcelas + forma + vencimentos */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={lbl}>Nº de parcelas</label>
          <input className="fi" type="number" min="0" max="360"
            value={v.installments_count ?? ''} onChange={e => set('installments_count', e.target.value)}
            placeholder="Ex.: 10 (0 = à vista)" />
        </div>
        <div>
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
    </div>
  )
}
