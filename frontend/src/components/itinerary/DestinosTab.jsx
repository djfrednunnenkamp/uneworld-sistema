import { memo, useEffect, useState } from 'react'
import Dropdown from '../Dropdown'
import TagPicker from '../TagPicker'
import { configApi } from '../../api'
import { FormRow, TabCard } from './ui'

/* Aba "Destinos": Continente (campo existente) + Países, Cidades e Aeroportos
   (M2M novos). Reusa o TagPicker (chips + busca async) para os três. */
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
  const searchAirports = async (q) => {
    if (!q || q.length < 2) return []
    const r = await configApi.airports({ q })
    return notSelected('airports', r.data.results ?? r.data)
      .map(a => ({ id: a.id, label: `${a.iata_code ? a.iata_code + ' · ' : ''}${a.name}${a.city ? ` (${a.city})` : ''}`,
                  raw: { id: a.id, name: a.name, iata_code: a.iata_code, city: a.city } }))
  }

  const chips = (dataKey, labelFn) => (data[dataKey] || []).map(x => ({ id: x.id, label: labelFn(x) }))

  return (
    <TabCard>
      <FormRow label="Continente">
        <Dropdown value={data.continent} options={continentOptions} disabled={!canEdit}
          onChange={v => setData(d => ({ ...d, continent: v }))} placeholder="— Selecione —" />
      </FormRow>

      <FormRow label="Países">
        <TagPicker placeholder="Buscar país…" search={searchCountries}
          selected={chips('countries_data', c => c.name)}
          onAdd={it => canEdit && addItem('countries', 'countries_data', it.id, it.raw)}
          onRemove={id => canEdit && removeItem('countries', 'countries_data', id)} />
      </FormRow>

      <FormRow label="Cidades">
        <TagPicker placeholder="Buscar cidade…" search={searchCities}
          selected={chips('cities_data', c => c.country_name ? `${c.name} · ${c.country_name}` : c.name)}
          onAdd={it => canEdit && addItem('cities', 'cities_data', it.id, it.raw)}
          onRemove={id => canEdit && removeItem('cities', 'cities_data', id)} />
      </FormRow>

      <FormRow label="Aeroportos" last>
        <TagPicker placeholder="Buscar aeroporto (nome/IATA/cidade)…" search={searchAirports}
          selected={chips('airports_data', a => `${a.iata_code ? a.iata_code + ' · ' : ''}${a.name}`)}
          onAdd={it => canEdit && addItem('airports', 'airports_data', it.id, it.raw)}
          onRemove={id => canEdit && removeItem('airports', 'airports_data', id)} />
      </FormRow>
    </TabCard>
  )
}

export default memo(DestinosTab)
