import { memo, useEffect, useState } from 'react'
import TagPicker from '../TagPicker'
import { configApi } from '../../api'
import { TabCard } from './ui'

/* Aba "Inclusos": itens que estão inclusos no pacote/roteiro. Puxa da lista de
   Configurações › Inclusos e permite criar novos na hora (reusa o TagPicker). */
function InclusosTab({ data, setData, canEdit }) {
  const [all, setAll] = useState([])
  useEffect(() => { configApi.inclusions().then(r => setAll(r.data.results ?? r.data)).catch(() => {}) }, [])

  const chips = (data.inclusions_data || []).map(x => ({ id: x.id, label: x.name }))
  const add = (id, raw) => setData(d => (d.inclusions || []).includes(id) ? d
    : ({ ...d, inclusions: [...(d.inclusions || []), id], inclusions_data: [...(d.inclusions_data || []), raw] }))
  const remove = (id) => setData(d => ({
    ...d, inclusions: (d.inclusions || []).filter(x => x !== id), inclusions_data: (d.inclusions_data || []).filter(x => x.id !== id),
  }))
  const search = async (q) => {
    const s = (q || '').toLowerCase(); const sel = new Set(data.inclusions || [])
    return all.filter(x => !sel.has(x.id) && (!s || x.name.toLowerCase().includes(s))).slice(0, 50)
      .map(x => ({ id: x.id, label: x.name, raw: { id: x.id, name: x.name } }))
  }
  const create = async (name) => {
    const r = await configApi.addInclusion(name)
    setAll(a => [...a, r.data])
    return { id: r.data.id, label: r.data.name, raw: { id: r.data.id, name: r.data.name } }
  }

  return (
    <TabCard style={{ padding: '20px 24px' }}>
      <p style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: '0 0 4px' }}>Inclusos no pacote</p>
      <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 14px' }}>
        Selecione o que está incluso neste roteiro. Digite para buscar; se não existir, dá pra criar na hora (fica salvo em Configurações › Inclusos).
      </p>
      <TagPicker popup placeholder="Buscar ou criar item incluso…" search={search} onCreate={create}
        selected={chips}
        onAdd={it => canEdit && add(it.id, it.raw)}
        onRemove={id => canEdit && remove(id)} />
    </TabCard>
  )
}

export default memo(InclusosTab)
