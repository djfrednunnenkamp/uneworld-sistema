import { Ic } from './Icon'

/* Lista de requisitos de senha com check ao vivo (fica verde conforme o usuário
 * digita). Espelha os validadores do backend (Django validate_password): tamanho
 * mínimo, não pode ser só números, não pode ser muito comum, e não pode ser
 * parecida com e-mail/nome (quando esses dados estão disponíveis). O backend é a
 * fonte da verdade — isto é só o guia visual. */

// Amostra das senhas mais comuns (o backend valida contra a lista completa).
const COMMON = new Set([
  '12345678', '123456789', '1234567890', '123456789012', 'password', 'password1',
  'senha123', 'qwertyui', 'qwerty123', '11111111', '00000000', 'abcd1234',
  '87654321', 'iloveyou', 'admin123', '12341234',
])

function tooSimilar(pw, inputs) {
  const p = (pw || '').toLowerCase()
  if (!p) return false
  return (inputs || []).some(v => {
    const s = (v || '').toString().toLowerCase().trim()
    if (s.length < 3) return false
    return p.includes(s) || s.includes(p)
  })
}

export default function PasswordRequirements({ password = '', userInputs = [], style }) {
  const pw = password || ''
  const has = pw.length > 0
  const rules = [
    { label: 'Pelo menos 8 caracteres', ok: pw.length >= 8 },
    { label: 'Pelo menos uma letra (não pode ser só números)', ok: /[a-zA-Z]/.test(pw) },
    { label: 'Não pode ser uma senha muito comum', ok: has && !COMMON.has(pw.toLowerCase()) },
  ]
  const inputs = (userInputs || []).filter(Boolean)
  if (inputs.length) {
    rules.push({ label: 'Não pode ser parecida com seu e-mail/nome', ok: has && !tooSimilar(pw, inputs) })
  }

  return (
    <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 5, ...style }}>
      {rules.map((r, i) => {
        const met = has && r.ok
        return (
          <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: met ? '#16a34a' : '#94a3b8', transition: 'color .15s' }}>
            {met ? (
              <span style={{ width: 15, height: 15, borderRadius: '50%', background: '#16a34a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Ic n="check" s={10} />
              </span>
            ) : (
              <span style={{ width: 15, height: 15, borderRadius: '50%', border: '1.5px solid #cbd5e1', flexShrink: 0 }} />
            )}
            <span>{r.label}</span>
          </li>
        )
      })}
    </ul>
  )
}
