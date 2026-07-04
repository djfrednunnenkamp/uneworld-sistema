import { memo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { itinerariesApi } from '../../api'
import { Ic } from '../Icon'
import { TabCard } from './ui'
import GalleryManager from './GalleryManager'
import ImageLightbox from './ImageLightbox'

const slotBox = { position: 'relative', width: '100%', maxWidth: 240, height: 150, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#f8fafc' }

/* Campo de uma única imagem (lâminas). Clicar abre o lightbox; aceita soltar
   um arquivo para upload automático. */
function SingleImageSlot({ image, canEdit, onUpload, onDelete, onView }) {
  const [busy, setBusy] = useState(false)
  const [fileOver, setFileOver] = useState(false)
  const ref = useRef(null)
  const upload = async (file) => {
    if (!file) return
    setBusy(true)
    try { await onUpload(file) } catch { toast.error('Falha ao enviar imagem.') } finally { setBusy(false) }
  }
  const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files')
  const onDrop = (e) => {
    if (canEdit && e.dataTransfer?.files?.length) { e.preventDefault(); upload(e.dataTransfer.files[0]) }
    setFileOver(false)
  }
  return (
    <div onDragOver={e => { if (canEdit && isFileDrag(e)) { e.preventDefault(); setFileOver(true) } }}
      onDragLeave={() => setFileOver(false)} onDrop={onDrop}
      style={{ borderRadius: 8, outline: fileOver ? '2px dashed #2e6db4' : 'none', outlineOffset: 4 }}>
      {image ? (
        <div style={slotBox}>
          <img src={image.image} alt="" onClick={() => onView?.(image.image)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }} />
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
      <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = (e.target.files || [])[0]; e.target.value = ''; upload(f) }} />
    </div>
  )
}

const cardTitle = { fontSize: 15, fontWeight: 700, color: '#1e293b', margin: '0 0 4px' }
const cardSub = { fontSize: 12, color: '#94a3b8', margin: '0 0 16px' }

/* Aba "Imagens": quatro cards em grade 2×2. À esquerda (largo) os carrosséis de
   Capas e Galeria; à direita as lâminas (imagem única). Arrastar arquivos para
   qualquer campo faz upload; clicar na imagem abre o lightbox. */
function ImagensTab({ data, setData, canEdit }) {
  const id = data.id
  const images = data.images || []
  const covers        = images.filter(im => im.kind === 'cover')
  const gallery       = images.filter(im => im.kind === 'gallery')
  const blocking      = images.find(im => im.kind === 'blocking') || null
  const blockingPromo = images.find(im => im.kind === 'blocking_promo') || null
  const [lightbox, setLightbox] = useState(null)

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

  const grid = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 20, alignItems: 'stretch' }

  return (
    <>
      <div style={grid}>
        <TabCard style={{ padding: '20px 24px' }}>
          <p style={cardTitle}>Capas do roteiro</p>
          <p style={cardSub}>Uma ou mais imagens de capa. Arraste para ordenar.</p>
          <GalleryManager images={covers} canEdit={canEdit} onView={setLightbox}
            onUpload={upload('cover')} onDelete={deleteImg} onReorder={reorder('cover')} />
        </TabCard>
        <TabCard style={{ padding: '20px 24px' }}>
          <p style={cardTitle}>Lâmina do Bloqueio</p>
          <p style={cardSub}>Imagem única.</p>
          <SingleImageSlot image={blocking} canEdit={canEdit} onView={setLightbox}
            onUpload={upload('blocking')} onDelete={deleteImg} />
        </TabCard>

        <TabCard style={{ padding: '20px 24px' }}>
          <p style={cardTitle}>Galeria de imagens</p>
          <p style={cardSub}>Imagens do roteiro. Arraste para ordenar.</p>
          <GalleryManager images={gallery} canEdit={canEdit} onView={setLightbox}
            onUpload={upload('gallery')} onDelete={deleteImg} onReorder={reorder('gallery')} />
        </TabCard>
        <TabCard style={{ padding: '20px 24px' }}>
          <p style={cardTitle}>Lâmina do Bloqueio Promocional</p>
          <p style={cardSub}>Imagem única.</p>
          <SingleImageSlot image={blockingPromo} canEdit={canEdit} onView={setLightbox}
            onUpload={upload('blocking_promo')} onDelete={deleteImg} />
        </TabCard>
      </div>

      <ImageLightbox url={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}

export default memo(ImagensTab)
