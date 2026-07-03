/* Helpers puros dos modelos de pagamento do roteiro (sem React). Extraídos da
   página para serem compartilhados entre a casca (normalizeItinerary) e a
   aba de Pagamentos. Comportamento idêntico ao original. */

export const BLANK_PLAN = { name: '', a_vista: false, has_down_payment: false, down_payment_mode: 'percent', down_payment_value: '', down_payment_method: '', down_payment_rounding: 0.01, installments_count: '', payment_method: '', installment_rounding: 0.01, first_due_days: 30, interval_days: 30 }

export const planUid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.round(Math.random() * 1e6)}`)

// Nome automático quando o usuário não digita um.
export function planAutoName(p) {
  if (p.a_vista) return 'À vista' + (p.payment_method ? ` (${p.payment_method})` : '')
  const parts = []
  if (p.has_down_payment) {
    const val = Number(p.down_payment_value) || 0
    parts.push('Entrada ' + (p.down_payment_mode === 'valor' ? `R$ ${val.toLocaleString('pt-BR')}` : `${val}%`))
  }
  const n = parseInt(p.installments_count) || 0
  if (n > 0) parts.push(`${n}x`)
  else if (!p.has_down_payment) parts.push('À vista')
  return parts.join(' + ') || 'Modelo de pagamento'
}

// Resumo curto exibido no card.
export function planSummary(p) {
  if (p.a_vista) return 'à vista' + (p.payment_method ? ` · ${p.payment_method}` : '')
  const parts = []
  if (p.has_down_payment) {
    const val = Number(p.down_payment_value) || 0
    parts.push('entrada ' + (p.down_payment_mode === 'valor' ? `R$ ${val.toLocaleString('pt-BR')}` : `${val}%`))
  }
  const n = parseInt(p.installments_count) || 0
  parts.push(n > 0 ? `${n}x` : 'à vista')
  if (p.payment_method) parts.push(p.payment_method)
  return parts.join(' · ')
}

// Copia os campos de um modelo (das Configurações ou do editor) num item da lista.
export const planFromModel = (p) => ({
  _uid: planUid(), name: p.name || '', a_vista: !!p.a_vista, has_down_payment: !!p.has_down_payment,
  down_payment_mode: p.down_payment_mode || 'percent', down_payment_value: p.down_payment_value ?? '',
  down_payment_method: p.down_payment_method || '', down_payment_rounding: p.down_payment_rounding ?? 0.01,
  installments_count: p.installments_count ?? '', payment_method: p.payment_method || '',
  installment_rounding: p.installment_rounding ?? 0.01,
  first_due_days: p.first_due_days ?? 30, interval_days: p.interval_days ?? 30,
})

// Payload p/ salvar um modelo como GLOBAL (Configurações › Modelos de Pagamento).
export const planToConfigPayload = (p) => ({
  name: p.name, a_vista: !!p.a_vista, has_down_payment: !!p.has_down_payment,
  down_payment_mode: p.down_payment_mode || 'percent', down_payment_value: Number(p.down_payment_value) || 0,
  down_payment_method: p.down_payment_method || '',
  down_payment_rounding: p.down_payment_rounding === '' || p.down_payment_rounding == null ? 0.01 : Number(p.down_payment_rounding),
  installments_count: parseInt(p.installments_count) || 0, payment_method: p.payment_method || '',
  installment_rounding: p.installment_rounding === '' || p.installment_rounding == null ? 0.01 : Number(p.installment_rounding),
  first_due_days: parseInt(p.first_due_days) || 0, interval_days: parseInt(p.interval_days) || 0,
})

// Normaliza o roteiro carregado: garante payment_plans como lista (migra o
// payment_plan único antigo) e dá um _uid a cada item.
export const normalizeItinerary = (d) => {
  let plans = Array.isArray(d.payment_plans) ? d.payment_plans : []
  if (!plans.length && d.payment_plan) plans = [d.payment_plan]
  plans = plans.map(p => ({ ...p, _uid: p._uid || planUid() }))
  return { ...d, payment_plans: plans }
}
