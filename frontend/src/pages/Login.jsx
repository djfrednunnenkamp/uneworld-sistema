import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const { login }  = useAuth()
  const navigate   = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) { setError('Preencha e-mail e senha.'); return }
    setLoading(true); setError('')
    try {
      await login(email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.response?.data?.error ?? 'Erro ao entrar. Verifique suas credenciais.')
    } finally { setLoading(false) }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f1b3d 0%, #1a2d4f 60%, #1e3a5f 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/logo.png" alt="UneWorld" style={{ height: 60, width: 'auto', display: 'inline-block' }}
            onError={e => { e.target.style.display='none' }} />
          <p style={{ color: 'rgba(255,255,255,.45)', fontSize: 12, fontWeight: 600, letterSpacing: '.15em', textTransform: 'uppercase', margin: '8px 0 0' }}>
            Sistema de Gestão
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: '#fff', borderRadius: 14, padding: '36px 32px',
          boxShadow: '0 24px 60px rgba(0,0,0,.35)',
        }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>
            Entrar
          </h1>
          <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 28px' }}>
            Acesse o painel UneWorld Turismo
          </p>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 20, color: '#dc2626', fontSize: 13, fontWeight: 500 }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                E-mail
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                autoComplete="email"
                autoFocus
                style={{
                  width: '100%', padding: '10px 13px', border: '1.5px solid #e2e8f0',
                  borderRadius: 8, fontSize: 14, outline: 'none', fontFamily: 'inherit',
                  color: '#0f172a', background: '#fff', boxSizing: 'border-box',
                  transition: 'border-color .15s',
                }}
                onFocus={e => e.target.style.borderColor = '#1a2d4f'}
                onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                Senha
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                style={{
                  width: '100%', padding: '10px 13px', border: '1.5px solid #e2e8f0',
                  borderRadius: 8, fontSize: 14, outline: 'none', fontFamily: 'inherit',
                  color: '#0f172a', background: '#fff', boxSizing: 'border-box',
                  transition: 'border-color .15s',
                }}
                onFocus={e => e.target.style.borderColor = '#1a2d4f'}
                onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '12px', borderRadius: 8, border: 'none',
                background: loading ? '#94a3b8' : '#1a2d4f',
                color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', transition: 'background .15s', letterSpacing: '.02em',
              }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#2e6db4' }}
              onMouseLeave={e => { if (!loading) e.currentTarget.style.background = '#1a2d4f' }}
            >
              {loading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,.25)', fontSize: 12, marginTop: 24 }}>
          UneWorld Turismo © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
