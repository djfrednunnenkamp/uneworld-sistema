import { useState } from 'react'

/* Aplica máscara XXX.XXX.XXX-XX */
function mask(raw) {
  const d = raw.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
}

/* Valida CPF (algoritmo oficial) */
function validateCpf(cpf) {
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  const calc = (len) => {
    const sum = Array.from({ length: len }, (_, i) => parseInt(d[i]) * (len + 1 - i))
                     .reduce((a, b) => a + b, 0)
    const rem = sum % 11
    return rem < 2 ? 0 : 11 - rem
  }
  return parseInt(d[9]) === calc(9) && parseInt(d[10]) === calc(10)
}

/**
 * CpfInput — campo CPF com máscara e validação
 * Props: value (string), onChange (v: string) => void
 */
export default function CpfInput({ value, onChange }) {
  const [status, setStatus] = useState('idle')  // 'idle' | 'valid' | 'invalid'

  const handleChange = (e) => {
    const masked = mask(e.target.value)
    onChange(masked)
    // Valida em tempo real quando completo
    const digits = masked.replace(/\D/g, '')
    if (digits.length === 11) {
      setStatus(validateCpf(masked) ? 'valid' : 'invalid')
    } else {
      setStatus('idle')
    }
  }

  const handleBlur = () => {
    const digits = value.replace(/\D/g, '')
    if (digits.length === 0)  { setStatus('idle');    return }
    if (digits.length !== 11) { setStatus('invalid'); return }
    setStatus(validateCpf(value) ? 'valid' : 'invalid')
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
        placeholder="000.000.000-00"
        maxLength={14}
        style={{ borderColor, background: bg, paddingRight: status !== 'idle' ? 28 : undefined }}
      />
      {/* Ícone de feedback */}
      {status !== 'idle' && (
        <span style={{
          position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)',
          fontSize: 14, lineHeight: 1,
          color: status === 'valid' ? '#059669' : '#dc2626',
        }}>
          {status === 'valid' ? '✓' : '✗'}
        </span>
      )}
      {/* Mensagem de erro */}
      {status === 'invalid' && (
        <p style={{ fontSize: 11, color: '#dc2626', margin: '3px 0 0', fontWeight: 500 }}>
          CPF inválido
        </p>
      )}
      {status === 'valid' && (
        <p style={{ fontSize: 11, color: '#059669', margin: '3px 0 0', fontWeight: 500 }}>
          CPF válido ✓
        </p>
      )}
    </div>
  )
}
