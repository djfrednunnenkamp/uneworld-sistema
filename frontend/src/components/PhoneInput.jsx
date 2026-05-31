import { useRef } from 'react'

function maskPhone(raw) {
  const d = raw.replace(/\D/g, '').slice(0, 13)
  const n = d.length
  if (n === 0)  return ''
  if (n === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`
  if (n === 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`
  if (n === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
  if (n === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
  if (n === 9)  return `${d.slice(0,5)}-${d.slice(5)}`
  if (n === 8)  return `${d.slice(0,4)}-${d.slice(4)}`
  if (n <= 2)   return d
  if (n <= 6)   return `(${d.slice(0,2)}) ${d.slice(2)}`
  return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
}

/* Encontra posição no valor mascarado correspondente a N dígitos */
function cursorPosForDigits(masked, digitCount) {
  let count = 0
  for (let i = 0; i < masked.length; i++) {
    if (count >= digitCount) return i
    if (/\d/.test(masked[i])) count++
  }
  return masked.length
}

export default function PhoneInput({ value, onChange, placeholder }) {
  const inputRef = useRef(null)

  const handleChange = (e) => {
    const el = e.target
    const cursorBefore = el.selectionStart
    // Quantos dígitos estavam antes do cursor
    const digitsBefore = el.value.slice(0, cursorBefore).replace(/\D/g, '').length

    const masked = maskPhone(el.value)
    onChange(masked)

    // Restaura o cursor na posição correta após o re-render
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
      className="fi"
      value={value ?? ''}
      onChange={handleChange}
      placeholder={placeholder ?? '(00) 00000-0000'}
      maxLength={19}
    />
  )
}
