import { memo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { itinerariesApi } from '../../api'
import { Ic } from '../Icon'
import { TabCard } from './ui'
import GalleryManager from './GalleryManager'

const slotBox = { position: 'relative', width: 200, height: 130, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0 }

/* Campo de uma única imagem (lâminas). Mostra a imagem com excluir, ou o upload. */
function SingleImageSlot({ label, image, canEdit, onUpload, onDelete }) {
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  const pick = async (e) => {
    const f = (e.target.files || [])[0]; e.target.value = ''
    if (!f) return
    setBusy(true)
    try { await onUpload(f) } catch { toast.error('Falha ao enviar imagem.') } finally { setBusy(false) }
  }
  return (
    <div style={{ minWidth: 0 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>{label}</p>
      {image ? (
        <div style={slotBox}>
          <img src={image.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {canEdit && (
            <button type="button" title="Excluir" onClick={() => onDelete(image.id)}
              style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 6, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'rgba(220,38,38,.92)', color: '#fff' }}>
              <Ic n="x" s={12} />
            </button>
          )}
        </div>
      ) : canEdit ? (
        <button type="button" onClick={() => ref.current?.click()} disabled={busy}
          style={{ ...slotBox, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: '#64748b', cursor: busy ? 'wait' : 'pointer', borderStyle: 'dashed' }}>
          <Ic n={busy ? 'clock' : 'plus'} s={20} />
          <span style={{ fontSize: 11.5, fontWeight: 600 }}>{busy ? 'Enviando…' : 'Adicionar'}</span>
        </button>
      ) : <p style={{ fontSize: 12.5, color: '#94a3b8', margin: 0 }}>Sem imagem.</p>}
      <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }} onChange={pick} />
    </div>
  )
}

/* Aba "Imagens": duas linhas. Cada uma tem à esquerda um carrossel (Capas /
   Galeria, com upload múltiplo e reordenar por arrastar) e à direita um campo
   de imagem única (Lâmina do Bloqueio / Lâmina do Bloqueio Promocional). */
function ImagensTab({ data, setData, canEdit }) {
  const id = data.id
  const images = data.images || []
  const covers        = images.filter(im => im.kind === 'cover')
  const gallery       = images.filter(im => im.kind === 'gallery')
  const blocking      = images.find(im => im.kind === 'blocking') || null
  const blockingPromo = images.find(im => im.kind === 'blocking_promo') || null

  const upload = (kind) => async (file) => {
    const r = await itinerariesApi.uploadImage(id, file, { kind })
    setData(d => ({ ...d, images: [...(d.images || []), r.data] }))
  }
  const deleteImg = async (imgId) => {
    try {
      await itinerariesApi.deleteImage(id, imgId)
      setData(d => ({ ...d, images: (d.images || []).filter(x => x.id !== imgId) }))
    } catch { toast.error('Falha ao excluir imagem.') }
  }
  const reorder = (kind) => (ids) => {
    setData(d => {
      const byId = new Map((d.images || []).map(im => [im.id, im]))
      const reordered = ids.map(i => byId.get(i)).filter(Boolean)
      const others = (d.images || []).filter(im => im.kind !== kind)
      return { ...d, images: [...others, ...reordered] }
    })
    itinerariesApi.reorderImages(id, ids).catch(() => toast.error('Falha ao reordenar.'))
  }

  const rowStyle = { display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }

  return (
    <>
      <TabCard style={{ padding: '20px 24px' }}>
        <div style={rowStyle}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: '0 0 4px' }}>Capas do roteiro</p>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 16px' }}>Uma ou mais imagens de capa. Arraste para ordenar.</p>
            <GalleryManager images={covers} canEdit={canEdit}
              onUpload={upload('cover')} onDelete={deleteImg} onReorder={reorder('cover')} />
          </div>
          <SingleImageSlot label="Lâmina do Bloqueio" image={blocking} canEdit={canEdit}
            onUpload={upload('blocking')} onDelete={deleteImg} />
        </div>
      </TabCard>

      <TabCard style={{ padding: '20px 24px', marginTop: 20 }}>
        <div style={rowStyle}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: '0 0 4px' }}>Galeria de imagens</p>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 16px' }}>Imagens do roteiro. Arraste para ordenar.</p>
            <GalleryManager images={gallery} canEdit={canEdit}
              onUpload={upload('gallery')} onDelete={deleteImg} onReorder={reorder('gallery')} />
          </div>
          <SingleImageSlot label="Lâmina do Bloqueio Promocional" image={blockingPromo} canEdit={canEdit}
            onUpload={upload('blocking_promo')} onDelete={deleteImg} />
        </div>
      </TabCard>
    </>
  )
}

export default memo(ImagensTab)
