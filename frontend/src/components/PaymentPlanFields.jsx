import Dropdown from './Dropdown'

/* Campos de um Modelo/Sugestão de pagamento, separados em dois blocos: ENTRADA
 * (opcional — valor em R$ OU % do total, com forma de pagamento própria) e
 * PARCELAS (nº de parcelas + forma de pagamento + agenda de vencimentos em dias).
 * Usado nas Configurações (PaymentPlanManager) e no roteiro (ItineraryDetail). */
const lbl = { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }
const sectionCard = { border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12, background: '#fff' }
const sectionTitle = { fontSize: 12, fontWeight: 800, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '.04em', paddingBottom: 8, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 7 }

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

  // Opções do dropdown de forma de pagamento — inclui os valores já salvos,
  // mesmo que não estejam mais na lista de Formas de Pagamento das Configurações.
  const methodOpts = Array.from(new Set([...methodOptions, v.payment_method, v.down_payment_method].filter(Boolean)))
    .map(m => ({ value: m, label: m }))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', gap: 14, alignItems: 'start' }}>
      {/* ── Bloco ENTRADA ── */}
      <section style={sectionCard}>
        <div style={sectionTitle}>
          <span>Entrada</span>
          <label className="toggle-wrap" style={{ marginLeft: 'auto' }}>
            <span className="toggle">
              <input type="checkbox" checked={!!v.has_down_payment}
                onChange={e => set('has_down_payment', e.target.checked)} />
              <span className="toggle-slider" />
            </span>
            <span className="toggle-label">{v.has_down_payment ? 'Sim' : 'Não'}</span>
          </label>
        </div>
        {v.has_down_payment ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
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
            <div>
              <label style={lbl}>Forma de pagamento da entrada</label>
              <Dropdown value={v.down_payment_method || null} options={methodOpts}
                placeholder="Selecione a forma" searchable clearable
                onChange={val => set('down_payment_method', val || '')} />
            </div>
          </>
        ) : (
          <p style={{ fontSize: 12.5, color: '#94a3b8', margin: 0 }}>Sem entrada — o valor é todo dividido nas parcelas.</p>
        )}
      </section>

      {/* ── Bloco PARCELAS ── */}
      <section style={sectionCard}>
        <div style={sectionTitle}><span>Parcelas</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12 }}>
          <div>
            <label style={lbl}>Número de parcelas</label>
            <input className="fi" type="number" min="0" max="360"
              value={v.installments_count ?? ''} onChange={e => set('installments_count', e.target.value)}
              placeholder="Ex.: 10 (0 = à vista)" />
          </div>
          <div>
            <label style={lbl}>Forma de pagamento</label>
            <Dropdown value={v.payment_method || null} options={methodOpts}
              placeholder="Selecione a forma" searchable clearable
              onChange={val => set('payment_method', val || '')} />
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
      </section>
    </div>
  )
}
