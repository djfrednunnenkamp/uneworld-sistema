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

// Opções de arredondamento (passo em R$), do mais fino ao mais grosso. Em reais,
// R$ 0,01 (centavo) é a menor unidade real — não há como ir abaixo de 2 casas.
export const ROUNDING_OPTIONS = [
  { value: 0.01, label: 'Centavos (R$ 0,01)' },
  { value: 0.05, label: 'Cinco centavos (R$ 0,05)' },
  { value: 0.10, label: 'Dez centavos (R$ 0,10)' },
  { value: 0.25, label: 'Vinte e cinco centavos (R$ 0,25)' },
  { value: 0.50, label: 'Cinquenta centavos (R$ 0,50)' },
  { value: 1,    label: 'Real inteiro (R$ 1)' },
  { value: 5,    label: 'R$ 5' },
  { value: 10,   label: 'R$ 10' },
  { value: 25,   label: 'R$ 25' },
  { value: 50,   label: 'R$ 50' },
  { value: 100,  label: 'R$ 100' },
  { value: 500,  label: 'R$ 500' },
  { value: 1000, label: 'R$ 1.000' },
]
// Número de exemplo mostrado em cada opção (com casas "sujas", como o cálculo gera).
const ROUNDING_SAMPLE = 1125.552
const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const brl3 = (n) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })

// Arredonda n para o passo mais próximo (0/vazio → 2 casas por padrão).
export const roundToStep = (n, step) => {
  const s = Number(step) || 0.01
  // toFixed(2) limpa o ruído de float (ex.: 120.30000000000001) — reais têm 2 casas.
  return Number((Math.round((Number(n) || 0) / s) * s).toFixed(2))
}
export const roundLabelShort = (step) => {
  const s = Number(step) || 0.01
  return s < 1 ? `R$ ${s.toFixed(2).replace('.', ',')}` : `R$ ${s.toLocaleString('pt-BR')}`
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/* Simula um plano de pagamento para um valor total — MESMA lógica que o contrato
 * usa ao aplicar a sugestão (entrada + parcelas iguais, última absorvendo a
 * diferença, com o arredondamento configurado). Devolve os números "que o cliente
 * receberia", sem tocar em estado nenhum. */
export function simulatePaymentPlan(plan, total) {
  const p = plan || {}
  const t = round2(total)
  const n = Math.max(0, parseInt(p.installments_count) || 0)
  const hasDp = !!p.has_down_payment
  const dpMode = p.down_payment_mode || 'percent'
  const dpVal = Number(p.down_payment_value || 0)
  const dpRound = Number(p.down_payment_rounding) || 0.01
  const instRound = Number(p.installment_rounding) || 0.01
  const firstDue = parseInt(p.first_due_days) || 0
  const interval = parseInt(p.interval_days) || 0
  const method = p.payment_method || ''
  const dpMethod = p.down_payment_method || ''

  // À vista: pagamento único do total (arredondado pelo passo do "valor").
  if (p.a_vista) {
    return { total: t, entrada: null, avista: { value: roundToStep(t, instRound), method, dueDays: firstDue }, installments: [] }
  }

  const entradaVal = hasDp ? roundToStep(dpMode === 'valor' ? dpVal : t * dpVal / 100, dpRound) : 0
  const entrada = (hasDp && entradaVal > 0) ? { value: entradaVal, method: dpMethod, dueDays: 0 } : null

  if (n <= 0) {
    // Sem parcelas → pagamento à vista do total cheio (é como o contrato aplica).
    return { total: t, entrada: null, avista: { value: round2(t), method, dueDays: firstDue }, installments: [] }
  }
  const remaining = round2(t - entradaVal)
  const base = roundToStep(remaining / n, instRound)
  const installments = Array.from({ length: n }, (_, i) => ({
    n: i + 1,
    value: i === n - 1 ? round2(remaining - base * (n - 1)) : base,
    method,
    dueDays: firstDue + i * interval,
  }))
  return { total: t, entrada, avista: null, installments }
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
        <div style={{ padding: '6px 18px 10px', fontSize: 11.5, color: '#94a3b8', borderBottom: '1px solid #f1f5f9', marginBottom: 4 }}>
          Veja como <b style={{ color: '#64748b' }}>R$ {brl3(ROUNDING_SAMPLE)}</b> fica em cada opção:
        </div>
        <div style={{ padding: '4px 0 8px', maxHeight: '52vh', overflowY: 'auto' }}>
          {ROUNDING_OPTIONS.map(o => {
            const sel = Math.abs(cur - o.value) < 1e-9
            return (
              <button key={o.value} type="button" onClick={() => { onSelect(o.value); onClose() }}
                style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 18px', background: sel ? '#eff6ff' : 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f8fafc' }}
                onMouseLeave={e => { e.currentTarget.style.background = sel ? '#eff6ff' : 'transparent' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: sel ? 700 : 500, color: '#1e293b' }}>{o.label}</div>
                  <div style={{ fontSize: 11.5, color: '#94a3b8' }}>R$ {brl3(ROUNDING_SAMPLE)} → <b style={{ color: '#475569' }}>R$ {brl(roundToStep(ROUNDING_SAMPLE, o.value))}</b></div>
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
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', padding: '5px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'none', letterSpacing: 'normal', whiteSpace: 'nowrap' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.color = '#2563eb' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#475569' }}>
      <Ic n="wrench" s={12} /> Arredondar: {roundLabelShort(value)}
    </button>
  )
}

const dueLabel = (days) => days === 0 ? 'na aplicação' : `em ${days} ${days === 1 ? 'dia' : 'dias'}`

/* Simulador: digita-se um valor total e vê-se a entrada + parcelas que o cliente
 * receberia com os parâmetros atuais (inclui os arredondamentos). */
export function PaymentPlanTester({ value, onClose }) {
  const [total, setTotal] = useState('')
  // Aceita "12000", "12000.50" e o formato pt-BR "12.000,50".
  const t = (() => {
    const s = String(total).trim()
    if (!s) return 0
    return s.includes(',') ? (Number(s.replace(/\./g, '').replace(',', '.')) || 0) : (Number(s) || 0)
  })()
  const sim = t > 0 ? simulatePaymentPlan(value, t) : null
  const parcSum = sim ? round2(sim.installments.reduce((a, b) => a + b.value, 0)) : 0
  const grand = sim ? round2((sim.entrada?.value || 0) + (sim.avista?.value || 0) + parcSum) : 0
  const bate = sim ? Math.abs(grand - sim.total) < 0.005 : true

  const row = (label, val, method, dueDays) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{label}</div>
        <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{[method || null, dueLabel(dueDays)].filter(Boolean).join(' · ')}</div>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a', flexShrink: 0 }}>R$ {brl(val)}</div>
    </div>
  )

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', backdropFilter: 'blur(2px)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onMouseDown={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 460, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.28)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Testar forma de pagamento</span>
          <button type="button" onClick={onClose} title="Fechar"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex', padding: 2 }}><Ic n="x" s={16} /></button>
        </div>
        <div style={{ padding: '16px 18px', overflowY: 'auto' }}>
          <label style={lbl}>Valor total do contrato (R$)</label>
          <input className="fi" inputMode="decimal" value={total} autoFocus
            onChange={e => setTotal(e.target.value)} placeholder="Ex.: 12000" />
          {!sim ? (
            <p style={{ fontSize: 12.5, color: '#94a3b8', margin: '14px 0 0' }}>Digite um valor total para ver como ficaria para o cliente.</p>
          ) : (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Ficaria assim para o cliente</div>
              {sim.entrada && row('Entrada', sim.entrada.value, sim.entrada.method, sim.entrada.dueDays)}
              {sim.avista && row('Pagamento à vista', sim.avista.value, sim.avista.method, sim.avista.dueDays)}
              {sim.installments.map(p => row(`Parcela ${p.n} de ${sim.installments.length}`, p.value, p.method, p.dueDays))}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12, padding: '10px 12px', borderRadius: 8, background: bate ? '#f0fdf4' : '#fef2f2', border: `1px solid ${bate ? '#bbf7d0' : '#fecaca'}` }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: bate ? '#15803d' : '#b91c1c' }}>
                  {bate ? 'Soma confere com o total' : 'Atenção: a soma não bate com o total'}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: bate ? '#15803d' : '#b91c1c' }}>R$ {brl(grand)}</span>
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button type="button" onClick={onClose} className="btn btn-outline">Fechar</button>
        </div>
      </div>
    </div>
  )
}

export default function PaymentPlanFields({ value, onChange, methodOptions = [], showTestButton = true }) {
  const v = value || {}
  const set = (k, val) => onChange({ ...v, [k]: val })
  const mode = v.down_payment_mode || 'percent'
  const [roundingFor, setRoundingFor] = useState(null)   // null | 'down' | 'installment'
  const [testing, setTesting] = useState(false)
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Tipo de pagamento: à vista (chave) OU parcelado (entrada + parcelas). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 16px', background: '#fff' }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '.04em' }}>Pagamento à vista</span>
        <label className="toggle-wrap" style={{ marginLeft: 'auto' }}>
          <span className="toggle">
            <input type="checkbox" checked={!!v.a_vista} onChange={e => set('a_vista', e.target.checked)} />
            <span className="toggle-slider" />
          </span>
          <span className="toggle-label">{v.a_vista ? 'Sim' : 'Não'}</span>
        </label>
      </div>

      {v.a_vista ? (
      /* ── Bloco À VISTA ── */
      <section style={sectionCard}>
        <div style={sectionTitle}>
          <span>À vista</span>
          <div style={{ marginLeft: 'auto' }}>
            <RoundingButton value={v.installment_rounding} onClick={() => setRoundingFor('avista')} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
          <div>
            <label style={lbl}>Forma de pagamento</label>
            <Dropdown value={v.payment_method || null} options={methodOpts}
              placeholder="Selecione a forma" searchable clearable
              onChange={val => set('payment_method', val || '')} />
          </div>
          <div>
            <label style={lbl}>Vencimento (dias após aplicar)</label>
            <input className="fi" type="number" min="0" value={v.first_due_days ?? ''}
              onChange={e => set('first_due_days', e.target.value)} placeholder="Ex.: 0 (na hora)" />
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: '#94a3b8', margin: 0 }}>Pagamento único do valor total, sem entrada nem parcelas.</p>
      </section>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', gap: 14, alignItems: 'start' }}>
      {/* ── Bloco ENTRADA ── */}
      <section style={sectionCard}>
        <div style={sectionTitle}>
          <span>Entrada</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {v.has_down_payment && <RoundingButton value={v.down_payment_rounding} onClick={() => setRoundingFor('down')} />}
            <label className="toggle-wrap">
              <span className="toggle">
                <input type="checkbox" checked={!!v.has_down_payment}
                  onChange={e => set('has_down_payment', e.target.checked)} />
                <span className="toggle-slider" />
              </span>
              <span className="toggle-label">{v.has_down_payment ? 'Sim' : 'Não'}</span>
            </label>
          </div>
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
        <div style={sectionTitle}>
          <span>Parcelas</span>
          <div style={{ marginLeft: 'auto' }}>
            <RoundingButton value={v.installment_rounding} onClick={() => setRoundingFor('installment')} />
          </div>
        </div>
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
      )}

      {/* Botão de testar a forma de pagamento (simulador) — escondido quando o
          chamador coloca o botão em outro lugar, ex.: no cabeçalho do modal. */}
      {showTestButton && (
        <button type="button" onClick={() => setTesting(true)}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, alignSelf: 'flex-start', padding: '9px 16px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#dbeafe' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#eff6ff' }}>
          <Ic n="card" s={14} /> Testar forma de pagamento
        </button>
      )}

      {roundingFor === 'down' && (
        <RoundingPopup title="Arredondar o valor da entrada" value={v.down_payment_rounding}
          onSelect={val => set('down_payment_rounding', val)} onClose={() => setRoundingFor(null)} />
      )}
      {roundingFor === 'installment' && (
        <RoundingPopup title="Arredondar o valor das parcelas" value={v.installment_rounding}
          onSelect={val => set('installment_rounding', val)} onClose={() => setRoundingFor(null)} />
      )}
      {roundingFor === 'avista' && (
        <RoundingPopup title="Arredondar o valor à vista" value={v.installment_rounding}
          onSelect={val => set('installment_rounding', val)} onClose={() => setRoundingFor(null)} />
      )}
      {testing && <PaymentPlanTester value={v} onClose={() => setTesting(false)} />}
    </div>
  )
}
