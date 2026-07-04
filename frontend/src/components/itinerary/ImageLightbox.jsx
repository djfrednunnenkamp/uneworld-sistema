import { Ic } from '../Icon'

/* Baixa a imagem forçando download (blob); se falhar (CORS), abre em nova aba. */
async function downloadImage(url, name) {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name || 'imagem'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  } catch { window.open(url, '_blank') }
}

/* Pop-up que mostra a imagem em tamanho maior, com botão de baixar. */
export default function ImageLightbox({ url, onClose }) {
  if (!url) return null
  const name = (url.split('/').pop() || 'imagem').split('?')[0]
  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mbox" style={{ maxWidth: 760, width: '100%' }} onClick={e => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">Imagem</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15} /></button>
        </div>
        <div className="mbody" style={{ maxHeight: 'none', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#0f172a' }}>
          <img src={url} alt="" style={{ maxWidth: '100%', maxHeight: '64vh', objectFit: 'contain', display: 'block' }} />
        </div>
        <div className="mfoot">
          <button className="btn btn-primary" onClick={() => downloadImage(url, name)}>
            <Ic n="download" s={14} /> Baixar imagem
          </button>
        </div>
      </div>
    </div>
  )
}
