/**
 * PhoneInput — máscara inteligente para telefones brasileiros
 *
 * Formatos detectados pelo número de dígitos:
 *   8 dígitos → XXXX-XXXX           (fixo local, sem DDD)
 *   9 dígitos → XXXXX-XXXX          (celular local, sem DDD)
 *  10 dígitos → (XX) XXXX-XXXX      (fixo com DDD)
 *  11 dígitos → (XX) XXXXX-XXXX     (celular com DDD)
 *  12 dígitos → +55 (XX) XXXX-XXXX  (fixo internacional)
 *  13 dígitos → +55 (XX) XXXXX-XXXX (celular internacional)
 *
 *  Exemplos de entrada → saída:
 *   51992345678   (11d) → (51) 99234-5678
 *   5551992345678 (13d) → +55 (51) 99234-5678
 *   992345678     (9d)  → 99234-5678
 */
function maskPhone(raw) {
  // Extrai somente dígitos e limita a 13
  const d = raw.replace(/\D/g, '').slice(0, 13)
  const n = d.length

  if (n === 0) return ''

  // ── 13 dígitos: +CC (DDD) XXXXX-XXXX (celular internacional) ──
  if (n === 13)
    return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`

  // ── 12 dígitos: +CC (DDD) XXXX-XXXX (fixo internacional) ──
  if (n === 12)
    return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`

  // ── 11 dígitos: (DDD) XXXXX-XXXX (celular com DDD) ──
  if (n === 11)
    return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`

  // ── 10 dígitos: (DDD) XXXX-XXXX (fixo com DDD) ──
  if (n === 10)
    return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`

  // ── 9 dígitos: XXXXX-XXXX (celular sem DDD) ──
  if (n === 9)
    return `${d.slice(0,5)}-${d.slice(5)}`

  // ── 8 dígitos: XXXX-XXXX (fixo sem DDD) ──
  if (n === 8)
    return `${d.slice(0,4)}-${d.slice(4)}`

  // ── < 8 dígitos: formatação progressiva ──
  // Assume DDD nos primeiros 2 dígitos para orientar o usuário
  if (n <= 2)  return d
  if (n <= 6)  return `(${d.slice(0,2)}) ${d.slice(2)}`
  return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
}

export default function PhoneInput({ value, onChange, placeholder }) {
  const handleChange = (e) => {
    onChange(maskPhone(e.target.value))
  }

  return (
    <input
      className="fi"
      value={value ?? ''}
      onChange={handleChange}
      placeholder={placeholder ?? '(00) 00000-0000'}
      maxLength={19}
    />
  )
}
