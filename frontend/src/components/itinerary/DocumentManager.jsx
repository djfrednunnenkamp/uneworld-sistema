import { memo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Ic } from '../Icon'

/* Lista reutilizável de documentos (PDF) com upload/exclusão. Uploads imediatos.
   Props:
     documents [{ id, file, title }]
     canEdit
     onUpload (file) => Promise
     onDelete (id)   => Promise
*/
function DocumentManager({ documents = [], canEdit, onUpload, onDelete }) {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setBusy(true)
    try { for (const f of files) await onUpload(f) }
    catch { toast.error('Falha ao enviar documento.') }
    finally { setBusy(false) }
  }

  const fileName = (url = '') => { try { return decodeURIComponent(url.split('/').pop().split('?')[0]) } catch { return url } }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {documents.map(doc => (
          <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 12px', background: '#fff' }}>
            <span style={{ width: 30, height: 30, borderRadius: 6, background: '#fef2f2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Ic n="feather" s={15} /></span>
            <a href={doc.file} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: '#1e293b', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {doc.title || fileName(doc.file)}
            </a>
            {canEdit && (
              <button type="button" title="Excluir" onClick={() => onDelete(doc.id)}
                style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 6, border: '1px solid #fee2e2', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Ic n="trash" s={13} />
              </button>
            )}
          </div>
        ))}
        {documents.length === 0 && <p style={{ fontSize: 12.5, color: '#94a3b8', margin: 0 }}>Nenhum documento anexado.</p>}
      </div>
      {canEdit && (
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
          style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 7, border: '1px dashed #cbd5e1', background: '#fafbfc', color: '#1a2d4f', fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
          <Ic n={busy ? 'clock' : 'plus'} s={13} /> {busy ? 'Enviando…' : 'Adicionar PDF'}
        </button>
      )}
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple style={{ display: 'none' }} onChange={handleFiles} />
    </div>
  )
}

export default memo(DocumentManager)
