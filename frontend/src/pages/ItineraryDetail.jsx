import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { itinerariesApi, configApi } from '../api'
import Dropdown from '../components/Dropdown'
import TagPicker from '../components/TagPicker'
import { Ic } from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import usePersistedTab from '../hooks/usePersistedTab'

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
  }, [])

  const set = (k) => (e) => setData(d => ({ ...d, [k]: e.target.value }))

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        name: data.name, slug: data.slug, start_date: data.start_date || null, end_date: data.end_date || null,
        trip_type: data.trip_type, category: data.category, continent: data.continent,
        countries: data.countries_data.map(c => c.id), cities: data.cities_data.map(c => c.id),
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
  const categoryLabel  = categories.find(c => c.id === data.category)?.name
  const continentLabel = continents.find(c => c.id === data.continent)?.name

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
              selected={data.cities_data.map(c => ({ id: c.id, label: c.state_name ? `${c.name} (${c.state_name})` : c.name }))}
              onRemove={(cid) => setData(d => ({ ...d, cities_data: d.cities_data.filter(c => c.id !== cid) }))}
              onAdd={(item) => setData(d => ({ ...d, cities_data: [...d.cities_data, { id: item.id, name: item.label }] }))}
              search={async (q) => {
                if (!q || q.length < 2) return []
                const r = await configApi.citiesSearch(q)
                return r.data.map(c => ({ id: c.id, label: c.state_name ? `${c.name} (${c.state_name})` : c.name }))
              }}
              placeholder="Buscar cidade…"
            />
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

          <FormRow label="Tipo" last>
            <Dropdown value={data.trip_type} options={TYPE_OPTS} disabled={!canEdit}
              onChange={v => setData(d => ({ ...d, trip_type: v }))} />
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
