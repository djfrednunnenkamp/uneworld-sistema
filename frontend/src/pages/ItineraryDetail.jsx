import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { itinerariesApi, configApi } from '../api'
import Dropdown from '../components/Dropdown'
import DatePicker from '../components/DatePicker'
import MoneyInput from '../components/MoneyInput'
import PaymentPlanFields, { PaymentPlanTester } from '../components/PaymentPlanFields'
import { Ic } from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import usePersistedTab from '../hooks/usePersistedTab'

const CURRENCY_OPTS = [
  { value: 'EUR', label: 'Euro' },
  { value: 'USD', label: 'Dólar' },
  { value: 'BRL', label: 'Real' },
]

/* ── Modelos de pagamento do roteiro (multi) ── */
const BLANK_PLAN = { name: '', a_vista: false, has_down_payment: false, down_payment_mode: 'percent', down_payment_value: '', down_payment_method: '', down_payment_rounding: 0.01, installments_count: '', payment_method: '', installment_rounding: 0.01, first_due_days: 30, interval_days: 30 }
const planUid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.round(Math.random() * 1e6)}`)
// Nome automático quando o usuário não digita um.
function planAutoName(p) {
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
function planSummary(p) {
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
const planFromModel = (p) => ({
  _uid: planUid(), name: p.name || '', a_vista: !!p.a_vista, has_down_payment: !!p.has_down_payment,
  down_payment_mode: p.down_payment_mode || 'percent', down_payment_value: p.down_payment_value ?? '',
  down_payment_method: p.down_payment_method || '', down_payment_rounding: p.down_payment_rounding ?? 0.01,
  installments_count: p.installments_count ?? '', payment_method: p.payment_method || '',
  installment_rounding: p.installment_rounding ?? 0.01,
  first_due_days: p.first_due_days ?? 30, interval_days: p.interval_days ?? 30,
})
// Payload p/ salvar um modelo como GLOBAL (Configurações › Modelos de Pagamento).
const planToConfigPayload = (p) => ({
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
const normalizeItinerary = (d) => {
  let plans = Array.isArray(d.payment_plans) ? d.payment_plans : []
  if (!plans.length && d.payment_plan) plans = [d.payment_plan]
  plans = plans.map(p => ({ ...p, _uid: p._uid || planUid() }))
  return { ...d, payment_plans: plans }
}

const inp = { padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b', boxSizing: 'border-box', width: '100%' }

const TYPE_OPTS = [
  { value: 'aereo',     label: 'Aéreo' },
  { value: 'terrestre', label: 'Terrestre' },
]

const TABS = [
  { key: 'info',      label: 'Informações do roteiro' },
  { key: 'clausulas', label: 'Cláusulas (contrato)' },
]

/* ── Chip de resumo (igual ao usado em Listas de Passageiros) ── */
function Chip({ label, value }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</span>
      <span style={{ fontSize: 13, color: '#1e293b', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

/* ── Linha "label | campo" com divisor, igual ao mockup de referência ── */
function FormRow({ label, children, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28, padding: '16px 0', borderBottom: last ? 'none' : '1px solid #f1f5f9' }}>
      <div style={{ width: 200, flexShrink: 0, fontSize: 13, fontWeight: 600, color: '#475569' }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

const fmtDateBR = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default function ItineraryDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const perms   = user?.permissions ?? {}
  const canEdit = !!user?.is_superuser || perms.roteiros_edit
  const [tab, setTab] = usePersistedTab('tab_itinerary_detail', 'info')

  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [data,    setData]    = useState(null)
  const [categories, setCategories] = useState([])
  const [continents, setContinents] = useState([])
  const [accommodationOpts, setAccommodationOpts] = useState([])
  const [paymentPlanOpts, setPaymentPlanOpts] = useState([])       // modelos das Configurações
  const [paymentMethodOpts, setPaymentMethodOpts] = useState([])   // nomes de formas de pagamento
  const [clauseList, setClauseList] = useState([])   // cláusulas cadastradas em Config

  const load = useCallback(() => {
    setLoading(true)
    itinerariesApi.get(id)
      .then(r => setData(normalizeItinerary(r.data)))
      .catch(() => toast.error('Erro ao carregar roteiro.'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    configApi.itineraryCategories().then(r => setCategories(r.data)).catch(() => {})
    configApi.continents().then(r => setContinents(r.data)).catch(() => {})
    configApi.accommodations().then(r => setAccommodationOpts(r.data.results ?? r.data)).catch(() => {})
    configApi.contractClauses().then(r => setClauseList(r.data.results ?? r.data)).catch(() => {})
    configApi.paymentPlans().then(r => setPaymentPlanOpts(r.data.results ?? r.data)).catch(() => {})
    configApi.paymentMethods().then(r => setPaymentMethodOpts((r.data.results ?? r.data).map(m => m.name))).catch(() => {})
  }, [])

  const set = (k) => (e) => setData(d => ({ ...d, [k]: e.target.value }))
  const toggleClause = (cid) => setData(d => { const cur = d.clauses || []; return { ...d, clauses: cur.includes(cid) ? cur.filter(x => x !== cid) : [...cur, cid] } })
  const addCustomClause = () => setData(d => ({ ...d, custom_clauses: [...(d.custom_clauses || []), { name: '', content: '' }] }))
  const updateCustomClause = (i, k, v) => setData(d => ({ ...d, custom_clauses: (d.custom_clauses || []).map((c, j) => j === i ? { ...c, [k]: v } : c) }))
  const removeCustomClause = (i) => setData(d => ({ ...d, custom_clauses: (d.custom_clauses || []).filter((_, j) => j !== i) }))

  // ── Modelos de pagamento do roteiro (multi-seleção) ──
  const [planEditor, setPlanEditor]         = useState(null)   // { index, plan, isNew, makeGlobal } | null
  const [planTesting, setPlanTesting]       = useState(false)  // simulador aberto (a partir do editor)
  const [showPlanPicker, setShowPlanPicker] = useState(false)  // popup "adicionar das Configurações"
  const [pickerSel, setPickerSel]           = useState([])     // ids (dos modelos globais) marcados no popup

  // Abre o popup já com os modelos globais que o roteiro usa MARCADOS (via _cfgId).
  const openPlanPicker = () => {
    setPickerSel((data.payment_plans || []).filter(p => p._cfgId).map(p => p._cfgId))
    setShowPlanPicker(true)
  }
  // Sincroniza a seleção: adiciona os recém-marcados e remove os desmarcados que
  // vieram das Configurações. Itens exclusivos do roteiro (sem _cfgId) não são tocados.
  const applyPlanPicker = () => {
    setData(d => {
      const current = d.payment_plans || []
      const currentCfgIds = new Set(current.filter(p => p._cfgId).map(p => p._cfgId))
      const kept  = current.filter(p => !p._cfgId || pickerSel.includes(p._cfgId))
      const toAdd = pickerSel.filter(cid => !currentCfgIds.has(cid))
        .map(cid => paymentPlanOpts.find(x => x.id === cid)).filter(Boolean)
        .map(p => ({ ...planFromModel(p), _cfgId: p.id }))
      return { ...d, payment_plans: [...kept, ...toAdd] }
    })
    setShowPlanPicker(false); setPickerSel([])
  }
  const openNewPlan  = () => setPlanEditor({ index: null, plan: { ...BLANK_PLAN, _uid: planUid() }, isNew: true, makeGlobal: false })
  const openEditPlan = (i) => setPlanEditor({ index: i, plan: { ...(data.payment_plans || [])[i] }, isNew: false, makeGlobal: false })
  const removePlan   = (i) => setData(d => ({ ...d, payment_plans: (d.payment_plans || []).filter((_, j) => j !== i) }))

  const savePlanEditor = async () => {
    const ed = planEditor
    const plan = { ...ed.plan, name: (ed.plan.name || '').trim() || planAutoName(ed.plan) }
    setData(d => {
      const list = [...(d.payment_plans || [])]
      if (ed.isNew) list.push(plan); else list[ed.index] = plan
      return { ...d, payment_plans: list }
    })
    // "Global" → também cria um Modelo em Configurações, disponível em outros roteiros.
    if (ed.makeGlobal) {
      try {
        await configApi.addPaymentPlan(planToConfigPayload(plan))
        configApi.paymentPlans().then(r => setPaymentPlanOpts(r.data.results ?? r.data)).catch(() => {})
        toast.success('Salvo no roteiro e como modelo global.')
      } catch { toast.error('Salvo no roteiro, mas falhou ao salvar como global.') }
    }
    setPlanEditor(null)
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        name: data.name, slug: data.slug, start_date: data.start_date || null, end_date: data.end_date || null,
        trip_type: data.trip_type, category: data.category, continent: data.continent,
        base_currency: data.base_currency,
        accommodation_lines: (data.accommodation_lines || []).map(l => ({
          accommodation_type: l.accommodation_type, value_per_person: l.value_per_person || 0, taxes: l.taxes || 0,
        })),
        clauses: data.clauses || [], custom_clauses: (data.custom_clauses || []).filter(c => (c.name || '').trim() || (c.content || '').trim()),
        payment_plans: data.payment_plans || [],
        // Compat com o contrato (que hoje lê UM só): 1º modelo da lista.
        payment_plan: (data.payment_plans || [])[0] ?? null,
      }
      const r = await itinerariesApi.update(id, payload)
      setData(normalizeItinerary(r.data))
      toast.success('Roteiro salvo.')
    } catch {
      toast.error('Erro ao salvar roteiro.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#94a3b8' }}>
      Carregando…
    </div>
  )
  if (!data) return null

  const categoryOptions  = categories.map(c => ({ value: c.id, label: c.name }))
  const continentOptions = continents.map(c => ({ value: c.id, label: c.name }))
  const categoryLabel  = categories.find(c => c.id === data.category)?.name
  const continentLabel = continents.find(c => c.id === data.continent)?.name

  const accommodationOptions = accommodationOpts.map(a => ({ value: a.id, label: a.name }))
  const currencyLabel = (CURRENCY_OPTS.find(c => c.value === data.base_currency)?.value) || data.base_currency || ''
  const accomLines = data.accommodation_lines || []
  const addAccomLine = () => setData(d => ({ ...d, accommodation_lines: [...(d.accommodation_lines || []), { accommodation_type: null, value_per_person: 0, taxes: 0 }] }))
  const updateAccomLine = (idx, patch) => setData(d => ({ ...d, accommodation_lines: d.accommodation_lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }))
  const removeAccomLine = (idx) => setData(d => ({ ...d, accommodation_lines: d.accommodation_lines.filter((_, i) => i !== idx) }))

  return (
    <div>
      {/* Cabeçalho */}
      <div className="ph" style={{ alignItems: 'flex-start' }}>
        <div>
          <button onClick={() => navigate('/roteiros')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 12, fontFamily: 'inherit', padding: 0, marginBottom: 6 }}
            onMouseEnter={e => e.currentTarget.style.color = '#1a2d4f'}
            onMouseLeave={e => e.currentTarget.style.color = '#64748b'}>
            ← Roteiros
          </button>
          <h1 className="ph-title" style={{ margin: 0 }}>{data.name || 'Roteiro'}</h1>
        </div>
        <div className="ph-actions" style={{ alignItems: 'center' }}>
          {canEdit && (
            <button type="button" onClick={save} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Ic n="check" s={13} />{saving ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </div>
      </div>

      {/* Resumo */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 20px', boxShadow: '0 1px 4px rgba(0,0,0,.04)', marginBottom: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 40px', alignItems: 'flex-start' }}>
          <Chip label="Tipo"       value={TYPE_OPTS.find(t => t.value === data.trip_type)?.label} />
          <Chip label="Categoria"  value={categoryLabel} />
          <Chip label="Continente" value={continentLabel} />
          <Chip label="Início"     value={fmtDateBR(data.start_date) || '—'} />
          <Chip label="Término"    value={fmtDateBR(data.end_date) || '—'} />
        </div>
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '2px solid #e2e8f0', marginBottom: 20 }}>
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{ padding: '10px 22px', background: 'none', border: 'none', borderBottom: tab === t.key ? '2px solid #1a2d4f' : '2px solid transparent', marginBottom: -2, color: tab === t.key ? '#1a2d4f' : '#64748b', fontSize: 14, fontWeight: tab === t.key ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit', transition: 'color .15s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Conteúdo das abas */}
      {tab === 'clausulas' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '18px 24px', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
            As cláusulas marcadas/escritas aqui são as que o contrato feito com este roteiro vai usar.
          </p>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a2d4f', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Cláusulas cadastradas</div>
          {clauseList.length === 0 ? (
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 18px' }}>Nenhuma cláusula cadastrada em Configurações → Cláusulas de Contrato.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 22, maxHeight: 240, overflowY: 'auto' }}>
              {clauseList.map(c => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: canEdit ? 'pointer' : 'default' }}>
                  <input type="checkbox" checked={(data.clauses || []).includes(c.id)} disabled={!canEdit}
                    onChange={() => toggleClause(c.id)} style={{ width: 15, height: 15, accentColor: '#1a2d4f' }} />
                  <span style={{ fontSize: 13, color: '#1e293b' }}>{c.name}</span>
                </label>
              ))}
            </div>
          )}
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a2d4f', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Cláusulas específicas deste roteiro</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(data.custom_clauses || []).map((c, i) => (
              <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input style={{ ...inp, flex: 1 }} value={c.name || ''} disabled={!canEdit} placeholder="Título da cláusula"
                    onChange={e => updateCustomClause(i, 'name', e.target.value)} />
                  {canEdit && (
                    <button type="button" onClick={() => removeCustomClause(i)}
                      style={{ padding: 8, borderRadius: 6, border: '1px solid #fee2e2', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', flexShrink: 0 }}>
                      <Ic n="trash" s={14} />
                    </button>
                  )}
                </div>
                <textarea style={{ ...inp, minHeight: 80, resize: 'vertical' }} value={c.content || ''} disabled={!canEdit} placeholder="Texto da cláusula"
                  onChange={e => updateCustomClause(i, 'content', e.target.value)} />
              </div>
            ))}
            {canEdit && (
              <button type="button" onClick={addCustomClause}
                style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 7, border: '1px dashed #cbd5e1', background: '#fafbfc', color: '#1a2d4f', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                + Adicionar cláusula específica
              </button>
            )}
          </div>
        </div>
      )}

      {tab === 'info' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '4px 24px', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
          <FormRow label="Nome da viagem">
            <input style={inp} value={data.name} disabled={!canEdit} onChange={set('name')} />
          </FormRow>

          <FormRow label="Slug">
            <input style={inp} value={data.slug} disabled={!canEdit} onChange={set('slug')} />
          </FormRow>

          <FormRow label="Categoria">
            <Dropdown value={data.category} options={categoryOptions} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, category: v }))} placeholder="— Selecione —" />
          </FormRow>

          <FormRow label="Continente">
            <Dropdown value={data.continent} options={continentOptions} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, continent: v }))} placeholder="— Selecione —" />
          </FormRow>

          <FormRow label="Tipo">
            <Dropdown value={data.trip_type} options={TYPE_OPTS} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, trip_type: v }))} />
          </FormRow>

          <FormRow label="Data de início">
            <DatePicker value={data.start_date} relatedDate={data.end_date || null} disabled={!canEdit} fixed
              onChange={v => setData(d => ({ ...d, start_date: v }))} />
          </FormRow>

          <FormRow label="Data de término">
            <DatePicker value={data.end_date} relatedDate={data.start_date || null} disabled={!canEdit} fixed
              onChange={v => setData(d => ({ ...d, end_date: v }))} />
          </FormRow>

          <FormRow label="Moeda base" last>
            <Dropdown value={data.base_currency} options={CURRENCY_OPTS} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, base_currency: v }))} />
          </FormRow>
        </div>
      )}

      {tab === 'info' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,.04)', marginTop: 20 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: '0 0 4px' }}>
            Valores das acomodações
          </p>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 16px' }}>
            Valor por pessoa e taxas de cada tipo de acomodação, na moeda base do roteiro{currencyLabel ? ` (${currencyLabel})` : ''}. Puxados automaticamente no contrato ao escolher este roteiro.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 10, fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              <span style={{ width: 32, flexShrink: 0 }}>#</span>
              <span style={{ flex: 2 }}>Tipo de acomodação</span>
              <span style={{ flex: 1 }}>Valor por pessoa{currencyLabel ? ` (${currencyLabel})` : ''}</span>
              <span style={{ flex: 1 }}>Taxas{currencyLabel ? ` (${currencyLabel})` : ''}</span>
              <span style={{ width: 32, flexShrink: 0 }} />
            </div>
            {accomLines.map((line, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 32, flexShrink: 0, paddingTop: 8, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>{idx + 1}</div>
                <div style={{ flex: 2 }}>
                  <Dropdown value={line.accommodation_type} options={accommodationOptions} disabled={!canEdit}
                    onChange={v => updateAccomLine(idx, { accommodation_type: v })} placeholder="Selecione a acomodação" />
                </div>
                <div style={{ flex: 1 }}>
                  <MoneyInput style={inp} value={line.value_per_person} disabled={!canEdit} placeholder="0,00"
                    onChange={v => updateAccomLine(idx, { value_per_person: v })} />
                </div>
                <div style={{ flex: 1 }}>
                  <MoneyInput style={inp} value={line.taxes} disabled={!canEdit} placeholder="0,00"
                    onChange={v => updateAccomLine(idx, { taxes: v })} />
                </div>
                <button type="button" onClick={() => removeAccomLine(idx)} disabled={!canEdit}
                  style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 6, border: '1px solid #fee2e2', background: '#fef2f2', color: '#dc2626', cursor: canEdit ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ic n="x" s={13} />
                </button>
              </div>
            ))}
            {canEdit && (
              <button type="button" onClick={addAccomLine}
                style={{ alignSelf: 'flex-start', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 7, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                <Ic n="plus" s={13} /> Adicionar acomodação
              </button>
            )}
          </div>
        </div>
      )}

      {tab === 'info' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '4px 24px', boxShadow: '0 1px 4px rgba(0,0,0,.04)', marginTop: 20 }}>
          <FormRow label="Formas de pagamento (aplicáveis no contrato)" last>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: (data.payment_plans?.length) ? 12 : 0 }}>
              <button type="button" disabled={!canEdit} onClick={openPlanPicker}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: canEdit ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                <Ic n="plus" s={13} /> Adicionar das Configurações
              </button>
              <button type="button" disabled={!canEdit} onClick={openNewPlan}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', fontSize: 13, fontWeight: 700, cursor: canEdit ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                <Ic n="plus" s={13} /> Criar exclusiva deste roteiro
              </button>
            </div>
            {(data.payment_plans?.length || 0) === 0 ? (
              <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Nenhuma forma de pagamento definida. Adicione um modelo das Configurações ou crie uma exclusiva deste roteiro.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.payment_plans.map((p, i) => (
                  <div key={p._uid || i} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', background: '#fff' }}>
                    <div style={{ flex: 1, minWidth: 0, cursor: canEdit ? 'pointer' : 'default' }} onClick={() => canEdit && openEditPlan(i)}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || planAutoName(p)}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{planSummary(p)}</div>
                    </div>
                    {canEdit && (
                      <div className="r-acts" style={{ flexShrink: 0 }}>
                        <button className="r-btn edit" title="Editar (só neste roteiro)" onClick={() => openEditPlan(i)}><Ic n="edit" s={13} /></button>
                        <button className="r-btn del"  title="Remover deste roteiro"      onClick={() => removePlan(i)}><Ic n="trash" s={13} /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </FormRow>
        </div>
      )}

      {/* Popup: adicionar modelos das Configurações (multi-seleção) */}
      {showPlanPicker && (
        <div onMouseDown={e => { if (e.target === e.currentTarget) setShowPlanPicker(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onMouseDown={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 460, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.28)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Adicionar modelos das Configurações</span>
              <button type="button" onClick={() => setShowPlanPicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex', padding: 2 }}><Ic n="x" s={16} /></button>
            </div>
            <div style={{ padding: '8px 0', overflowY: 'auto', flex: 1 }}>
              {paymentPlanOpts.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '24px 0' }}>Nenhum modelo global cadastrado em Configurações › Modelos de Pagamento.</p>
              ) : paymentPlanOpts.map(p => {
                const sel = pickerSel.includes(p.id)
                return (
                  <div key={p.id} onClick={() => setPickerSel(s => s.includes(p.id) ? s.filter(x => x !== p.id) : [...s, p.id])}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', cursor: 'pointer', background: sel ? '#f0f6ff' : 'transparent' }}>
                    <input type="checkbox" readOnly checked={sel} style={{ width: 15, height: 15, accentColor: '#2e6db4', pointerEvents: 'none', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: sel ? 700 : 500, color: '#1e293b' }}>{p.name}</div>
                      <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{planSummary(p)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
              <button type="button" onClick={() => setShowPlanPicker(false)} className="btn btn-outline">Cancelar</button>
              <button type="button" onClick={applyPlanPicker} className="btn btn-primary">
                Confirmar{pickerSel.length ? ` (${pickerSel.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: criar/editar um modelo exclusivo do roteiro */}
      {planEditor && (
        <div onMouseDown={e => { if (e.target === e.currentTarget) setPlanEditor(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onMouseDown={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 840, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.25)' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                {planEditor.isNew ? 'Nova forma de pagamento (deste roteiro)' : 'Editar forma de pagamento (deste roteiro)'}
              </div>
              <button type="button" onClick={() => setPlanTesting(true)}
                style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#dbeafe' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#eff6ff' }}>
                <Ic n="card" s={14} /> Testar forma de pagamento
              </button>
              <button type="button" onClick={() => setPlanEditor(null)} title="Fechar" style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex', padding: 2 }}><Ic n="x" s={18} /></button>
            </div>
            <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>Nome do modelo</label>
                <input className="fi" value={planEditor.plan.name || ''} onChange={e => setPlanEditor(ed => ({ ...ed, plan: { ...ed.plan, name: e.target.value } }))} placeholder="Deixe em branco para gerar automaticamente (ex.: Entrada 20% + 10x)" autoFocus />
              </div>
              {/* Chave: exclusivo do roteiro (padrão) ou também global — no topo */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 16px', background: '#f8fafc' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>Também salvar como modelo global</div>
                  <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{planEditor.makeGlobal ? 'Fica disponível em Configurações e em outros roteiros.' : 'Exclusivo deste roteiro (só aqui).'}</div>
                </div>
                <label className="toggle-wrap">
                  <span className="toggle">
                    <input type="checkbox" checked={!!planEditor.makeGlobal} onChange={e => setPlanEditor(ed => ({ ...ed, makeGlobal: e.target.checked }))} />
                    <span className="toggle-slider" />
                  </span>
                  <span className="toggle-label">{planEditor.makeGlobal ? 'Global' : 'Só aqui'}</span>
                </label>
              </div>
              <PaymentPlanFields value={planEditor.plan} methodOptions={paymentMethodOpts} showTestButton={false}
                onChange={pp => setPlanEditor(ed => ({ ...ed, plan: pp }))} />
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
              <button type="button" onClick={() => setPlanEditor(null)} className="btn btn-outline">Cancelar</button>
              <button type="button" onClick={savePlanEditor} className="btn btn-primary">Salvar</button>
            </div>
          </div>
          {planTesting && <PaymentPlanTester value={planEditor.plan} onClose={() => setPlanTesting(false)} />}
        </div>
      )}
    </div>
  )
}
