import { useState } from 'react'

/* Campo de valor que mostra o número formatado no padrão BR (1.234,56) quando
 * não está em foco e, ao clicar fora (blur), aplica os pontos de milhar e a
 * vírgula decimal certos. Enquanto digita, deixa o usuário escrever à vontade
 * (vírgula ou ponto) e emite o valor canônico (ex.: "1234.56") para o estado —
 * assim toda a matemática que usa Number() continua funcionando igual. */

// "1.234,56" | "1234,56" | "1234.56" -> "1234.56" (ponto decimal, sem milhar)
export function parseMoney(raw) {
  if (raw == null) return ''
  let s = String(raw).trim()
  if (!s) return ''
  if (s.includes(',')) {
    // vírgula é o separador decimal (BR) → remove os pontos de milhar
    s = s.replace(/\./g, '').replace(',', '.')
  }
  s = s.replace(/[^\d.]/g, '')
  // mantém só o primeiro ponto decimal
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
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')

  const display = focused ? text : formatMoney(value, { min: minDecimals, max: maxDecimals })

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      style={style}
      placeholder={placeholder}
      value={display}
      onFocus={(e) => {
        // edição livre: mostra com vírgula decimal e sem separador de milhar
        setText(value === '' || value == null ? '' : String(value).replace('.', ','))
        setFocused(true)
      }}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d.,]/g, '')
        setText(raw)
        onChange(parseMoney(raw))
      }}
      onBlur={() => {
        setFocused(false)
        onChange(parseMoney(text))
      }}
    />
  )
}
