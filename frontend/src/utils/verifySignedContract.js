import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/* Confere um documento assinado (foto/scan ou PDF) contra os dados do contrato.
 * PDF com camada de texto → leitura direta (precisa). Foto/scan → OCR (Tesseract,
 * best-effort: pode errar com baixa qualidade). Compara campo a campo. */

const norm = (s) => (s || '').toString().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim()
const digitsOf = (s) => (s || '').toString().replace(/\D/g, '')
const fmtDateBR = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).split('-'); return (y && m && d) ? `${d}/${m}/${y}` : '' }

async function ocr(source, onProgress) {
  const Tesseract = (await import('tesseract.js')).default
  const { data } = await Tesseract.recognize(source, 'por', {
    logger: m => { if (m.status === 'recognizing text' && onProgress) onProgress(m.progress) },
  })
  return data?.text || ''
}

async function extractText(file, onProgress) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (isPdf) {
    const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
    let text = ''
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent()
      text += ' ' + content.items.map(it => it.str).join(' ')
    }
    if (norm(text).length >= 80) return { text, ocr: false }   // PDF digital (tem texto)
    // PDF escaneado (sem camada de texto) → OCR das páginas renderizadas
    let out = ''
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const vp = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = vp.width; canvas.height = vp.height
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
      out += ' ' + await ocr(canvas, p => onProgress && onProgress((i - 1 + p) / doc.numPages))
    }
    return { text: out, ocr: true }
  }
  return { text: await ocr(file, onProgress), ocr: true }
}

function buildExpected(c) {
  const items = []
  const add = (label, value, kind = 'text') => { if (value != null && String(value).trim()) items.push({ label, value: String(value), kind }) }
  add('Reserva nº', c.reservation_number, 'digits')
  add('Contratante', c.contratante_data?.full_name || c.payer_name, 'name')
  add('Agência', c.agency_data?.name, 'name')
  add('Pacote', c.package_name, 'name')
  if (c.total_brl) add('Total (BRL)', c.total_brl, 'digits')
  if (c.total_usd) add('Total (USD)', c.total_usd, 'digits')
  const dep = fmtDateBR(c.departure_date), ret = fmtDateBR(c.return_date)
  if (dep) add('Data de início', dep, 'digits')
  if (ret) add('Data de término', ret, 'digits')
  ;(c.clauses_data || []).forEach(cl => add(`Cláusula: ${cl.name}`, cl.name, 'name'))
  return items
}

function matches(textNorm, textDigits, item) {
  if (item.kind === 'digits') {
    const d = digitsOf(item.value)
    return d.length >= 3 && textDigits.includes(d)
  }
  if (item.kind === 'name') {
    const tokens = norm(item.value).split(' ').filter(t => t.length >= 3)
    if (!tokens.length) return textNorm.includes(norm(item.value))
    return tokens.filter(t => textNorm.includes(t)).length / tokens.length >= 0.6
  }
  return textNorm.includes(norm(item.value))
}

export async function verifySignedContract(file, contract, onProgress) {
  const { text, ocr } = await extractText(file, onProgress)
  const textNorm = norm(text)
  const textDigits = digitsOf(text)
  const items = buildExpected(contract).map(it => ({ label: it.label, value: it.value, ok: matches(textNorm, textDigits, it) }))
  return { items, allOk: items.every(i => i.ok), ocr, readable: textNorm.length >= 20 }
}
