import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { toast } from 'sonner'
import { contractsApi, agenciesApi, passengersApi, itinerariesApi, configApi } from '../api'
import EntityPicker from './EntityPicker'
import DatePicker from './DatePicker'
import AirportPicker from './AirportPicker'
import Dropdown from './Dropdown'
import CnpjInput from './CnpjInput'
import MoneyInput from './MoneyInput'
import EmailInput from './EmailInput'
import ContractPdfPreviewModal from './ContractPdfPreviewModal'
import RichTextEditor from './RichTextEditor'
import { Ic } from './Icon'
import { usePrefs } from '../context/PrefsContext'
import { useAuth } from '../context/AuthContext'

/* Confirmação específica pra "valores não somam o total" — não reaproveita o
 * ConfirmModal genérico porque ele sempre mostra "Esta ação não pode ser
 * desfeita" e botão vermelho de exclusão, que não fazem sentido aqui (é só
 * um aviso, o usuário pode continuar editando depois). */
function MismatchConfirm({ sumFilled, total, onOk, onCancel }) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="mbox" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">Os valores não somam o total</span>
          <button className="mclose" onClick={onCancel}><Ic n="x" s={15} /></button>
        </div>
        <div className="mbody">
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }}><Ic n="warn" s={20} /></div>
            <div>
              <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.7, margin: '0 0 4px' }}>
                Entrada + parcelas somam {sumFilled.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, mas o total do contrato é {total?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.
              </p>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Você pode salvar assim mesmo e ajustar depois.</p>
            </div>
          </div>
        </div>
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onCancel}>Voltar e revisar</button>
          <button className="btn btn-primary" onClick={onOk}>Salvar mesmo assim</button>
        </div>
      </div>
    </div>
  )
}

/* Popup do pagante avulso — SÓ empresa (CNPJ). Pessoa física que paga precisa
 * estar cadastrada como passageiro (e ser escolhida no seletor). Aqui digita-se
 * o CNPJ e a lupa puxa os dados pela BrasilAPI. Os dados continuam indo nos
 * campos payer_* do contrato — nada muda no backend. */
function maskPhoneBR(digits) {
  const d = (digits || '').replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  return d
}

function PayerModal({ payer, setPayer, onClearContratante, onClose }) {
  const [cnpjLoading, setCnpjLoading] = useState(false)
  const setField = (k) => (e) => { onClearContratante(); setPayer(p => ({ ...p, payer_type: 'juridica', [k]: e.target.value })) }

  const lookupCnpj = async () => {
    const cnpj = (payer.payer_document || '').replace(/\D/g, '')
    if (cnpj.length !== 14) { toast.error('CNPJ incompleto (14 dígitos).'); return }
    setCnpjLoading(true)
    try {
      const r = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`)
      const d = r.data
      const rawPhone = d.ddd_telefone_1 || d.telefone || ''
      const addr = [
        [d.logradouro, d.numero].filter(Boolean).join(', '),
        d.bairro,
        [d.municipio, d.uf].filter(Boolean).join('/'),
      ].filter(Boolean).join(' - ')
      onClearContratante()
      setPayer(p => ({
        ...p,
        payer_type: 'juridica',
        payer_name: d.razao_social || p.payer_name,
        payer_email: d.email || p.payer_email,
        payer_phone: rawPhone ? maskPhoneBR(rawPhone) : p.payer_phone,
        payer_address: addr || p.payer_address,
      }))
      toast.success('Dados preenchidos via CNPJ.')
    } catch { toast.error('CNPJ não encontrado ou inválido.') }
    finally { setCnpjLoading(false) }
  }

  return (
    <div className="overlay" onClick={onClose} style={{ zIndex: 600 }}>
      <div className="mbox" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">Empresa pagante (CNPJ)</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15} /></button>
        </div>
        <div className="mbody">
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
            Para empresa não cadastrada. Digite o CNPJ e clique na lupa para puxar os dados automaticamente. Pessoa física precisa estar cadastrada como passageiro.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={lbl}>CNPJ</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <CnpjInput value={payer.payer_document}
                    onChange={v => { onClearContratante(); setPayer(p => ({ ...p, payer_type: 'juridica', payer_document: v })) }} />
                </div>
                <button type="button" className="cep-btn" onClick={lookupCnpj} disabled={cnpjLoading} title="Buscar dados pelo CNPJ">
                  <Ic n="search" s={13} />{cnpjLoading ? 'Buscando…' : 'Buscar'}
                </button>
              </div>
            </div>
            <div>
              <label style={lbl}>Razão social</label>
              <input style={inp} value={payer.payer_name} onChange={setField('payer_name')} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Celular</label>
                <input style={inp} value={payer.payer_phone} onChange={setField('payer_phone')} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>E-mail</label>
                <EmailInput style={inp} value={payer.payer_email}
                  onChange={v => setField('payer_email')({ target: { value: v } })} />
              </div>
            </div>
            <div>
              <label style={lbl}>Endereço</label>
              <input style={inp} value={payer.payer_address} onChange={setField('payer_address')} />
            </div>
          </div>
        </div>
        <div className="mfoot">
          <button className="btn btn-primary" onClick={onClose}>Concluir</button>
        </div>
      </div>
    </div>
  )
}

/* Popup de valores extras (acréscimos) e descontos — entram na Soma total (USD).
 * Cada linha pode ser um valor fixo (US$) ou um percentual sobre o subtotal das
 * acomodações (baseUsd). */
function AdjustmentsModal({ adjustments, setAdjustments, baseUsd = 0, commissionPct = 0, commissionUsd = 0, cur = 'US$', onClose }) {
  const add    = () => setAdjustments(a => [...a, { description: '', kind: 'acrescimo', mode: 'valor', value_usd: '', percent: '' }])
  const update = (i, k, v) => setAdjustments(a => a.map((x, idx) => idx === i ? { ...x, [k]: v } : x))
  const remove = (i) => setAdjustments(a => a.filter((_, idx) => idx !== i))
  const amountOf = (a) => a.mode === 'percentual' ? baseUsd * Number(a.percent || 0) / 100 : Number(a.value_usd || 0)
  const fmt = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
  const net = adjustments.reduce((s, a) => s + (a.kind === 'desconto' ? -1 : 1) * amountOf(a), 0)
  const KIND_OPTS = [{ value: 'acrescimo', label: 'Acréscimo (+)' }, { value: 'desconto', label: 'Desconto (−)' }]
  const MODE_OPTS = [{ value: 'valor', label: `Valor (${cur})` }, { value: 'percentual', label: 'Percentual (%)' }]
  return (
    <div className="overlay" onClick={onClose} style={{ zIndex: 600 }}>
      <div className="mbox" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">Valores extras e descontos</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15} /></button>
        </div>
        <div className="mbody">
          {commissionPct > 0 && (
            <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '9px 12px', margin: '0 0 12px', fontSize: 12.5, color: '#5b21b6', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Ic n="briefcase" s={13} />
              <span>Comissão da agência: <strong>{commissionPct.toLocaleString('pt-BR')}%</strong> ({cur} {fmt(commissionUsd)}) — já embutida nas acomodações. Use os campos abaixo pra somar ou abater por cima.</span>
            </div>
          )}
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 14px', lineHeight: 1.5 }}>
            Acréscimos somam e descontos subtraem da <strong>Soma total ({cur})</strong>. O percentual
            incide sobre o subtotal das acomodações (<strong>{cur} {fmt(baseUsd)}</strong>).
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {adjustments.length === 0 && (
              <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 13, border: '1px dashed #e2e8f0', borderRadius: 10 }}>
                Nenhum valor adicionado ainda.
              </div>
            )}
            {adjustments.map((a, i) => {
              const signed = (a.kind === 'desconto' ? -1 : 1) * amountOf(a)
              return (
                <div key={i} style={{ border: '1px solid #e6eaf1', borderRadius: 10, padding: 12, background: '#fff', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input style={{ ...inp, flex: 1 }} value={a.description} onChange={e => update(i, 'description', e.target.value)}
                      placeholder="Descrição (ex: Taxa de embarque, Desconto fidelidade…)" />
                    <button type="button" onClick={() => remove(i)} title="Remover"
                      onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                      onMouseLeave={e => e.currentTarget.style.color = '#cbd5e1'}
                      style={{ display: 'flex', padding: 6, borderRadius: 6, border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', flexShrink: 0, transition: 'color .12s' }}>
                      <Ic n="trash" s={15} />
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ width: 150 }}>
                      <Dropdown value={a.kind} clearable={false} searchable={false} options={KIND_OPTS}
                        onChange={v => update(i, 'kind', v || 'acrescimo')} />
                    </div>
                    <div style={{ width: 158 }}>
                      <Dropdown value={a.mode} clearable={false} searchable={false} options={MODE_OPTS}
                        onChange={v => update(i, 'mode', v || 'valor')} />
                    </div>
                    <div style={{ position: 'relative', flex: 1, minWidth: 96 }}>
                      {a.mode === 'percentual' ? (
                        <input style={{ ...inp, paddingRight: 34 }} type="number" step="0.01" min="0"
                          value={a.percent} placeholder="0"
                          onChange={e => update(i, 'percent', e.target.value)} />
                      ) : (
                        <MoneyInput style={{ ...inp, paddingRight: 34 }} value={a.value_usd} placeholder="0,00"
                          onChange={v => update(i, 'value_usd', v)} />
                      )}
                      <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#94a3b8', pointerEvents: 'none' }}>
                        {a.mode === 'percentual' ? '%' : cur}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      {a.mode === 'percentual' ? `${Number(a.percent || 0)}% de ${cur} ${fmt(baseUsd)}` : 'Valor fixo'}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: signed < 0 ? '#dc2626' : '#15803d' }}>
                      {signed >= 0 ? '+' : '−'} {cur} {fmt(Math.abs(signed))}
                    </span>
                  </div>
                </div>
              )
            })}
            <button type="button" onClick={add}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 12px', borderRadius: 8, border: '1.5px dashed #cbd5e1', background: '#fafbfc', color: '#1a2d4f', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Ic n="plus" s={14} /> Adicionar valor
            </button>
          </div>
        </div>
        <div className="mfoot" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#475569' }}>
            Efeito no total:{' '}
            <strong style={{ color: net < 0 ? '#dc2626' : (net > 0 ? '#15803d' : '#1e293b') }}>
              {net >= 0 ? '+' : '−'} {cur} {fmt(Math.abs(net))}
            </strong>
          </span>
          <button className="btn btn-primary" onClick={onClose}>Concluir</button>
        </div>
      </div>
    </div>
  )
}

const lbl = { fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 5 }
const inp = { padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b', boxSizing: 'border-box', width: '100%' }
const inpRO = { ...inp, background: '#f8fafc', color: '#64748b' }
const btnPri = { padding: '8px 16px', borderRadius: 7, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
const sectionTitle = { fontSize: 13, fontWeight: 700, color: '#1e40af', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 7, background: '#eff6ff', borderRadius: 7, padding: '7px 11px', borderLeft: '3px solid #2e6db4' }
const card = { border: '1px solid #e2e8f0', borderRadius: 8, padding: 14 }

/* Pop-up para escrever/editar uma cláusula personalizada deste contrato (título +
 * editor de texto rico). `initial` null = nova cláusula. */
function CustomClauseModal({ initial, onSave, onClose }) {
  const [name, setName]       = useState(initial?.name || '')
  const [content, setContent] = useState(initial?.content || '')

  const submit = () => {
    if (!name.trim()) { toast.error('Dê um título à cláusula.'); return }
    onSave({ name: name.trim(), content })
  }

  return createPortal(
    <div className="overlay" style={{ zIndex: 650 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mbox" style={{ maxWidth: 880, width: '92vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div className="mhead">
          <span className="mtitle">{initial ? 'Editar cláusula personalizada' : 'Nova cláusula personalizada'}</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={16} /></button>
        </div>
        <div className="mbody" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={lbl}>Título da cláusula</label>
            <input style={inp} value={name} autoFocus onChange={e => setName(e.target.value)}
              placeholder="Ex.: Política de cancelamento" />
          </div>
          <RichTextEditor title="Texto da cláusula" value={content} onChange={setContent}
            placeholder="Escreva o texto da cláusula…" />
        </div>
        <div className="mfoot" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button style={btnPri} onClick={submit}>Salvar cláusula</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

const agencyLabel = (a) => {
  const name = a.person_type === 'fisica' ? (a.company_name || `${a.name} ${a.last_name}`.trim()) : (a.name || a.company_name)
  return name || `Agência #${a.id}`
}

const fmtDateBR = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const addMonthsIso = (iso, n) => {
  const d = new Date(iso + 'T00:00:00')
  d.setMonth(d.getMonth() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const round2 = (n) => Math.round(n * 100) / 100
// Arredonda à precisão do campo do backend (evita 400 "máx. N casas decimais"
// quando vem precisão alta de divisões/somas ou do que foi digitado).
const toDec = (v, places = 2) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? Number(n.toFixed(places)) : null
}

// Símbolo da moeda base (rótulos do contrato). Cai pro próprio código se desconhecida.
const CUR_SYMBOL = { USD: 'US$', EUR: '€', BRL: 'R$', GBP: '£', ARS: 'AR$', CLP: 'CLP$', PYG: '₲', UYU: '$U' }
const curSym = (code) => CUR_SYMBOL[code] || code || 'US$'

export default function ContractFormModal({ contractId, onClose, onSaved, onPublish }) {
  const isEdit = !!contractId
  const [loading, setLoading] = useState(isEdit)
  const [saving,  setSaving]  = useState(false)
  const [confirmMismatch, setConfirmMismatch] = useState(false)
  // Evita que o auto-divisor de parcelas rode nos primeiros valores
  // carregados (criação automática do câmbio, ou abertura de um contrato já
  // salvo) — só deve recalcular depois de tudo já estar de pé. Em criação
  // nova não há nada pra sobrescrever, então já começa "pronto"; em edição,
  // só fica pronto depois que os dados do contrato terminam de carregar.
  const initializedRef = useRef(!isEdit)

  // ── Autosave (rascunho) ───────────────────────────────────────────────────
  // Salva sozinho enquanto o usuário preenche: cria um rascunho na 1ª informação
  // e vai atualizando (debounce de ~1,2s). "Finalizar" valida e marca como pronto.
  // autosaveRef.id = id real do contrato (já salvo); começa com o contractId em
  // edição, ou null em criação (definido após o 1º autosave criar o rascunho).
  const autosaveRef     = useRef({ id: contractId || null, saving: false, dirty: null, discarded: false })
  const autosaveTimerRef = useRef(null)
  const lastSavedRef    = useRef(null)   // snapshot já persistido (evita re-salvar igual)
  const baselineReadyRef = useRef(false) // fixa o estado inicial sem salvá-lo
  const [savingState, setSavingState] = useState('idle') // 'idle' | 'saving' | 'saved'

  // Fontes de dados pros pickers
  const [agencies,   setAgencies]   = useState([])
  const [passengers, setPassengers] = useState([])
  const [itineraries, setItineraries] = useState([])
  const [accomTypes,  setAccomTypes] = useState([])
  const [clauses,     setClauses]    = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [sellers, setSellers] = useState([])   // [{id, name, email, phone}]
  const [loadedSellerData, setLoadedSellerData] = useState(null)  // seller_data do contrato carregado
  const { user: me } = useAuth()
  const canChangeSeller = !!me?.is_superuser || !!me?.permissions?.contracts_change_seller
  const canEditExchangeRate = !!me?.is_superuser || !!me?.permissions?.contracts_edit_exchange_rate
  const canCustomClauses = !!me?.is_superuser || !!me?.permissions?.contracts_custom_clauses

  const [exchangeRates, setExchangeRates] = useState([])   // [{from_currency, to_currency, rate}]
  const [form, setForm] = useState({
    agency: null, itinerary: null, contratante: null, seller: null,
    package_name: '', departure_date: '', return_date: '', departure_airport: '', observations: '',
    base_currency: 'USD',
    exchange_rate: '', received_down_payment_brl: '', received_installments_brl: '',
    round_step: 0, round_mode: 'nearest', round_currency: 'brl', signature_type: 'fisica',
  })
  // Pagante manual — usado quando não há contratante selecionado entre os
  // passageiros cadastrados (pode ser uma pessoa física ou uma empresa).
  const [payer, setPayer] = useState({
    payer_type: 'fisica', payer_name: '', payer_document: '', payer_birth_date: '',
    payer_gender: '', payer_email: '', payer_phone: '', payer_address: '',
  })
  const [showPayerModal, setShowPayerModal] = useState(false)
  const [departureAirportObj, setDepartureAirportObj] = useState(null)
  const [accomLines, setAccomLines] = useState([])
  // Tabela de preços de acomodação puxada do roteiro selecionado
  // (accommodation_type id -> { value_per_person_usd, taxes_usd }).
  const itinAccomPricingRef = useRef({})
  // Tipos de acomodação cujo valor veio do roteiro — ficam travados (não editáveis).
  const [pricedTypeIds, setPricedTypeIds] = useState(() => new Set())
  const [adjustments, setAdjustments] = useState([]) // [{ description, kind, value_usd }]
  const [showAdjustments, setShowAdjustments] = useState(false)
  const { contractCreateLayout, contractEditLayout, setContractLayout } = usePrefs()
  // Layout: 'steps' (passo a passo) ou 'full' (completo). Vem do perfil do usuário
  // (separado para criar/editar). Trocar aqui salva o novo padrão no perfil.
  const [layout, setLayout] = useState(isEdit ? contractEditLayout : contractCreateLayout)
  const [showPreview, setShowPreview] = useState(false)
  const [previewData, setPreviewData] = useState(null)
  const [loadedStage, setLoadedStage] = useState('em_edicao')
  const changeLayout = (v) => { setLayout(v); setContractLayout(isEdit, v) }
  const [step, setStep] = useState(0)
  const STEPS = [
    { key: 'geral',       title: 'Geral' },
    { key: 'passageiros', title: 'Passageiros' },
    { key: 'valores',     title: 'Valores' },
    { key: 'pagamento',   title: 'Pagamento' },
    { key: 'clausulas',   title: 'Cláusulas' },
    { key: 'revisao',     title: 'Revisão' },
  ]
  const lastStep = STEPS.length - 1
  const [guests, setGuests]         = useState([]) // [{ passenger, room }]  room = id do quarto | null
  // Contrato novo já começa com 1 quarto criado (na edição, vêm do contrato).
  const [rooms, setRooms]           = useState(() => isEdit ? [] : [{ id: 1, type: null }]) // [{ id, type }]  type = id da acomodação | null
  const roomSeqRef                  = useRef(isEdit ? 1 : 2)     // gera ids estáveis de quarto
  const [draggingId, setDraggingId] = useState(null) // passageiro sendo arrastado
  const [dragOverKey, setDragOverKey] = useState(null) // zona destacada no arraste ('pool' | id do quarto | 'new')
  const [paymentType, setPaymentType] = useState('parcelado') // 'a_vista' | 'parcelado'
  const [avista, setAvista]         = useState({ due_date: '', value_brl: '', payment_method: '' }) // pagamento à vista
  const [hasEntrada, setHasEntrada] = useState(false)
  const [entrada, setEntrada]       = useState({ detail: '', due_date: '', value_brl: '', payment_method: '' })
  const [installmentsCount, setInstallmentsCount] = useState(0)
  const [installments, setInstallments] = useState([]) // [{ detail, due_date, value_brl, payment_method }]
  const [selectedClauses, setSelectedClauses] = useState([])
  const [customClauses, setCustomClauses] = useState([]) // [{ name, content }] — só deste contrato
  const [clauseEditor, setClauseEditor] = useState(null) // { index, initial } | null
  const [reservationNumber, setReservationNumber] = useState('')
  const [contractDate, setContractDate] = useState('')

  useEffect(() => {
    Promise.all([
      agenciesApi.list(), passengersApi.list({ page_size: 1000 }), itinerariesApi.list({ page_size: 1000 }),
      configApi.accommodations(), configApi.contractClauses(), configApi.paymentMethods(), configApi.exchangeRates(),
      configApi.operatingCompany(),
    ]).then(([ag, pax, it, ac, cl, pm, er, oc]) => {
      setAgencies(ag.data.results ?? ag.data)
      setPassengers(pax.data.results ?? pax.data)
      setItineraries(it.data.results ?? it.data)
      setAccomTypes(ac.data.results ?? ac.data)
      setClauses(cl.data)
      setPaymentMethods(pm.data)
      setExchangeRates(er.data || [])
      if (!isEdit) {
        setSelectedClauses((cl.data).filter(c => c.is_default).map(c => c.id))
        const usdBrl = (er.data).find(r => r.from_currency === 'USD' && r.to_currency === 'BRL')
        // Contrato novo herda a forma de assinatura padrão da Operadora.
        setForm(f => ({ ...f, signature_type: oc.data?.default_signature_type || 'fisica',
          ...(usdBrl ? { exchange_rate: Number(usdBrl.rate) } : {}) }))
      }
    }).catch(() => toast.error('Erro ao carregar dados auxiliares.'))
    // Lista de vendedores só importa para quem pode trocar o vendedor.
    if (canChangeSeller) {
      contractsApi.sellers().then(r => setSellers(r.data || [])).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!isEdit) return
    contractsApi.get(contractId).then(async (r) => {
      const d = r.data
      setReservationNumber(d.reservation_number ?? '')
      setContractDate(d.contract_date ?? '')
      setLoadedStage(d.stage ?? 'em_edicao')
      setLoadedSellerData(d.seller_data ?? null)
      setForm({
        agency: d.agency, itinerary: d.itinerary, contratante: d.contratante, seller: d.seller ?? null,
        package_name: d.package_name ?? '', departure_date: d.departure_date ?? '', return_date: d.return_date ?? '',
        departure_airport: d.departure_airport ?? '', observations: d.observations ?? '',
        base_currency: d.base_currency ?? 'USD',
        exchange_rate: d.exchange_rate != null ? Number(d.exchange_rate) : '',
        received_down_payment_brl: d.received_down_payment_brl ?? '',
        received_installments_brl: d.received_installments_brl ?? '',
        round_step: d.round_step ?? 0, round_mode: d.round_mode ?? 'nearest', round_currency: d.round_currency ?? 'brl',
        signature_type: d.signature_type ?? 'fisica',
      })
      if (d.departure_airport) setDepartureAirportObj({ name: d.departure_airport })
      setPayer({
        payer_type: d.payer_type || 'fisica', payer_name: d.payer_name ?? '', payer_document: d.payer_document ?? '',
        payer_birth_date: d.payer_birth_date ?? '', payer_gender: d.payer_gender ?? '',
        payer_email: d.payer_email ?? '', payer_phone: d.payer_phone ?? '', payer_address: d.payer_address ?? '',
      })
      setAccomLines((d.accommodation_lines ?? []).map(l => ({
        accommodation_type: l.accommodation_type, value_per_person_usd: l.value_per_person_usd,
        taxes_usd: l.taxes_usd, quantity: l.quantity,
      })))
      // Restaura o TRAVAMENTO dos valores que vêm do roteiro (sem sobrescrever os
      // valores salvos). Sem isso, ao reabrir (edição/rascunho) os campos ficavam
      // editáveis indevidamente.
      if (d.itinerary) {
        try {
          const ir = await itinerariesApi.get(d.itinerary)
          const pricing = {}
          ;(ir.data?.accommodation_lines || []).forEach(l => {
            if (l.accommodation_type != null) {
              pricing[l.accommodation_type] = { value_per_person_usd: Number(l.value_per_person) || 0, taxes_usd: Number(l.taxes) || 0 }
            }
          })
          itinAccomPricingRef.current = pricing
          setPricedTypeIds(new Set(Object.keys(pricing).map(Number)))
        } catch { /* sem travamento se a busca do roteiro falhar */ }
      }
      setAdjustments((d.adjustments ?? []).map(a => ({
        description: a.description ?? '', kind: a.kind ?? 'acrescimo', mode: a.mode ?? 'valor',
        value_usd: a.value_usd ?? '', percent: a.percent ?? '',
      })))
      // Reconstrói os quartos a partir do room_group salvo. Contrato antigo (sem
      // room_group) com tipo definido vira um quarto por hóspede, preservando o tipo.
      const roomById = new Map()
      let compatSeq = 900000
      const loadedGuests = (d.guests ?? []).map(g => {
        let rg = g.room_group
        if (!rg && g.accommodation_type) { compatSeq += 1; rg = compatSeq }
        if (rg) {
          if (!roomById.has(rg)) roomById.set(rg, { id: rg, type: g.accommodation_type ?? null, typeManual: g.accommodation_type != null })
          return { passenger: g.passenger, room: rg }
        }
        return { passenger: g.passenger, room: null }
      })
      const loadedRooms = [...roomById.values()]
      roomSeqRef.current = (loadedRooms.length ? Math.max(...loadedRooms.map(r => r.id)) : 0) + 1
      setRooms(loadedRooms)
      setGuests(loadedGuests)
      const entradaRow = (d.installments ?? []).find(i => i.kind === 'entrada')
      const parcelaRows = (d.installments ?? []).filter(i => i.kind === 'parcela').sort((a, b) => a.installment_number - b.installment_number)
      const ptype = d.payment_type || 'parcelado'
      setPaymentType(ptype)
      if (ptype === 'a_vista') {
        const p = parcelaRows[0] || entradaRow
        if (p) setAvista({ due_date: p.due_date ?? '', value_brl: p.value_brl ?? '', payment_method: p.payment_method ?? '' })
      } else {
        setHasEntrada(!!entradaRow)
        if (entradaRow) setEntrada({
          detail: entradaRow.detail ?? '', due_date: entradaRow.due_date ?? '',
          value_brl: entradaRow.value_brl ?? '', payment_method: entradaRow.payment_method ?? '',
        })
        setInstallmentsCount(parcelaRows.length)
        setInstallments(parcelaRows.map(r => ({
          detail: r.detail ?? '', due_date: r.due_date ?? '', value_brl: r.value_brl ?? '', payment_method: r.payment_method ?? '',
        })))
      }
      setSelectedClauses((d.clauses ?? []))
      setCustomClauses(Array.isArray(d.custom_clauses) ? d.custom_clauses : [])
    }).catch(() => toast.error('Erro ao carregar contrato.')).finally(() => {
      setLoading(false)
      setTimeout(() => { initializedRef.current = true }, 0)
    })
  }, [contractId])

  const sellerItems = useMemo(() => sellers.map(s => ({ id: s.id, label: s.name, sublabel: [s.email, s.phone].filter(Boolean).join(' · ') })), [sellers])
  // Vendedor que será exibido no contrato: o escolhido, ou o usuário logado por padrão.
  const meSellerBrief = useMemo(() => ({
    id: me?.id, name: me?.full_name || me?.email || 'Você', email: me?.email || '', phone: me?.phone || '',
  }), [me])
  const currentSeller = useMemo(() => {
    if (form.seller) return sellers.find(s => s.id === form.seller) || loadedSellerData || meSellerBrief
    if (isEdit && loadedSellerData) return loadedSellerData
    return meSellerBrief
  }, [form.seller, sellers, loadedSellerData, isEdit, meSellerBrief])
  const agencyItems = useMemo(() => agencies.map(a => ({ id: a.id, label: agencyLabel(a), sublabel: a.cnpj || a.cpf })), [agencies])
  const passengerItems = useMemo(() => passengers.map(p => ({ id: p.id, label: p.full_name, sublabel: p.cpf || p.email })), [passengers])
  const itineraryItems = useMemo(() => itineraries.map(i => {
    const parts = []
    if (i.start_date) parts.push(`Início: ${fmtDateBR(i.start_date)}`)
    if (i.end_date)   parts.push(`Término: ${fmtDateBR(i.end_date)}`)
    return { id: i.id, label: i.name, sublabel: parts.join('  ·  ') }
  }), [itineraries])
  const accomTypeOptions = useMemo(() => accomTypes.map(at => ({ value: at.id, label: at.name })), [accomTypes])
  const paymentMethodOptions = useMemo(() => paymentMethods.map(pm => ({ value: pm.name, label: pm.name })), [paymentMethods])

  // Soma total (USD) sempre calculada a partir das linhas de acomodação —
  // nunca digitada. Total em BRL deriva da soma total e do câmbio.
  const accomSubtotalUsd = useMemo(() => accomLines.reduce(
    (sum, l) => sum + (Number(l.value_per_person_usd || 0) + Number(l.taxes_usd || 0)) * Number(l.quantity || 1), 0
  ), [accomLines])
  // Percentual incide sobre o subtotal das acomodações; valor é absoluto em USD.
  const adjustmentsTotalUsd = useMemo(() => adjustments.reduce((s, a) => {
    const amount = a.mode === 'percentual' ? accomSubtotalUsd * Number(a.percent || 0) / 100 : Number(a.value_usd || 0)
    return s + (a.kind === 'desconto' ? -1 : 1) * amount
  }, 0), [adjustments, accomSubtotalUsd])
  // Comissão da agência: % do cadastro da agência sobre o subtotal das
  // acomodações; soma ao total (o backend recalcula igual em _recalc_totals).
  const agencyCommissionPct = useMemo(() => {
    const ag = agencies.find(a => a.id === form.agency)
    return Number(ag?.commission_rate) || 0
  }, [agencies, form.agency])
  // Comissão incide só sobre o valor/pessoa (não sobre as taxas) e fica EMBUTIDA
  // no valor exibido (valor base × (1+%)). O valor base é o que fica armazenado.
  const valueSubtotalUsd = useMemo(() => accomLines.reduce(
    (s, l) => s + Number(l.value_per_person_usd || 0) * Number(l.quantity || 1), 0
  ), [accomLines])
  const commissionUsd = useMemo(() => valueSubtotalUsd * agencyCommissionPct / 100, [valueSubtotalUsd, agencyCommissionPct])
  const roundTo = (v, step, mode) => {
    if (!step || v == null) return v
    const q = v / step
    const r = mode === 'up' ? Math.ceil(q) : mode === 'down' ? Math.floor(q) : Math.round(q)
    return r * step
  }
  // Total cru (acomodações + ajustes) e, por cima, o arredondamento opcional da
  // moeda escolhida — a outra moeda é derivada pelo câmbio.
  const [computedTotalUsd, computedTotalBrl] = useMemo(() => {
    const rawUsd = accomSubtotalUsd + adjustmentsTotalUsd + commissionUsd
    const rate = Number(form.exchange_rate) || 0
    const rawBrl = rate ? rawUsd * rate : null
    const step = Number(form.round_step) || 0
    if (!step) return [rawUsd, rawBrl]
    if (form.round_currency === 'usd') {
      const u = roundTo(rawUsd, step, form.round_mode)
      return [u, rate ? u * rate : null]
    }
    if (rawBrl == null) return [rawUsd, null]
    const b = roundTo(rawBrl, step, form.round_mode)
    return [rate ? b / rate : rawUsd, b]
  }, [accomSubtotalUsd, adjustmentsTotalUsd, commissionUsd, form.exchange_rate, form.round_step, form.round_mode, form.round_currency])


  // Soma do que foi de fato preenchido em entrada + parcelas, pra comparar com o total.
  const sumFilled = paymentType === 'a_vista'
    ? round2(Number(avista.value_brl || 0))
    : round2((hasEntrada ? Number(entrada.value_brl || 0) : 0) + installments.reduce((s, it) => s + Number(it.value_brl || 0), 0))
  const anyPaymentFilled = paymentType === 'a_vista'
    ? !!avista.value_brl
    : ((hasEntrada && entrada.value_brl) || installments.some(i => i.value_brl))
  const totalMismatch = computedTotalBrl != null && anyPaymentFilled &&
    Math.abs(sumFilled - round2(computedTotalBrl)) > 0.01

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const clearPayer = () => setPayer({
    payer_type: 'fisica', payer_name: '', payer_document: '', payer_birth_date: '',
    payer_gender: '', payer_email: '', payer_phone: '', payer_address: '',
  })

  // Câmbio moeda → BRL (1 quando a moeda já é BRL; null se não houver conversão).
  const rateFor = (cur) => {
    if (cur === 'BRL') return 1
    const r = exchangeRates.find(x => x.from_currency === cur && x.to_currency === 'BRL')
    return r ? Number(r.rate) : null
  }
  // Moedas disponíveis: as que têm conversão para BRL (Configurações → Câmbio) + BRL.
  const currencyOptions = useMemo(() => {
    const brl = exchangeRates.filter(r => r.to_currency === 'BRL')
    const favSet = new Set(brl.filter(r => r.is_favorite).map(r => r.from_currency))
    const all = new Set(brl.map(r => r.from_currency))
    all.add('BRL')
    if (form.base_currency) all.add(form.base_currency)
    const arr = [...all]
    // Favoritos primeiro, depois o resto — cada grupo em ordem alfabética.
    const byName = (a, b) => a.localeCompare(b)
    const ordered = [...arr.filter(c => favSet.has(c)).sort(byName), ...arr.filter(c => !favSet.has(c)).sort(byName)]
    return ordered.map(c => ({ value: c, label: `${favSet.has(c) ? '★ ' : ''}${c} — ${curSym(c)}` }))
  }, [exchangeRates, form.base_currency])
  // Com roteiro selecionado, a moeda vem dele e fica travada.
  const currencyLocked = !!form.itinerary
  const cur = curSym(form.base_currency)   // símbolo da moeda base p/ rótulos

  const setBaseCurrency = (cur) => {
    const rate = rateFor(cur)
    setForm(f => ({ ...f, base_currency: cur, ...(rate != null ? { exchange_rate: rate } : {}) }))
  }

  const handleSelectItinerary = async (ids) => {
    const id = ids[0] ?? null
    const it = id ? itineraries.find(x => x.id === id) : null
    if (it) {
      // Selecionar: preenche nome do pacote, datas e MOEDA a partir do roteiro
      // (ficam travados enquanto o roteiro estiver selecionado).
      const cur = it.base_currency || 'USD'
      const rate = rateFor(cur)
      setForm(f => ({
        ...f, itinerary: id,
        package_name: it.name ?? '',
        departure_date: it.start_date || '',
        return_date: it.end_date || '',
        base_currency: cur,
        ...(rate != null ? { exchange_rate: rate } : {}),
      }))
      // Puxa os valores de acomodação cadastrados no roteiro (valor por pessoa e
      // taxas, na moeda base do roteiro) e aplica nos tipos já presentes.
      try {
        const r = await itinerariesApi.get(id)
        const pricing = {}
        ;(r.data?.accommodation_lines || []).forEach(l => {
          if (l.accommodation_type != null) {
            pricing[l.accommodation_type] = {
              value_per_person_usd: Number(l.value_per_person) || 0,
              taxes_usd: Number(l.taxes) || 0,
            }
          }
        })
        itinAccomPricingRef.current = pricing
        setPricedTypeIds(new Set(Object.keys(pricing).map(Number)))
        setAccomLines(prev => prev.map(line => {
          const p = pricing[line.accommodation_type]
          return p ? { ...line, value_per_person_usd: p.value_per_person_usd, taxes_usd: p.taxes_usd } : line
        }))
      } catch { /* mantém os valores atuais se a busca falhar */ }
    } else {
      // Remover o roteiro: limpa tudo que ele havia preenchido (e o aeroporto).
      itinAccomPricingRef.current = {}
      setPricedTypeIds(new Set())
      setDepartureAirportObj(null)
      setForm(f => ({
        ...f, itinerary: null,
        package_name: '', departure_date: '', return_date: '', departure_airport: '',
      }))
    }
  }

  // ── Tipos de Acomodação / Valores — auto-gerado a partir dos QUARTOS ──
  // O valor é POR PESSOA, então a quantidade por tipo = número de PESSOAS
  // ocupando os quartos daquele tipo (ex.: um quarto duplo com 2 pessoas conta
  // como 2). Os valores (USD/taxas) são preservados e editáveis.
  useEffect(() => {
    const typeOfRoom = {}
    rooms.forEach(r => { if (r.type) typeOfRoom[r.id] = r.type })
    const counts = {}
    guests.forEach(g => {
      const t = g.room != null ? typeOfRoom[g.room] : null
      if (t) counts[t] = (counts[t] || 0) + 1
    })
    setAccomLines(prev => {
      const next = []
      Object.entries(counts).forEach(([typeIdStr, qty]) => {
        const typeId = Number(typeIdStr)
        const existing = prev.find(l => l.accommodation_type === typeId)
        const priced = itinAccomPricingRef.current[typeId]
        next.push(existing ? { ...existing, quantity: qty }
                           : {
                               accommodation_type: typeId,
                               value_per_person_usd: priced?.value_per_person_usd || 0,
                               taxes_usd: priced?.taxes_usd || 0,
                               quantity: qty,
                             })
      })
      // mantém linhas adicionadas manualmente que não têm tipo vinculado a quarto
      prev.forEach(l => { if (!l.accommodation_type) next.push(l) })
      return next
    })
  }, [rooms, guests])

  // ── Adivinha o tipo do quarto pela quantidade de pessoas, casando a contagem
  // com a capacidade da acomodação. Para 2 pessoas, decide entre Duplo Casal e
  // Duplo Twin pelo sexo: sexos diferentes = casal; sexos iguais = twin.
  // Quartos com tipo escolhido na mão (typeManual) NÃO são tocados.
  const guessRoomType = (passengerIds) => {
    const count = passengerIds.length
    if (count === 2) {
      const duplos = accomTypes.filter(t => (t.capacity || 1) === 2)
      const casal = duplos.find(t => /casal/i.test(t.name))
      const twin  = duplos.find(t => /twin/i.test(t.name))
      const g = passengerIds.map(pid => (passengers.find(p => p.id === pid)?.gender || '').trim().toLowerCase())
      const differentSex = g[0] && g[1] && g[0] !== g[1]
      if (differentSex && casal) return casal.id
      if (!differentSex && twin)  return twin.id
      return (casal || twin || duplos[0])?.id ?? null
    }
    return accomTypes.find(t => (t.capacity || 1) === count)?.id ?? null
  }

  useEffect(() => {
    setRooms(prev => {
      let changed = false
      const next = prev.map(room => {
        if (room.typeManual) return room
        const occ = guests.filter(g => g.room === room.id).map(g => g.passenger)
        if (occ.length === 0) return room
        const newType = guessRoomType(occ)
        if (newType != null && newType !== room.type) { changed = true; return { ...room, type: newType } }
        return room
      })
      return changed ? next : prev
    })
  }, [guests, accomTypes, passengers])

  const addAccomLine = () => setAccomLines(a => [...a, { accommodation_type: null, value_per_person_usd: 0, taxes_usd: 0, quantity: 1 }])
  const updateAccomLine = (idx, key, value) => setAccomLines(a => a.map((l, i) => i === idx ? { ...l, [key]: value } : l))
  const removeAccomLine = (idx) => setAccomLines(a => a.filter((_, i) => i !== idx))

  // ── Quartos ──
  const addRoom    = () => { const id = roomSeqRef.current++; setRooms(r => [...r, { id, type: null }]) }
  const createRoomWith = (passenger) => {
    // Arrastar alguém para a área "novo quarto" cria um quarto já com essa pessoa.
    const id = roomSeqRef.current++
    setRooms(r => [...r, { id, type: null }])
    setGuests(gs => gs.map(g => g.passenger === passenger ? { ...g, room: id } : g))
  }
  const removeRoom = (id) => {
    setRooms(r => r.filter(x => x.id !== id))
    setGuests(gs => gs.map(g => g.room === id ? { ...g, room: null } : g))
  }
  // Escolher o tipo na mão trava o quarto (typeManual); limpar volta pro automático.
  const setRoomType   = (id, type)        => setRooms(r => r.map(x => x.id === id ? { ...x, type, typeManual: type != null } : x))
  const assignGuest   = (passenger, room) => setGuests(gs => gs.map(g => g.passenger === passenger ? { ...g, room } : g))
  const roomTypeOf    = (room)            => rooms.find(r => r.id === room)?.type ?? null
  const guestName     = (pid)             => passengers.find(x => x.id === pid)?.full_name ?? `#${pid}`

  // Cartãozinho de hóspede — arrastável por qualquer parte, exceto o dropdown e o
  // botão de remover (marcados com data-no-drag). Fica translúcido enquanto arrasta.
  const renderGuestChip = (g) => {
    const dragging = draggingId === g.passenger
    return (
      <div key={g.passenger} draggable
        onDragStart={e => {
          if (e.target.closest('[data-no-drag]')) { e.preventDefault(); return }
          e.dataTransfer.setData('text/plain', String(g.passenger))
          e.dataTransfer.effectAllowed = 'move'
          setDraggingId(g.passenger)
        }}
        onDragEnd={() => { setDraggingId(null); setDragOverKey(null) }}
        title="Arraste para um quarto"
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: dragging ? '#eff6ff' : '#fff', border: `1px solid ${dragging ? '#93c5fd' : '#e2e8f0'}`, borderRadius: 6, padding: '5px 6px 5px 9px', fontSize: 12.5, cursor: 'grab', opacity: dragging ? 0.5 : 1, boxShadow: dragging ? '0 4px 12px rgba(0,0,0,.12)' : 'none', transition: 'opacity .12s, box-shadow .12s, border-color .12s' }}>
        <span style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1, flexShrink: 0 }}>⠿</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1e293b' }}>{guestName(g.passenger)}</span>
        <div data-no-drag style={{ width: 124, flexShrink: 0 }}>
          <Dropdown value={g.room ?? null}
            options={rooms.map((r, i) => ({ value: r.id, label: `Quarto ${i + 1}` }))}
            placeholder="Mover…"
            onChange={v => assignGuest(g.passenger, v)} />
        </div>
        <button type="button" title="Remover do contrato" data-no-drag
          onClick={() => setGuests(prev => prev.filter(x => x.passenger !== g.passenger))}
          style={{ display: 'flex', padding: 2, borderRadius: 4, border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', flexShrink: 0 }}>
          <Ic n="x" s={13} />
        </button>
      </div>
    )
  }

  // ── Hóspedes ──
  // O contratante escolhido entre os passageiros cadastrados já entra
  // automaticamente como hóspede (ele também viaja) — ainda pode ser
  // removido da lista manualmente depois, se necessário. Ao TROCAR o
  // contratante, o anterior (que tinha entrado automático) sai da lista,
  // senão os dois ficariam acumulados nos passageiros.
  const prevContratanteRef = useRef(null)
  useEffect(() => {
    const prev = prevContratanteRef.current
    if (prev === form.contratante) return
    prevContratanteRef.current = form.contratante
    setGuests(gs => {
      let next = prev ? gs.filter(g => g.passenger !== prev) : gs
      if (form.contratante && !next.some(g => g.passenger === form.contratante)) {
        next = [{ passenger: form.contratante, room: null }, ...next]
      }
      return next
    })
  }, [form.contratante])

  const guestIds = guests.map(g => g.passenger)
  const handleGuestsChange = (ids) => {
    setGuests(prev => {
      const kept = prev.filter(g => ids.includes(g.passenger))
      const added = ids.filter(id => !prev.some(g => g.passenger === id)).map(id => ({ passenger: id, room: null }))
      return [...kept, ...added]
    })
  }

  // ── Parcelas ──
  // Define quantas parcelas existem e já divide o valor restante (total -
  // entrada) igualmente entre elas — a última absorve a diferença de
  // arredondamento. Continua editável depois, linha a linha.
  const entradaValue = () => (hasEntrada ? Number(entrada.value_brl || 0) : 0)
  const setInstallmentsCountClamped = (n) => {
    const count = Math.max(0, Math.min(360, Math.floor(n) || 0))   // sem limite prático (cap só pra evitar travar a tela)
    const remaining = (computedTotalBrl || 0) - entradaValue()
    const base = count > 0 ? Math.floor((remaining / count) * 100) / 100 : 0
    setInstallmentsCount(count)
    setInstallments(prev => {
      const next = []
      for (let i = 0; i < count; i++) {
        const isLast = i === count - 1
        const value = isLast ? round2(remaining - base * (count - 1)) : base
        next.push(prev[i] ? { ...prev[i], value_brl: value } : { detail: '', due_date: '', value_brl: value, payment_method: '' })
      }
      return next
    })
  }
  // Se o total mudar depois (ex: editou o valor por pessoa na acomodação)
  // ou a entrada mudar, redivide as parcelas existentes automaticamente —
  // não precisa apagar e recriar as parcelas pra atualizar os valores.
  useEffect(() => {
    if (!initializedRef.current) return
    if (installmentsCount === 0) return
    const remaining = (computedTotalBrl || 0) - entradaValue()
    const base = Math.floor((remaining / installmentsCount) * 100) / 100
    setInstallments(prev => prev.map((it, i) => {
      const isLast = i === installmentsCount - 1
      const value = isLast ? round2(remaining - base * (installmentsCount - 1)) : base
      return { ...it, value_brl: value }
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedTotalBrl, entrada.value_brl, hasEntrada])

  // À vista: valor já vem com o total do contrato (editável depois). Não
  // sobrescreve o valor salvo ao abrir um contrato existente (initializedRef).
  useEffect(() => {
    if (!initializedRef.current) return
    if (paymentType !== 'a_vista') return
    setAvista(p => ({ ...p, value_brl: computedTotalBrl != null ? computedTotalBrl : '' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentType, computedTotalBrl])

  const updateInstallment = (idx, key, value) => {
    setInstallments(prev => {
      let next = prev.map((it, i) => i === idx ? { ...it, [key]: value } : it)
      // Preencher a data da 1ª parcela já preenche as seguintes, um mês depois
      // cada — ainda editáveis individualmente depois.
      if (key === 'due_date' && idx === 0 && value) {
        next = next.map((it, i) => i === 0 ? it : { ...it, due_date: addMonthsIso(value, i) })
      }
      // Definir a forma de pagamento da 1ª parcela já aplica pras demais —
      // ainda editável individualmente depois.
      if (key === 'payment_method' && idx === 0) {
        next = next.map((it, i) => i === 0 ? it : { ...it, payment_method: value })
      }
      return next
    })
  }

  // Recebido na entrada / a prazo são preenchidos automaticamente a partir
  // do que foi definido na entrada e nas parcelas — o total já é conhecido.
  useEffect(() => {
    if (paymentType === 'a_vista') {
      setForm(f => ({ ...f, received_down_payment_brl: avista.value_brl || '', received_installments_brl: '' }))
    } else {
      const dp = hasEntrada ? (entrada.value_brl || '') : ''
      const sum = installments.reduce((s, it) => s + Number(it.value_brl || 0), 0)
      setForm(f => ({ ...f, received_down_payment_brl: dp, received_installments_brl: installments.length ? sum : '' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentType, avista.value_brl, hasEntrada, entrada.value_brl, installments])

  const buildPayload = () => {
    const installmentsPayload = []
    if (paymentType === 'a_vista') {
      // Pagamento único, guardado como uma parcela (nº 1); o payment_type marca à vista.
      installmentsPayload.push({
        kind: 'parcela', installment_number: 1, detail: '',
        due_date: avista.due_date || null, value_brl: toDec(avista.value_brl),
        payment_method: avista.payment_method,
      })
    } else {
      if (hasEntrada && (entrada.detail || entrada.due_date || entrada.value_brl || entrada.payment_method)) {
        installmentsPayload.push({
          kind: 'entrada', installment_number: null, detail: entrada.detail,
          due_date: entrada.due_date || null, value_brl: toDec(entrada.value_brl),
          payment_method: entrada.payment_method,
        })
      }
      installments.forEach((it, i) => {
        installmentsPayload.push({
          kind: 'parcela', installment_number: i + 1, detail: it.detail,
          due_date: it.due_date || null, value_brl: toDec(it.value_brl),
          payment_method: it.payment_method,
        })
      })
    }

    // Nome do pacote e datas já vêm preenchidos do roteiro selecionado (e podem
    // ser ajustados); o aeroporto é sempre manual (roteiro não tem aeroporto).
    const packageFields = {
      package_name: form.package_name,
      departure_date: form.departure_date || null,
      return_date: form.return_date || null,
      departure_airport: form.departure_airport,
    }

    // Contratante: passageiro cadastrado OU dados preenchidos à mão (nunca os dois).
    const contratanteFields = form.contratante
      ? { contratante: form.contratante, payer_type: '', payer_name: '', payer_document: '',
          payer_birth_date: null, payer_gender: '', payer_email: '', payer_phone: '', payer_address: '' }
      : { contratante: null, payer_type: payer.payer_type, payer_name: payer.payer_name,
          payer_document: payer.payer_document, payer_birth_date: payer.payer_birth_date || null,
          payer_gender: payer.payer_gender, payer_email: payer.payer_email,
          payer_phone: payer.payer_phone, payer_address: payer.payer_address }

    return {
      agency: form.agency, itinerary: form.itinerary,
      // Vendedor só é enviado por quem pode trocá-lo; o backend ignora/força ao
      // criador caso contrário. Em criação sem escolha, vai null e o backend usa o criador.
      ...(canChangeSeller ? { seller: form.seller || null } : {}),
      observations: form.observations,
      base_currency: form.base_currency || 'USD',
      payment_type: paymentType,
      exchange_rate: toDec(form.exchange_rate, 4),
      ...packageFields,
      ...contratanteFields,
      received_down_payment_brl: toDec(form.received_down_payment_brl),
      received_installments_brl: toDec(form.received_installments_brl),
      round_step: Number(form.round_step) || 0, round_mode: form.round_mode || 'nearest', round_currency: form.round_currency || 'brl',
      signature_type: form.signature_type || 'fisica',
      accommodation_lines: accomLines.filter(l => l.accommodation_type).map(l => ({
        accommodation_type: l.accommodation_type, value_per_person_usd: toDec(l.value_per_person_usd) ?? 0,
        taxes_usd: toDec(l.taxes_usd) ?? 0, quantity: l.quantity || 1,
      })),
      guests: guests.filter(g => g.passenger).map(g => ({
        passenger: g.passenger,
        accommodation_type: roomTypeOf(g.room),
        room_group: g.room ?? null,
      })),
      adjustments: adjustments
        .filter(a => Number(a.value_usd) !== 0 || Number(a.percent) !== 0 || (a.description || '').trim())
        .map(a => ({
          description: a.description || '', kind: a.kind || 'acrescimo', mode: a.mode || 'valor',
          value_usd: a.mode === 'percentual' ? 0 : (toDec(a.value_usd) ?? 0),
          percent: a.mode === 'percentual' ? (toDec(a.percent) ?? 0) : 0,
        })),
      installments: installmentsPayload,
      clauses: selectedClauses,
      custom_clauses: customClauses,
    }
  }

  const validateRequired = () => {
    if (!form.agency) { toast.error('Selecione a agência.'); return false }
    if (!form.contratante && !payer.payer_name.trim()) {
      toast.error('Selecione um contratante cadastrado ou preencha os dados do pagante manualmente.')
      return false
    }
    return true
  }

  // Finalizar: valida tudo e marca o contrato como pronto (status 'ativo').
  // Usa o id que o autosave já criou (se houver) — senão cria na hora.
  const doSave = async () => {
    if (!validateRequired()) return
    clearTimeout(autosaveTimerRef.current)
    const st = autosaveRef.current
    setSaving(true)
    try {
      // Espera um autosave em andamento terminar, pra usar o id certo (evita
      // criar um segundo contrato).
      while (st.saving) await new Promise(r => setTimeout(r, 80))
      const payload = buildPayload()
      payload.status = 'ativo'
      if (st.id) {
        await contractsApi.update(st.id, payload)
      } else {
        const r = await contractsApi.create(payload)
        st.id = r.data.id
      }
      toast.success(isEdit ? 'Contrato salvo.' : 'Contrato criado.')
      onSaved()
    } catch (e) {
      toast.error(e.response?.data?.error ?? 'Erro ao salvar contrato.')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveClick = () => {
    if (!validateRequired()) return
    if (totalMismatch) { setConfirmMismatch(true); return }
    doSave()
  }

  // Cancelar: descarta o rascunho criado nesta sessão (contrato novo) — não deixa
  // rascunho salvo. Fechar clicando fora (onClose) mantém o rascunho pra retomar.
  const handleCancel = async () => {
    clearTimeout(autosaveTimerRef.current)
    const st = autosaveRef.current
    st.discarded = true                       // impede autosaves posteriores
    if (!isEdit && st.id) {                    // só descarta rascunho criado agora (contrato novo)
      while (st.saving) await new Promise(r => setTimeout(r, 60))   // espera autosave em curso
      try { await contractsApi.discard(st.id) } catch { /* ignora */ }
    }
    onClose()
  }

  // Autosave silencioso (sem validar, sem fechar). `snap` = JSON do payload no
  // instante em que o debounce disparou — usado direto pra evitar closures velhas.
  const runAutosave = async (snap) => {
    const st = autosaveRef.current
    if (st.discarded) return                               // cancelado: não salva mais
    if (st.saving) { st.dirty = snap; return }             // já salvando: re-salva depois
    if (snap === lastSavedRef.current) return              // nada mudou desde o último save
    const p = JSON.parse(snap)
    // Qualquer informação preenchida pelo usuário já cria o rascunho. Campos
    // auto-populados (câmbio, moeda base, totais, vendedor, arredondamento) NÃO
    // contam — senão o sistema criaria rascunho sozinho ao abrir a tela.
    const txt = (v) => (v || '').toString().trim()
    const hasContent = !!(
      p.agency || p.itinerary || p.contratante ||
      txt(p.payer_name) || txt(p.payer_document) || txt(p.payer_phone) || txt(p.payer_email) || txt(p.payer_address) ||
      (p.guests && p.guests.length) || (p.accommodation_lines && p.accommodation_lines.length) ||
      (p.installments && p.installments.length) || (p.adjustments && p.adjustments.length) ||
      (p.clauses && p.clauses.length) || (p.custom_clauses && p.custom_clauses.length) ||
      txt(p.package_name) || p.departure_date || p.return_date || txt(p.departure_airport) || txt(p.observations) ||
      p.received_down_payment_brl || p.received_installments_brl
    )
    if (!st.id && !hasContent) return                      // não cria rascunho vazio
    st.saving = true; setSavingState('saving')
    try {
      // Contrato novo (ainda sem id) entra como rascunho; ao atualizar um
      // existente, não mexe no status (preserva ativo/rascunho).
      if (!st.id) p.status = 'rascunho'
      if (st.id) {
        await contractsApi.update(st.id, p)
      } else {
        const r = await contractsApi.create(p)
        st.id = r.data.id
        setReservationNumber(r.data.reservation_number ?? '')
      }
      lastSavedRef.current = snap
      setSavingState('saved')
    } catch {
      setSavingState('idle')   // falhou: tenta de novo na próxima mudança
    } finally {
      st.saving = false
      if (st.dirty && st.dirty !== lastSavedRef.current) { const d = st.dirty; st.dirty = null; runAutosave(d) }
      else st.dirty = null
    }
  }

  // Dispara o autosave (debounce) sempre que o payload muda, depois que o estado
  // inicial está montado (não salva o estado recém-carregado).
  const autosaveSnapshot = JSON.stringify(buildPayload())
  useEffect(() => {
    if (loading || autosaveRef.current.discarded) return
    if (!baselineReadyRef.current) {        // 1ª vez pronto: fixa a baseline, não salva
      baselineReadyRef.current = true
      lastSavedRef.current = autosaveSnapshot
      return
    }
    clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => runAutosave(autosaveSnapshot), 1200)
    return () => clearTimeout(autosaveTimerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveSnapshot, loading])

  // Passo final: "papel completo" — resumo read-only com seções bem divididas.
  const renderReview = () => {
    const fmtN = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 }))
    const typeName = (id) => accomTypes.find(t => t.id === id)?.name ?? '—'
    const ag = agencies.find(a => a.id === form.agency)
    const it = itineraries.find(i => i.id === form.itinerary)
    const contratanteName = form.contratante
      ? (passengers.find(p => p.id === form.contratante)?.full_name ?? '—')
      : (payer.payer_name ? `${payer.payer_name} (CNPJ)` : '—')

    const sec = (title, children) => (
      <div style={{ border: '1px solid #e6eaf1', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ background: '#f8fafc', borderBottom: '1px solid #eef2f7', padding: '8px 14px', fontSize: 11.5, fontWeight: 800, color: '#1a2d4f', textTransform: 'uppercase', letterSpacing: '.04em' }}>{title}</div>
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>{children}</div>
      </div>
    )
    const row = (k, v, key) => (
      <div key={key ?? k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
        <span style={{ color: '#64748b' }}>{k}</span>
        <span style={{ color: '#1e293b', fontWeight: 500, textAlign: 'right' }}>{v}</span>
      </div>
    )
    const unassigned = guests.filter(g => g.room == null)

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 12.5, color: '#64748b', margin: 0 }}>
          Confira o contrato completo abaixo. Para mudar algo, clique no passo correspondente lá em cima.
        </p>

        {sec('Assinatura', [
          row('Forma de assinatura', form.signature_type === 'digital' ? 'Digital' : 'Física (imprimir e assinar)', 'sig'),
        ])}

        {sec('Agência, roteiro e contratante', [
          row('Agência', ag ? agencyLabel(ag) : '—', 'ag'),
          row('Roteiro / pacote', it ? it.name : (form.package_name || '—'), 'rot'),
          row('Contratante / pagante', contratanteName, 'ct'),
          row('Vendedor', `${currentSeller.name}${currentSeller.email || currentSeller.phone ? ` (${[currentSeller.email, currentSeller.phone].filter(Boolean).join(' · ')})` : ''}`, 'sel'),
        ])}

        {sec('Pacote de viagem', [
          row('Nome do pacote', form.package_name || '—', 'pn'),
          row('Datas', `${fmtDateBR(form.departure_date) || '—'}  →  ${fmtDateBR(form.return_date) || '—'}`, 'dt'),
          row('Aeroporto de embarque', form.departure_airport || '—', 'ap'),
        ])}

        {sec(`Passageiros e quartos (${guests.length})`, [
          ...(rooms.length === 0 && guests.length === 0 ? [<span key="np" style={{ fontSize: 13, color: '#94a3b8' }}>Nenhum passageiro.</span>] : []),
          ...rooms.map((r, idx) => {
            const occ = guests.filter(g => g.room === r.id)
            return (
              <div key={`room${r.id}`} style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 700, color: '#1e293b' }}>Quarto {idx + 1}</span>
                <span style={{ color: '#64748b' }}> — {typeName(r.type)}: </span>
                <span style={{ color: '#475569' }}>{occ.length ? occ.map(g => guestName(g.passenger)).join(', ') : '(vazio)'}</span>
              </div>
            )
          }),
          ...(unassigned.length ? [(
            <div key="semquarto" style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 700, color: '#b45309' }}>Sem quarto: </span>
              <span style={{ color: '#475569' }}>{unassigned.map(g => guestName(g.passenger)).join(', ')}</span>
            </div>
          )] : []),
        ])}

        {sec('Valores', [
          ...accomLines.filter(l => l.accommodation_type).map((l, i) =>
            row(`${typeName(l.accommodation_type)} × ${l.quantity}`, `${cur} ${fmtN((Number(l.value_per_person_usd || 0) + Number(l.taxes_usd || 0)) * Number(l.quantity || 1))}`, `al${i}`)),
          ...adjustments.filter(a => Number(a.value_usd) || Number(a.percent)).map((a, i) => {
            const amt = a.mode === 'percentual' ? accomSubtotalUsd * Number(a.percent || 0) / 100 : Number(a.value_usd || 0)
            const signed = (a.kind === 'desconto' ? -1 : 1) * amt
            return row(a.description || (a.kind === 'desconto' ? 'Desconto' : 'Acréscimo'), `${signed < 0 ? '−' : '+'} ${cur} ${fmtN(Math.abs(signed))}`, `aj${i}`)
          }),
          ...(Number(form.round_step) > 0 ? [row('Arredondamento', `${form.round_currency === 'usd' ? cur : 'R$'} · múltiplo de ${Number(form.round_step).toLocaleString('pt-BR')}`, 'rd')] : []),
          <div key="tot" style={{ borderTop: '1px solid #eef2f7', paddingTop: 8, marginTop: 2 }}>
            {row(<strong>Soma total ({cur})</strong>, <strong>{cur} {fmtN(computedTotalUsd)}</strong>, 'tu')}
            {row(<strong>Total (BRL)</strong>, <strong>R$ {fmtN(computedTotalBrl)}</strong>, 'tb')}
          </div>,
        ])}

        {sec('Pagamento', paymentType === 'a_vista'
          ? [row('À vista', `R$ ${fmtN(avista.value_brl)}${avista.due_date ? `  ·  ${fmtDateBR(avista.due_date)}` : ''}`, 'av')]
          : [
            ...(hasEntrada ? [row('Entrada', `R$ ${fmtN(entrada.value_brl)}${entrada.due_date ? `  ·  ${fmtDateBR(entrada.due_date)}` : ''}`, 'ent')] : []),
            ...(installments.length === 0 ? [<span key="sp" style={{ fontSize: 13, color: '#94a3b8' }}>Sem parcelas.</span>]
              : installments.map((it2, i) => row(`Parcela ${i + 1}${it2.due_date ? `  ·  ${fmtDateBR(it2.due_date)}` : ''}`, `R$ ${fmtN(it2.value_brl)}`, `par${i}`))),
          ])}

        {sec('Cláusulas', (() => {
          const sel = clauses.filter(c => c.is_default || selectedClauses.includes(c.id))
          if (!sel.length && !customClauses.length) return [<span key="nc" style={{ fontSize: 13, color: '#94a3b8' }}>Nenhuma cláusula.</span>]
          return [
            ...sel.map(c => (
              <div key={c.id} style={{ fontSize: 13, color: '#1e293b' }}>• {c.name}{c.is_default ? <span style={{ color: '#94a3b8' }}> (sempre)</span> : ''}</div>
            )),
            ...customClauses.map((c, i) => (
              <div key={`cc${i}`} style={{ fontSize: 13, color: '#1e293b' }}>• {c.name || '(sem título)'}<span style={{ color: '#94a3b8' }}> (personalizada)</span></div>
            )),
          ]
        })())}
      </div>
    )
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 920, maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.24)' }}>
        <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>
              {isEdit ? 'Editar contrato' : 'Novo contrato'}
              {isEdit && reservationNumber && (
                <span style={{ fontSize: 12, fontWeight: 400, color: '#94a3b8', marginLeft: 10 }}>
                  Reserva nº {reservationNumber} · {fmtDateBR(contractDate)}
                </span>
              )}
            </p>
            {/* Moeda base — do roteiro (travada) ou escolhida quando não há roteiro */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Moeda base</span>
              {currencyLocked ? (
                <span title="Definida pelo roteiro selecionado — para trocar, mude ou remova o roteiro"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', fontSize: 12.5, fontWeight: 700 }}>
                  {form.base_currency} — {curSym(form.base_currency)} <Ic n="key" s={11} />
                </span>
              ) : (
                <div style={{ width: 140 }}>
                  <Dropdown value={form.base_currency} onChange={(v) => setBaseCurrency(v || 'USD')} options={currencyOptions} clearable={false} placeholder="Moeda" />
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {isEdit && (
              <button type="button" onClick={() => { setPreviewData({ payload: buildPayload(), overrides: { reservation_number: reservationNumber, contract_date: contractDate || null } }); setShowPreview(true) }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#1a2d4f', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                <Ic n="eye" s={13} /> Ver documento
              </button>
            )}
            <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }} title="Como você prefere preencher — fica salvo no seu perfil">
              {[{ v: 'steps', label: 'Passo a passo' }, { v: 'full', label: 'Completo' }].map(o => {
                const active = layout === o.v
                return (
                  <button key={o.v} type="button" onClick={() => changeLayout(o.v)}
                    style={{ padding: '6px 12px', border: 'none', background: active ? '#1a2d4f' : '#fff', color: active ? '#fff' : '#64748b', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {o.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {loading ? (
          <p style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Carregando…</p>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* Barra de passos — só no modo passo a passo */}
            {layout === 'steps' && (
            <div style={{ display: 'flex', gap: 6, padding: '14px 20px 0', flexWrap: 'wrap' }}>
              {STEPS.map((s, idx) => (
                <button key={s.key} type="button" onClick={() => setStep(idx)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 20, border: `1px solid ${idx === step ? '#2e6db4' : '#e6eaf1'}`, background: idx === step ? '#eff6ff' : '#fff', color: idx === step ? '#1a2d4f' : '#64748b', fontSize: 12, fontWeight: idx === step ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: '50%', fontSize: 10, fontWeight: 700, background: idx === step ? '#2e6db4' : (idx < step ? '#22c55e' : '#e2e8f0'), color: idx <= step ? '#fff' : '#94a3b8' }}>
                    {idx < step ? '✓' : idx + 1}
                  </span>
                  {s.title}
                </button>
              ))}
            </div>
            )}
            {totalMismatch && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 20px 0', padding: '10px 14px', borderRadius: 8, background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e', fontSize: 12.5 }}>
                <Ic n="warn" s={15} />
                Entrada + parcelas ({sumFilled.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) não somam o total ({computedTotalBrl?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).
              </div>
            )}
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto', flex: 1 }}>

            {(layout === 'full' || step === 0) && (<>
            {/* Forma de assinatura */}
            <div style={card}>
              <p style={sectionTitle}><Ic n="docs" s={14} /> Forma de assinatura</p>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { v: 'fisica', label: 'Física', hint: 'Imprimir, assinar à mão e enviar o PDF' },
                  { v: 'digital', label: 'Digital', hint: 'Assinatura digital (em breve)' },
                ].map(opt => {
                  const active = form.signature_type === opt.v
                  return (
                    <button key={opt.v} type="button" onClick={() => setForm(f => ({ ...f, signature_type: opt.v }))}
                      style={{ flex: 1, textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: `1.5px solid ${active ? '#2e6db4' : '#e2e8f0'}`, background: active ? '#eff6ff' : '#fff', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: active ? '#1a2d4f' : '#475569' }}>
                        {active ? '● ' : '○ '}{opt.label}
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{opt.hint}</div>
                    </button>
                  )
                })}
              </div>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '8px 0 0' }}>
                Aparece em destaque no cabeçalho do PDF.
              </p>
            </div>

            {/* Agência / Lista / Contratante */}
            <div style={card}>
              <p style={sectionTitle}><Ic n="building" s={14} /> Agência, pacote e contratante</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={lbl}>Agência de viagem (intermediadora) *</label>
                  <EntityPicker items={agencyItems} selectedIds={form.agency ? [form.agency] : []}
                    onChange={(ids) => setForm(f => ({ ...f, agency: ids[0] ?? null }))}
                    title="Selecionar agência" searchPlaceholder="Buscar agência…" placeholder="— Selecionar agência —"
                    emptyLabel="Nenhuma agência encontrada" createLink={{ label: 'Adicionar nova agência', to: '/agencias' }} />
                </div>
                <div>
                  <label style={lbl}>Roteiro / pacote</label>
                  <EntityPicker items={itineraryItems} selectedIds={form.itinerary ? [form.itinerary] : []}
                    onChange={handleSelectItinerary}
                    title="Selecionar roteiro" searchPlaceholder="Buscar roteiro…" placeholder="— Selecionar roteiro —"
                    emptyLabel="Nenhum roteiro encontrado" />
                  <p style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0 0' }}>
                    Selecionando um roteiro, o nome do pacote e as datas são preenchidos automaticamente (e podem ser ajustados).
                  </p>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <label style={lbl}>Cliente: contratante / responsável pelo pagamento *</label>
                    {!(!form.contratante && payer.payer_name.trim()) && (
                      <button type="button" onClick={() => setShowPayerModal(true)}
                        title="Pagante pessoa jurídica (CNPJ)"
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#94a3b8', fontSize: 11, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                        <Ic n="building" s={11} /> Empresa (CNPJ)
                      </button>
                    )}
                  </div>
                  {(!form.contratante && payer.payer_name.trim()) ? (
                    /* CNPJ definido — esconde a busca e o "+", mostra só o cartão da empresa */
                    <div style={{ padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                          {payer.payer_name}
                          <span style={{ fontSize: 11, fontWeight: 500, color: '#64748b', marginLeft: 6 }}>(CNPJ)</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{payer.payer_document || 'Pagante avulso'}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button type="button" onClick={() => setShowPayerModal(true)}
                          style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                          Editar
                        </button>
                        <button type="button" onClick={clearPayer}
                          style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #fee2e2', background: '#fef2f2', color: '#dc2626', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                          Remover
                        </button>
                      </div>
                    </div>
                  ) : (
                    <EntityPicker items={passengerItems} selectedIds={form.contratante ? [form.contratante] : []}
                      onChange={(ids) => { setForm(f => ({ ...f, contratante: ids[0] ?? null })); if (ids[0]) clearPayer() }}
                      title="Selecionar contratante" searchPlaceholder="Buscar passageiro…" placeholder="— Selecionar contratante —"
                      emptyLabel="Nenhum passageiro encontrado" createLink={{ label: 'Adicionar novo passageiro', to: '/passageiros' }} />
                  )}
                </div>
                {/* Vendedor — aparece no contrato (e-mail e telefone). Padrão: quem cria. */}
                <div>
                  <label style={lbl}>Vendedor <span style={{ fontWeight: 400, textTransform: 'none', color: '#94a3b8' }}>(e-mail e telefone que aparecem no contrato)</span></label>
                  {canChangeSeller ? (
                    <>
                      <EntityPicker items={sellerItems} selectedIds={form.seller ? [form.seller] : []}
                        onChange={(ids) => setForm(f => ({ ...f, seller: ids[0] ?? null }))}
                        title="Selecionar vendedor" searchPlaceholder="Buscar usuário…"
                        placeholder={`— Padrão: ${meSellerBrief.name} —`}
                        emptyLabel="Nenhum usuário encontrado" />
                      <p style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0 0' }}>
                        Sem escolher um vendedor, o contrato sai com o seu contato. Contato atual: {[currentSeller.email, currentSeller.phone].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </>
                  ) : (
                    <div style={{ padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{currentSeller.name}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{[currentSeller.email, currentSeller.phone].filter(Boolean).join(' · ') || '—'}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Pacote de viagem */}
            <div style={card}>
              <p style={sectionTitle}><Ic n="plane" s={14} /> Pacote de viagem</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {form.itinerary ? (
                  /* Roteiro selecionado — nome e datas vêm dele e ficam travados */
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 2 }}>
                      <label style={lbl}>Nome do pacote</label>
                      <input style={inpRO} readOnly value={form.package_name} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={lbl}>Data de início</label>
                      <input style={inpRO} readOnly value={fmtDateBR(form.departure_date) || '—'} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={lbl}>Data de término</label>
                      <input style={inpRO} readOnly value={fmtDateBR(form.return_date) || '—'} />
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 2 }}>
                      <label style={lbl}>Nome do pacote</label>
                      <input style={inp} value={form.package_name} onChange={set('package_name')} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={lbl}>Data de início</label>
                      <DatePicker value={form.departure_date} relatedDate={form.return_date || null}
                        onChange={v => setForm(f => ({ ...f, departure_date: v }))} fixed />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={lbl}>Data de término</label>
                      <DatePicker value={form.return_date} relatedDate={form.departure_date || null}
                        onChange={v => setForm(f => ({ ...f, return_date: v }))} fixed />
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Aeroporto de embarque</label>
                    <AirportPicker value={departureAirportObj}
                      onChange={a => { setDepartureAirportObj(a); setForm(f => ({ ...f, departure_airport: a?.name ?? '' })) }}
                      placeholder="Buscar aeroporto…" />
                  </div>
                </div>
                <div>
                  <label style={lbl}>Observações</label>
                  <textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} value={form.observations} onChange={set('observations')} />
                </div>
              </div>
            </div>

            </>)}

            {(layout === 'full' || step === 1) && (<>
            {/* Hóspedes + Quartos */}
            <div style={card}>
              <p style={sectionTitle}><Ic n="users" s={14} /> Nome dos passageiros / quartos</p>
              <label style={lbl}>Hóspedes (contratante e demais usuários dos serviços)</label>
              <EntityPicker items={passengerItems} selectedIds={guestIds} onChange={handleGuestsChange}
                multiple title="Selecionar hóspedes" searchPlaceholder="Buscar passageiro…" placeholder="— Selecionar hóspedes —"
                emptyLabel="Nenhum passageiro encontrado" createLink={{ label: 'Adicionar novo passageiro', to: '/passageiros' }} />

              {(guests.length > 0 || rooms.length > 0) && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ fontSize: 12, color: '#64748b', margin: 0, display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.4 }}>
                    <Ic n="bed" s={13} />
                    <span><span style={{ color: '#475569', fontWeight: 600 }}>Arraste cada passageiro para um quarto</span> (ou use o seletor "mover"). A acomodação vale para todos no quarto.</span>
                  </p>

                  {/* Pool: sem quarto */}
                  {(() => {
                    const unassigned = guests.filter(g => g.room == null)
                    return (
                      <div
                        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                        onDragEnter={() => setDragOverKey('pool')}
                        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverKey(k => k === 'pool' ? null : k) }}
                        onDrop={e => { const pid = Number(e.dataTransfer.getData('text/plain')); setDragOverKey(null); setDraggingId(null); if (pid) assignGuest(pid, null) }}
                        style={{ border: `1.5px dashed ${dragOverKey === 'pool' ? '#2e6db4' : '#cbd5e1'}`, borderRadius: 8, padding: 10, background: dragOverKey === 'pool' ? '#eff6ff' : '#fafbfc', transition: 'border-color .12s, background .12s' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                          Sem quarto ({unassigned.length})
                        </div>
                        {unassigned.length === 0 ? (
                          <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>Todos os passageiros já estão em um quarto.</p>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{unassigned.map(renderGuestChip)}</div>
                        )}
                      </div>
                    )
                  })()}

                  {/* Quartos */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
                    {rooms.map((room, idx) => {
                      const occ = guests.filter(g => g.room === room.id)
                      const cap = accomTypes.find(t => t.id === room.type)?.capacity
                      const over = cap ? occ.length > cap : false
                      return (
                        <div key={room.id}
                          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                          onDragEnter={() => setDragOverKey(room.id)}
                          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverKey(k => k === room.id ? null : k) }}
                          onDrop={e => { const pid = Number(e.dataTransfer.getData('text/plain')); setDragOverKey(null); setDraggingId(null); if (pid) assignGuest(pid, room.id) }}
                          style={{ border: `${dragOverKey === room.id ? 1.5 : 1}px solid ${dragOverKey === room.id ? '#2e6db4' : (over ? '#fca5a5' : '#e2e8f0')}`, borderRadius: 8, padding: 10, background: dragOverKey === room.id ? '#eff6ff' : (over ? '#fef2f2' : '#fff'), display: 'flex', flexDirection: 'column', gap: 8, transition: 'border-color .12s, background .12s' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                              Quarto {idx + 1}
                              <span style={{ fontSize: 11, fontWeight: 500, color: over ? '#dc2626' : '#94a3b8', marginLeft: 6 }}>
                                {occ.length}{cap ? `/${cap}` : ''}
                              </span>
                            </span>
                            <button type="button" onClick={() => removeRoom(room.id)} title="Excluir quarto"
                              style={{ display: 'flex', padding: 4, borderRadius: 6, border: '1px solid #fee2e2', background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}>
                              <Ic n="trash" s={12} />
                            </button>
                          </div>
                          <Dropdown value={room.type ?? null} options={accomTypeOptions} placeholder="— Acomodação —"
                            onChange={v => setRoomType(room.id, v)} />
                          {occ.length === 0 ? (
                            <p style={{ fontSize: 12, color: '#cbd5e1', margin: '2px 0', textAlign: 'center' }}>Arraste passageiros pra cá</p>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{occ.map(renderGuestChip)}</div>
                          )}
                          {over && <span style={{ fontSize: 11, color: '#dc2626' }}>Acima da capacidade do tipo</span>}
                        </div>
                      )
                    })}

                    {/* Novo quarto — clicar OU soltar uma pessoa aqui cria um quarto */}
                    <div
                      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                      onDragEnter={() => setDragOverKey('new')}
                      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverKey(k => k === 'new' ? null : k) }}
                      onDrop={e => { const pid = Number(e.dataTransfer.getData('text/plain')); setDragOverKey(null); setDraggingId(null); if (pid) createRoomWith(pid) }}
                      onClick={addRoom}
                      style={{ border: `1.5px dashed ${dragOverKey === 'new' ? '#2e6db4' : '#cbd5e1'}`, borderRadius: 8, padding: 10, background: dragOverKey === 'new' ? '#eff6ff' : '#fafbfc', minHeight: 96, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer', color: '#64748b', transition: 'border-color .12s, background .12s' }}>
                      <Ic n="plus" s={18} />
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Novo quarto</span>
                      <span style={{ fontSize: 10.5, color: '#94a3b8', textAlign: 'center' }}>clique ou arraste alguém aqui</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            </>)}

            {(layout === 'full' || step === 2) && (<>
            {/* Tipos de Acomodação / Valores */}
            <div style={card}>
              <p style={sectionTitle}><Ic n="bed" s={14} /> Tipos de acomodação / valores por pessoa</p>
              <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '0 0 10px' }}>
                As linhas e quantidades abaixo são geradas automaticamente a partir dos quartos montados acima (cada quarto = 1 unidade) — pode ajustar os valores manualmente se precisar. Tipos cujo valor já vem do roteiro ficam travados.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {accomLines.map((line, idx) => {
                  const locked = pricedTypeIds.has(line.accommodation_type)
                  // Valor/pessoa exibido = valor base + comissão da agência embutida.
                  const commFactor = 1 + agencyCommissionPct / 100
                  const shownValue = agencyCommissionPct > 0
                    ? round2(Number(line.value_per_person_usd || 0) * commFactor)
                    : line.value_per_person_usd
                  return (
                  <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div style={{ flex: 2 }}>
                      {idx === 0 && <label style={lbl}>Tipo de acomodação</label>}
                      <Dropdown value={line.accommodation_type ?? null} options={accomTypeOptions}
                        onChange={v => updateAccomLine(idx, 'accommodation_type', v)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      {idx === 0 && <label style={lbl}>Valor/pessoa ({cur})</label>}
                      <MoneyInput style={locked ? inpRO : inp} value={shownValue}
                        disabled={locked} readOnly={locked}
                        onChange={v => updateAccomLine(idx, 'value_per_person_usd', agencyCommissionPct > 0 ? round2(Number(v || 0) / commFactor) : v)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      {idx === 0 && <label style={lbl}>Taxas ({cur})</label>}
                      <MoneyInput style={locked ? inpRO : inp} value={line.taxes_usd}
                        disabled={locked} readOnly={locked}
                        onChange={v => updateAccomLine(idx, 'taxes_usd', v)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      {idx === 0 && <label style={lbl}>Quantidade</label>}
                      <input style={inp} type="number" min="1" value={line.quantity}
                        onChange={e => updateAccomLine(idx, 'quantity', e.target.value)} />
                    </div>
                    <button type="button" onClick={() => removeAccomLine(idx)}
                      style={{ padding: 8, borderRadius: 6, border: '1px solid #fee2e2', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', flexShrink: 0 }}>
                      <Ic n="trash" s={13} />
                    </button>
                  </div>
                  )
                })}
                <button type="button" onClick={addAccomLine}
                  style={{ alignSelf: 'flex-start', padding: '6px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  + Adicionar linha
                </button>
              </div>
            </div>

            {/* Dados de pagamento */}
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <p style={{ ...sectionTitle, margin: 0 }}><Ic n="card" s={14} /> Dados dos pagamentos / valores</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => setShowAdjustments(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#1a2d4f', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    <Ic n="plus" s={13} /> Valores extras / descontos
                    {adjustments.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: adjustmentsTotalUsd < 0 ? '#dc2626' : '#15803d' }}>
                        ({adjustmentsTotalUsd >= 0 ? '+' : '−'}{Math.abs(adjustmentsTotalUsd).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} USD)
                      </span>
                    )}
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Soma total ({cur})</label>
                    <input style={inpRO} readOnly value={computedTotalUsd.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Total em (BRL)</label>
                    <input style={inpRO} readOnly value={computedTotalBrl != null ? computedTotalBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Câmbio ({form.base_currency} → BRL)</label>
                    <MoneyInput style={canEditExchangeRate ? inp : inpRO} value={form.exchange_rate} maxDecimals={4}
                      disabled={!canEditExchangeRate} readOnly={!canEditExchangeRate}
                      onChange={v => setForm(f => ({ ...f, exchange_rate: v }))} />
                    <p style={{ fontSize: 10.5, color: '#94a3b8', margin: '3px 0 0' }}>
                      {canEditExchangeRate
                        ? 'Preenchido de Configurações → Câmbio (você pode ajustar).'
                        : 'Valor fixo de Configurações → Câmbio.'}
                    </p>
                  </div>
                </div>
                {commissionUsd > 0 && (
                  <p style={{ fontSize: 11.5, color: '#94a3b8', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Ic n="briefcase" s={12} />
                    Os valores por pessoa já incluem a comissão da agência ({agencyCommissionPct.toLocaleString('pt-BR')}%).
                  </p>
                )}
              </div>
            </div>

            </>)}

            {(layout === 'full' || step === 3) && (<>
            {/* Pagamento */}
            <div style={card}>
              <p style={sectionTitle}><Ic n="clock" s={14} /> Pagamento</p>

              {/* Forma: à vista ou parcelado */}
              <div style={{ display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
                {[['a_vista', 'À vista'], ['parcelado', 'Parcelado']].map(([val, label]) => {
                  const sel = paymentType === val
                  return (
                    <button key={val} type="button" onClick={() => setPaymentType(val)}
                      style={{ padding: '8px 16px', border: 'none', background: sel ? '#1a2d4f' : '#fff', color: sel ? '#fff' : '#475569', fontSize: 13, fontWeight: sel ? 600 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {label}
                    </button>
                  )
                })}
              </div>

              {paymentType === 'a_vista' ? (
                <div>
                  <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px' }}>O valor total é pago de uma vez — o valor já vem fixo com o total do contrato.</p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <label style={lbl}>Data</label>
                      <DatePicker value={avista.due_date} onChange={v => setAvista(p => ({ ...p, due_date: v }))} fixed />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={lbl}>Valor (BRL)</label>
                      <MoneyInput style={inpRO} placeholder="Valor (BRL)" value={avista.value_brl}
                        disabled readOnly
                        onChange={v => setAvista(p => ({ ...p, value_brl: v }))} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={lbl}>Forma de pagamento</label>
                      <Dropdown value={avista.payment_method || null} options={paymentMethodOptions} placeholder="— Forma de pagamento —"
                        onChange={v => setAvista(p => ({ ...p, payment_method: v }))} />
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Entrada (opcional) */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: hasEntrada ? 8 : 12 }}>
                    <input type="checkbox" checked={hasEntrada} onChange={e => setHasEntrada(e.target.checked)}
                      style={{ width: 15, height: 15, accentColor: '#1a2d4f', cursor: 'pointer' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Tem entrada?</span>
                  </label>
                  {hasEntrada && (
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: '#475569', margin: '0 0 4px' }}>Entrada</p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input style={{ ...inp, flex: 2 }} placeholder="Detalhe do pagamento" value={entrada.detail}
                          onChange={e => setEntrada(p => ({ ...p, detail: e.target.value }))} />
                        <div style={{ flex: 1 }}>
                          <DatePicker value={entrada.due_date} onChange={v => setEntrada(p => ({ ...p, due_date: v }))} fixed />
                        </div>
                        <MoneyInput style={{ ...inp, flex: 1 }} placeholder="Valor (BRL)" value={entrada.value_brl}
                          onChange={v => setEntrada(p => ({ ...p, value_brl: v }))} />
                        <div style={{ flex: 1 }}>
                          <Dropdown value={entrada.payment_method || null} options={paymentMethodOptions} placeholder="— Forma de pagamento —"
                            onChange={v => setEntrada(p => ({ ...p, payment_method: v }))} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Número de parcelas — digitável, sem limite */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                    <label style={lbl}>Número de parcelas</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button type="button" onClick={() => setInstallmentsCountClamped(installmentsCount - 1)}
                        style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer' }}>−</button>
                      <input type="number" min="0" value={installmentsCount}
                        onChange={e => setInstallmentsCountClamped(parseInt(e.target.value, 10))}
                        style={{ width: 64, textAlign: 'center', padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 14, fontWeight: 700, color: '#1e293b', fontFamily: 'inherit', outline: 'none' }} />
                      <button type="button" onClick={() => setInstallmentsCountClamped(installmentsCount + 1)}
                        style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer' }}>+</button>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>(o valor restante é dividido igualmente)</span>
                    </div>
                  </div>

                  {installments.map((it, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: '#64748b', width: 70, flexShrink: 0, paddingTop: 8 }}>{idx + 1}ª parcela</span>
                      <input style={{ ...inp, flex: 2 }} placeholder="Detalhe do pagamento" value={it.detail}
                        onChange={e => updateInstallment(idx, 'detail', e.target.value)} />
                      <div style={{ flex: 1 }}>
                        <DatePicker value={it.due_date} onChange={v => updateInstallment(idx, 'due_date', v)} fixed />
                      </div>
                      <MoneyInput style={{ ...inp, flex: 1 }} placeholder="Valor (BRL)" value={it.value_brl}
                        onChange={v => updateInstallment(idx, 'value_brl', v)} />
                      <div style={{ flex: 1 }}>
                        <Dropdown value={it.payment_method || null} options={paymentMethodOptions} placeholder="— Forma de pagamento —"
                          onChange={v => updateInstallment(idx, 'payment_method', v)} />
                      </div>
                    </div>
                  ))}
                  {installments.length > 1 && (
                    <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>
                      Definir a data e a forma de pagamento da 1ª parcela já aplica pras demais — ainda editável individualmente.
                    </p>
                  )}
                </>
              )}
            </div>

            </>)}

            {(layout === 'full' || step === 4) && (<>
            {/* Cláusulas */}
            <div style={card}>
              <p style={sectionTitle}><Ic n="docs" s={14} /> Cláusulas do contrato</p>
              {clauses.length === 0 ? (
                <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>
                  Nenhuma cláusula cadastrada. Cadastre em Configurações → Cláusulas de Contrato.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                  {clauses.map(c => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: c.is_default ? 'default' : 'pointer' }}>
                      <input type="checkbox" checked={c.is_default || selectedClauses.includes(c.id)} disabled={c.is_default}
                        onChange={e => setSelectedClauses(prev => e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id))}
                        style={{ width: 15, height: 15, accentColor: '#1a2d4f', cursor: c.is_default ? 'default' : 'pointer' }} />
                      <span style={{ fontSize: 13, color: '#1e293b' }}>{c.name}</span>
                      {c.is_default && <span style={{ fontSize: 11, color: '#f59e0b' }} title="Cláusula padrão — sempre incluída no contrato">★ sempre incluída</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Cláusulas personalizadas — escritas só para este contrato */}
            {(canCustomClauses || customClauses.length > 0) && (
              <div style={card}>
                <p style={sectionTitle}><Ic n="edit" s={14} /> Cláusulas personalizadas deste contrato</p>
                <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '0 0 10px' }}>
                  Cláusulas escritas à mão só para este contrato — não entram na lista global de Configurações.
                </p>
                {customClauses.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: canCustomClauses ? 10 : 0 }}>
                    {customClauses.map((c, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e2e8f0', borderRadius: 6, padding: '7px 10px' }}>
                        <Ic n="docs" s={13} />
                        <span style={{ fontSize: 13, color: '#1e293b', flex: 1, fontWeight: 600 }}>{c.name || '(sem título)'}</span>
                        {canCustomClauses && (<>
                          <button type="button" onClick={() => setClauseEditor({ index: i, initial: c })}
                            style={{ padding: 6, borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer' }} title="Editar">
                            <Ic n="edit" s={13} />
                          </button>
                          <button type="button" onClick={() => setCustomClauses(prev => prev.filter((_, j) => j !== i))}
                            style={{ padding: 6, borderRadius: 6, border: '1px solid #fee2e2', background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }} title="Remover">
                            <Ic n="trash" s={13} />
                          </button>
                        </>)}
                      </div>
                    ))}
                  </div>
                )}
                {canCustomClauses && (
                  <button type="button" onClick={() => setClauseEditor({ index: -1, initial: null })}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 7, border: '1px solid #c7d6ee', background: '#eff6ff', color: '#1e40af', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    <Ic n="plus" s={13} /> Escrever cláusula
                  </button>
                )}
              </div>
            )}
            </>)}

            {layout === 'steps' && step === lastStep && renderReview()}
            </div>
          </div>
        )}

        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={handleCancel} disabled={saving}
              style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancelar
            </button>
            {savingState !== 'idle' && (
              <span style={{ fontSize: 12, color: savingState === 'saving' ? '#94a3b8' : '#16a34a', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Ic n={savingState === 'saving' ? 'clock' : 'check'} s={12} />
                {savingState === 'saving' ? 'Salvando…' : 'Salvo automaticamente'}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {layout === 'steps' && <span style={{ fontSize: 12, color: '#94a3b8' }}>Passo {step + 1} de {STEPS.length}</span>}
            {layout === 'steps' && step > 0 && (
              <button type="button" onClick={() => setStep(s => s - 1)} disabled={saving}
                style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Voltar
              </button>
            )}
            {(layout === 'steps' && step < lastStep) ? (
              <button type="button" onClick={() => setStep(s => Math.min(s + 1, lastStep))}
                style={{ ...btnPri, display: 'flex', alignItems: 'center', gap: 6 }}>
                Próximo <Ic n="chevron" s={13} />
              </button>
            ) : (
              <button onClick={handleSaveClick} disabled={saving || loading} style={{ ...btnPri, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Ic n="check" s={13} />{saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Finalizar contrato'}
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmMismatch && (
        <MismatchConfirm
          sumFilled={sumFilled}
          total={computedTotalBrl}
          onOk={() => { setConfirmMismatch(false); doSave() }}
          onCancel={() => setConfirmMismatch(false)}
        />
      )}
      {showPayerModal && (
        <PayerModal
          payer={payer}
          setPayer={setPayer}
          onClearContratante={() => setForm(f => ({ ...f, contratante: null }))}
          onClose={() => setShowPayerModal(false)}
        />
      )}
      {showAdjustments && (
        <AdjustmentsModal
          adjustments={adjustments}
          setAdjustments={setAdjustments}
          baseUsd={accomSubtotalUsd}
          commissionPct={agencyCommissionPct}
          commissionUsd={commissionUsd}
          cur={cur}
          onClose={() => setShowAdjustments(false)}
        />
      )}
      {showPreview && (
        <ContractPdfPreviewModal
          contractId={contractId}
          previewPayload={previewData?.payload}
          overrides={previewData?.overrides}
          allowDownload={form.signature_type !== 'digital' || loadedStage === 'assinado'}
          onClose={() => setShowPreview(false)}
          footerExtra={(loadedStage === 'em_edicao' && onPublish) ? (
            <button type="button" onClick={() => onPublish(contractId)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Ic n="mail" s={14} /> Enviar para assinatura
            </button>
          ) : null}
        />
      )}
      {clauseEditor && (
        <CustomClauseModal
          initial={clauseEditor.initial}
          onClose={() => setClauseEditor(null)}
          onSave={(data) => {
            setCustomClauses(prev => clauseEditor.index < 0
              ? [...prev, data]
              : prev.map((c, i) => i === clauseEditor.index ? data : c))
            setClauseEditor(null)
          }}
        />
      )}
    </div>
  )
}
