import { useState } from 'react'
import { authApi } from '../api'
import { useAuth } from '../context/AuthContext'

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: 20,
}
const card = {
  background: '#fff', borderRadius: 14, width: '100%', maxWidth: 420,
  boxShadow: '0 24px 60px rgba(0,0,0,.25)', overflow: 'hidden',
}
const header = {
  padding: '20px 24px 16px', borderBottom: '1px solid #e2e8f0',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
}
const inp = {
  width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0',
  borderRadius: 8, fontSize: 14, outline: 'none', fontFamily: 'inherit',
  color: '#0f172a', boxSizing: 'border-box', transition: 'border-color .15s',
}
const label = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b',
  textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5,
}

export default function AccountModal({ onClose, onSaved }) {
  const { user } = useAuth()
  const [firstName, setFirstName] = useState(user?.first_name || '')
  const [lastName,  setLastName]  = useState(user?.last_name  || '')
  const [email,     setEmail]     = useState(user?.email      || '')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState(false)

  const handleSave = async (e) => {
    e.preventDefault()
    if (!email.trim()) { setError('O e-mail é obrigatório.'); return }
    setLoading(true); setError('')
    try {
      await authApi.updateMe({ first_name: firstName, last_name: lastName, email: email.trim().toLowerCase() })
      await onSaved()
      setSuccess(true)
      setTimeout(onClose, 900)
    } catch (err) {
      setError(err.response?.data?.error ?? 'Erro ao salvar. Tente novamente.')
    } finally { setLoading(false) }
  }

  return (
    <div style={overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={card}>
        <div style={header}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Minha conta</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 20, lineHeight: 1, padding: 2 }}>×</button>
        </div>
        <form onSubmit={handleSave} style={{ padding: '20px 24px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={label}>Nome</label>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Nome" style={inp}
                onFocus={e => e.target.style.borderColor='#1a2d4f'} onBlur={e => e.target.style.borderColor='#e2e8f0'} />
            </div>
            <div>
              <label style={label}>Sobrenome</label>
              <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Sobrenome" style={inp}
                onFocus={e => e.target.style.borderColor='#1a2d4f'} onBlur={e => e.target.style.borderColor='#e2e8f0'} />
            </div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={label}>E-mail</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" style={inp}
              onFocus={e => e.target.style.borderColor='#1a2d4f'} onBlur={e => e.target.style.borderColor='#e2e8f0'} />
          </div>
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose}
              style={{ padding: '9px 18px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancelar
            </button>
            <button type="submit" disabled={loading || success}
              style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: success ? '#16a34a' : loading ? '#94a3b8' : '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 700, cursor: (loading || success) ? 'default' : 'pointer', fontFamily: 'inherit', transition: 'background .15s' }}>
              {success ? '✓ Salvo' : loading ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
