import { memo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { itinerariesApi } from '../../api'
import { Ic } from '../Icon'
import { TabCard } from './ui'
import GalleryManager from './GalleryManager'

/* Aba "Imagens": duas áreas separadas — Capa (uma imagem) e Galeria (várias,
   com reordenação por arrastar). Uploads são imediatos (actions do backend). */
function ImagensTab({ data, setData, canEdit }) {
  const id = data.id
  const images = data.images || []
  const cover = images.find(im => im.is_cover) || null
  const gallery = images.filter(im => !im.is_cover)

  const [coverBusy, setCoverBusy] = useState(false)
  const coverRef = useRef(null)

  const uploadCover = async (e) => {
    const file = (e.target.files || [])[0]
    e.target.value = ''
    if (!file) return
    setCoverBusy(true)
    try {
      const r = await itinerariesApi.uploadImage(id, file, { is_cover: true })
      setData(d => ({ ...d, images: [...(d.images || []).map(x => ({ ...x, is_cover: false })), r.data] }))
    } catch { toast.error('Falha ao enviar a capa.') }
    finally { setCoverBusy(false) }
  }

  const uploadGallery = async (file) => {
    const r = await itinerariesApi.uploadImage(id, file, {})
    setData(d => ({ ...d, images: [...(d.images || []), r.data] }))
  }
  const deleteImg = async (imgId) => {
    try {
      await itinerariesApi.deleteImage(id, imgId)
      setData(d => ({ ...d, images: (d.images || []).filter(x => x.id !== imgId) }))
    } catch { toast.error('Falha ao excluir imagem.') }
  }
  const reorderGallery = (ids) => {
    setData(d => {
      const byId = new Map((d.images || []).map(im => [im.id, im]))
      const reordered = ids.map(i => byId.get(i)).filter(Boolean)
      const cov = (d.images || []).filter(im => im.is_cover)
      return { ...d, images: [...cov, ...reordered] }
    })
    itinerariesApi.reorderImages(id, ids).catch(() => toast.error('Falha ao reordenar.'))
  }

  const thumb = { position: 'relative', width: 160, height: 120, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0 }

  return (
    <>
      <TabCard style={{ padding: '20px 24px' }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: '0 0 4px' }}>Capa do roteiro</p>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 16px' }}>Uma imagem de destaque, usada como capa do roteiro.</p>
        {cover ? (
          <div style={thumb}>
            <img src={cover.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            {canEdit && (
              <button type="button" title="Excluir capa" onClick={() => deleteImg(cover.id)}
                style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 6, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'rgba(220,38,38,.92)', color: '#fff' }}>
                <Ic n="x" s={12} />
              </button>
            )}
          </div>
        ) : canEdit ? (
          <button type="button" onClick={() => coverRef.current?.click()} disabled={coverBusy}
            style={{ ...thumb, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: '#64748b', cursor: coverBusy ? 'wait' : 'pointer', borderStyle: 'dashed' }}>
            <Ic n={coverBusy ? 'clock' : 'plus'} s={20} />
            <span style={{ fontSize: 11.5, fontWeight: 600 }}>{coverBusy ? 'Enviando…' : 'Adicionar capa'}</span>
          </button>
        ) : (
          <p style={{ fontSize: 12.5, color: '#94a3b8', margin: 0 }}>Sem capa.</p>
        )}
        <input ref={coverRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={uploadCover} />
      </TabCard>

      <TabCard style={{ padding: '20px 24px', marginTop: 20 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: '0 0 4px' }}>Galeria de imagens</p>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 16px' }}>Imagens do roteiro. Arraste para ordenar.</p>
        <GalleryManager images={gallery} canEdit={canEdit}
          onUpload={uploadGallery} onDelete={deleteImg} onReorder={reorderGallery} />
      </TabCard>
    </>
  )
}

export default memo(ImagensTab)
