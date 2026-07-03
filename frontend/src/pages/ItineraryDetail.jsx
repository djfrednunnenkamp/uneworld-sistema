import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { itinerariesApi, configApi, listsApi } from '../api'
import Dropdown from '../components/Dropdown'
import TagPicker from '../components/TagPicker'
import RichTextEditor from '../components/RichTextEditor'
import DatePicker from '../components/DatePicker'
import MoneyInput from '../components/MoneyInput'
import PaymentPlanFields, { PaymentPlanTester } from '../components/PaymentPlanFields'
import { Ic } from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import usePersistedTab from '../hooks/usePersistedTab'

const NOTICE_COLORS = [
  { value: 'laranja',  label: 'Laranja',  hex: '#f59e0b' },
  { value: 'vermelho', label: 'Vermelho', hex: '#dc2626' },
  { value: 'verde',    label: 'Verde',    hex: '#16a34a' },
  { value: 'azul',     label: 'Azul',     hex: '#2563eb' },
  { value: 'cinza',    label: 'Cinza',    hex: '#64748b' },
]

const CURRENCY_OPTS = [
  { value: 'EUR', label: 'Euro' },
  { value: 'USD', label: 'Dólar' },
  { value: 'BRL', label: 'Real' },
]

const WEEKDAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']

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

const addDaysIso = (iso, days) => {
  if (!iso) return iso
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + (days || 0))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const fmtDateWithWeekday = (iso) => {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return `${fmtDateBR(iso)} (${WEEKDAYS[d.getDay()]})`
}

/* ── Seletor de cor do aviso — o botão fica colorido com a cor escolhida ── */
function NoticeColorSelect({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const current = NOTICE_COLORS.find(c => c.value === value) || NOTICE_COLORS[0]
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => !disabled && setOpen(o => !o)} disabled={disabled}
        style={{
          width: '100%', padding: '8px 10px', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600,
          background: current.hex, color: '#fff', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
        {current.label}
        <span style={{ display: 'flex', transform: 'rotate(90deg)' }}><Ic n="chevron" s={12} /></span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,.14)' }}>
          {NOTICE_COLORS.map(c => (
            <div key={c.value} onMouseDown={e => { e.preventDefault(); onChange(c.value); setOpen(false) }}
              style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#fff', background: c.hex, opacity: c.value === value ? 1 : .85 }}>
              {c.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Stepper numérico com +/-, igual ao "Número de parcelas" dos Contratos ── */
function Stepper({ value, onChange, disabled }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button type="button" onClick={() => onChange((value || 0) - 1)} disabled={disabled}
        style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 14 }}>−</button>
      <input type="number" value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value) || 0)}
        style={{ ...inp, width: 90, textAlign: 'center' }} />
      <button type="button" onClick={() => onChange((value || 0) + 1)} disabled={disabled}
        style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 14 }}>+</button>
    </div>
  )
}

/* ── Seletor transiente "Usar modelo" — escolher um modelo preenche o texto
 * abaixo, mas o usuário sempre pode ignorar e escrever manualmente. ── */
function TemplatePicker({ options, onUse }) {
  return (
    <div style={{ maxWidth: 320, marginBottom: 8 }}>
      <Dropdown value={null} options={options} placeholder="— Usar um modelo —"
        onChange={v => {
          const opt = options.find(o => o.value === v)
          if (opt) onUse(opt.content)
        }} />
    </div>
  )
}

/* ── Toggle Sim/Não — mesmo padrão usado em Agências/Usuários/Passageiros ── */
function Toggle({ checked, onChange, disabled }) {
  return (
    <label className="toggle-wrap" style={{ opacity: disabled ? .6 : 1, cursor: disabled ? 'default' : 'pointer' }}>
      <span className="toggle">
        <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
        <span className="toggle-slider" />
      </span>
      <span className="toggle-label">{checked ? 'Sim' : 'Não'}</span>
    </label>
  )
}

const inp = { padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b', boxSizing: 'border-box', width: '100%' }

const TYPE_OPTS = [
  { value: 'aereo',     label: 'Aéreo' },
  { value: 'terrestre', label: 'Terrestre' },
]

const TABS = [
  { key: 'info',      label: 'Informações do roteiro' },
  { key: 'clausulas', label: 'Cláusulas (contrato)' },
  { key: 'videos',    label: 'Galeria de Vídeos' },
  { key: 'imagens',   label: 'Galeria de Imagens' },
  { key: 'slideshow', label: 'Slideshow' },
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
  const [destinationOpts, setDestinationOpts] = useState([])
  const [holidayOpts, setHolidayOpts] = useState([])
  const [supplierOpts, setSupplierOpts] = useState([])
  const [serviceOpts, setServiceOpts] = useState([])
  const [accommodationOpts, setAccommodationOpts] = useState([])
  const [templatesByKind, setTemplatesByKind] = useState({})
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
    configApi.destinations().then(r => setDestinationOpts(r.data)).catch(() => {})
    configApi.holidays().then(r => setHolidayOpts(r.data)).catch(() => {})
    listsApi.suppliers().then(r => setSupplierOpts(r.data.results ?? r.data)).catch(() => {})
    configApi.services().then(r => setServiceOpts(r.data)).catch(() => {})
    configApi.accommodations().then(r => setAccommodationOpts(r.data.results ?? r.data)).catch(() => {})
    configApi.contractClauses().then(r => setClauseList(r.data.results ?? r.data)).catch(() => {})
    ;['seguro', 'condicoes', 'documentacao'].forEach(k => {
      configApi.itineraryTemplates(k).then(r => setTemplatesByKind(prev => ({ ...prev, [k]: r.data }))).catch(() => {})
    })
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
        countries: data.countries_data.map(c => c.id), destinations: data.destinations_data.map(d => d.id),
        cover_title: data.cover_title, internal_title: data.internal_title,
        subtitle: data.subtitle, short_description: data.short_description, holiday: data.holiday,
        is_featured: data.is_featured, is_active: data.is_active, is_full: data.is_full, is_listed: data.is_listed,
        has_notice: data.has_notice, notice_color: data.notice_color, notice_message: data.notice_message,
        day_count_correction: data.day_count_correction || 0,
        cash_discount_percent: data.cash_discount_percent || 0,
        base_currency: data.base_currency, additional_spread_percent: data.additional_spread_percent || 0,
        service_lines: (data.service_lines || []).map(l => ({
          supplier: l.supplier, services: (l.services_data || []).map(s => s.id), percentage: l.percentage || 0,
        })),
        accommodation_lines: (data.accommodation_lines || []).map(l => ({
          accommodation_type: l.accommodation_type, value_per_person: l.value_per_person || 0, taxes: l.taxes || 0,
        })),
        about_destination: data.about_destination, day_by_day: data.day_by_day,
        package_includes: data.package_includes, package_excludes: data.package_excludes,
        insurance_info: data.insurance_info, pricing_info: data.pricing_info,
        payment_info: data.payment_info, terms_info: data.terms_info,
        hotels_reserved: data.hotels_reserved, transport_info: data.transport_info,
        documentation_info: data.documentation_info, extras: data.extras,
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
  const holidayOptions   = holidayOpts.map(h => ({ value: h.id, label: h.name }))
  const supplierOptions  = supplierOpts.map(s => ({ value: s.id, label: s.name }))
  const categoryLabel  = categories.find(c => c.id === data.category)?.name
  const continentLabel = continents.find(c => c.id === data.continent)?.name

  const serviceLines = data.service_lines || []
  const addServiceLine = () => setData(d => ({ ...d, service_lines: [...(d.service_lines || []), { supplier: null, services_data: [], percentage: 0 }] }))
  const updateServiceLine = (idx, patch) => setData(d => ({ ...d, service_lines: d.service_lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }))
  const removeServiceLine = (idx) => setData(d => ({ ...d, service_lines: d.service_lines.filter((_, i) => i !== idx) }))

  const accommodationOptions = accommodationOpts.map(a => ({ value: a.id, label: a.name }))
  const currencyLabel = (CURRENCY_OPTS.find(c => c.value === data.base_currency)?.value) || data.base_currency || ''
  const accomLines = data.accommodation_lines || []
  const addAccomLine = () => setData(d => ({ ...d, accommodation_lines: [...(d.accommodation_lines || []), { accommodation_type: null, value_per_person: 0, taxes: 0 }] }))
  const updateAccomLine = (idx, patch) => setData(d => ({ ...d, accommodation_lines: d.accommodation_lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }))
  const removeAccomLine = (idx) => setData(d => ({ ...d, accommodation_lines: d.accommodation_lines.filter((_, i) => i !== idx) }))

  const regenerateShortDescription = () => {
    const names = data.destinations_data.map(d => d.name)
    setData(d => ({ ...d, short_description: names.join(', ') }))
  }

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

          <FormRow label="Destinos e Cidades">
            <TagPicker
              selected={data.destinations_data.map(d => ({ id: d.id, label: d.name }))}
              onRemove={(did) => setData(d => ({ ...d, destinations_data: d.destinations_data.filter(x => x.id !== did) }))}
              onAdd={(item) => setData(d => ({ ...d, destinations_data: [...d.destinations_data, { id: item.id, name: item.label }] }))}
              search={async (q) => {
                const list = q ? destinationOpts.filter(d => d.name.toLowerCase().includes(q.toLowerCase())) : destinationOpts
                return list.map(d => ({ id: d.id, label: d.name }))
              }}
              onCreate={async (name) => {
                const r = await configApi.addDestination(name)
                setDestinationOpts(prev => [...prev, r.data])
                return { id: r.data.id, label: r.data.name }
              }}
              placeholder="Buscar destino…"
            />
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0' }}>
              Os destinos disponíveis são gerenciados em Configurações → Destinos.
            </p>
          </FormRow>

          <FormRow label="Países">
            <TagPicker
              selected={data.countries_data.map(c => ({ id: c.id, label: c.name }))}
              onRemove={(cid) => setData(d => ({ ...d, countries_data: d.countries_data.filter(c => c.id !== cid) }))}
              onAdd={(item) => setData(d => ({ ...d, countries_data: [...d.countries_data, { id: item.id, name: item.label }] }))}
              search={async (q) => {
                const r = await configApi.countries()
                const list = q ? r.data.filter(c => c.name.toLowerCase().includes(q.toLowerCase())) : r.data
                return list.map(c => ({ id: c.id, label: c.name }))
              }}
              placeholder="Buscar país…"
            />
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

          <FormRow label="Título da capa">
            <input style={inp} value={data.cover_title} disabled={!canEdit} onChange={set('cover_title')} />
          </FormRow>

          <FormRow label="Título interno completo">
            <RichTextEditor title="Título interno completo" value={data.internal_title} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, internal_title: v }))} />
          </FormRow>

          <FormRow label="Subtítulo">
            <input style={inp} value={data.subtitle} disabled={!canEdit} onChange={set('subtitle')} />
          </FormRow>

          <FormRow label="Breve descrição">
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={inp} value={data.short_description} disabled={!canEdit} onChange={set('short_description')} />
              {canEdit && (
                <button type="button" onClick={regenerateShortDescription} title="Gerar a partir dos destinos selecionados"
                  style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ic n="rotate" s={14} />
                </button>
              )}
            </div>
          </FormRow>

          <FormRow label="Feriado">
            <Dropdown value={data.holiday} options={holidayOptions} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, holiday: v }))} placeholder="— Selecione —" />
          </FormRow>

          <FormRow label="Destaque na home?">
            <Toggle checked={data.is_featured} disabled={!canEdit} onChange={v => setData(d => ({ ...d, is_featured: v }))} />
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0' }}>Marque esta opção para fixar o roteiro no topo da página principal.</p>
          </FormRow>

          <FormRow label="Roteiro ativo?">
            <Toggle checked={data.is_active} disabled={!canEdit} onChange={v => setData(d => ({ ...d, is_active: v }))} />
          </FormRow>

          <FormRow label="Roteiro lotado?">
            <Toggle checked={data.is_full} disabled={!canEdit} onChange={v => setData(d => ({ ...d, is_full: v }))} />
          </FormRow>

          <FormRow label="Listado no website?">
            <Toggle checked={data.is_listed} disabled={!canEdit} onChange={v => setData(d => ({ ...d, is_listed: v }))} />
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0' }}>Desative esta opção para que o roteiro não seja listado no website.</p>
          </FormRow>

          <FormRow label="Aviso">
            <Toggle checked={data.has_notice} disabled={!canEdit} onChange={v => setData(d => ({ ...d, has_notice: v }))} />
          </FormRow>

          <FormRow label="Cor do aviso">
            <NoticeColorSelect value={data.notice_color} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, notice_color: v }))} />
          </FormRow>

          <FormRow label="Mensagem do aviso">
            <input style={inp} value={data.notice_message} disabled={!canEdit} onChange={set('notice_message')} />
          </FormRow>

          <FormRow label="Data de início">
            <DatePicker value={data.start_date} relatedDate={data.end_date || null} disabled={!canEdit} fixed
              onChange={v => setData(d => ({ ...d, start_date: v }))} />
          </FormRow>

          <FormRow label="Data de término">
            <DatePicker value={data.end_date} relatedDate={data.start_date || null} disabled={!canEdit} fixed
              onChange={v => setData(d => ({ ...d, end_date: v }))} />
          </FormRow>

          <FormRow label="Correção contagem de dias">
            <Stepper value={data.day_count_correction} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, day_count_correction: v }))} />
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0' }}>Ajuste o total de dias do roteiro incluindo ou removendo dias.</p>
            {data.start_date && data.end_date && (
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', margin: '8px 0 0' }}>
                {fmtDateWithWeekday(data.start_date)} à {fmtDateWithWeekday(addDaysIso(data.end_date, data.day_count_correction))}
              </p>
            )}
          </FormRow>

          <FormRow label="Desconto à vista em %">
            <input style={inp} type="number" step="0.01" value={data.cash_discount_percent} disabled={!canEdit}
              onChange={e => setData(d => ({ ...d, cash_discount_percent: e.target.value }))} />
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0' }}>Informe o desconto à vista.</p>
          </FormRow>

          <FormRow label="Moeda base">
            <Dropdown value={data.base_currency} options={CURRENCY_OPTS} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, base_currency: v }))} />
          </FormRow>

          <FormRow label="Spread adicional em %" last>
            <input style={inp} type="number" step="0.01" value={data.additional_spread_percent} disabled={!canEdit}
              onChange={e => setData(d => ({ ...d, additional_spread_percent: e.target.value }))} />
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0' }}>Informe um spread adicional apenas para este roteiro.</p>
          </FormRow>
        </div>
      )}

      {tab === 'info' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,.04)', marginTop: 20 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: '0 0 16px' }}>
            Serviços turísticos fornecidos por terceiros (serviços intermediados)
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 10, fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              <span style={{ width: 32, flexShrink: 0 }}>#</span>
              <span style={{ flex: 1 }}>Fornecedor</span>
              <span style={{ flex: 2 }}>Serviço</span>
              <span style={{ width: 110, flexShrink: 0 }}>Percentual %</span>
              <span style={{ width: 32, flexShrink: 0 }} />
            </div>
            {serviceLines.map((line, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 32, flexShrink: 0, paddingTop: 8, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>{idx + 1}</div>
                <div style={{ flex: 1 }}>
                  <Dropdown value={line.supplier} options={supplierOptions} disabled={!canEdit}
                    onChange={v => updateServiceLine(idx, { supplier: v })} placeholder="Selecione o fornecedor" />
                </div>
                <div style={{ flex: 2 }}>
                  <TagPicker
                    selected={(line.services_data || []).map(s => ({ id: s.id, label: s.name }))}
                    onRemove={(sid) => updateServiceLine(idx, { services_data: line.services_data.filter(s => s.id !== sid) })}
                    onAdd={(item) => updateServiceLine(idx, { services_data: [...(line.services_data || []), { id: item.id, name: item.label }] })}
                    search={async (q) => {
                      const list = q ? serviceOpts.filter(s => s.name.toLowerCase().includes(q.toLowerCase())) : serviceOpts
                      return list.map(s => ({ id: s.id, label: s.name }))
                    }}
                    onCreate={async (name) => {
                      const r = await configApi.addService(name)
                      setServiceOpts(prev => [...prev, r.data])
                      return { id: r.data.id, label: r.data.name }
                    }}
                    placeholder="Selecione os serviços…"
                  />
                </div>
                <div style={{ width: 110, flexShrink: 0 }}>
                  <input style={inp} type="number" step="0.01" value={line.percentage} disabled={!canEdit}
                    onChange={e => updateServiceLine(idx, { percentage: e.target.value })} />
                </div>
                <button type="button" onClick={() => removeServiceLine(idx)} disabled={!canEdit}
                  style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 6, border: '1px solid #fee2e2', background: '#fef2f2', color: '#dc2626', cursor: canEdit ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ic n="x" s={13} />
                </button>
              </div>
            ))}
            {canEdit && (
              <button type="button" onClick={addServiceLine}
                style={{ alignSelf: 'flex-start', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 7, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                <Ic n="plus" s={13} /> Adicionar linha
              </button>
            )}
          </div>
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
          <FormRow label="Formas de pagamento (aplicáveis no contrato)">
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

          <FormRow label="Sobre o destino">
            <RichTextEditor title="Sobre o destino" value={data.about_destination} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, about_destination: v }))} />
          </FormRow>

          <FormRow label="Dia a dia">
            <RichTextEditor title="Dia a dia" value={data.day_by_day} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, day_by_day: v }))} />
          </FormRow>

          <FormRow label="O que inclui no pacote">
            <RichTextEditor title="O que inclui no pacote" value={data.package_includes} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, package_includes: v }))} />
          </FormRow>

          <FormRow label="O que não inclui no pacote">
            <RichTextEditor title="O que não inclui no pacote" value={data.package_excludes} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, package_excludes: v }))} />
          </FormRow>

          <FormRow label="Adicional de seguro viagem">
            <TemplatePicker options={(templatesByKind.seguro || []).map(t => ({ value: t.id, label: t.name, content: t.content }))}
              onUse={content => setData(d => ({ ...d, insurance_info: content }))} />
            <RichTextEditor title="Adicional de seguro viagem" value={data.insurance_info} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, insurance_info: v }))} />
          </FormRow>

          <FormRow label="Informações sobre valores">
            <RichTextEditor title="Informações sobre valores" value={data.pricing_info} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, pricing_info: v }))} />
          </FormRow>

          <FormRow label="Condições gerais para compra do pacote">
            <TemplatePicker options={(templatesByKind.condicoes || []).map(t => ({ value: t.id, label: t.name, content: t.content }))}
              onUse={content => setData(d => ({ ...d, terms_info: content }))} />
            <RichTextEditor title="Condições gerais para compra do pacote" value={data.terms_info} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, terms_info: v }))} />
          </FormRow>

          <FormRow label="Hotéis reservados">
            <RichTextEditor title="Hotéis reservados" value={data.hotels_reserved} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, hotels_reserved: v }))} />
          </FormRow>

          <FormRow label="Parte aérea / rodoviária">
            <RichTextEditor title="Parte aérea / rodoviária" value={data.transport_info} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, transport_info: v }))} />
          </FormRow>

          <FormRow label="Documentação necessária para a viagem">
            <TemplatePicker options={(templatesByKind.documentacao || []).map(t => ({ value: t.id, label: t.name, content: t.content }))}
              onUse={content => setData(d => ({ ...d, documentation_info: content }))} />
            <RichTextEditor title="Documentação necessária para a viagem" value={data.documentation_info} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, documentation_info: v }))} />
          </FormRow>

          <FormRow label="Extras" last>
            <RichTextEditor title="Extras" value={data.extras} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, extras: v }))} />
          </FormRow>
        </div>
      )}

      {tab !== 'info' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13.5 }}>
          Em breve.
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
