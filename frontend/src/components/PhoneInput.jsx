/**
 * PhoneInput — máscara automática para telefones brasileiros
 * (XX) XXXX-XXXX   → fixo (10 dígitos)
 * (XX) XXXXX-XXXX  → celular (11 dígitos)
 */
function maskPhone(raw) {
  // Remove tudo que não é dígito e limita a 11
  const d = raw.replace(/\D/g, '').slice(0, 11)
  if (d.length === 0)  return ''
  if (d.length <= 2)   return `(${d}`
  if (d.length <= 6)   return `(${d.slice(0,2)}) ${d.slice(2)}`
  if (d.length <= 10)  return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
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
      maxLength={15}
    />
  )
}
