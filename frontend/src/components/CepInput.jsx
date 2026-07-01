import { useRef } from 'react'

/* Máscara de CEP: só números, no máximo 8 dígitos, com o traço automático
 * (formato XXXXX-XXX). Emite o valor formatado via onChange(value). */
function maskCep(raw) {
  const d = String(raw).replace(/\D/g, '').slice(0, 8)
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`
}

function cursorPosForDigits(masked, digitCount) {
  let count = 0
  for (let i = 0; i < masked.length; i++) {
    if (count >= digitCount) return i
    if (/\d/.test(masked[i])) count++
  }
  return masked.length
}

/**
 * CepInput — campo de CEP com máscara XXXXX-XXX (só números, máx. 8 dígitos).
 * Props: value (string), onChange (v: string) => void. Demais props (className,
 * placeholder, onKeyDown, onBlur, style, disabled…) passam direto pro <input>.
 */
export default function CepInput({ value, onChange, className = 'fi', ...rest }) {
  const inputRef = useRef(null)

  const handleChange = (e) => {
    const el = e.target
    const digitsBefore = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/\D/g, '').length
    const masked = maskCep(el.value)
    onChange(masked)
    requestAnimationFrame(() => {
      const inp = inputRef.current
      if (!inp) return
      const pos = cursorPosForDigits(masked, digitsBefore)
      inp.setSelectionRange(pos, pos)
    })
  }

  return (
    <input
      ref={inputRef}
      className={className}
      value={maskCep(value ?? '')}
      onChange={handleChange}
      inputMode="numeric"
      maxLength={9}
      placeholder="00000-000"
      {...rest}
    />
  )
}
