import { memo } from 'react'
import { toast } from 'sonner'
import { itinerariesApi } from '../../api'
import Dropdown from '../Dropdown'
import { Ic } from '../Icon'
import { TabCard } from './ui'
import { inp } from './constants'
import ImageManager from './ImageManager'

/* Aba "Roteiro Dia a Dia": estrutura repetível — dia (posição), título, descrição,
   cidade (dentre as cidades do roteiro) e imagens do dia. O número do dia é a
   posição na lista (renumerado ao salvar). Imagens do dia sobem via action e só
   ficam disponíveis depois que o dia foi salvo (tem id). */
function DiaADiaTab({ data, setData, canEdit }) {
  const days = data.days || []
  const cityOptions = (data.cities_data || []).map(c => ({
    value: c.id, label: c.country_name ? `${c.name} · ${c.country_name}` : c.name,
  }))

  const updateDay = (i, patch) => setData(d => ({ ...d, days: d.days.map((x, j) => j === i ? { ...x, ...patch } : x) }))
  const addDay    = () => setData(d => ({ ...d, days: [...(d.days || []), { title: '', description: '', city: null, images: [] }] }))
  const removeDay = (i) => setData(d => ({ ...d, days: (d.days || []).filter((_, j) => j !== i) }))

  const uploadDayImg = (i, dayId) => async (file) => {
    const r = await itinerariesApi.uploadImage(data.id, file, { day: dayId })
    setData(d => ({ ...d, days: d.days.map((x, j) => j === i ? { ...x, images: [...(x.images || []), r.data] } : x) }))
  }
  const deleteDayImg = (i) => async (imgId) => {
    try {
      await itinerariesApi.deleteImage(data.id, imgId)
      setData(d => ({ ...d, days: d.days.map((x, j) => j === i ? { ...x, images: (x.images || []).filter(y => y.id !== imgId) } : x) }))
    } catch { toast.error('Falha ao excluir imagem do dia.') }
  }

  return (
    <TabCard style={{ padding: '20px 24px' }}>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px' }}>
        Cada bloco é um dia do itinerário. A cidade é escolhida entre as cidades do roteiro (aba Destinos).
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {days.map((day, i) => (
          <div key={day.id || `new-${i}`} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#1a2d4f', background: '#eef2f8', borderRadius: 6, padding: '4px 10px', flexShrink: 0 }}>Dia {i + 1}</span>
              <input style={{ ...inp, flex: 1 }} value={day.title || ''} disabled={!canEdit} placeholder="Título do dia (ex.: Chegada a Roma)"
                onChange={e => updateDay(i, { title: e.target.value })} />
              <div style={{ width: 220, flexShrink: 0 }}>
                <Dropdown value={day.city ?? null} options={cityOptions} disabled={!canEdit} searchable clearable
                  placeholder={cityOptions.length ? 'Cidade do dia' : 'Adicione cidades em Destinos'}
                  onChange={v => updateDay(i, { city: v || null })} />
              </div>
              {canEdit && (
                <button type="button" title="Remover dia" onClick={() => removeDay(i)}
                  style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 6, border: '1px solid #fee2e2', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ic n="trash" s={14} />
                </button>
              )}
            </div>
            <textarea style={{ ...inp, minHeight: 70, resize: 'vertical', marginBottom: 12 }} value={day.description || ''} disabled={!canEdit}
              placeholder="Descrição do dia" onChange={e => updateDay(i, { description: e.target.value })} />
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Imagens do dia</div>
            <ImageManager images={day.images || []} canEdit={canEdit}
              onUpload={uploadDayImg(i, day.id)} onDelete={deleteDayImg(i)}
              disabledHint={day.id ? undefined : 'Salve o roteiro para poder anexar imagens a este dia.'} />
          </div>
        ))}
        {days.length === 0 && <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Nenhum dia adicionado ainda.</p>}
        {canEdit && (
          <button type="button" onClick={addDay}
            style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 7, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Ic n="plus" s={13} /> Adicionar dia
          </button>
        )}
      </div>
    </TabCard>
  )
}

export default memo(DiaADiaTab)
