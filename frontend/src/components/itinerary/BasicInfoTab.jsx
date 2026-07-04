import { memo, useEffect, useState } from 'react'
import Dropdown from '../Dropdown'
import DatePicker from '../DatePicker'
import TagPicker from '../TagPicker'
import { configApi } from '../../api'
import { FormRow, TabCard } from './ui'
import { inp, TYPE_OPTS } from './constants'

/* Aba "Informações Básicas": Nome, Slug, Categoria, Tipo, Início, Término e
   Palavras-chave (tags do roteiro, buscadas/criadas via Configurações). */
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

  return (
    <TabCard>
      <FormRow label="Nome da viagem">
        <input style={inp} value={data.name || ''} disabled={!canEdit} onChange={set('name')} />
      </FormRow>
      <FormRow label="Slug">
        <input style={inp} value={data.slug || ''} disabled={!canEdit} onChange={set('slug')} />
      </FormRow>
      <FormRow label="Categoria">
        <Dropdown value={data.category} options={categoryOptions} disabled={!canEdit}
          onChange={v => setData(d => ({ ...d, category: v }))} placeholder="— Selecione —" />
      </FormRow>
      <FormRow label="Tipo">
        <Dropdown value={data.trip_type} options={TYPE_OPTS} disabled={!canEdit}
          onChange={v => setData(d => ({ ...d, trip_type: v }))} />
      </FormRow>
      <FormRow label="Produto próprio da UneWorld">
        <label className="toggle-wrap" style={{ cursor: canEdit ? 'pointer' : 'default' }}>
          <span className="toggle">
            <input type="checkbox" checked={data.is_own_product !== false} disabled={!canEdit}
              onChange={e => setData(d => ({ ...d, is_own_product: e.target.checked }))} />
            <span className="toggle-slider" />
          </span>
          <span className="toggle-label">{data.is_own_product !== false ? 'Sim — produto próprio' : 'Não — de terceiro/parceiro'}</span>
        </label>
      </FormRow>
      <FormRow label="Data de início">
        <DatePicker value={data.start_date} relatedDate={data.end_date || null} disabled={!canEdit} fixed
          onChange={v => setData(d => ({ ...d, start_date: v }))} />
      </FormRow>
      <FormRow label="Data de término">
        <DatePicker value={data.end_date} relatedDate={data.start_date || null} disabled={!canEdit} fixed
          onChange={v => setData(d => ({ ...d, end_date: v }))} />
      </FormRow>
      <FormRow label="Total de noites">
        <input style={{ ...inp, background: '#f1f5f9', color: '#475569', cursor: 'not-allowed' }} readOnly disabled
          value={(() => {
            if (!data.start_date || !data.end_date) return '—'
            const n = Math.round((new Date(data.end_date) - new Date(data.start_date)) / 86400000)
            return n >= 0 ? `${n} ${n === 1 ? 'noite' : 'noites'}` : '—'
          })()} />
      </FormRow>
      <FormRow label="Palavras-chave">
        <TagPicker popup placeholder="Buscar ou criar palavra-chave…" search={searchKw} onCreate={createKw}
          selected={kwChips}
          onAdd={it => canEdit && addKw(it.id, it.raw)}
          onRemove={id => canEdit && removeKw(id)} />
      </FormRow>
      <FormRow label="Inclusos" last>
        <TagPicker popup placeholder="Buscar ou criar item incluso…" search={searchInc} onCreate={createInc}
          selected={incChips}
          onAdd={it => canEdit && addInc(it.id, it.raw)}
          onRemove={id => canEdit && removeInc(id)} />
      </FormRow>
    </TabCard>
  )
}

export default memo(BasicInfoTab)
