import { memo } from 'react'
import Dropdown from '../Dropdown'
import { FormRow, TabCard } from './ui'

/* Aba "Destinos": por enquanto o Continente (campo existente). Cidades e demais
   destinos detalhados entram aqui numa próxima etapa. */
function DestinosTab({ data, setData, canEdit, continentOptions }) {
  return (
    <TabCard style={{ paddingBottom: 18 }}>
      <FormRow label="Continente" last>
        <Dropdown value={data.continent} options={continentOptions} disabled={!canEdit}
          onChange={v => setData(d => ({ ...d, continent: v }))} placeholder="— Selecione —" />
      </FormRow>
      <p style={{ fontSize: 12.5, color: '#94a3b8', margin: '6px 0 4px' }}>
        Cidades e destinos detalhados serão adicionados aqui em breve.
      </p>
    </TabCard>
  )
}

export default memo(DestinosTab)
