import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/* Visualizador próprio (PDF.js) — zoom instantâneo, sem recarregar, preservando a
 * posição e centralizando no que está sendo visto. Funciona com PDF e imagem. */
export default function SignedFileViewer({ url, annotations = [] }) {
  const scrollRef  = useRef(null)
  const canvasWrap = useRef(null)
  const imgRef     = useRef(null)
  const docRef     = useRef(null)
  const pending    = useRef(null)   // centro a restaurar após o re-render
  const renderSeq  = useRef(0)

  const [status, setStatus] = useState('loading')   // loading | pdf | image | error
  const [imageUrl, setImageUrl] = useState(null)
  const [imgNat, setImgNat] = useState({ w: 1 })
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1)
  const [baseScale, setBaseScale] = useState(1)      // escala que ajusta à largura (o "normal")
  const [pageRects, setPageRects] = useState([])     // posição/tamanho de cada página renderizada
  const [hover, setHover] = useState(null)           // tooltip da caixa destacada

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

  // ── Mede a posição/tamanho de cada página (p/ ancorar as caixas destacadas) ──
  const measure = useCallback(() => {
    if (status === 'pdf' && canvasWrap.current) {
      const rects = []
      canvasWrap.current.querySelectorAll('canvas[data-page]').forEach(cv => {
        rects.push({ page: Number(cv.getAttribute('data-page')), left: cv.offsetLeft, top: cv.offsetTop, width: cv.clientWidth, height: cv.clientHeight })
      })
      setPageRects(rects)
    } else if (status === 'image' && imgRef.current) {
      const im = imgRef.current
      setPageRects([{ page: 1, left: im.offsetLeft, top: im.offsetTop, width: im.clientWidth, height: im.clientHeight }])
    }
  }, [status])

  // Re-mede quando muda escala/páginas/anotações (após o layout assentar).
  useEffect(() => {
    if (!annotations.length) return
    const id = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(id)
  }, [measure, scale, numPages, annotations, imageUrl])

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
      if (seq === renderSeq.current) { restoreCenter(); requestAnimationFrame(measure) }
    })()
    return () => tasks.forEach(t => { try { t.cancel() } catch { /* noop */ } })
  }, [status, scale, numPages, measure])

  // Para imagem o tamanho muda síncrono — restaura o centro após o layout.
  useLayoutEffect(() => { if (status === 'image') { restoreCenter(); measure() } }, [scale, status, measure])

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
          <img ref={imgRef} src={imageUrl} alt="Contrato assinado" style={{ width: imgNat.w * scale, display: 'block', margin: '0 auto', boxShadow: '0 2px 14px rgba(0,0,0,.35)', background: '#fff' }} />
        )}

        {/* Caixas destacadas sobre o documento (campos errados / assinatura) */}
        {(status === 'pdf' || status === 'image') && annotations.length > 0 && pageRects.length > 0 && (
          <div style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 5 }}>
            {annotations.map((a, i) => {
              const pr = pageRects.find(p => p.page === (a.page ?? 1))
              if (!pr || !a.box) return null
              const [x0, y0, x1, y1] = a.box
              const left = pr.left + x0 * pr.width
              const top  = pr.top + y0 * pr.height
              const w = Math.max(8, (x1 - x0) * pr.width)
              const h = Math.max(8, (y1 - y0) * pr.height)
              return (
                <div key={i}
                  onMouseEnter={e => setHover({ x: e.clientX, y: e.clientY, a })}
                  onMouseMove={e => setHover(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : prev)}
                  onMouseLeave={() => setHover(null)}
                  style={{ position: 'absolute', left, top, width: w, height: h, border: `2.5px solid ${a.color}`, borderRadius: 5, background: `${a.color}1f`, boxShadow: `0 0 0 2px ${a.color}33, 0 4px 14px ${a.color}44`, pointerEvents: 'auto', cursor: 'help', transition: 'background .12s' }}
                  onMouseOver={e => { e.currentTarget.style.background = `${a.color}33` }}
                  onMouseOut={e => { e.currentTarget.style.background = `${a.color}1f` }} />
              )
            })}
          </div>
        )}
      </div>

      {/* Tooltip elegante ao passar o mouse sobre uma caixa */}
      {hover && (
        <div style={{ position: 'fixed', left: Math.min(hover.x + 14, window.innerWidth - 280), top: hover.y + 16, zIndex: 9999, pointerEvents: 'none', maxWidth: 264, background: 'rgba(15,23,42,.97)', color: '#fff', borderRadius: 10, padding: '10px 13px', boxShadow: '0 12px 34px rgba(0,0,0,.4)', border: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: hover.a.sub ? 5 : 0 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: hover.a.color, flexShrink: 0, boxShadow: `0 0 8px ${hover.a.color}` }} />
            <span style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.2 }}>{hover.a.label}</span>
          </div>
          {hover.a.sub && <p style={{ margin: 0, fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.45 }}>{hover.a.sub}</p>}
        </div>
      )}

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
