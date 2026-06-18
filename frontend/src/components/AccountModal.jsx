import { useState, useEffect } from 'react'
import { authApi, agendaApi } from '../api'
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
const lbl = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b',
  textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5,
}

function Toggle({ checked, onChange }) {
  return (
    <label style={{ position: 'relative', display: 'inline-block', width: 36, height: 20, flexShrink: 0, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} />
      <span style={{
        position: 'absolute', inset: 0, borderRadius: 20, transition: 'background .2s',
        background: checked ? '#1a2d4f' : '#cbd5e1',
      }} />
      <span style={{
        position: 'absolute', top: 3, left: checked ? 19 : 3, width: 14, height: 14,
        borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
      }} />
    </label>
  )
}

export default function AccountModal({ onClose, onSaved }) {
  const { user } = useAuth()
  const [firstName, setFirstName] = useState(user?.first_name || '')
  const [lastName,  setLastName]  = useState(user?.last_name  || '')
  const [email,     setEmail]     = useState(user?.email      || '')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState(false)

  const [prefs, setPrefs] = useState({
    digest_enabled:          false,
    digest_frequency:        'daily',
    receive_deadline_emails: false,
    receive_task_emails:     false,
    receive_birthday_emails: false,
  })

  const canSeeSensitive = user?.is_superuser || !!user?.permissions?.passengers_view_full

  useEffect(() => {
    agendaApi.getPrefs()
      .then(r => setPrefs(p => ({
        ...p,
        digest_enabled:          !!r.data.digest_enabled,
        digest_frequency:        r.data.digest_frequency || 'daily',
        receive_deadline_emails: !!r.data.receive_deadline_emails,
        receive_task_emails:     !!r.data.receive_task_emails,
        receive_birthday_emails: !!r.data.receive_birthday_emails,
      })))
      .catch(() => {})
  }, [])

  const handleSave = async (e) => {
    e.preventDefault()
    if (!email.trim()) { setError('O e-mail é obrigatório.'); return }
    setLoading(true); setError('')
    try {
      await authApi.updateMe({ first_name: firstName, last_name: lastName, email: email.trim().toLowerCase() })
      await agendaApi.updatePrefs(prefs)
      await onSaved()
      setSuccess(true)
      setTimeout(onClose, 900)
    } catch (err) {
      setError(err.response?.data?.error ?? 'Erro ao salvar. Tente novamente.')
    } finally { setLoading(false) }
  }

  const EMAIL_OPTS = [
    { key: 'receive_deadline_emails', label: 'Prazos de confirmação',      desc: 'E-mail quando passageiros têm prazo vencendo hoje ou em 2 dias' },
    { key: 'receive_task_emails',     label: 'Pendências',                  desc: 'E-mail quando tarefas têm prazo vencendo hoje' },
    ...(canSeeSensitive ? [{ key: 'receive_birthday_emails', label: 'Aniversários de passageiros', desc: 'E-mail com passageiros que fazem aniversário hoje' }] : []),
  ]

  return (
    <div style={overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={card}>
        <div style={header}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Minha conta</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 20, lineHeight: 1, padding: 2 }}>×</button>
        </div>
        <form onSubmit={handleSave} style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Nome</label>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Nome" style={inp}
                onFocus={e => e.target.style.borderColor='#1a2d4f'} onBlur={e => e.target.style.borderColor='#e2e8f0'} />
            </div>
            <div>
              <label style={lbl}>Sobrenome</label>
              <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Sobrenome" style={inp}
                onFocus={e => e.target.style.borderColor='#1a2d4f'} onBlur={e => e.target.style.borderColor='#e2e8f0'} />
            </div>
          </div>
          <div>
            <label style={lbl}>E-mail</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" style={inp}
              onFocus={e => e.target.style.borderColor='#1a2d4f'} onBlur={e => e.target.style.borderColor='#e2e8f0'} />
          </div>

          {/* Resumo automático do calendário */}
          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
            <label style={lbl}>Resumo do calendário</label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', marginBottom: 8 }}>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: '#1e293b' }}>Resumo automático periódico</p>
                <p style={{ margin: 0, fontSize: 11.5, color: '#94a3b8' }}>Recebe um e-mail com seus próximos eventos e prazos</p>
              </div>
              <Toggle checked={!!prefs.digest_enabled} onChange={v => setPrefs(p => ({ ...p, digest_enabled: v }))} />
            </label>
            {prefs.digest_enabled && (
              <div style={{ padding: '0 4px 8px' }}>
                <label style={lbl}>Frequência</label>
                <select value={prefs.digest_frequency} onChange={e => setPrefs(p => ({ ...p, digest_frequency: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', color: '#0f172a', outline: 'none', background: '#fff' }}>
                  <option value="daily">Diário</option>
                  <option value="weekly">Semanal (segundas-feiras)</option>
                </select>
              </div>
            )}
          </div>

          {/* Notificações por e-mail */}
          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
            <label style={lbl}>Notificações por e-mail</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {EMAIL_OPTS.map(({ key, label, desc }) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer' }}>
                  <div>
                    <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{label}</p>
                    <p style={{ margin: 0, fontSize: 11.5, color: '#94a3b8' }}>{desc}</p>
                  </div>
                  <Toggle checked={!!prefs[key]} onChange={v => setPrefs(p => ({ ...p, [key]: v }))} />
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', color: '#dc2626', fontSize: 13 }}>
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
