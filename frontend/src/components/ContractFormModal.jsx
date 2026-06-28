import { useState, useEffect, useMemo, useRef } from 'react'
import axios from 'axios'
import { toast } from 'sonner'
import { contractsApi, agenciesApi, passengersApi, itinerariesApi, configApi } from '../api'
import EntityPicker from './EntityPicker'
import DatePicker from './DatePicker'
import AirportPicker from './AirportPicker'
import Dropdown from './Dropdown'
import CnpjInput from './CnpjInput'
import { Ic } from './Icon'

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
                <input style={inp} type="email" value={payer.payer_email} onChange={setField('payer_email')} />
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

const lbl = { fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 5 }
const inp = { padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b', boxSizing: 'border-box', width: '100%' }
const inpRO = { ...inp, background: '#f8fafc', color: '#64748b' }
const btnPri = { padding: '8px 16px', borderRadius: 7, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
const sectionTitle = { fontSize: 13, fontWeight: 700, color: '#1e293b', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 6 }
const card = { border: '1px solid #e2e8f0', borderRadius: 8, padding: 14 }

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

export default function ContractFormModal({ contractId, onClose, onSaved }) {
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

  // Fontes de dados pros pickers
  const [agencies,   setAgencies]   = useState([])
  const [passengers, setPassengers] = useState([])
  const [itineraries, setItineraries] = useState([])
  const [accomTypes,  setAccomTypes] = useState([])
  const [clauses,     setClauses]    = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])

  const [form, setForm] = useState({
    agency: null, itinerary: null, contratante: null,
    package_name: '', departure_date: '', return_date: '', departure_airport: '', observations: '',
    exchange_rate: '', received_down_payment_brl: '', received_installments_brl: '',
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
  const [guests, setGuests]         = useState([]) // [{ passenger, room }]  room = id do quarto | null
  const [rooms, setRooms]           = useState([]) // [{ id, type }]  type = id da acomodação | null
  const roomSeqRef                  = useRef(1)     // gera ids estáveis de quarto
  const [draggingId, setDraggingId] = useState(null) // passageiro sendo arrastado
  const [dragOverKey, setDragOverKey] = useState(null) // zona destacada no arraste ('pool' | id do quarto | 'new')
  const [entrada, setEntrada]       = useState({ detail: '', due_date: '', value_brl: '', payment_method: '' })
  const [installmentsCount, setInstallmentsCount] = useState(0)
  const [installments, setInstallments] = useState([]) // [{ detail, due_date, value_brl, payment_method }]
  const [selectedClauses, setSelectedClauses] = useState([])
  const [reservationNumber, setReservationNumber] = useState('')
  const [contractDate, setContractDate] = useState('')

  useEffect(() => {
    Promise.all([
      agenciesApi.list(), passengersApi.list({ page_size: 1000 }), itinerariesApi.list({ page_size: 1000 }),
      configApi.accommodations(), configApi.contractClauses(), configApi.paymentMethods(), configApi.exchangeRates(),
    ]).then(([ag, pax, it, ac, cl, pm, er]) => {
      setAgencies(ag.data.results ?? ag.data)
      setPassengers(pax.data.results ?? pax.data)
      setItineraries(it.data.results ?? it.data)
      setAccomTypes(ac.data.results ?? ac.data)
      setClauses(cl.data)
      setPaymentMethods(pm.data)
      if (!isEdit) {
        setSelectedClauses((cl.data).filter(c => c.is_default).map(c => c.id))
        const usdBrl = (er.data).find(r => r.from_currency === 'USD' && r.to_currency === 'BRL')
        if (usdBrl) setForm(f => ({ ...f, exchange_rate: Number(usdBrl.rate) }))
      }
    }).catch(() => toast.error('Erro ao carregar dados auxiliares.'))
  }, [])

  useEffect(() => {
    if (!isEdit) return
    contractsApi.get(contractId).then(r => {
      const d = r.data
      setReservationNumber(d.reservation_number ?? '')
      setContractDate(d.contract_date ?? '')
      setForm({
        agency: d.agency, itinerary: d.itinerary, contratante: d.contratante,
        package_name: d.package_name ?? '', departure_date: d.departure_date ?? '', return_date: d.return_date ?? '',
        departure_airport: d.departure_airport ?? '', observations: d.observations ?? '',
        exchange_rate: d.exchange_rate != null ? Number(d.exchange_rate) : '',
        received_down_payment_brl: d.received_down_payment_brl ?? '',
        received_installments_brl: d.received_installments_brl ?? '',
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
      if (entradaRow) setEntrada({
        detail: entradaRow.detail ?? '', due_date: entradaRow.due_date ?? '',
        value_brl: entradaRow.value_brl ?? '', payment_method: entradaRow.payment_method ?? '',
      })
      setInstallmentsCount(parcelaRows.length)
      setInstallments(parcelaRows.map(r => ({
        detail: r.detail ?? '', due_date: r.due_date ?? '', value_brl: r.value_brl ?? '', payment_method: r.payment_method ?? '',
      })))
      setSelectedClauses((d.clauses ?? []))
    }).catch(() => toast.error('Erro ao carregar contrato.')).finally(() => {
      setLoading(false)
      setTimeout(() => { initializedRef.current = true }, 0)
    })
  }, [contractId])

  const agencyItems = useMemo(() => agencies.map(a => ({ id: a.id, label: agencyLabel(a), sublabel: a.cnpj || a.cpf })), [agencies])
  const passengerItems = useMemo(() => passengers.map(p => ({ id: p.id, label: p.full_name, sublabel: p.cpf || p.email })), [passengers])
  const itineraryItems = useMemo(() => itineraries.map(i => ({ id: i.id, label: i.name, sublabel: i.start_date ? `Início: ${fmtDateBR(i.start_date)}` : '' })), [itineraries])
  const accomTypeOptions = useMemo(() => accomTypes.map(at => ({ value: at.id, label: at.name })), [accomTypes])
  const paymentMethodOptions = useMemo(() => paymentMethods.map(pm => ({ value: pm.name, label: pm.name })), [paymentMethods])

  // Soma total (USD) sempre calculada a partir das linhas de acomodação —
  // nunca digitada. Total em BRL deriva da soma total e do câmbio.
  const computedTotalUsd = useMemo(() => accomLines.reduce(
    (sum, l) => sum + (Number(l.value_per_person_usd || 0) + Number(l.taxes_usd || 0)) * Number(l.quantity || 1), 0
  ), [accomLines])
  const computedTotalBrl = form.exchange_rate ? computedTotalUsd * Number(form.exchange_rate) : null

  // Soma do que foi de fato preenchido em entrada + parcelas, pra comparar com o total.
  const sumFilled = round2(Number(entrada.value_brl || 0) + installments.reduce((s, it) => s + Number(it.value_brl || 0), 0))
  const totalMismatch = computedTotalBrl != null && (entrada.value_brl || installments.some(i => i.value_brl)) &&
    Math.abs(sumFilled - round2(computedTotalBrl)) > 0.01

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const clearPayer = () => setPayer({
    payer_type: 'fisica', payer_name: '', payer_document: '', payer_birth_date: '',
    payer_gender: '', payer_email: '', payer_phone: '', payer_address: '',
  })

  const handleSelectItinerary = (ids) => {
    const id = ids[0] ?? null
    const it = id ? itineraries.find(x => x.id === id) : null
    if (it) {
      // Selecionar: preenche nome do pacote e datas a partir do roteiro (ficam
      // travados enquanto o roteiro estiver selecionado).
      setForm(f => ({
        ...f, itinerary: id,
        package_name: it.name ?? '',
        departure_date: it.start_date || '',
        return_date: it.end_date || '',
      }))
    } else {
      // Remover o roteiro: limpa tudo que ele havia preenchido (e o aeroporto).
      setDepartureAirportObj(null)
      setForm(f => ({
        ...f, itinerary: null,
        package_name: '', departure_date: '', return_date: '', departure_airport: '',
      }))
    }
  }

  // ── Tipos de Acomodação / Valores — auto-gerado a partir dos QUARTOS ──
  // Cada quarto montado é uma unidade. A quantidade por tipo = número de quartos
  // daquele tipo. Os valores (USD/taxas) são preservados e editáveis.
  useEffect(() => {
    const counts = {}
    rooms.forEach(r => { if (r.type) counts[r.type] = (counts[r.type] || 0) + 1 })
    setAccomLines(prev => {
      const next = []
      Object.entries(counts).forEach(([typeIdStr, qty]) => {
        const typeId = Number(typeIdStr)
        const existing = prev.find(l => l.accommodation_type === typeId)
        next.push(existing ? { ...existing, quantity: qty }
                           : { accommodation_type: typeId, value_per_person_usd: 0, taxes_usd: 0, quantity: qty })
      })
      // mantém linhas adicionadas manualmente que não têm tipo vinculado a quarto
      prev.forEach(l => { if (!l.accommodation_type) next.push(l) })
      return next
    })
  }, [rooms])

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
  // removido da lista manualmente depois, se necessário.
  useEffect(() => {
    if (!form.contratante) return
    setGuests(prev => prev.some(g => g.passenger === form.contratante)
      ? prev
      : [{ passenger: form.contratante, room: null }, ...prev])
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
  const setInstallmentsCountClamped = (n) => {
    const count = Math.max(0, Math.min(12, n))
    const remaining = (computedTotalBrl || 0) - Number(entrada.value_brl || 0)
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
    const remaining = (computedTotalBrl || 0) - Number(entrada.value_brl || 0)
    const base = Math.floor((remaining / installmentsCount) * 100) / 100
    setInstallments(prev => prev.map((it, i) => {
      const isLast = i === installmentsCount - 1
      const value = isLast ? round2(remaining - base * (installmentsCount - 1)) : base
      return { ...it, value_brl: value }
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedTotalBrl, entrada.value_brl])

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
    setForm(f => ({ ...f, received_down_payment_brl: entrada.value_brl || '' }))
  }, [entrada.value_brl])
  useEffect(() => {
    if (installments.length === 0) return
    const sum = installments.reduce((s, it) => s + Number(it.value_brl || 0), 0)
    setForm(f => ({ ...f, received_installments_brl: sum }))
  }, [installments])

  const buildPayload = () => {
    const installmentsPayload = []
    if (entrada.detail || entrada.due_date || entrada.value_brl || entrada.payment_method) {
      installmentsPayload.push({
        kind: 'entrada', installment_number: null, detail: entrada.detail,
        due_date: entrada.due_date || null, value_brl: entrada.value_brl || null,
        payment_method: entrada.payment_method,
      })
    }
    installments.forEach((it, i) => {
      installmentsPayload.push({
        kind: 'parcela', installment_number: i + 1, detail: it.detail,
        due_date: it.due_date || null, value_brl: it.value_brl || null,
        payment_method: it.payment_method,
      })
    })

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
      observations: form.observations,
      exchange_rate: form.exchange_rate || null,
      ...packageFields,
      ...contratanteFields,
      received_down_payment_brl: form.received_down_payment_brl || null,
      received_installments_brl: form.received_installments_brl || null,
      accommodation_lines: accomLines.filter(l => l.accommodation_type).map(l => ({
        accommodation_type: l.accommodation_type, value_per_person_usd: l.value_per_person_usd || 0,
        taxes_usd: l.taxes_usd || 0, quantity: l.quantity || 1,
      })),
      guests: guests.filter(g => g.passenger).map(g => ({
        passenger: g.passenger,
        accommodation_type: roomTypeOf(g.room),
        room_group: g.room ?? null,
      })),
      installments: installmentsPayload,
      clauses: selectedClauses,
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

  const doSave = async () => {
    if (!validateRequired()) return
    setSaving(true)
    const payload = buildPayload()
    try {
      if (isEdit) {
        await contractsApi.update(contractId, payload)
        toast.success('Contrato atualizado.')
      } else {
        await contractsApi.create(payload)
        toast.success('Contrato criado.')
      }
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

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 920, maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.24)' }}>
        <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>
            {isEdit ? 'Editar contrato' : 'Novo contrato'}
            {isEdit && reservationNumber && (
              <span style={{ fontSize: 12, fontWeight: 400, color: '#94a3b8', marginLeft: 10 }}>
                Reserva nº {reservationNumber} · {fmtDateBR(contractDate)}
              </span>
            )}
          </p>
        </div>

        {loading ? (
          <p style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Carregando…</p>
        ) : (
          <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto', flex: 1 }}>

            {totalMismatch && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e', fontSize: 12.5 }}>
                <Ic n="warn" s={15} />
                Os valores de entrada + parcelas ({sumFilled.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) não somam o total do contrato ({computedTotalBrl?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).
              </div>
            )}

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
                  <label style={lbl}>Cliente: contratante / responsável pelo pagamento *</label>
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
                    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <EntityPicker items={passengerItems} selectedIds={form.contratante ? [form.contratante] : []}
                          onChange={(ids) => { setForm(f => ({ ...f, contratante: ids[0] ?? null })); if (ids[0]) clearPayer() }}
                          title="Selecionar contratante" searchPlaceholder="Buscar passageiro…" placeholder="— Selecionar contratante —"
                          emptyLabel="Nenhum passageiro encontrado" createLink={{ label: 'Adicionar novo passageiro', to: '/passageiros' }} />
                      </div>
                      <button type="button" onClick={() => setShowPayerModal(true)}
                        title="Cadastrar empresa pagante (CNPJ)"
                        style={{ flexShrink: 0, width: 42, borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#1a2d4f', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Ic n="plus" s={18} />
                      </button>
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

            {/* Hóspedes + Quartos */}
            <div style={card}>
              <p style={sectionTitle}><Ic n="users" s={14} /> Nome dos passageiros / quartos</p>
              <label style={lbl}>Hóspedes (contratante e demais usuários dos serviços)</label>
              <EntityPicker items={passengerItems} selectedIds={guestIds} onChange={handleGuestsChange}
                multiple title="Selecionar hóspedes" searchPlaceholder="Buscar passageiro…" placeholder="— Selecionar hóspedes —"
                emptyLabel="Nenhum passageiro encontrado" createLink={{ label: 'Adicionar novo passageiro', to: '/passageiros' }} />

              {guests.length > 0 && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ fontSize: 11.5, color: '#94a3b8', margin: 0 }}>
                    Monte os quartos: arraste cada passageiro para um quarto (ou use o seletor "mover"). A acomodação escolhida vale para todos que estão no quarto.
                  </p>

                  {/* Pool: sem quarto */}
                  {(() => {
                    const unassigned = guests.filter(g => g.room == null)
                    return (
                      <div
                        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                        onDragEnter={() => setDragOverKey('pool')}
                        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverKey(k => k === 'pool' ? null : k) }}
                        onDrop={e => { const pid = Number(e.dataTransfer.getData('text/plain')); setDragOverKey(null); if (pid) assignGuest(pid, null) }}
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
                          onDrop={e => { const pid = Number(e.dataTransfer.getData('text/plain')); setDragOverKey(null); if (pid) assignGuest(pid, room.id) }}
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
                      onDrop={e => { const pid = Number(e.dataTransfer.getData('text/plain')); setDragOverKey(null); if (pid) createRoomWith(pid) }}
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

            {/* Tipos de Acomodação / Valores */}
            <div style={card}>
              <p style={sectionTitle}><Ic n="bed" s={14} /> Tipos de acomodação / valores por pessoa</p>
              <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '0 0 10px' }}>
                As linhas e quantidades abaixo são geradas automaticamente a partir dos quartos montados acima (cada quarto = 1 unidade) — pode ajustar os valores manualmente se precisar.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {accomLines.map((line, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div style={{ flex: 2 }}>
                      {idx === 0 && <label style={lbl}>Tipo de acomodação</label>}
                      <Dropdown value={line.accommodation_type ?? null} options={accomTypeOptions}
                        onChange={v => updateAccomLine(idx, 'accommodation_type', v)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      {idx === 0 && <label style={lbl}>Valor/pessoa (USD)</label>}
                      <input style={inp} type="number" step="0.01" value={line.value_per_person_usd}
                        onChange={e => updateAccomLine(idx, 'value_per_person_usd', e.target.value)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      {idx === 0 && <label style={lbl}>Taxas (USD)</label>}
                      <input style={inp} type="number" step="0.01" value={line.taxes_usd}
                        onChange={e => updateAccomLine(idx, 'taxes_usd', e.target.value)} />
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
                ))}
                <button type="button" onClick={addAccomLine}
                  style={{ alignSelf: 'flex-start', padding: '6px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  + Adicionar linha
                </button>
              </div>
            </div>

            {/* Dados de pagamento */}
            <div style={card}>
              <p style={sectionTitle}><Ic n="card" s={14} /> Dados dos pagamentos / valores</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Soma total (USD)</label>
                    <input style={inpRO} readOnly value={computedTotalUsd.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Total em (BRL)</label>
                    <input style={inpRO} readOnly value={computedTotalBrl != null ? computedTotalBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Câmbio</label>
                    <input style={inp} type="number" step="0.0001" value={form.exchange_rate} onChange={set('exchange_rate')} />
                    <p style={{ fontSize: 10.5, color: '#94a3b8', margin: '3px 0 0' }}>Preenchido de Configurações → Câmbio.</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Recebido na entrada (BRL)</label>
                    <input style={inpRO} readOnly value={form.received_down_payment_brl ? Number(form.received_down_payment_brl).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Recebido a prazo (BRL)</label>
                    <input style={inpRO} readOnly value={form.received_installments_brl ? Number(form.received_installments_brl).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'} />
                  </div>
                </div>
                <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>
                  "Recebido na entrada" e "Recebido a prazo" são preenchidos automaticamente a partir dos valores definidos na Entrada e nas Parcelas, abaixo.
                </p>
              </div>
            </div>

            {/* Parcelas */}
            <div style={card}>
              <p style={sectionTitle}><Ic n="clock" s={14} /> Parcelas</p>

              <div style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#475569', margin: '0 0 4px' }}>Entrada</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input style={{ ...inp, flex: 2 }} placeholder="Detalhe do pagamento" value={entrada.detail}
                    onChange={e => setEntrada(p => ({ ...p, detail: e.target.value }))} />
                  <div style={{ flex: 1 }}>
                    <DatePicker value={entrada.due_date} onChange={v => setEntrada(p => ({ ...p, due_date: v }))} fixed />
                  </div>
                  <input style={{ ...inp, flex: 1 }} type="number" step="0.01" placeholder="Valor (BRL)" value={entrada.value_brl}
                    onChange={e => setEntrada(p => ({ ...p, value_brl: e.target.value }))} />
                  <div style={{ flex: 1 }}>
                    <Dropdown value={entrada.payment_method || null} options={paymentMethodOptions} placeholder="— Forma de pagamento —"
                      onChange={v => setEntrada(p => ({ ...p, payment_method: v }))} />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <label style={lbl}>Número de parcelas</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button type="button" onClick={() => setInstallmentsCountClamped(installmentsCount - 1)}
                    style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer' }}>−</button>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', minWidth: 20, textAlign: 'center' }}>{installmentsCount}</span>
                  <button type="button" onClick={() => setInstallmentsCountClamped(installmentsCount + 1)}
                    style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer' }}>+</button>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>(0 a 12 — o valor restante já é dividido igualmente)</span>
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
                  <input style={{ ...inp, flex: 1 }} type="number" step="0.01" placeholder="Valor (BRL)" value={it.value_brl}
                    onChange={e => updateInstallment(idx, 'value_brl', e.target.value)} />
                  <div style={{ flex: 1 }}>
                    <Dropdown value={it.payment_method || null} options={paymentMethodOptions} placeholder="— Forma de pagamento —"
                      onChange={v => updateInstallment(idx, 'payment_method', v)} />
                  </div>
                </div>
              ))}
              {installments.length > 1 && (
                <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>
                  Definir a forma de pagamento da 1ª parcela já aplica pras demais — ainda editável individualmente.
                </p>
              )}
            </div>

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
          </div>
        )}

        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancelar
          </button>
          <button onClick={handleSaveClick} disabled={saving || loading} style={{ ...btnPri, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Ic n="check" s={13} />{saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar contrato'}
          </button>
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
    </div>
  )
}
