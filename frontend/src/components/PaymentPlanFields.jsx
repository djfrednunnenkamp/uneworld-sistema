import { useState } from 'react'
import Dropdown from './Dropdown'
import { Ic } from './Icon'

/* Campos de um Modelo/Sugestão de pagamento, separados em dois blocos: ENTRADA
 * (opcional — valor em R$ OU % do total, com forma de pagamento própria) e
 * PARCELAS (nº de parcelas + forma de pagamento + agenda de vencimentos em dias).
 * Cada bloco tem um botão de ARREDONDAMENTO: define o passo (em R$) usado ao
 * arredondar os valores reais quando o modelo é aplicado num contrato.
 * Usado nas Configurações (PaymentPlanManager) e no roteiro (ItineraryDetail). */
const lbl = { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }
const sectionCard = { border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12, background: '#fff' }
const sectionTitle = { fontSize: 12, fontWeight: 800, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '.04em', paddingBottom: 8, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 7 }

// Opções de arredondamento (passo em R$). value=0.01 → 2 casas (centavos).
export const ROUNDING_OPTIONS = [
  { value: 0.01, label: 'Centavos (R$ 0,01)',   hint: '2 casas decimais — R$ 123,45' },
  { value: 0.10, label: 'Dez centavos (R$ 0,10)', hint: '1 casa decimal — R$ 123,40' },
  { value: 1,    label: 'Real inteiro (R$ 1)',   hint: 'sem centavos — R$ 123,00' },
  { value: 5,    label: 'R$ 5',                   hint: 'múltiplos de 5 — R$ 125,00' },
  { value: 10,   label: 'R$ 10',                  hint: 'múltiplos de 10 — R$ 120,00' },
  { value: 50,   label: 'R$ 50',                  hint: 'múltiplos de 50 — R$ 100,00' },
  { value: 100,  label: 'R$ 100',                 hint: 'múltiplos de 100 — R$ 100,00' },
]

// Arredonda n para o passo mais próximo (0/vazio → 2 casas por padrão).
export const roundToStep = (n, step) => {
  const s = Number(step) || 0.01
  return Math.round((Number(n) || 0) / s) * s
}
export const roundLabelShort = (step) => {
  const s = Number(step) || 0.01
  if (s === 0.01) return '2 casas'
  if (s === 0.10) return '1 casa'
  if (s < 1) return `R$ ${s.toFixed(2)}`
  return `R$ ${s}`
}

/* Pop-up que sugere os arredondamentos disponíveis. */
function RoundingPopup({ title, value, onSelect, onClose }) {
  const cur = Number(value) || 0.01
  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', backdropFilter: 'blur(2px)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onMouseDown={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 420, boxShadow: '0 24px 60px rgba(0,0,0,.28)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{title}</span>
          <button type="button" onClick={onClose} title="Fechar"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex', padding: 2 }}><Ic n="x" s={16} /></button>
        </div>
        <div style={{ padding: '8px 0', maxHeight: '60vh', overflowY: 'auto' }}>
          {ROUNDING_OPTIONS.map(o => {
            const sel = Math.abs(cur - o.value) < 1e-9
            return (
              <button key={o.value} type="button" onClick={() => { onSelect(o.value); onClose() }}
                style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', background: sel ? '#eff6ff' : 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f8fafc' }}
                onMouseLeave={e => { e.currentTarget.style.background = sel ? '#eff6ff' : 'transparent' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: sel ? 700 : 500, color: '#1e293b' }}>{o.label}</div>
                  <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{o.hint}</div>
                </div>
                {sel && <span style={{ color: '#2563eb', flexShrink: 0 }}><Ic n="check" s={15} /></span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* Botão que abre o pop-up de arredondamento. */
function RoundingButton({ value, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', padding: '6px 11px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.color = '#2563eb' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#475569' }}>
      <Ic n="wrench" s={12} /> Arredondar: {roundLabelShort(value)}
    </button>
  )
}

export default function PaymentPlanFields({ value, onChange, methodOptions = [] }) {
  const v = value || {}
  const set = (k, val) => onChange({ ...v, [k]: val })
  const mode = v.down_payment_mode || 'percent'
  const [roundingFor, setRoundingFor] = useState(null)   // null | 'down' | 'installment'
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
            <RoundingButton value={v.down_payment_rounding} onClick={() => setRoundingFor('down')} />
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
        <RoundingButton value={v.installment_rounding} onClick={() => setRoundingFor('installment')} />
      </section>

      {roundingFor === 'down' && (
        <RoundingPopup title="Arredondar o valor da entrada" value={v.down_payment_rounding}
          onSelect={val => set('down_payment_rounding', val)} onClose={() => setRoundingFor(null)} />
      )}
      {roundingFor === 'installment' && (
        <RoundingPopup title="Arredondar o valor das parcelas" value={v.installment_rounding}
          onSelect={val => set('installment_rounding', val)} onClose={() => setRoundingFor(null)} />
      )}
    </div>
  )
}
