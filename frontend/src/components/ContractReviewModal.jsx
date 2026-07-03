import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { contractsApi } from '../api'
import SignedFileViewer from './SignedFileViewer'
import { Ic } from './Icon'

const fmtBRL = (v) => v == null ? '—' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
const fmtUSD = (v) => v == null ? '—' : `US$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
const fmtN   = (v, d = 2) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: 4 })
const CUR_SYM = { USD: 'US$', EUR: '€', BRL: 'R$', GBP: '£', ARS: 'AR$', CLP: 'CL$', PYG: '₲', UYU: '$U' }

const FLAG_STYLE = {
  error: { bg: '#fef2f2', border: '#fecaca', color: '#b91c1c', ic: 'warn' },
  warn:  { bg: '#fffbeb', border: '#fde68a', color: '#b45309', ic: 'warn' },
  info:  { bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af', ic: 'warn' },
  good:  { bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d', ic: 'check' },  // mudança favorável (verde)
}

/* Popup de REVISÃO da operadora — detalhamento item a item + alertas, com
 * Aprovar / Reprovar (motivo). */
export default function ContractReviewModal({ contractId, onClose, onDone }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    contractsApi.reviewData(contractId)
      .then(r => { if (alive) setData(r.data) })
      .catch(() => { if (alive) toast.error('Erro ao carregar os dados da revisão.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [contractId])

  const approve = async () => {
    setBusy(true)
    try {
      await contractsApi.approve(contractId)
      toast.success('Contrato aprovado — liberado para faturar.')
      onDone?.(); onClose()
    } catch (e) { toast.error(e?.response?.data?.error || 'Erro ao aprovar.') }
    finally { setBusy(false) }
  }

  const reject = async () => {
    if (!note.trim()) { toast.error('Informe o motivo da reprovação.'); return }
    setBusy(true)
    try {
      await contractsApi.reject(contractId, note.trim())
      toast.success('Contrato reprovado — voltou para edição.')
      onDone?.(); onClose()
    } catch (e) { toast.error(e?.response?.data?.error || 'Erro ao reprovar.') }
    finally { setBusy(false) }
  }

  // Tudo exibido em R$ (moeda principal), com o valor na MOEDA BASE do contrato
  // pequeno logo abaixo. Os valores do backend vêm na moeda base ("_usd").
  const rate    = Number(data?.exchange_rate?.used) || 0
  const baseCur = data?.base_currency || 'USD'
  const baseSym = CUR_SYM[baseCur] || `${baseCur} `
  const showBase = baseCur !== 'BRL' && rate > 0
  // base: valor na moeda base | brl: valor já em reais (parcelas). Mostra R$ + base.
  const Money = ({ base, brl, strong, size = 12.5, align = 'flex-end', color = '#0f172a', sign = '' }) => {
    const brlVal  = brl != null ? Number(brl) : (base != null && rate ? Number(base) * rate : null)
    const baseVal = base != null ? Number(base) : (brl != null && rate ? Number(brl) / rate : null)
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: align, lineHeight: 1.15 }}>
        <span style={{ fontWeight: strong ? 700 : 600, fontSize: size, color }}>{brlVal == null ? '—' : `${sign}${fmtBRL(brlVal)}`}</span>
        {showBase && baseVal != null && <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500 }}>{sign}{baseSym} {fmtN(baseVal, 2)}</span>}
      </span>
    )
  }

  const lbl = { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .4 }
  const card = { border: '1px solid #e9edf3', borderRadius: 10, padding: '12px 14px', background: '#fff' }
  const th = { fontSize: 11, fontWeight: 700, color: '#94a3b8', textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #eef2f7' }
  const td = { fontSize: 12.5, color: '#334155', padding: '6px 8px', borderBottom: '1px solid #f6f8fb' }

  // Quando há documento assinado, abre-o à ESQUERDA e a conferência à direita.
  const hasPdf = !!data?.signed_file
  return (
    <div onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: hasPdf ? 1140 : 720, height: hasPdf ? '92vh' : undefined, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.28)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#f3e8ff', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n="check" s={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Revisão do contrato</div>
            <div style={{ fontSize: 12.5, color: '#64748b' }}>Reserva {data?.reservation_number || `#${contractId}`} — confira os dados antes de aprovar.</div>
          </div>
          <button onClick={() => !busy && onClose()} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e6eaf1', background: '#fff', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n="x" s={16} /></button>
        </div>

        {/* Corpo: documento assinado à ESQUERDA (quando houver) + conferência à direita */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {hasPdf && (
            <div style={{ flex: 1.2, minWidth: 0, minHeight: 0, borderRight: '1px solid #eef2f7', display: 'flex' }}>
              <SignedFileViewer url={data.signed_file} />
            </div>
          )}
          <div style={{ flex: hasPdf ? '0 0 480px' : 1, minWidth: 0, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 0' }}>Carregando…</p>
          ) : !data ? (
            <p style={{ textAlign: 'center', color: '#dc2626', padding: '40px 0' }}>Não foi possível carregar a revisão.</p>
          ) : (<>
            {/* Alertas */}
            {data.flags.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.flags.map((f, i) => {
                  const s = FLAG_STYLE[f.level] || FLAG_STYLE.info
                  return (
                    <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: s.bg, border: `1px solid ${s.border}`, borderRadius: 9, padding: '9px 12px' }}>
                      <span style={{ color: s.color, flexShrink: 0, marginTop: 1 }}><Ic n={s.ic} s={15} /></span>
                      <span style={{ fontSize: 12.5, color: s.color, fontWeight: 600, lineHeight: 1.5 }}>{f.message}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 9, alignItems: 'center', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 9, padding: '9px 12px' }}>
                <span style={{ color: '#15803d' }}><Ic n="check" s={15} /></span>
                <span style={{ fontSize: 12.5, color: '#15803d', fontWeight: 600 }}>Nenhuma anomalia detectada automaticamente.</span>
              </div>
            )}

            {/* Comprovante de pagamento + de onde veio o pagamento (config da agência) */}
            <div style={card}>
              <div style={lbl}>Comprovante de pagamento</div>
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {data.receipt_payer === 'agencia' ? (
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#6d28d9', background: '#f5f3ff', border: '1px solid #ddd6fe', padding: '3px 10px', borderRadius: 999 }}>Agência → UneWorld</span>
                ) : (
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '3px 10px', borderRadius: 999 }}>Cliente → UneWorld</span>
                )}
                {data.payment_receipt ? (
                  <a href={data.payment_receipt} target="_blank" rel="noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: '#1a2d4f', textDecoration: 'none' }}>
                    <Ic n="eye" s={14} /> Ver comprovante
                  </a>
                ) : (
                  <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>Não anexado</span>
                )}
              </div>
              <div style={{ marginTop: 6, fontSize: 11.5, color: '#94a3b8', lineHeight: 1.4 }}>
                {data.receipt_payer === 'agencia'
                  ? 'Pela configuração da agência, o pagamento é repassado pela agência à UneWorld.'
                  : 'Pela configuração da agência, o cliente paga direto na conta da UneWorld.'}
              </div>
            </div>

            {/* Câmbio */}
            <div style={card}>
              <div style={lbl}>Câmbio ({data.base_currency} → BRL · {data.payment_type === 'a_vista' ? 'à vista' : 'parcelado'})</div>
              <div style={{ marginTop: 4, fontSize: 13.5, color: '#0f172a' }}>
                Usado: <strong>{fmtN(data.exchange_rate.used, 4)}</strong>
                <span style={{ color: '#94a3b8' }}> · configurado: {fmtN(data.exchange_rate.default, 4)}</span>
                {data.exchange_rate.manual && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', padding: '1px 8px', borderRadius: 10 }}>alterado manualmente</span>}
              </div>
            </div>

            {/* Acomodações */}
            <div style={card}>
              <div style={{ ...lbl, marginBottom: 6 }}>Acomodações (valores por pessoa)</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>Tipo</th><th style={{ ...th, textAlign: 'right' }}>Valor/pessoa</th>
                  <th style={{ ...th, textAlign: 'right' }}>Taxas</th><th style={{ ...th, textAlign: 'center' }}>Qtd</th>
                  <th style={{ ...th, textAlign: 'right' }}>Subtotal</th>
                </tr></thead>
                <tbody>
                  {data.accommodation_lines.map((l, i) => (
                    <tr key={i} style={l.changed_from_itinerary ? { background: '#fffbeb' } : undefined}>
                      <td style={td}>
                        {l.type}
                        {l.changed_from_itinerary && (
                          <span title={`Roteiro: ${fmtN(l.itinerary_value_per_person)}/pessoa + ${fmtN(l.itinerary_taxes)} taxas`}
                            style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: '#b45309' }}>≠ roteiro</span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <Money base={l.value_per_person_usd} size={12} />
                        {l.changed_from_itinerary && l.itinerary_value_per_person != null && (
                          <span style={{ display: 'block', fontSize: 10, color: '#b45309' }}>roteiro: {fmtBRL(Number(l.itinerary_value_per_person) * rate)}</span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}><Money base={l.taxes_usd} size={12} /></td>
                      <td style={{ ...td, textAlign: 'center' }}>{l.quantity}</td>
                      <td style={{ ...td, textAlign: 'right' }}><Money base={l.subtotal_usd} size={12} strong /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 6, fontSize: 12.5, color: '#475569' }}>
                <span style={{ paddingTop: 2 }}>Subtotal acomodações:</span><Money base={data.accom_subtotal_usd} strong />
              </div>
            </div>

            {/* Ajustes + comissão */}
            {(data.adjustments.length > 0 || data.commission || data.commission_discount) && (
              <div style={card}>
                <div style={{ ...lbl, marginBottom: 6 }}>Ajustes, comissão e descontos</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5, color: '#334155' }}>
                  {data.adjustments.map((a, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <span style={{ paddingTop: 2 }}>{a.kind === 'desconto' ? 'Desconto' : 'Acréscimo'}{a.description ? ` — ${a.description}` : ''}</span>
                      <Money base={a.amount_usd} sign={a.kind === 'desconto' ? '−' : '+'} color={a.kind === 'desconto' ? '#dc2626' : '#0f172a'} />
                    </div>
                  ))}
                  {data.commission && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', color: '#b45309' }}>
                      <span style={{ paddingTop: 2 }}>Comissão da agência ({fmtN(data.commission.pct)}%)</span>
                      <Money base={data.commission.amount_usd} sign="−" color="#b45309" />
                    </div>
                  )}
                  {data.commission_discount && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', color: '#b45309' }}>
                      <span style={{ paddingTop: 2 }}>Dedução da comissão</span>
                      <Money base={data.commission_discount.amount_usd} sign="−" color="#b45309" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Total (R$ em destaque, moeda base pequena embaixo) */}
            <div style={{ ...card, background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Total</span>
              <Money brl={data.total_brl} base={data.total_usd} strong size={17} />
            </div>

            {/* Pagamento (entrada + parcelas x total) */}
            <div style={card}>
              <div style={{ ...lbl, marginBottom: 6 }}>Pagamento</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: '#334155' }}>
                {data.installments.map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ paddingTop: 2 }}>{p.kind === 'entrada' ? 'Entrada' : `Parcela ${p.installment_number || i}`}{p.due_date ? ` · ${new Date(p.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}` : ''}{p.payment_method ? ` · ${p.payment_method}` : ''}</span>
                    <Money brl={p.value_brl} size={12} />
                  </div>
                ))}
                <div style={{ borderTop: '1px solid #eef2f7', marginTop: 4, paddingTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', color: data.totals_match ? '#15803d' : '#b91c1c', fontWeight: 700 }}>
                  <span style={{ paddingTop: 2 }}>Entrada + parcelas{!data.totals_match && data.totals_diff_brl != null ? ` (dif. ${fmtBRL(data.totals_diff_brl)})` : ''}</span>
                  <Money brl={data.paid_total_brl} strong color={data.totals_match ? '#15803d' : '#b91c1c'} />
                </div>
              </div>
            </div>
          </>)}
          </div>
        </div>

        {/* Footer / ações */}
        {!loading && data && (
          <div style={{ borderTop: '1px solid #eef2f7', padding: '14px 20px', flexShrink: 0 }}>
            {rejecting ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={lbl}>Motivo da reprovação (a agência verá)</label>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} autoFocus
                  placeholder="Ex.: câmbio divergente do configurado; total não bate com as parcelas…"
                  style={{ width: '100%', resize: 'vertical', padding: '9px 11px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={() => setRejecting(false)} disabled={busy}
                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Voltar</button>
                  <button onClick={reject} disabled={busy}
                    style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? .6 : 1 }}>
                    {busy ? 'Reprovando…' : 'Confirmar reprovação'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <button onClick={() => setRejecting(true)} disabled={busy}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, border: '1px solid #fecaca', background: '#fff', color: '#dc2626', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Ic n="x" s={14} /> Reprovar
                </button>
                <button onClick={approve} disabled={busy}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 22px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? .6 : 1 }}>
                  <Ic n="check" s={15} /> {busy ? 'Aprovando…' : 'Aprovar'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
