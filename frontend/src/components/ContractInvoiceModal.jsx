import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { contractsApi } from '../api'
import { Ic } from './Icon'
import DatePicker from './DatePicker'

const fmtBRL = (v) => v == null ? '—' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
const fmtUSD = (v) => v == null ? '—' : `US$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
const fmtN   = (v) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const fmtDate = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—'

/* Popup de FATURA — mostra os valores/dados relevantes e pede número + data da
 * fatura para mover o contrato de "A faturar" → "Faturado". */
export default function ContractInvoiceModal({ contractId, onClose, onDone }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [number, setNumber] = useState('')
  const [date, setDate] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    contractsApi.invoiceData(contractId)
      .then(r => { if (!alive) return; setData(r.data); setNumber(r.data?.invoice?.number || ''); setDate(r.data?.invoice?.date || '') })
      .catch(() => { if (alive) toast.error('Erro ao carregar os dados da fatura.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [contractId])

  const submit = async () => {
    if (!number.trim()) { toast.error('Informe o número da fatura.'); return }
    setBusy(true)
    try {
      await contractsApi.invoice(contractId, number.trim(), date || '')
      toast.success('Contrato faturado.')
      onDone?.(); onClose()
    } catch (e) { toast.error(e?.response?.data?.error || 'Erro ao faturar.') }
    finally { setBusy(false) }
  }

  const reject = async () => {
    if (!note.trim()) { toast.error('Informe o motivo da recusa.'); return }
    setBusy(true)
    try {
      await contractsApi.reject(contractId, note.trim())
      toast.success('Contrato recusado — voltou para edição.')
      onDone?.(); onClose()
    } catch (e) { toast.error(e?.response?.data?.error || 'Erro ao recusar.') }
    finally { setBusy(false) }
  }

  const lbl = { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .4 }
  const card = { border: '1px solid #e9edf3', borderRadius: 10, padding: '12px 14px', background: '#fff' }
  const rowSB = { display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#334155' }
  const alreadyInvoiced = data?.stage === 'faturado'

  return (
    <div onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 640, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.28)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#fef9c3', color: '#ca8a04', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n="card" s={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{alreadyInvoiced ? 'Fatura' : 'Faturar contrato'}</div>
            <div style={{ fontSize: 12.5, color: '#64748b' }}>Reserva {data?.reservation_number || `#${contractId}`}</div>
          </div>
          <button onClick={() => !busy && onClose()} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e6eaf1', background: '#fff', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n="x" s={16} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 0' }}>Carregando…</p>
          ) : !data ? (
            <p style={{ textAlign: 'center', color: '#dc2626', padding: '40px 0' }}>Não foi possível carregar a fatura.</p>
          ) : (<>
            {/* Agência / pagante / datas */}
            <div style={card}>
              <div style={{ ...lbl, marginBottom: 6 }}>Dados</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={rowSB}><span>Agência</span><strong>{data.agency_name || '—'}</strong></div>
                <div style={rowSB}><span>Pagante</span><strong>{data.payer_name || '—'}</strong></div>
                {data.package_name && <div style={rowSB}><span>Viagem</span><strong>{data.package_name}</strong></div>}
                <div style={rowSB}><span>Data do contrato</span><strong>{fmtDate(data.contract_date)}</strong></div>
                {data.departure_date && <div style={rowSB}><span>Data da viagem</span><strong>{fmtDate(data.departure_date)}</strong></div>}
              </div>
            </div>

            {/* Comissão (acima do total: a comissão é abatida do total) */}
            {(data.commission || data.commission_discount) && (
              <div style={card}>
                <div style={{ ...lbl, marginBottom: 6 }}>Comissão da agência</div>
                {data.commission && <div style={{ ...rowSB, color: '#b45309' }}><span>Comissão ({fmtN(data.commission.pct)}%)</span><strong>−{fmtUSD(data.commission.amount_usd)}</strong></div>}
                {data.commission_discount && <div style={{ ...rowSB, color: '#b45309' }}><span>Dedução</span><strong>−{fmtUSD(data.commission_discount.amount_usd)}</strong></div>}
              </div>
            )}

            {/* Totais (abaixo da comissão) */}
            <div style={{ ...card, background: '#f8fafc' }}>
              <div style={{ ...rowSB, fontSize: 13 }}><span>Total (USD)</span><strong>{fmtUSD(data.total_usd)}</strong></div>
              <div style={{ ...rowSB, fontSize: 14.5, color: '#0f172a', marginTop: 4 }}><span style={{ fontWeight: 700 }}>Total (BRL)</span><strong>{fmtBRL(data.total_brl)}</strong></div>
              <div style={{ ...rowSB, fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}><span>Câmbio {data.base_currency}→BRL</span><span>{fmtN(data.exchange_rate?.used)}</span></div>
            </div>

            {/* Pagamento */}
            <div style={card}>
              <div style={{ ...lbl, marginBottom: 6 }}>Pagamento ({data.payment_type === 'a_vista' ? 'à vista' : 'parcelado'})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.installments.map((p, i) => (
                  <div key={i} style={rowSB}>
                    <span>{p.kind === 'entrada' ? 'Entrada' : `Parcela ${p.installment_number || i}`}{p.due_date ? ` · ${fmtDate(p.due_date)}` : ''}{p.payment_method ? ` · ${p.payment_method}` : ''}</span>
                    <strong>{fmtBRL(p.value_brl)}</strong>
                  </div>
                ))}
                {data.installments.length > 0 && (
                  <div style={{ ...rowSB, borderTop: '1px solid #eef2f7', marginTop: 4, paddingTop: 6, fontWeight: 700, color: data.totals_match ? '#15803d' : '#b91c1c' }}>
                    <span>Entrada + parcelas</span><span>{fmtBRL(data.paid_total_brl)}{!data.totals_match ? ' ⚠' : ''}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Número + data da fatura */}
            <div style={{ ...card, borderColor: '#fde68a', background: '#fffbeb' }}>
              <div style={{ ...lbl, color: '#b45309', marginBottom: 8 }}>Fatura</div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Número da fatura *</label>
                  <input value={number} onChange={e => setNumber(e.target.value)} placeholder="Ex.: 2026-0001"
                    style={{ width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Data da fatura</label>
                  <DatePicker value={date} onChange={setDate} fixed />
                </div>
              </div>
            </div>
          </>)}
        </div>

        {!loading && data && (
          <div style={{ borderTop: '1px solid #eef2f7', padding: '14px 20px', flexShrink: 0 }}>
            {rejecting ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={lbl}>Motivo da recusa (a agência verá)</label>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} autoFocus
                  placeholder="Ex.: dados divergentes; total não bate com as parcelas; falta documento…"
                  style={{ width: '100%', resize: 'vertical', padding: '9px 11px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={() => setRejecting(false)} disabled={busy}
                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Voltar</button>
                  <button onClick={reject} disabled={busy}
                    style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? .6 : 1 }}>
                    {busy ? 'Recusando…' : 'Confirmar recusa'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                {/* Recusar só faz sentido antes de faturar (volta o contrato p/ edição). */}
                {!alreadyInvoiced ? (
                  <button onClick={() => setRejecting(true)} disabled={busy}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, border: '1px solid #fecaca', background: '#fff', color: '#dc2626', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    <Ic n="x" s={14} /> Recusar
                  </button>
                ) : <span />}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => !busy && onClose()} disabled={busy}
                    style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
                  <button onClick={submit} disabled={busy}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 22px', borderRadius: 8, border: 'none', background: '#ca8a04', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? .6 : 1 }}>
                    <Ic n="check" s={15} /> {busy ? 'Salvando…' : (alreadyInvoiced ? 'Salvar fatura' : 'Faturar')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
