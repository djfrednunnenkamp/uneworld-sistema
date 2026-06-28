import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/* Visualizador próprio (PDF.js) — zoom instantâneo, sem recarregar, preservando a
 * posição e centralizando no que está sendo visto. Funciona com PDF e imagem. */
export default function SignedFileViewer({ url }) {
  const scrollRef  = useRef(null)
  const canvasWrap = useRef(null)
  const docRef     = useRef(null)
  const pending    = useRef(null)   // centro a restaurar após o re-render
  const renderSeq  = useRef(0)

  const [status, setStatus] = useState('loading')   // loading | pdf | image | error
  const [imageUrl, setImageUrl] = useState(null)
  const [imgNat, setImgNat] = useState({ w: 1 })
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1)
  const [baseScale, setBaseScale] = useState(1)      // escala que ajusta à largura (o "normal")

  const fitWidth = (naturalW) => {
    const cw = (scrollRef.current?.clientWidth || 820) - 40
    return Math.max(0.1, cw / naturalW)
  }

  // ── Carrega o arquivo e detecta o tipo ──
  useEffect(() => {
    let cancelled = false
    const objUrls = []
    ;(async () => {
      try {
        const resp = await fetch(url, { credentials: 'include' })
        if (!resp.ok) throw new Error('fetch')
        const blob = await resp.blob()
        if (cancelled) return
        if (/pdf/i.test(blob.type)) {
          const data = await blob.arrayBuffer()
          if (cancelled) return
          const doc = await pdfjsLib.getDocument({ data }).promise
          if (cancelled) { doc.destroy?.(); return }
          docRef.current = doc
          const page = await doc.getPage(1)
          const fit = fitWidth(page.getViewport({ scale: 1 }).width)
          setNumPages(doc.numPages)
          setBaseScale(fit); setScale(fit)
          setStatus('pdf')
        } else {
          const o = URL.createObjectURL(blob); objUrls.push(o)
          const img = new Image()
          img.onload = () => {
            if (cancelled) return
            const fit = fitWidth(img.naturalWidth)
            setImgNat({ w: img.naturalWidth })
            setBaseScale(fit); setScale(fit)
            setImageUrl(o); setStatus('image')
          }
          img.onerror = () => { if (!cancelled) setStatus('error') }
          img.src = o
        }
      } catch { if (!cancelled) setStatus('error') }
    })()
    return () => { cancelled = true; objUrls.forEach(u => URL.revokeObjectURL(u)); docRef.current?.destroy?.(); docRef.current = null }
  }, [url])

  const restoreCenter = () => {
    const el = scrollRef.current
    if (!el || !pending.current) return
    const { cx, cy } = pending.current
    el.scrollLeft = cx * el.scrollWidth - el.clientWidth / 2
    el.scrollTop  = cy * el.scrollHeight - el.clientHeight / 2
    pending.current = null
  }

  // ── Renderiza as páginas do PDF na escala atual (reaproveita os canvases) ──
  useEffect(() => {
    if (status !== 'pdf' || !docRef.current || !canvasWrap.current) return
    const seq = ++renderSeq.current
    const doc = docRef.current
    const container = canvasWrap.current
    const tasks = []
    ;(async () => {
      for (let i = 1; i <= numPages; i++) {
        if (seq !== renderSeq.current) return
        const page = await doc.getPage(i)
        const viewport = page.getViewport({ scale })
        let canvas = container.querySelector(`canvas[data-page="${i}"]`)
        if (!canvas) {
          canvas = document.createElement('canvas')
          canvas.setAttribute('data-page', String(i))
          canvas.style.cssText = 'display:block;margin:0 auto 14px;box-shadow:0 2px 14px rgba(0,0,0,.35);background:#fff'
          container.appendChild(canvas)
        }
        const dpr = window.devicePixelRatio || 1
        canvas.width  = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width  = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        const ctx = canvas.getContext('2d')
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        const task = page.render({ canvasContext: ctx, viewport })
        tasks.push(task)
        try { await task.promise } catch { /* cancelado */ }
      }
      if (seq === renderSeq.current) restoreCenter()
    })()
    return () => tasks.forEach(t => { try { t.cancel() } catch { /* noop */ } })
  }, [status, scale, numPages])

  // Para imagem o tamanho muda síncrono — restaura o centro após o layout.
  useLayoutEffect(() => { if (status === 'image') restoreCenter() }, [scale, status])

  // ── Zoom (preserva o centro do que está visível) ──
  const captureCenter = () => {
    const el = scrollRef.current
    if (!el) return
    pending.current = {
      cx: (el.scrollLeft + el.clientWidth / 2) / Math.max(el.scrollWidth, 1),
      cy: (el.scrollTop + el.clientHeight / 2) / Math.max(el.scrollHeight, 1),
    }
  }
  const zoomBy   = useCallback((f) => { captureCenter(); setScale(s => Math.min(Math.max(s * f, baseScale * 0.25), baseScale * 6)) }, [baseScale])
  const resetZoom = () => { captureCenter(); setScale(baseScale) }

  // Ctrl + scroll continua dando zoom (listener nativo p/ poder preventDefault)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e) => { if (!e.ctrlKey) return; e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1) }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  const pct = baseScale ? Math.round((scale / baseScale) * 100) : 100
  const zbtn = { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 'none', background: '#f1f5f9', color: '#1e293b', fontSize: 18, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1 }

  return (
    <div style={{ flex: 1, position: 'relative', background: '#3f4651', minHeight: 0 }}>
      <div ref={scrollRef} style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: 20 }}>
        {status === 'loading' && <p style={{ color: '#cbd5e1', textAlign: 'center', marginTop: 40, fontSize: 13 }}>Carregando documento…</p>}
        {status === 'error'   && <p style={{ color: '#fca5a5', textAlign: 'center', marginTop: 40, fontSize: 13 }}>Não foi possível carregar o documento.</p>}
        {status === 'pdf'   && <div ref={canvasWrap} />}
        {status === 'image' && imageUrl && (
          <img src={imageUrl} alt="Contrato assinado" style={{ width: imgNat.w * scale, display: 'block', margin: '0 auto', boxShadow: '0 2px 14px rgba(0,0,0,.35)', background: '#fff' }} />
        )}
      </div>

      {(status === 'pdf' || status === 'image') && (
        <div style={{ position: 'absolute', right: 16, bottom: 16, display: 'flex', alignItems: 'center', gap: 4, background: '#fff', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.3)', padding: 5 }}>
          <button onClick={() => zoomBy(1 / 1.2)} title="Diminuir zoom" style={zbtn}>−</button>
          <button onClick={resetZoom} title="Zoom normal (ajustar à largura)"
            style={{ minWidth: 58, height: 32, padding: '0 8px', borderRadius: 8, border: 'none', background: '#fff', color: '#475569', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {pct}%
          </button>
          <button onClick={() => zoomBy(1.2)} title="Aumentar zoom" style={zbtn}>+</button>
        </div>
      )}
    </div>
  )
}
