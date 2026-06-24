import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usersApi, configApi } from '../api'
import { useAuth } from '../context/AuthContext'
import PasswordInput from '../components/PasswordInput'
import TermsModal from '../components/TermsModal'
import { hasVisibleText } from '../utils/richText'

export default function AcceptInvite() {
  const [params]  = useSearchParams()
  const token     = params.get('token') || ''
  const navigate  = useNavigate()
  const { user, login } = useAuth()

  const [invite,     setInvite]     = useState(null)
  const [password,   setPassword]   = useState('')
  const [confirm,    setConfirm]    = useState('')
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [switching,  setSwitching]  = useState(false)
  const [done,       setDone]       = useState(false)
  const [error,      setError]      = useState('')
  const [hasTerms,   setHasTerms]   = useState(false)
  const [agreed,     setAgreed]     = useState(false)
  const [showTerms,  setShowTerms]  = useState(false)

  useEffect(() => {
    if (!token) { navigate('/login'); return }
    usersApi.validateInvite(token)
      .then(r  => setInvite(r.data))
      .catch(() => setError('Convite inválido ou expirado.'))
      .finally(() => setLoading(false))
    configApi.terms().then(r => setHasTerms(hasVisibleText(r.data.content))).catch(() => {})
  }, [token])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password.length < 8) { setError('A senha deve ter pelo menos 8 caracteres.'); return }
    if (password !== confirm) { setError('As senhas não coincidem.'); return }
    if (hasTerms && !agreed) { setError('É preciso concordar com os Termos e Condições.'); return }
    setSaving(true); setError('')
    try {
      await usersApi.acceptInvite(token, password, agreed)
      if (user) {
        // Alguém está logado neste browser — mostra tela de escolha
        setDone(true)
      } else {
        // Nenhuma sessão ativa — faz login direto e vai para a home
        await login(invite.email, password)
        navigate('/', { replace: true })
      }
    } catch (err) {
      setError(err.response?.data?.error ?? 'Erro ao ativar conta.')
    } finally { setSaving(false) }
  }

  /* Faz login, recarrega a janela pai (nova sessão) e fecha esta aba */
  const handleSwitch = async () => {
    setSwitching(true)
    try {
      await login(invite.email, password)
      try {
        // window.opener.top acessa a janela principal mesmo se o link veio de um iframe
        if (window.opener) window.opener.top.location.reload()
      } catch {}
      window.close()
    } catch {
      navigate('/', { replace: true })
    } finally { setSwitching(false) }
  }

  /* Fecha esta aba sem trocar de usuário */
  const handleBack = () => {
    try { window.close() } catch {}
    navigate('/login', { replace: true })
  }

  const cardStyle = { background:'#fff', borderRadius:14, padding:'36px 32px', boxShadow:'0 24px 60px rgba(0,0,0,.35)' }
  const inp = { width:'100%', padding:'10px 13px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:14, outline:'none', fontFamily:'inherit', color:'#0f172a', boxSizing:'border-box', transition:'border-color .15s' }
  const btnPri = { width:'100%', padding:12, borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }
  const btnSec = { width:'100%', padding:12, borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:14, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#0f1b3d 0%,#1a2d4f 60%,#1e3a5f 100%)', display:'flex', alignItems:'center', justifyContent:'center', padding:20, fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif' }}>
      <div style={{ width:'100%', maxWidth:400 }}>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', marginBottom:32 }}>
          <img src="/logo.png" alt="UneWorld" style={{ height:60, width:180, objectFit:'contain', display:'block', margin:'0 auto' }} onError={e=>{e.target.style.display='none'}} />
          <p style={{ color:'rgba(255,255,255,.45)', fontSize:12, fontWeight:600, letterSpacing:'.15em', textTransform:'uppercase', margin:'8px 0 0' }}>Sistema de Gestão</p>
        </div>
        <div style={cardStyle}>
          {loading ? (
            <p style={{ textAlign:'center', color:'#94a3b8' }}>Validando convite…</p>
          ) : error && !invite ? (
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:48, marginBottom:16 }}>❌</div>
              <p style={{ color:'#dc2626', fontSize:14 }}>{error}</p>
            </div>
          ) : done ? (
            /* Tela de escolha — aparece quando havia sessão ativa ao ativar a conta */
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:48, marginBottom:16 }}>🎉</div>
              <h2 style={{ fontSize:20, fontWeight:700, color:'#0f172a', margin:'0 0 8px' }}>Conta ativada!</h2>
              <p style={{ fontSize:14, color:'#64748b', margin:'0 0 6px' }}>{invite?.email}</p>
              <p style={{ fontSize:14, color:'#64748b', margin:'0 0 28px', lineHeight:1.6 }}>O que você quer fazer agora?</p>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                <button onClick={handleSwitch} disabled={switching}
                  style={{ ...btnPri, background: switching ? '#94a3b8' : '#1a2d4f', cursor: switching ? 'not-allowed' : 'pointer' }}
                  onMouseEnter={e=>{if(!switching)e.currentTarget.style.background='#2e6db4'}}
                  onMouseLeave={e=>{if(!switching)e.currentTarget.style.background='#1a2d4f'}}>
                  {switching ? 'Entrando…' : 'Continuar com esse usuário'}
                </button>
                <button onClick={handleBack} style={btnSec}
                  onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
                  onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                  Continuar com meu usuário atual
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ textAlign:'center', marginBottom:24 }}>
                <div style={{ fontSize:36, marginBottom:8 }}>🎉</div>
                <h1 style={{ fontSize:20, fontWeight:700, color:'#0f172a', margin:'0 0 6px' }}>Bem-vindo{invite?.first_name ? `, ${invite.first_name}` : ''}!</h1>
                <p style={{ fontSize:14, color:'#64748b', margin:0 }}>Crie sua senha para ativar o acesso ao sistema.</p>
                <p style={{ fontSize:13, color:'#94a3b8', marginTop:6 }}>{invite?.email}</p>
              </div>
              {error && <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'10px 14px', marginBottom:16, color:'#dc2626', fontSize:13 }}>{error}</div>}
              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom:16 }}>
                  <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>Criar senha</label>
                  <PasswordInput value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" style={inp} autoFocus
                    onFocus={e=>e.target.style.borderColor='#1a2d4f'} onBlur={e=>e.target.style.borderColor='#e2e8f0'} />
                </div>
                <div style={{ marginBottom:24 }}>
                  <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>Confirmar senha</label>
                  <PasswordInput value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Repita a senha" style={inp}
                    onFocus={e=>e.target.style.borderColor='#1a2d4f'} onBlur={e=>e.target.style.borderColor='#e2e8f0'} />
                </div>
                {hasTerms && (
                  <label style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:20, cursor:'pointer' }}>
                    <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
                      style={{ width:16, height:16, marginTop:2, accentColor:'#1a2d4f', cursor:'pointer', flexShrink:0 }} />
                    <span style={{ fontSize:13, color:'#475569', lineHeight:1.5 }}>
                      Eu li e concordo com os{' '}
                      <button type="button" onClick={() => setShowTerms(true)}
                        style={{ background:'none', border:'none', padding:0, color:'#2e6db4', fontWeight:600, fontSize:13, cursor:'pointer', fontFamily:'inherit', textDecoration:'underline' }}>
                        Termos e Condições
                      </button>.
                    </span>
                  </label>
                )}
                <button type="submit" disabled={saving}
                  style={{ ...btnPri, background:saving?'#94a3b8':'#1a2d4f', cursor:saving?'not-allowed':'pointer' }}
                  onMouseEnter={e=>{if(!saving)e.currentTarget.style.background='#2e6db4'}}
                  onMouseLeave={e=>{if(!saving)e.currentTarget.style.background='#1a2d4f'}}>
                  {saving ? 'Ativando…' : 'Ativar minha conta'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
      {showTerms && <TermsModal onClose={() => setShowTerms(false)} />}
    </div>
  )
}
