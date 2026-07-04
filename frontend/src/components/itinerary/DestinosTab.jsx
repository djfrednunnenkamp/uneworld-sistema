import { memo, useEffect, useState } from 'react'
import TagPicker from '../TagPicker'
import { configApi } from '../../api'
import { FormRow, TabCard } from './ui'

/* Aba "Destinos": Continente (seleção única, exibida como chip) + Países e
   Cidades (M2M). Todos reusam o TagPicker (chips + busca async). */
function DestinosTab({ data, setData, canEdit, continentOptions }) {
  const [allCountries, setAllCountries] = useState([])
  useEffect(() => { configApi.countries().then(r => setAllCountries(r.data.results ?? r.data)).catch(() => {}) }, [])

  // Helpers genéricos p/ os 3 M2M (id array + *_data para os chips) — evita repetição.
  const addItem = (idKey, dataKey, id, raw) => setData(d => {
    if ((d[idKey] || []).includes(id)) return d
    return { ...d, [idKey]: [...(d[idKey] || []), id], [dataKey]: [...(d[dataKey] || []), raw] }
  })
  const removeItem = (idKey, dataKey, id) => setData(d => ({
    ...d, [idKey]: (d[idKey] || []).filter(x => x !== id), [dataKey]: (d[dataKey] || []).filter(x => x.id !== id),
  }))
  const notSelected = (idKey, list) => { const sel = new Set(data[idKey] || []); return list.filter(x => !sel.has(x.id)) }

  // Buscas (retornam [{id, label, raw}]).
  const searchCountries = async (q) => {
    const s = (q || '').toLowerCase()
    return notSelected('countries', allCountries)
      .filter(c => !s || c.name.toLowerCase().includes(s)).slice(0, 40)
      .map(c => ({ id: c.id, label: c.name, raw: { id: c.id, name: c.name } }))
  }
  const searchCities = async (q) => {
    if (!q || q.length < 2) return []
    const r = await configApi.citySearch(q)
    return notSelected('cities', r.data.results ?? r.data)
      .map(c => ({ id: c.id, label: c.country_name ? `${c.name} · ${c.country_name}` : c.name,
                  raw: { id: c.id, name: c.name, country_name: c.country_name } }))
  }
  const chips = (dataKey, labelFn) => (data[dataKey] || []).map(x => ({ id: x.id, label: labelFn(x) }))

  // Continente: seleção ÚNICA (FK), mas exibida como chip. Escolher um substitui
  // o anterior; o "×" limpa.
  const continentChip = data.continent != null
    ? [{ id: data.continent, label: continentOptions.find(o => o.value === data.continent)?.label || '—' }]
    : []
  const searchContinents = async (q) => {
    const s = (q || '').toLowerCase()
    return continentOptions
      .filter(o => o.value !== data.continent && (!s || o.label.toLowerCase().includes(s))).slice(0, 40)
      .map(o => ({ id: o.value, label: o.label }))
  }
  const setContinent = (id) => setData(d => ({ ...d, continent: id }))

  return (
    <TabCard>
      <FormRow label="Continente">
        <TagPicker placeholder="Buscar continente…" search={searchContinents}
          selected={continentChip}
          onAdd={it => canEdit && setContinent(it.id)}
          onRemove={() => canEdit && setContinent(null)} />
      </FormRow>

      <FormRow label="Países">
        <TagPicker placeholder="Buscar país…" search={searchCountries}
          selected={chips('countries_data', c => c.name)}
          onAdd={it => canEdit && addItem('countries', 'countries_data', it.id, it.raw)}
          onRemove={id => canEdit && removeItem('countries', 'countries_data', id)} />
      </FormRow>

      <FormRow label="Cidades" last>
        <TagPicker placeholder="Buscar cidade…" search={searchCities}
          selected={chips('cities_data', c => c.country_name ? `${c.name} · ${c.country_name}` : c.name)}
          onAdd={it => canEdit && addItem('cities', 'cities_data', it.id, it.raw)}
          onRemove={id => canEdit && removeItem('cities', 'cities_data', id)} />
      </FormRow>
    </TabCard>
  )
}

export default memo(DestinosTab)
