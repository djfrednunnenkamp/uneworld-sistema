import { memo } from 'react'
import Dropdown from '../Dropdown'
import { FormRow, TabCard } from './ui'
import { inp, TYPE_OPTS } from './constants'

/* Aba "Informações Básicas": Nome, Slug, Categoria, Tipo. */
function BasicInfoTab({ data, setData, canEdit, categoryOptions }) {
  const set = (k) => (e) => setData(d => ({ ...d, [k]: e.target.value }))
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
      <FormRow label="Tipo" last>
        <Dropdown value={data.trip_type} options={TYPE_OPTS} disabled={!canEdit}
          onChange={v => setData(d => ({ ...d, trip_type: v }))} />
      </FormRow>
    </TabCard>
  )
}

export default memo(BasicInfoTab)
