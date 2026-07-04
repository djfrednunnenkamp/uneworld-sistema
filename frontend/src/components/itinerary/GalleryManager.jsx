import { memo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Ic } from '../Icon'

/* Grade de imagens (Capas ou Galeria) com:
   - upload por botão ou ARRASTAR ARQUIVOS de fora;
   - reordenar arrastando imagens dentro do mesmo campo;
   - MOVER entre campos: arrastar uma imagem para outro campo (capa↔galeria↔lâmina)
     muda o tipo dela (via onMoveKind);
   - clicar numa imagem abre o lightbox (onView).

   Props:
     images  [{ id, image, caption }]  — já na ordem atual
     kind    string                     — tipo deste campo ('cover' | 'gallery')
     canEdit
     onUpload   (file) => Promise
     onDelete   (id)   => Promise
     onReorder  (ids)  => void
     onMoveKind (id, targetKind) => void  — imagem de outro campo solta aqui
     onView     (url)  => void
*/
function GalleryManager({ images = [], kind, canEdit, onUpload, onDelete, onReorder, onMoveKind, onView }) {
  const [busy, setBusy] = useState(false)
  const [draggingId, setDraggingId] = useState(null)
  const [overId, setOverId] = useState(null)
  const [dropActive, setDropActive] = useState(false)
  const fileRef = useRef(null)

  const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files')
  const hasImgPayload = (e) => Array.from(e.dataTransfer?.types || []).includes('text/plain')
  const readPayload = (e) => { try { return JSON.parse(e.dataTransfer.getData('text/plain')) } catch { return null } }

  const uploadList = async (list) => {
    const files = Array.from(list || [])
    if (!files.length) return
    setBusy(true)
    try { for (const f of files) await onUpload(f) }
    catch { toast.error('Falha ao enviar imagem.') }
    finally { setBusy(false) }
  }

  const reorderTo = (fromId, targetId) => {
    const ids = images.map(im => im.id)
    const from = ids.indexOf(fromId), to = ids.indexOf(targetId)
    if (from < 0 || to < 0 || from === to) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    onReorder(ids)
  }

  const onThumbDragStart = (e, im) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: im.id, kind }))
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(im.id)
  }
  const onThumbDrop = (e, targetId) => {
    if (isFileDrag(e)) return   // arquivos: tratados pelo container
    const p = readPayload(e); setOverId(null)
    if (!p) return
    if (p.kind === kind) { e.preventDefault(); e.stopPropagation(); reorderTo(p.id, targetId) }
    // tipo diferente → deixa borbulhar para o container (mover de campo)
  }

  const onContainerDragOver = (e) => {
    if (!canEdit) return
    if (isFileDrag(e)) { e.preventDefault(); setDropActive(true) }
    else if (hasImgPayload(e)) { e.preventDefault(); setDropActive(true) }
  }
  const onContainerDrop = (e) => {
    setDropActive(false); setOverId(null); setDraggingId(null)
    if (!canEdit) return
    if (isFileDrag(e)) { if (e.dataTransfer.files?.length) { e.preventDefault(); uploadList(e.dataTransfer.files) } return }
    const p = readPayload(e)
    if (p && p.kind !== kind) { e.preventDefault(); onMoveKind?.(p.id, kind) }
  }

  const thumb = { position: 'relative', width: 120, height: 90, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0 }

  return (
    <div onDragOver={onContainerDragOver} onDragLeave={() => setDropActive(false)} onDrop={onContainerDrop}
      style={{ borderRadius: 8, outline: dropActive ? '2px dashed #2e6db4' : 'none', outlineOffset: 4 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {images.map(im => (
          <div key={im.id}
            draggable={canEdit}
            onDragStart={e => onThumbDragStart(e, im)}
            onDragOver={e => { if (isFileDrag(e)) return; e.preventDefault(); if (overId !== im.id) setOverId(im.id) }}
            onDragEnd={() => { setDraggingId(null); setOverId(null) }}
            onDrop={e => onThumbDrop(e, im.id)}
            style={{ ...thumb, cursor: canEdit ? 'grab' : 'zoom-in',
                     outline: overId === im.id && draggingId != null ? '2px solid #2e6db4' : 'none',
                     opacity: draggingId === im.id ? 0.4 : 1 }}>
            <img src={im.image} alt={im.caption || ''} draggable={false} onClick={() => onView?.(im.image)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }} />
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
      {canEdit && <p style={{ fontSize: 12, color: '#94a3b8', margin: '10px 0 0' }}>Arraste para reordenar, mover para outro campo, ou solte arquivos aqui.</p>}
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => { const l = e.target.files; e.target.value = ''; uploadList(l) }} />
    </div>
  )
}

export default memo(GalleryManager)
