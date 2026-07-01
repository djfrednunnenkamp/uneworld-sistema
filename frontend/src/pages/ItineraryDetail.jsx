import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { itinerariesApi, configApi, listsApi } from '../api'
import Dropdown from '../components/Dropdown'
import TagPicker from '../components/TagPicker'
import RichTextEditor from '../components/RichTextEditor'
import DatePicker from '../components/DatePicker'
import MoneyInput from '../components/MoneyInput'
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
  const [clauseList, setClauseList] = useState([])   // cláusulas cadastradas em Config

  const load = useCallback(() => {
    setLoading(true)
    itinerariesApi.get(id)
      .then(r => setData(r.data))
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
    ;['seguro', 'pagamento', 'condicoes', 'documentacao'].forEach(k => {
      configApi.itineraryTemplates(k).then(r => setTemplatesByKind(prev => ({ ...prev, [k]: r.data }))).catch(() => {})
    })
  }, [])

  const set = (k) => (e) => setData(d => ({ ...d, [k]: e.target.value }))
  const toggleClause = (cid) => setData(d => { const cur = d.clauses || []; return { ...d, clauses: cur.includes(cid) ? cur.filter(x => x !== cid) : [...cur, cid] } })
  const addCustomClause = () => setData(d => ({ ...d, custom_clauses: [...(d.custom_clauses || []), { name: '', content: '' }] }))
  const updateCustomClause = (i, k, v) => setData(d => ({ ...d, custom_clauses: (d.custom_clauses || []).map((c, j) => j === i ? { ...c, [k]: v } : c) }))
  const removeCustomClause = (i) => setData(d => ({ ...d, custom_clauses: (d.custom_clauses || []).filter((_, j) => j !== i) }))

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
      }
      const r = await itinerariesApi.update(id, payload)
      setData(r.data)
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

          <FormRow label="Forma de pagamento">
            <TemplatePicker options={(templatesByKind.pagamento || []).map(t => ({ value: t.id, label: t.name, content: t.content }))}
              onUse={content => setData(d => ({ ...d, payment_info: content }))} />
            <RichTextEditor title="Forma de pagamento" value={data.payment_info} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, payment_info: v }))} />
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
    </div>
  )
}
