import { memo, useEffect, useState } from 'react'
import Dropdown from '../Dropdown'
import DatePicker from '../DatePicker'
import TagPicker from '../TagPicker'
import { configApi } from '../../api'
import { inp, TYPE_OPTS } from './constants'

const flabel = { fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 }

/* Campo do formulário em grid: rótulo em cima, campo embaixo. `full` ocupa as
   duas colunas. */
function Field({ label, children, full }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : 'auto', minWidth: 0 }}>
      <label style={flabel}>{label}</label>
      {children}
    </div>
  )
}

/* "Informações Básicas" (exibida num pop-up, em duas colunas): Nome, Slug,
   Categoria, Tipo, datas, e os seletores de tags (palavras-chave, inclusos,
   destaques, tipos de roteiro, datas especiais). */
function BasicInfoTab({ data, setData, canEdit, categoryOptions }) {
  const set = (k) => (e) => setData(d => ({ ...d, [k]: e.target.value }))

  // Palavras-chave: reusa o TagPicker (busca + chips + criar na hora).
  const [allKw, setAllKw] = useState([])
  useEffect(() => { configApi.keywords().then(r => setAllKw(r.data.results ?? r.data)).catch(() => {}) }, [])

  const kwChips = (data.keywords_data || []).map(k => ({ id: k.id, label: k.name }))
  const addKw = (id, raw) => setData(d => (d.keywords || []).includes(id) ? d
    : ({ ...d, keywords: [...(d.keywords || []), id], keywords_data: [...(d.keywords_data || []), raw] }))
  const removeKw = (id) => setData(d => ({
    ...d, keywords: (d.keywords || []).filter(x => x !== id), keywords_data: (d.keywords_data || []).filter(x => x.id !== id),
  }))
  const searchKw = async (q) => {
    const s = (q || '').toLowerCase(); const sel = new Set(data.keywords || [])
    return allKw.filter(k => !sel.has(k.id) && (!s || k.name.toLowerCase().includes(s))).slice(0, 40)
      .map(k => ({ id: k.id, label: k.name, raw: { id: k.id, name: k.name } }))
  }
  // Não achou no banco → cria em Configurações e já seleciona.
  const createKw = async (name) => {
    const r = await configApi.addKeyword(name)
    setAllKw(a => [...a, r.data])
    return { id: r.data.id, label: r.data.name, raw: { id: r.data.id, name: r.data.name } }
  }

  // Inclusos: itens que estão inclusos no pacote — mesmo comportamento das palavras-chave.
  const [allInc, setAllInc] = useState([])
  useEffect(() => { configApi.inclusions().then(r => setAllInc(r.data.results ?? r.data)).catch(() => {}) }, [])

  const incChips = (data.inclusions_data || []).map(x => ({ id: x.id, label: x.name }))
  const addInc = (id, raw) => setData(d => (d.inclusions || []).includes(id) ? d
    : ({ ...d, inclusions: [...(d.inclusions || []), id], inclusions_data: [...(d.inclusions_data || []), raw] }))
  const removeInc = (id) => setData(d => ({
    ...d, inclusions: (d.inclusions || []).filter(x => x !== id), inclusions_data: (d.inclusions_data || []).filter(x => x.id !== id),
  }))
  const searchInc = async (q) => {
    const s = (q || '').toLowerCase(); const sel = new Set(data.inclusions || [])
    return allInc.filter(x => !sel.has(x.id) && (!s || x.name.toLowerCase().includes(s))).slice(0, 40)
      .map(x => ({ id: x.id, label: x.name, raw: { id: x.id, name: x.name } }))
  }
  const createInc = async (name) => {
    const r = await configApi.addInclusion(name)
    setAllInc(a => [...a, r.data])
    return { id: r.data.id, label: r.data.name, raw: { id: r.data.id, name: r.data.name } }
  }

  // Destaques: mesmo comportamento de inclusos/palavras-chave.
  const [allHl, setAllHl] = useState([])
  useEffect(() => { configApi.highlights().then(r => setAllHl(r.data.results ?? r.data)).catch(() => {}) }, [])

  const hlChips = (data.highlights_data || []).map(x => ({ id: x.id, label: x.name }))
  const addHl = (id, raw) => setData(d => (d.highlights || []).includes(id) ? d
    : ({ ...d, highlights: [...(d.highlights || []), id], highlights_data: [...(d.highlights_data || []), raw] }))
  const removeHl = (id) => setData(d => ({
    ...d, highlights: (d.highlights || []).filter(x => x !== id), highlights_data: (d.highlights_data || []).filter(x => x.id !== id),
  }))
  const searchHl = async (q) => {
    const s = (q || '').toLowerCase(); const sel = new Set(data.highlights || [])
    return allHl.filter(x => !sel.has(x.id) && (!s || x.name.toLowerCase().includes(s))).slice(0, 40)
      .map(x => ({ id: x.id, label: x.name, raw: { id: x.id, name: x.name } }))
  }
  const createHl = async (name) => {
    const r = await configApi.addHighlight(name)
    setAllHl(a => [...a, r.data])
    return { id: r.data.id, label: r.data.name, raw: { id: r.data.id, name: r.data.name } }
  }

  // Tipos de roteiro: multi-seleção reusando a lista Configurações › Tipos de Roteiro.
  const [allIt, setAllIt] = useState([])
  useEffect(() => { configApi.itineraryTypes().then(r => setAllIt(r.data.results ?? r.data)).catch(() => {}) }, [])

  const itChips = (data.itinerary_types_data || []).map(x => ({ id: x.id, label: x.name }))
  const addIt = (id, raw) => setData(d => (d.itinerary_types || []).includes(id) ? d
    : ({ ...d, itinerary_types: [...(d.itinerary_types || []), id], itinerary_types_data: [...(d.itinerary_types_data || []), raw] }))
  const removeIt = (id) => setData(d => ({
    ...d, itinerary_types: (d.itinerary_types || []).filter(x => x !== id), itinerary_types_data: (d.itinerary_types_data || []).filter(x => x.id !== id),
  }))
  const searchIt = async (q) => {
    const s = (q || '').toLowerCase(); const sel = new Set(data.itinerary_types || [])
    return allIt.filter(x => !sel.has(x.id) && (!s || x.name.toLowerCase().includes(s))).slice(0, 40)
      .map(x => ({ id: x.id, label: x.name, raw: { id: x.id, name: x.name } }))
  }
  const createIt = async (name) => {
    const r = await configApi.addItineraryType(name)
    setAllIt(a => [...a, r.data])
    return { id: r.data.id, label: r.data.name, raw: { id: r.data.id, name: r.data.name } }
  }

  // Datas especiais: multi-seleção da lista Configurações › Datas Especiais.
  const [allSd, setAllSd] = useState([])
  useEffect(() => { configApi.specialDates().then(r => setAllSd(r.data.results ?? r.data)).catch(() => {}) }, [])

  const sdChips = (data.special_dates_data || []).map(x => ({ id: x.id, label: x.name }))
  const addSd = (id, raw) => setData(d => (d.special_dates || []).includes(id) ? d
    : ({ ...d, special_dates: [...(d.special_dates || []), id], special_dates_data: [...(d.special_dates_data || []), raw] }))
  const removeSd = (id) => setData(d => ({
    ...d, special_dates: (d.special_dates || []).filter(x => x !== id), special_dates_data: (d.special_dates_data || []).filter(x => x.id !== id),
  }))
  const searchSd = async (q) => {
    const s = (q || '').toLowerCase(); const sel = new Set(data.special_dates || [])
    return allSd.filter(x => !sel.has(x.id) && (!s || x.name.toLowerCase().includes(s))).slice(0, 40)
      .map(x => ({ id: x.id, label: x.name, raw: { id: x.id, name: x.name } }))
  }
  const createSd = async (name) => {
    const r = await configApi.addSpecialDate(name)
    setAllSd(a => [...a, r.data])
    return { id: r.data.id, label: r.data.name, raw: { id: r.data.id, name: r.data.name } }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px 24px' }}>
      <Field label="Nome da viagem" full>
        <input style={inp} value={data.name || ''} disabled={!canEdit} onChange={set('name')} />
      </Field>
      <Field label="Slug" full>
        <input style={inp} value={data.slug || ''} disabled={!canEdit} onChange={set('slug')} />
      </Field>
      <Field label="Categoria">
        <Dropdown value={data.category} options={categoryOptions} disabled={!canEdit}
          onChange={v => setData(d => ({ ...d, category: v }))} placeholder="— Selecione —" />
      </Field>
      <Field label="Tipo">
        <Dropdown value={data.trip_type} options={TYPE_OPTS} disabled={!canEdit}
          onChange={v => setData(d => ({ ...d, trip_type: v }))} />
      </Field>
      <Field label="Data de início">
        <DatePicker value={data.start_date} relatedDate={data.end_date || null} disabled={!canEdit} fixed
          onChange={v => setData(d => ({ ...d, start_date: v }))} />
      </Field>
      <Field label="Data de término">
        <DatePicker value={data.end_date} relatedDate={data.start_date || null} disabled={!canEdit} fixed
          onChange={v => setData(d => ({ ...d, end_date: v }))} />
      </Field>
      <Field label="Total de noites">
        <input style={{ ...inp, background: '#f1f5f9', color: '#475569', cursor: 'not-allowed' }} readOnly disabled
          value={(() => {
            if (!data.start_date || !data.end_date) return '—'
            const n = Math.round((new Date(data.end_date) - new Date(data.start_date)) / 86400000)
            return n >= 0 ? `${n} ${n === 1 ? 'noite' : 'noites'}` : '—'
          })()} />
      </Field>
      {/* Coluna da direita: os dois toggles empilhados na mesma linha do Total de noites. */}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={flabel}>Produto próprio da UneWorld</label>
          <label className="toggle-wrap" style={{ cursor: canEdit ? 'pointer' : 'default', height: 36 }}>
            <span className="toggle">
              <input type="checkbox" checked={data.is_own_product !== false} disabled={!canEdit}
                onChange={e => setData(d => ({ ...d, is_own_product: e.target.checked }))} />
              <span className="toggle-slider" />
            </span>
            <span className="toggle-label">{data.is_own_product !== false ? 'Sim — produto próprio' : 'Não — de terceiro/parceiro'}</span>
          </label>
        </div>
        <div>
          <label style={flabel}>Destaque do roteiro</label>
          <label className="toggle-wrap" style={{ cursor: canEdit ? 'pointer' : 'default', height: 36 }}>
            <span className="toggle">
              <input type="checkbox" checked={data.is_featured === true} disabled={!canEdit}
                onChange={e => setData(d => ({ ...d, is_featured: e.target.checked }))} />
              <span className="toggle-slider" />
            </span>
            <span className="toggle-label">{data.is_featured === true ? 'Sim — em destaque' : 'Não'}</span>
          </label>
        </div>
      </div>
      <Field label="Palavras-chave">
        <TagPicker popup placeholder="Buscar ou criar palavra-chave…" search={searchKw} onCreate={createKw}
          selected={kwChips}
          onAdd={it => canEdit && addKw(it.id, it.raw)}
          onRemove={id => canEdit && removeKw(id)} />
      </Field>
      <Field label="Inclusos">
        <TagPicker popup placeholder="Buscar ou criar item incluso…" search={searchInc} onCreate={createInc}
          selected={incChips}
          onAdd={it => canEdit && addInc(it.id, it.raw)}
          onRemove={id => canEdit && removeInc(id)} />
      </Field>
      <Field label="Destaques">
        <TagPicker popup placeholder="Buscar ou criar destaque…" search={searchHl} onCreate={createHl}
          selected={hlChips}
          onAdd={it => canEdit && addHl(it.id, it.raw)}
          onRemove={id => canEdit && removeHl(id)} />
      </Field>
      <Field label="Tipos de roteiro">
        <TagPicker popup placeholder="Buscar ou criar tipo de roteiro…" search={searchIt} onCreate={createIt}
          selected={itChips}
          onAdd={it => canEdit && addIt(it.id, it.raw)}
          onRemove={id => canEdit && removeIt(id)} />
      </Field>
      <Field label="Datas especiais" full>
        <TagPicker popup placeholder="Buscar ou criar data especial…" search={searchSd} onCreate={createSd}
          selected={sdChips}
          onAdd={it => canEdit && addSd(it.id, it.raw)}
          onRemove={id => canEdit && removeSd(id)} />
      </Field>
    </div>
  )
}

export default memo(BasicInfoTab)
