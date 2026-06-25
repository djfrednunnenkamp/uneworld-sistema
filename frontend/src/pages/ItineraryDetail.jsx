import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { itinerariesApi, configApi } from '../api'
import Dropdown from '../components/Dropdown'
import TagPicker from '../components/TagPicker'
import RichTextEditor from '../components/RichTextEditor'
import { Ic } from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import usePersistedTab from '../hooks/usePersistedTab'

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
  }, [])

  const set = (k) => (e) => setData(d => ({ ...d, [k]: e.target.value }))

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
  const categoryLabel  = categories.find(c => c.id === data.category)?.name
  const continentLabel = continents.find(c => c.id === data.continent)?.name

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
            <RichTextEditor title="Título interno completo" value={data.internal_title}
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

          <FormRow label="Listado no website?" last>
            <Toggle checked={data.is_listed} disabled={!canEdit} onChange={v => setData(d => ({ ...d, is_listed: v }))} />
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0' }}>Desative esta opção para que o roteiro não seja listado no website.</p>
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
