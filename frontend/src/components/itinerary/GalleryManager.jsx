import { memo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Ic } from '../Icon'

/* Grade de imagens da GALERIA com upload, exclusão e reordenação por arrastar
   (drag & drop nativo). A ordem é persistida via onReorder(ids).

   Props:
     images    [{ id, image, caption }] — já na ordem atual
     canEdit
     onUpload  (file) => Promise         — sobe 1 arquivo, resolve com o item criado
     onDelete  (id)   => Promise
     onReorder (ids)  => void            — nova ordem (array de ids)
*/
function GalleryManager({ images = [], canEdit, onUpload, onDelete, onReorder }) {
  const [busy, setBusy] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  const fileRef = useRef(null)

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setBusy(true)
    try { for (const f of files) await onUpload(f) }
    catch { toast.error('Falha ao enviar imagem.') }
    finally { setBusy(false) }
  }

  const drop = (targetId) => {
    if (dragId == null || dragId === targetId) { setDragId(null); setOverId(null); return }
    const ids = images.map(im => im.id)
    const from = ids.indexOf(dragId), to = ids.indexOf(targetId)
    if (from < 0 || to < 0) { setDragId(null); setOverId(null); return }
    ids.splice(to, 0, ids.splice(from, 1)[0])
    onReorder(ids)
    setDragId(null); setOverId(null)
  }

  const thumb = { position: 'relative', width: 120, height: 90, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0 }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {images.map(im => (
          <div key={im.id}
            draggable={canEdit}
            onDragStart={() => setDragId(im.id)}
            onDragOver={e => { e.preventDefault(); if (overId !== im.id) setOverId(im.id) }}
            onDragEnd={() => { setDragId(null); setOverId(null) }}
            onDrop={e => { e.preventDefault(); drop(im.id) }}
            style={{ ...thumb, cursor: canEdit ? 'grab' : 'default',
                     outline: overId === im.id && dragId != null ? '2px solid #2e6db4' : 'none',
                     opacity: dragId === im.id ? 0.4 : 1 }}>
            <img src={im.image} alt={im.caption || ''} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            {canEdit && (
              <button type="button" title="Excluir" onClick={() => onDelete(im.id)}
                style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 6, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'rgba(220,38,38,.92)', color: '#fff' }}>
                <Ic n="x" s={12} />
              </button>
            )}
          </div>
        ))}
        {canEdit && (
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
            style={{ ...thumb, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: '#64748b', cursor: busy ? 'wait' : 'pointer', borderStyle: 'dashed' }}>
            <Ic n={busy ? 'clock' : 'plus'} s={18} />
            <span style={{ fontSize: 11, fontWeight: 600 }}>{busy ? 'Enviando…' : 'Adicionar'}</span>
          </button>
        )}
      </div>
      {images.length === 0 && !canEdit && <p style={{ fontSize: 12.5, color: '#94a3b8', margin: '10px 0 0' }}>Nenhuma imagem.</p>}
      {images.length > 1 && canEdit && <p style={{ fontSize: 12, color: '#94a3b8', margin: '10px 0 0' }}>Arraste as imagens para mudar a ordem.</p>}
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFiles} />
    </div>
  )
}

export default memo(GalleryManager)
