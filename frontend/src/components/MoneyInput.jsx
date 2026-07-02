import { useState, useEffect, useLayoutEffect, useRef } from 'react'

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

// Mesmo número? (ignora forma da string: "5" == "5.00" == "" vs vazio)
function sameValue(a, b) {
  const ea = a === '' || a == null
  const eb = b === '' || b == null
  if (ea || eb) return ea === eb
  return Number(a) === Number(b)
}

export default function MoneyInput({ value, onChange, style, placeholder, minDecimals = 2, maxDecimals = 2, ...rest }) {
  const decimals = maxDecimals
  const factor = 10 ** decimals

  // O texto exibido é ESTADO LOCAL — atualizado na hora dentro do onChange. Assim
  // o input não "reverte" pro valor da prop (que chega async pelo pai) a cada
  // tecla, que era o que fazia a tela piscar e o cursor pular. O valor canônico
  // (ex.: "1234.56") continua indo pro pai normalmente.
  const [display, setDisplay] = useState(() => formatMoney(value, { min: decimals, max: decimals }))
  const lastCanonical = useRef(value)
  const ref = useRef(null)

  // Máscara direita→esquerda: o caret fica sempre no fim. Feito ANTES do paint
  // (useLayoutEffect) e só quando o campo está focado — sem flash e sem o "pulo"
  // que o requestAnimationFrame causava.
  useLayoutEffect(() => {
    const el = ref.current
    if (el && document.activeElement === el) {
      const end = el.value.length
      try { el.setSelectionRange(end, end) } catch { /* alguns tipos não suportam */ }
    }
  }, [display])

  // Ressincroniza SÓ quando o valor muda por FORA (reset do form, aplicar
  // sugestão, cálculo automático) — não durante a digitação.
  useEffect(() => {
    if (!sameValue(value, lastCanonical.current)) {
      setDisplay(formatMoney(value, { min: decimals, max: decimals }))
      lastCanonical.current = value
    }
  }, [value, decimals])

  const handleChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '')
    const num = Number(digits)
    let canonical
    if (!digits || num === 0) {
      canonical = ''                       // vazio ou tudo zero → limpa
      setDisplay('')
    } else {
      const n = num / factor
      canonical = String(Number(n.toFixed(decimals)))
      setDisplay(formatMoney(canonical, { min: decimals, max: decimals }))
    }
    lastCanonical.current = canonical
    onChange(canonical)
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
