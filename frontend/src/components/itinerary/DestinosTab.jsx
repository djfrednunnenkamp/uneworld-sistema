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
  // Países: lista completa (sem corte — são ~250, filtro local).
  const searchCountries = async (q) => {
    const s = (q || '').toLowerCase()
    return notSelected('countries', allCountries)
      .filter(c => !s || c.name.toLowerCase().includes(s))
      .map(c => ({ id: c.id, label: c.name, raw: { id: c.id, name: c.name } }))
  }

  // Ao adicionar um país: inclui automaticamente o continente daquele país na
  // lista de continentes (se ainda não estiver lá) — integração país → continente.
  const addCountry = (id, raw) => setData(d => {
    if ((d.countries || []).includes(id)) return d
    const next = { ...d, countries: [...(d.countries || []), id], countries_data: [...(d.countries_data || []), raw] }
    const full = allCountries.find(c => c.id === id)
    if (full && full.continent != null && !(d.continents || []).includes(full.continent)) {
      const contName = full.continent_name || continentOptions.find(o => o.value === full.continent)?.label || '—'
      next.continents = [...(d.continents || []), full.continent]
      next.continents_data = [...(d.continents_data || []), { id: full.continent, name: contName }]
    }
    return next
  })
  // Subtítulo "Continente · País" (linha de baixo, menor).
  const citySub = (c) => [c.continent_name, c.country_name].filter(Boolean).join(' · ')
  // Cidades: busca GLOBAL (não filtra pelo país selecionado); nome na 1ª linha e
  // "Continente · País" na 2ª. Lista navegável mesmo sem digitar (amostra).
  const mapCity = (c) => ({ id: c.id, label: c.name, sublabel: citySub(c),
                            raw: { id: c.id, name: c.name, country_name: c.country_name, continent_name: c.continent_name,
                                   country_id: c.country, continent_id: c.continent } })
  const searchCities = async (q) => {
    const r = await configApi.citySearch(q || '')
    return notSelected('cities', r.data.results ?? r.data).map(mapCity)
  }

  // Ao adicionar uma cidade: inclui automaticamente o país e o continente dela
  // (se ainda não estiverem nas listas) — integração cidade → país → continente.
  const addCity = (id, raw) => setData(d => {
    if ((d.cities || []).includes(id)) return d
    const next = { ...d, cities: [...(d.cities || []), id], cities_data: [...(d.cities_data || []), raw] }
    if (raw.country_id != null && !(next.countries || []).includes(raw.country_id)) {
      next.countries = [...(next.countries || []), raw.country_id]
      next.countries_data = [...(next.countries_data || []), { id: raw.country_id, name: raw.country_name }]
    }
    if (raw.continent_id != null && !(next.continents || []).includes(raw.continent_id)) {
      next.continents = [...(next.continents || []), raw.continent_id]
      next.continents_data = [...(next.continents_data || []), { id: raw.continent_id, name: raw.continent_name }]
    }
    return next
  })
  const chips = (dataKey, labelFn) => (data[dataKey] || []).map(x => ({ id: x.id, label: labelFn(x) }))

  // Continente: multi-seleção (chips), igual a Países.
  const continentChips = (data.continents_data || []).map(x => ({ id: x.id, label: x.name }))
  const searchContinents = async (q) => {
    const s = (q || '').toLowerCase()
    const sel = new Set(data.continents || [])
    return continentOptions
      .filter(o => !sel.has(o.value) && (!s || o.label.toLowerCase().includes(s))).slice(0, 40)
      .map(o => ({ id: o.value, label: o.label, raw: { id: o.value, name: o.label } }))
  }

  return (
    <TabCard>
      <FormRow label="Continente">
        <TagPicker popup placeholder="Buscar continente…" search={searchContinents}
          selected={continentChips}
          onAdd={it => canEdit && addItem('continents', 'continents_data', it.id, it.raw)}
          onRemove={id => canEdit && removeItem('continents', 'continents_data', id)} />
      </FormRow>

      <FormRow label="Países">
        <TagPicker popup placeholder="Buscar país…" search={searchCountries}
          selected={chips('countries_data', c => c.name)}
          onAdd={it => canEdit && addCountry(it.id, it.raw)}
          onRemove={id => canEdit && removeItem('countries', 'countries_data', id)} />
      </FormRow>

      <FormRow label="Cidades" last>
        <TagPicker popup placeholder="Buscar cidade…" search={searchCities}
          selected={(data.cities_data || []).map(c => ({ id: c.id, label: c.name, sublabel: citySub(c) }))}
          onAdd={it => canEdit && addCity(it.id, it.raw)}
          onRemove={id => canEdit && removeItem('cities', 'cities_data', id)} />
      </FormRow>
    </TabCard>
  )
}

export default memo(DestinosTab)
