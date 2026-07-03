import { memo } from 'react'
import { toast } from 'sonner'
import { itinerariesApi } from '../../api'
import { TabCard } from './ui'
import ImageManager from './ImageManager'
import DocumentManager from './DocumentManager'

/* Aba "Imagens": capa + galeria do roteiro e documentos (PDF). Uploads são
   imediatos (actions do backend) e independem do botão Salvar. */
function ImagensTab({ data, setData, canEdit }) {
  const id = data.id

  const uploadImg = async (file) => {
    const r = await itinerariesApi.uploadImage(id, file, {})
    setData(d => ({ ...d, images: [...(d.images || []), r.data] }))
  }
  const deleteImg = async (imgId) => {
    try {
      await itinerariesApi.deleteImage(id, imgId)
      setData(d => ({ ...d, images: (d.images || []).filter(x => x.id !== imgId) }))
    } catch { toast.error('Falha ao excluir imagem.') }
  }
  const setCover = async (imgId) => {
    try {
      await itinerariesApi.setCover(id, imgId)
      setData(d => ({ ...d, images: (d.images || []).map(x => ({ ...x, is_cover: x.id === imgId })) }))
    } catch { toast.error('Falha ao definir a capa.') }
  }
  const uploadDoc = async (file) => {
    const r = await itinerariesApi.uploadDocument(id, file, {})
    setData(d => ({ ...d, documents: [...(d.documents || []), r.data] }))
  }
  const deleteDoc = async (docId) => {
    try {
      await itinerariesApi.deleteDocument(id, docId)
      setData(d => ({ ...d, documents: (d.documents || []).filter(x => x.id !== docId) }))
    } catch { toast.error('Falha ao excluir documento.') }
  }

  return (
    <>
      <TabCard style={{ padding: '20px 24px' }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: '0 0 4px' }}>Capa e galeria</p>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 16px' }}>A imagem marcada com ★ é a capa do roteiro (só uma). As demais formam a galeria.</p>
        <ImageManager images={data.images || []} canEdit={canEdit}
          onUpload={uploadImg} onDelete={deleteImg} onSetCover={setCover} />
      </TabCard>

      <TabCard style={{ padding: '20px 24px', marginTop: 20 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: '0 0 4px' }}>Documentos (PDF)</p>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 16px' }}>Anexe folhetos, programação ou condições em PDF.</p>
        <DocumentManager documents={data.documents || []} canEdit={canEdit}
          onUpload={uploadDoc} onDelete={deleteDoc} />
      </TabCard>
    </>
  )
}

export default memo(ImagensTab)
