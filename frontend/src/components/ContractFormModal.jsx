import { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { contractsApi, agenciesApi, passengersApi, listsApi, configApi } from '../api'
import EntityPicker from './EntityPicker'
import DatePicker from './DatePicker'
import { Ic } from './Icon'

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

export default function ContractFormModal({ contractId, onClose, onSaved }) {
  const isEdit = !!contractId
  const [loading, setLoading] = useState(isEdit)
  const [saving,  setSaving]  = useState(false)

  // Fontes de dados pros pickers
  const [agencies,   setAgencies]   = useState([])
  const [passengers, setPassengers] = useState([])
  const [lists,       setLists]       = useState([])
  const [accomTypes,  setAccomTypes] = useState([])
  const [clauses,     setClauses]    = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])

  const [form, setForm] = useState({
    reservation_number: '', contract_date: '', agency: null, passenger_list: null, contratante: null,
    package_name: '', departure_date: '', departure_airport: '', observations: '',
    exchange_rate: '', payment_method: '',
    received_down_payment_brl: '', received_installments_brl: '', status: 'ativo',
  })
  const [accomLines, setAccomLines] = useState([])
  const [guests, setGuests]         = useState([]) // [{ passenger, accommodation_type }]
  const [entrada, setEntrada]       = useState({ detail: '', due_date: '', value_brl: '' })
  const [installmentsCount, setInstallmentsCount] = useState(0)
  const [installments, setInstallments] = useState([]) // [{ detail, due_date, value_brl }]
  const [selectedClauses, setSelectedClauses] = useState([])

  useEffect(() => {
    Promise.all([
      agenciesApi.list(), passengersApi.list({ page_size: 1000 }), listsApi.list(),
      configApi.accommodations(), configApi.contractClauses(), configApi.paymentMethods(), configApi.exchangeRates(),
    ]).then(([ag, pax, ls, ac, cl, pm, er]) => {
      setAgencies(ag.data.results ?? ag.data)
      setPassengers(pax.data.results ?? pax.data)
      setLists(ls.data.results ?? ls.data)
      setAccomTypes(ac.data.results ?? ac.data)
      setClauses(cl.data)
      setPaymentMethods(pm.data)
      if (!isEdit) {
        setSelectedClauses((cl.data).filter(c => c.is_default).map(c => c.id))
        // Câmbio USD → BRL pré-preenchido automaticamente — editável se necessário.
        const usdBrl = (er.data).find(r => r.from_currency === 'USD' && r.to_currency === 'BRL')
        if (usdBrl) setForm(f => ({ ...f, exchange_rate: usdBrl.rate }))
      }
    }).catch(() => toast.error('Erro ao carregar dados auxiliares.'))
  }, [])

  useEffect(() => {
    if (!isEdit) return
    contractsApi.get(contractId).then(r => {
      const d = r.data
      setForm({
        reservation_number: d.reservation_number ?? '', contract_date: d.contract_date ?? '',
        agency: d.agency, passenger_list: d.passenger_list, contratante: d.contratante,
        package_name: d.package_name ?? '', departure_date: d.departure_date ?? '',
        departure_airport: d.departure_airport ?? '', observations: d.observations ?? '',
        exchange_rate: d.exchange_rate ?? '',
        payment_method: d.payment_method ?? '', received_down_payment_brl: d.received_down_payment_brl ?? '',
        received_installments_brl: d.received_installments_brl ?? '', status: d.status ?? 'ativo',
      })
      setAccomLines((d.accommodation_lines ?? []).map(l => ({
        accommodation_type: l.accommodation_type, value_per_person_usd: l.value_per_person_usd,
        taxes_usd: l.taxes_usd, quantity: l.quantity,
      })))
      setGuests((d.guests ?? []).map(g => ({ passenger: g.passenger, accommodation_type: g.accommodation_type })))
      const entradaRow = (d.installments ?? []).find(i => i.kind === 'entrada')
      const parcelaRows = (d.installments ?? []).filter(i => i.kind === 'parcela').sort((a, b) => a.installment_number - b.installment_number)
      if (entradaRow) setEntrada({ detail: entradaRow.detail ?? '', due_date: entradaRow.due_date ?? '', value_brl: entradaRow.value_brl ?? '' })
      setInstallmentsCount(parcelaRows.length)
      setInstallments(parcelaRows.map(r => ({ detail: r.detail ?? '', due_date: r.due_date ?? '', value_brl: r.value_brl ?? '' })))
      setSelectedClauses((d.clauses ?? []))
    }).catch(() => toast.error('Erro ao carregar contrato.')).finally(() => setLoading(false))
  }, [contractId])

  const agencyItems = useMemo(() => agencies.map(a => ({ id: a.id, label: agencyLabel(a), sublabel: a.cnpj || a.cpf })), [agencies])
  const passengerItems = useMemo(() => passengers.map(p => ({ id: p.id, label: p.full_name, sublabel: p.cpf || p.email })), [passengers])
  const listItems = useMemo(() => lists.map(l => ({ id: l.id, label: l.name, sublabel: l.start_date ? `Início: ${fmtDateBR(l.start_date)}` : '' })), [lists])
  const selectedList = useMemo(() => lists.find(l => l.id === form.passenger_list) ?? null, [lists, form.passenger_list])

  // Soma total (USD) sempre calculada a partir das linhas de acomodação —
  // nunca digitada. Total em BRL deriva da soma total e do câmbio.
  const computedTotalUsd = useMemo(() => accomLines.reduce(
    (sum, l) => sum + (Number(l.value_per_person_usd || 0) + Number(l.taxes_usd || 0)) * Number(l.quantity || 1), 0
  ), [accomLines])
  const computedTotalBrl = form.exchange_rate ? computedTotalUsd * Number(form.exchange_rate) : null

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSelectList = (ids) => {
    const id = ids[0] ?? null
    setForm(f => ({ ...f, passenger_list: id }))
  }

  // ── Tipos de Acomodação / Valores ──
  const addAccomLine = () => setAccomLines(a => [...a, { accommodation_type: null, value_per_person_usd: 0, taxes_usd: 0, quantity: 1 }])
  const updateAccomLine = (idx, key, value) => setAccomLines(a => a.map((l, i) => i === idx ? { ...l, [key]: value } : l))
  const removeAccomLine = (idx) => setAccomLines(a => a.filter((_, i) => i !== idx))

  // ── Hóspedes ──
  const guestIds = guests.map(g => g.passenger)
  const handleGuestsChange = (ids) => {
    setGuests(prev => {
      const kept = prev.filter(g => ids.includes(g.passenger))
      const added = ids.filter(id => !prev.some(g => g.passenger === id)).map(id => ({ passenger: id, accommodation_type: null }))
      return [...kept, ...added]
    })
  }
  const updateGuestAccom = (passengerId, accommodation_type) =>
    setGuests(prev => prev.map(g => g.passenger === passengerId ? { ...g, accommodation_type } : g))

  // ── Parcelas ──
  const setInstallmentsCountClamped = (n) => {
    const count = Math.max(0, Math.min(12, n))
    setInstallmentsCount(count)
    setInstallments(prev => {
      const next = [...prev]
      while (next.length < count) next.push({ detail: '', due_date: '', value_brl: '' })
      return next.slice(0, count)
    })
  }
  const updateInstallment = (idx, key, value) => setInstallments(prev => prev.map((it, i) => i === idx ? { ...it, [key]: value } : it))

  const save = async () => {
    if (!form.agency)      { toast.error('Selecione a agência.'); return }
    if (!form.contratante) { toast.error('Selecione o contratante.'); return }
    setSaving(true)

    const installmentsPayload = []
    if (entrada.detail || entrada.due_date || entrada.value_brl) {
      installmentsPayload.push({
        kind: 'entrada', installment_number: null, detail: entrada.detail,
        due_date: entrada.due_date || null, value_brl: entrada.value_brl || null,
      })
    }
    installments.forEach((it, i) => {
      installmentsPayload.push({
        kind: 'parcela', installment_number: i + 1, detail: it.detail,
        due_date: it.due_date || null, value_brl: it.value_brl || null,
      })
    })

    // Quando há lista vinculada, pacote/data/aeroporto vêm sempre dela —
    // os campos manuais ficam ocultos e não devem sobrescrever com vazio.
    const packageFields = selectedList ? {
      package_name: selectedList.name,
      departure_date: selectedList.start_date || null,
      departure_airport: selectedList.default_airport_data?.name ?? '',
    } : {
      package_name: form.package_name,
      departure_date: form.departure_date || null,
      departure_airport: form.departure_airport,
    }

    const payload = {
      agency: form.agency, passenger_list: form.passenger_list, contratante: form.contratante,
      observations: form.observations,
      exchange_rate: form.exchange_rate || null,
      payment_method: form.payment_method,
      status: form.status,
      ...packageFields,
      received_down_payment_brl: form.received_down_payment_brl || null,
      received_installments_brl: form.received_installments_brl || null,
      accommodation_lines: accomLines.filter(l => l.accommodation_type).map(l => ({
        accommodation_type: l.accommodation_type, value_per_person_usd: l.value_per_person_usd || 0,
        taxes_usd: l.taxes_usd || 0, quantity: l.quantity || 1,
      })),
      guests: guests.filter(g => g.passenger).map(g => ({ passenger: g.passenger, accommodation_type: g.accommodation_type })),
      installments: installmentsPayload,
      clauses: selectedClauses,
    }

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

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 920, maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.24)' }}>
        <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>
            {isEdit ? 'Editar contrato' : 'Novo contrato'}
          </p>
        </div>

        {loading ? (
          <p style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Carregando…</p>
        ) : (
          <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto', flex: 1 }}>

            {/* Reserva / Data */}
            <div style={card}>
              <p style={sectionTitle}><Ic n="docs" s={14} /> Reserva</p>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Reserva nº</label>
                  <input style={inpRO} readOnly value={isEdit ? form.reservation_number : 'Gerado automaticamente ao salvar'} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Data desta contratação</label>
                  <input style={inpRO} readOnly value={isEdit ? fmtDateBR(form.contract_date) : 'Hoje, ao salvar'} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Status</label>
                  <select style={inp} value={form.status} onChange={set('status')}>
                    <option value="ativo">Ativo</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </div>
              </div>
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
                  <label style={lbl}>Lista de passageiros / pacote</label>
                  <EntityPicker items={listItems} selectedIds={form.passenger_list ? [form.passenger_list] : []}
                    onChange={handleSelectList}
                    title="Selecionar lista de passageiros" searchPlaceholder="Buscar lista…" placeholder="— Selecionar lista —"
                    emptyLabel="Nenhuma lista encontrada" />
                  <p style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0 0' }}>
                    Selecionando uma lista, o nome do pacote, a data da viagem e o aeroporto vêm dela automaticamente.
                  </p>
                </div>
                <div>
                  <label style={lbl}>Cliente: contratante / responsável pelo pagamento *</label>
                  <EntityPicker items={passengerItems} selectedIds={form.contratante ? [form.contratante] : []}
                    onChange={(ids) => setForm(f => ({ ...f, contratante: ids[0] ?? null }))}
                    title="Selecionar contratante" searchPlaceholder="Buscar passageiro…" placeholder="— Selecionar contratante —"
                    emptyLabel="Nenhum passageiro encontrado" createLink={{ label: 'Adicionar novo passageiro', to: '/passageiros' }} />
                </div>
              </div>
            </div>

            {/* Pacote de viagem */}
            <div style={card}>
              <p style={sectionTitle}><Ic n="plane" s={14} /> Pacote de viagem</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {selectedList ? (
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 2 }}>
                      <label style={lbl}>Nome do pacote</label>
                      <input style={inpRO} readOnly value={selectedList.name} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={lbl}>Data da viagem</label>
                      <input style={inpRO} readOnly value={fmtDateBR(selectedList.start_date) || '—'} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={lbl}>Aeroporto de embarque</label>
                      <input style={inpRO} readOnly value={selectedList.default_airport_data?.name || '—'} />
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flex: 2 }}>
                        <label style={lbl}>Nome do pacote</label>
                        <input style={inp} value={form.package_name} onChange={set('package_name')} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={lbl}>Data da viagem</label>
                        <DatePicker value={form.departure_date} onChange={v => setForm(f => ({ ...f, departure_date: v }))} fixed />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <label style={lbl}>Aeroporto de embarque</label>
                        <input style={inp} value={form.departure_airport} onChange={set('departure_airport')} />
                      </div>
                    </div>
                  </>
                )}
                <div>
                  <label style={lbl}>Observações</label>
                  <textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} value={form.observations} onChange={set('observations')} />
                </div>
              </div>
            </div>

            {/* Hóspedes */}
            <div style={card}>
              <p style={sectionTitle}><Ic n="users" s={14} /> Nome dos passageiros</p>
              <label style={lbl}>Hóspedes (contratante e demais usuários dos serviços)</label>
              <EntityPicker items={passengerItems} selectedIds={guestIds} onChange={handleGuestsChange}
                multiple title="Selecionar hóspedes" searchPlaceholder="Buscar passageiro…" placeholder="— Selecionar hóspedes —"
                emptyLabel="Nenhum passageiro encontrado" createLink={{ label: 'Adicionar novo passageiro', to: '/passageiros' }} />

              {guests.length > 0 && (
                <div style={{ marginTop: 12, border: '1px solid #f1f5f9', borderRadius: 6, overflow: 'hidden' }}>
                  {guests.map((g, i) => {
                    const p = passengers.find(x => x.id === g.passenger)
                    return (
                      <div key={g.passenger} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: i < guests.length - 1 ? '1px solid #f8fafc' : 'none' }}>
                        <span style={{ fontSize: 13, color: '#1e293b', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p?.full_name ?? `#${g.passenger}`}
                        </span>
                        <select style={{ ...inp, width: 220, padding: '5px 8px' }} value={g.accommodation_type ?? ''}
                          onChange={e => updateGuestAccom(g.passenger, e.target.value ? Number(e.target.value) : null)}>
                          <option value="">— Acomodação —</option>
                          {accomTypes.map(at => <option key={at.id} value={at.id}>{at.name}</option>)}
                        </select>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Tipos de Acomodação / Valores */}
            <div style={card}>
              <p style={sectionTitle}><Ic n="bed" s={14} /> Tipos de acomodação / valores por pessoa</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {accomLines.map((line, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div style={{ flex: 2 }}>
                      {idx === 0 && <label style={lbl}>Tipo de acomodação</label>}
                      <select style={inp} value={line.accommodation_type ?? ''}
                        onChange={e => updateAccomLine(idx, 'accommodation_type', e.target.value ? Number(e.target.value) : null)}>
                        <option value="">— Selecione —</option>
                        {accomTypes.map(at => <option key={at.id} value={at.id}>{at.name}</option>)}
                      </select>
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
                    <label style={lbl}>Forma de pagamento</label>
                    <select style={inp} value={form.payment_method} onChange={set('payment_method')}>
                      <option value="">— Selecione —</option>
                      {paymentMethods.map(pm => <option key={pm.id} value={pm.name}>{pm.name}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Recebido na entrada (BRL)</label>
                    <input style={inp} type="number" step="0.01" value={form.received_down_payment_brl} onChange={set('received_down_payment_brl')} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Recebido a prazo (BRL)</label>
                    <input style={inp} type="number" step="0.01" value={form.received_installments_brl} onChange={set('received_installments_brl')} />
                  </div>
                </div>
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
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>(0 a 12)</span>
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
                </div>
              ))}
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
          <button onClick={save} disabled={saving || loading} style={{ ...btnPri, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Ic n="check" s={13} />{saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar contrato'}
          </button>
        </div>
      </div>
    </div>
  )
}
