import { useRef } from 'react'

/* Campo de valor com MÁSCARA AO VIVO (padrão BR): o usuário digita e o número
 * já vai sendo formatado com ponto de milhar e vírgula decimal, preenchendo da
 * direita pra esquerda (estilo moeda). Emite o valor canônico (ex.: "1234.56")
 * para o estado — toda a matemática com Number() continua igual. */

// "1.234,56" | "1234,56" | "1234.56" -> "1234.56" (ponto decimal, sem milhar)
export function parseMoney(raw) {
  if (raw == null) return ''
  let s = String(raw).trim()
  if (!s) return ''
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  s = s.replace(/[^\d.]/g, '')
  const parts = s.split('.')
  if (parts.length > 2) s = parts[0] + '.' + parts.slice(1).join('')
  if (s === '' || s === '.') return ''
  const n = Number(s)
  return Number.isFinite(n) ? String(n) : ''
}

// "1234.56" -> "1.234,56"
export function formatMoney(value, { min = 2, max = 2 } = {}) {
  if (value === '' || value == null) return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max })
}

export default function MoneyInput({ value, onChange, style, placeholder, minDecimals = 2, maxDecimals = 2, ...rest }) {
  const ref = useRef(null)
  const decimals = maxDecimals
  const factor = 10 ** decimals

  const display = formatMoney(value, { min: decimals, max: decimals })

  const putCursorEnd = () => requestAnimationFrame(() => {
    const el = ref.current
    if (!el) return
    const end = el.value.length
    try { el.setSelectionRange(end, end) } catch { /* alguns tipos não suportam */ }
  })

  const handleChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '')
    const num = Number(digits)
    if (!digits || num === 0) {
      onChange('')                       // vazio ou tudo zero → limpa
    } else {
      const n = num / factor
      onChange(String(Number(n.toFixed(decimals))))
    }
    putCursorEnd()
  }

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode="numeric"
      style={style}
      placeholder={placeholder}
      value={display}
      onChange={handleChange}
    />
  )
}
