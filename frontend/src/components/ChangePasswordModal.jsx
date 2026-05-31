import { useState } from 'react'
import { authApi } from '../api'

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: 20,
}
const card = {
  background: '#fff', borderRadius: 14, width: '100%', maxWidth: 400,
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

export default function ChangePasswordModal({ onClose }) {
  const [current,  setCurrent]  = useState('')
  const [newPw,    setNewPw]    = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState(false)

  const handleSave = async (e) => {
    e.preventDefault()
    if (!current) { setError('Informe a senha atual.'); return }
    if (newPw.length < 8) { setError('A nova senha deve ter pelo menos 8 caracteres.'); return }
    if (newPw !== confirm) { setError('As senhas não coincidem.'); return }
    setLoading(true); setError('')
    try {
      await authApi.changePassword(current, newPw)
      setSuccess(true)
      setTimeout(onClose, 1000)
    } catch (err) {
      setError(err.response?.data?.error ?? 'Erro ao alterar senha.')
    } finally { setLoading(false) }
  }

  return (
    <div style={overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={card}>
        <div style={header}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Alterar senha</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 20, lineHeight: 1, padding: 2 }}>×</button>
        </div>
        <form onSubmit={handleSave} style={{ padding: '20px 24px 24px' }}>
          <div style={{ marginBottom: 12 }}>
            <label style={label}>Senha atual</label>
            <input type="password" value={current} onChange={e => setCurrent(e.target.value)} placeholder="••••••••" style={inp} autoFocus
              onFocus={e => e.target.style.borderColor='#1a2d4f'} onBlur={e => e.target.style.borderColor='#e2e8f0'} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={label}>Nova senha</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Mínimo 8 caracteres" style={inp}
              onFocus={e => e.target.style.borderColor='#1a2d4f'} onBlur={e => e.target.style.borderColor='#e2e8f0'} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={label}>Confirmar nova senha</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repita a nova senha" style={inp}
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
              {success ? '✓ Alterada' : loading ? 'Salvando…' : 'Alterar senha'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
