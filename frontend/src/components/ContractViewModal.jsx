import { useState, useEffect } from 'react'
import { contractsApi } from '../api'
import { StatusBadge } from './DataTable'
import ContractPdfPreviewModal from './ContractPdfPreviewModal'
import { Ic } from './Icon'

const fmtDateBR = (iso) => {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('-')
  return (y && m && d) ? `${d}/${m}/${y}` : String(iso)
}
const money = (v, cur) => (v == null || v === '') ? '' : `${cur} ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

/* Popup de visualização do contrato — resumo read-only. Toda linha é clicável e
 * copia o valor pra área de transferência (igual Passageiros/Agências). No rodapé:
 * Editar (abre o formulário) e OK (fecha). */
export default function ContractViewModal({ contractId, canEdit = false, onClose, onEdit }) {
  const [c, setC] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(null)
  const [showPdf, setShowPdf] = useState(false)

  useEffect(() => {
    contractsApi.get(contractId)
      .then(r => setC(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [contractId])

  const copy = async (label, value) => {
    if (!value) return
    try { await navigator.clipboard.writeText(String(value)); setCopied(label); setTimeout(() => setCopied(null), 1600) } catch {}
  }

  const Row = ({ label, value }) => {
    if (value == null || value === '') return null
    const isCopied = copied === label
    return (
      <div onClick={() => copy(label, value)} title="Clique para copiar"
        style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 6, borderBottom: '1px solid #f8fafc', cursor: 'pointer' }}
        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', minWidth: 130, flexShrink: 0 }}>{label}</span>
        <span title={String(value)} style={{ fontSize: 13, color: '#1e293b', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        {isCopied && <span style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', background: '#059669', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 10 }}>✓ Copiado</span>}
      </div>
    )
  }
  const SecLabel = ({ children }) => (
    <p style={{ fontSize: 10, fontWeight: 700, color: '#2e6db4', textTransform: 'uppercase', letterSpacing: '.05em', margin: '10px 10px 2px' }}>{children}</p>
  )

  const it    = c?.itinerary_data
  const datas = c ? `${fmtDateBR(c.departure_date) || '—'} → ${fmtDateBR(c.return_date) || '—'}` : ''

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 520, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.24)', animation: 'mIn .15s ease' }}>

        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', margin: '0 0 2px' }}>
              Contrato {c?.reservation_number ? `nº ${c.reservation_number}` : ''}
            </p>
            {c && (it?.name || c.package_name) && (
              <p title={it?.name || c.package_name} style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it?.name || c.package_name}</p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {c && <StatusBadge value={c.status} />}
              {c && <span style={{ fontSize: 11, fontWeight: 600, color: c.signature_type === 'digital' ? '#7c3aed' : '#0891b2', background: c.signature_type === 'digital' ? '#f3e8ff' : '#e0f2fe', padding: '1px 8px', borderRadius: 6 }}>
                {c.signature_type === 'digital' ? 'Assinatura digital' : 'Assinatura física'}
              </span>}
            </div>
          </div>
          <button onClick={onClose}
            style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', cursor: 'pointer', flexShrink: 0 }}>
            <Ic n="x" s={14} />
          </button>
        </div>

        {/* Campos */}
        <div style={{ padding: '6px 12px 12px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <p style={{ padding: '28px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Carregando…</p>
          ) : !c ? (
            <p style={{ padding: '28px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Erro ao carregar o contrato.</p>
          ) : (
            <>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '.05em', margin: '6px 10px 2px' }}>
                Clique em qualquer linha para copiar
              </p>
              <SecLabel>Geral</SecLabel>
              <Row label="Reserva nº" value={c.reservation_number} />
              <Row label="Nome da viagem" value={it?.name || c.package_name} />
              <Row label="Pagante" value={c.contratante_data?.full_name} />
              <Row label="Agência" value={c.agency_data?.name} />
              <Row label="Data do contrato" value={fmtDateBR(c.contract_date)} />
              <Row label="Assinatura" value={c.signature_type === 'digital' ? 'Digital' : 'Física (imprimir e assinar)'} />

              <SecLabel>Viagem</SecLabel>
              <Row label="Datas" value={datas} />
              <Row label="Aeroporto" value={c.departure_airport} />

              <SecLabel>Valores</SecLabel>
              <Row label="Total (USD)" value={money(c.total_usd, 'US$')} />
              <Row label="Total (BRL)" value={money(c.total_brl, 'R$')} />
              <Row label="Câmbio" value={c.exchange_rate ? String(Number(c.exchange_rate)).replace('.', ',') : null} />
            </>
          )}
        </div>

        {/* Rodapé */}
        <div style={{ padding: '12px 22px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowPdf(true)} title="Ver o documento (PDF) como ficará"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#1a2d4f', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Ic n="docs" s={13} /> Ver PDF
            </button>
            {canEdit && (
              <button onClick={onEdit}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                <Ic n="edit" s={13} /> Editar
              </button>
            )}
          </div>
          <button onClick={onClose}
            style={{ padding: '8px 20px', borderRadius: 7, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            OK
          </button>
        </div>
      </div>

      {showPdf && (
        <ContractPdfPreviewModal contractId={contractId} onClose={() => setShowPdf(false)} />
      )}
    </div>
  )
}
