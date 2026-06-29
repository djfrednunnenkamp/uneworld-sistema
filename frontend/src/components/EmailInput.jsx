import { useState, useRef } from 'react'
import { validateEmailApi } from '../api'

/* Campo de e-mail que verifica de verdade ao sair do campo (onBlur): além do
 * formato, consulta o backend para saber se o DOMÍNIO existe e recebe e-mail
 * (registros MX) e sugere a correção de domínios digitados errado
 * (gmial.com → gmail.com). Emite o valor por onChange(value), igual ao padrão
 * do MoneyInput/CpfInput. O aviso aparece logo abaixo do campo. */

const linkBtn = {
  background: 'none', border: 'none', padding: 0, color: 'inherit',
  font: 'inherit', textDecoration: 'underline', cursor: 'pointer', fontWeight: 600,
}
const DEFAULT_ERR = { border: '1px solid #ef4444', background: '#fef2f2' }
// formato mínimo de e-mail (tem texto@texto.tld) — evita ir ao servidor à toa.
const LOOKS_LIKE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export default function EmailInput({
  value, onChange, className, style, errStyle, placeholder, disabled, ...rest
}) {
  const [result, setResult]   = useState(null)   // {valid, reason, suggestion, suggested_email}
  const [checking, setChecking] = useState(false)
  const lastChecked = useRef(null)

  const check = async (raw) => {
    const email = (raw ?? '').trim()
    if (!email) { setResult(null); lastChecked.current = ''; return }
    if (email === lastChecked.current) return
    lastChecked.current = email
    if (!LOOKS_LIKE_EMAIL.test(email)) {       // claramente incompleto/errado
      setResult({ valid: false, reason: 'format' })
      return
    }
    setChecking(true)
    try {
      const r = await validateEmailApi(email)
      setResult(r.data)
    } catch {
      setResult(null)                          // falha na consulta: não atrapalha
    } finally {
      setChecking(false)
    }
  }

  const applySuggestion = () => {
    const s = result?.suggested_email
    if (!s) return
    onChange(s)
    lastChecked.current = null
    check(s)
  }

  const renderMsg = () => {
    if (checking) return <span style={{ color: '#64748b' }}>Verificando e-mail…</span>
    if (!result) return null
    if (result.reason === 'format')
      return <span style={{ color: '#dc2626' }}>E-mail em formato inválido.</span>
    if (result.reason === 'domain')
      return (
        <span style={{ color: '#dc2626' }}>
          Esse domínio não recebe e-mail.
          {result.suggested_email && <>
            {' '}Você quis dizer{' '}
            <button type="button" onClick={applySuggestion} style={linkBtn}>{result.suggested_email}</button>?
          </>}
        </span>
      )
    if (result.suggested_email)                // domínio válido, mas parece typo
      return (
        <span style={{ color: '#d97706' }}>
          Você quis dizer{' '}
          <button type="button" onClick={applySuggestion} style={linkBtn}>{result.suggested_email}</button>?
        </span>
      )
    if (result.reason === 'ok')
      return <span style={{ color: '#16a34a' }}>✓ E-mail válido</span>
    return null                                // 'unverified' sem sugestão: silencioso
  }

  const bad = result && !result.valid

  return (
    <>
      <input
        {...rest}
        className={className}
        type="email"
        value={value ?? ''}
        disabled={disabled}
        placeholder={placeholder || ''}
        onChange={(e) => { onChange(e.target.value); if (result) setResult(null) }}
        onBlur={(e) => check(e.target.value)}
        style={{ ...(style || {}), ...(bad ? (errStyle || DEFAULT_ERR) : {}) }}
      />
      <div style={{ fontSize: 12, marginTop: 2, minHeight: 14, lineHeight: 1.3 }}>{renderMsg()}</div>
    </>
  )
}
