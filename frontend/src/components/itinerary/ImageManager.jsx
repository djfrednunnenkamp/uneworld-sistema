import { memo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Ic } from '../Icon'

/* Grade reutilizável de imagens com upload/exclusão e (opcional) definição de capa.
   Usada pela aba Imagens (galeria, com capa) e por cada dia do dia-a-dia (sem capa).
   Uploads são imediatos (chamam onUpload → API); o pai atualiza a lista com o retorno.

   Props:
     images     [{ id, image, caption, is_cover }]
     canEdit
     onUpload   (file) => Promise           — sobe 1 arquivo, resolve com o item criado
     onDelete   (id)   => Promise
     onSetCover (id)   => Promise            — opcional; se ausente, sem UI de capa
     disabledHint string                     — se presente, esconde o upload e mostra a dica
*/
function ImageManager({ images = [], canEdit, onUpload, onDelete, onSetCover, disabledHint }) {
  const [busy, setBusy] = useState(false)
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

  const thumb = { position: 'relative', width: 120, height: 90, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0 }
  const cornerBtn = { position: 'absolute', top: 4, width: 22, height: 22, borderRadius: 6, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 12 }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {images.map(im => (
          <div key={im.id} style={thumb}>
            <img src={im.image} alt={im.caption || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            {onSetCover && (
              <button type="button" title={im.is_cover ? 'Capa atual' : 'Definir como capa'} disabled={!canEdit || im.is_cover}
                onClick={() => onSetCover(im.id)}
                style={{ ...cornerBtn, left: 4, background: im.is_cover ? '#f59e0b' : 'rgba(255,255,255,.9)', color: im.is_cover ? '#fff' : '#64748b' }}>★</button>
            )}
            {canEdit && (
              <button type="button" title="Excluir" onClick={() => onDelete(im.id)}
                style={{ ...cornerBtn, right: 4, background: 'rgba(220,38,38,.92)', color: '#fff' }}>
                <Ic n="x" s={12} />
              </button>
            )}
            {im.is_cover && (
              <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(245,158,11,.92)', color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'center', padding: '2px 0', letterSpacing: '.04em' }}>CAPA</span>
            )}
          </div>
        ))}
        {canEdit && !disabledHint && (
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
            style={{ ...thumb, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: '#64748b', cursor: busy ? 'wait' : 'pointer', borderStyle: 'dashed' }}>
            <Ic n={busy ? 'clock' : 'plus'} s={18} />
            <span style={{ fontSize: 11, fontWeight: 600 }}>{busy ? 'Enviando…' : 'Adicionar'}</span>
          </button>
        )}
      </div>
      {disabledHint && <p style={{ fontSize: 12.5, color: '#94a3b8', margin: '10px 0 0' }}>{disabledHint}</p>}
      {images.length === 0 && !canEdit && <p style={{ fontSize: 12.5, color: '#94a3b8', margin: '10px 0 0' }}>Nenhuma imagem.</p>}
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFiles} />
    </div>
  )
}

export default memo(ImageManager)
