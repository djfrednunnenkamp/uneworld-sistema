import { useState, useRef } from 'react'

/* Aplica máscara XX.XXX.XXX/XXXX-XX */
function mask(raw) {
  const d = raw.replace(/\D/g, '').slice(0, 14)
  if (d.length <=  2) return d
  if (d.length <=  5) return `${d.slice(0,2)}.${d.slice(2)}`
  if (d.length <=  8) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
}

/* Valida CNPJ (algoritmo oficial) */
function validateCnpj(cnpj) {
  const d = cnpj.replace(/\D/g, '')
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const calc = (len, weights) =>
    d.slice(0, len).split('').reduce((acc, n, i) => acc + parseInt(n) * weights[i], 0)
  const mod = (n) => { const r = n % 11; return r < 2 ? 0 : 11 - r }
  const w1 = [5,4,3,2,9,8,7,6,5,4,3,2]
  const w2 = [6,5,4,3,2,9,8,7,6,5,4,3,2]
  return parseInt(d[12]) === mod(calc(12, w1)) && parseInt(d[13]) === mod(calc(13, w2))
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
 * CnpjInput — campo CNPJ com máscara e validação
 * Props: value (string), onChange (v: string) => void
 */
export default function CnpjInput({ value, onChange }) {
  const [status, setStatus] = useState('idle')
  const inputRef = useRef(null)

  const handleChange = (e) => {
    const el = e.target
    const digitsBefore = el.value.slice(0, el.selectionStart).replace(/\D/g, '').length
    const masked = mask(el.value)
    onChange(masked)
    const digits = masked.replace(/\D/g, '')
    setStatus(digits.length === 14 ? (validateCnpj(masked) ? 'valid' : 'invalid') : 'idle')
    requestAnimationFrame(() => {
      const inp = inputRef.current
      if (!inp) return
      const pos = cursorPosForDigits(masked, digitsBefore)
      inp.setSelectionRange(pos, pos)
    })
  }

  const handleBlur = () => {
    const digits = value.replace(/\D/g, '')
    if (digits.length === 0)  { setStatus('idle');    return }
    if (digits.length !== 14) { setStatus('invalid'); return }
    setStatus(validateCnpj(value) ? 'valid' : 'invalid')
  }

  const borderColor = status === 'valid'   ? '#059669'
                    : status === 'invalid' ? '#dc2626'
                    : '#e2e8f0'
  const bg          = status === 'valid'   ? '#f0fdf4'
                    : status === 'invalid' ? '#fef2f2'
                    : '#fff'

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="fi"
        value={value ?? ''}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="00.000.000/0000-00"
        maxLength={18}
        ref={inputRef}
        style={{ borderColor, background: bg, paddingRight: status !== 'idle' ? 28 : undefined }}
      />
      {status !== 'idle' && (
        <span style={{
          position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)',
          fontSize: 14, lineHeight: 1,
          color: status === 'valid' ? '#059669' : '#dc2626',
        }}>
          {status === 'valid' ? '✓' : '✗'}
        </span>
      )}
      {status === 'invalid' && (
        <p style={{ fontSize: 11, color: '#dc2626', margin: '3px 0 0', fontWeight: 500 }}>
          CNPJ inválido
        </p>
      )}
      {status === 'valid' && (
        <p style={{ fontSize: 11, color: '#059669', margin: '3px 0 0', fontWeight: 500 }}>
          CNPJ válido ✓
        </p>
      )}
    </div>
  )
}
