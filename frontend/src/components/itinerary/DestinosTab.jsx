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
  // Países: lista completa (a escolha de continente não remove países).
  const searchCountries = async (q) => {
    const s = (q || '').toLowerCase()
    return notSelected('countries', allCountries)
      .filter(c => !s || c.name.toLowerCase().includes(s)).slice(0, 40)
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
  // Cidades: se houver país(es) selecionado(s), lista as cidades desses países
  // (navegável, mesmo sem digitar) e permite buscar por nome. Sem país
  // selecionado, cai na busca global por nome (mín. 2 letras).
  const mapCity = (c) => ({ id: c.id, label: c.country_name ? `${c.name} · ${c.country_name}` : c.name,
                            raw: { id: c.id, name: c.name, country_name: c.country_name } })
  const searchCities = async (q) => {
    const countryIds = data.countries || []
    if (countryIds.length > 0) {
      const r = await configApi.citiesByCountries(countryIds.join(','), q || '')
      return notSelected('cities', r.data.results ?? r.data).map(mapCity)
    }
    if (!q || q.length < 2) return []
    const r = await configApi.citySearch(q)
    return notSelected('cities', r.data.results ?? r.data).map(mapCity)
  }
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
          selected={chips('cities_data', c => c.country_name ? `${c.name} · ${c.country_name}` : c.name)}
          onAdd={it => canEdit && addItem('cities', 'cities_data', it.id, it.raw)}
          onRemove={id => canEdit && removeItem('cities', 'cities_data', id)} />
      </FormRow>
    </TabCard>
  )
}

export default memo(DestinosTab)
