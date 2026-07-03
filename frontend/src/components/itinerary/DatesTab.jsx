import { memo } from 'react'
import DatePicker from '../DatePicker'
import { FormRow, TabCard } from './ui'

/* Aba "Datas": início e término (DatePicker, nunca input nativo). */
function DatesTab({ data, setData, canEdit }) {
  return (
    <TabCard>
      <FormRow label="Data de início">
        <DatePicker value={data.start_date} relatedDate={data.end_date || null} disabled={!canEdit} fixed
          onChange={v => setData(d => ({ ...d, start_date: v }))} />
      </FormRow>
      <FormRow label="Data de término" last>
        <DatePicker value={data.end_date} relatedDate={data.start_date || null} disabled={!canEdit} fixed
          onChange={v => setData(d => ({ ...d, end_date: v }))} />
      </FormRow>
    </TabCard>
  )
}

export default memo(DatesTab)
