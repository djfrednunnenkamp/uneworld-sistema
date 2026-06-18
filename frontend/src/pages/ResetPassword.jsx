import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { usersApi } from '../api'
import { useAuth } from '../context/AuthContext'
import PasswordInput from '../components/PasswordInput'

export default function ResetPassword() {
  const [params]   = useSearchParams()
  const token      = params.get('token') || ''
  const navigate   = useNavigate()
  const { login }  = useAuth()
  const [password, setPassword]  = useState('')
  const [confirm,  setConfirm]   = useState('')
  const [done,     setDone]      = useState(false)
  const [loading,  setLoading]   = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error,    setError]     = useState('')
  const [email,    setEmail]     = useState('')   // retornado pelo backend após reset
  const hasOpener = typeof window !== 'undefined' && !!window.opener

  useEffect(() => { if (!token) navigate('/login') }, [token])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password.length < 8) { setError('A senha deve ter pelo menos 8 caracteres.'); return }
    if (password !== confirm) { setError('As senhas não coincidem.'); return }
    setLoading(true); setError('')
    try {
      const r = await usersApi.resetPassword(token, password)
      setEmail(r.data.email || '')
      setDone(true)
    } catch (err) {
      setError(err.response?.data?.error ?? 'Link inválido ou expirado.')
    } finally { setLoading(false) }
  }

  /* Faz login nesta aba, recarrega a janela pai (nova sessão) e fecha esta */
  const handleSwitch = async () => {
    setSwitching(true)
    try {
      await login(email, password)
      if (window.opener) {
        window.opener.location.reload()
        window.close()
      } else {
        navigate('/', { replace: true })
      }
    } catch {
      if (window.opener) { window.opener.location.reload(); window.close() }
      else navigate('/', { replace: true })
    } finally { setSwitching(false) }
  }

  /* Fecha esta aba; a janela pai fica inalterada */
  const handleBack = () => {
    if (window.opener) window.close()
    else navigate('/login', { replace: true })
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
          {done ? (
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:48, marginBottom:16 }}>✅</div>
              <h2 style={{ fontSize:20, fontWeight:700, color:'#0f172a', margin:'0 0 8px' }}>Senha redefinida!</h2>
              <p style={{ fontSize:14, color:'#64748b', margin:'0 0 28px', lineHeight:1.6 }}>
                {hasOpener
                  ? 'O que você quer fazer agora?'
                  : 'Sua senha foi alterada com sucesso. Faça login com a nova senha.'}
              </p>

              {hasOpener ? (
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {email && (
                    <button onClick={handleSwitch} disabled={switching}
                      style={{ ...btnPri, background: switching ? '#94a3b8' : '#1a2d4f', cursor: switching ? 'not-allowed' : 'pointer' }}
                      onMouseEnter={e=>{if(!switching)e.currentTarget.style.background='#2e6db4'}}
                      onMouseLeave={e=>{if(!switching)e.currentTarget.style.background='#1a2d4f'}}>
                      {switching ? 'Entrando…' : 'Continuar com esse usuário'}
                    </button>
                  )}
                  <button onClick={handleBack} style={btnSec}
                    onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
                    onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                    Continuar com meu usuário atual
                  </button>
                </div>
              ) : (
                <Link to="/login" style={{ display:'inline-block', padding:'10px 24px', borderRadius:8, background:'#1a2d4f', color:'#fff', textDecoration:'none', fontSize:14, fontWeight:600 }}>
                  Ir para o login
                </Link>
              )}
            </div>
          ) : (
            <>
              <h1 style={{ fontSize:22, fontWeight:700, color:'#0f172a', margin:'0 0 6px' }}>Redefinir senha</h1>
              <p style={{ fontSize:14, color:'#94a3b8', margin:'0 0 28px' }}>Crie uma nova senha para sua conta.</p>
              {error && <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'10px 14px', marginBottom:20, color:'#dc2626', fontSize:13 }}>{error}</div>}
              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom:16 }}>
                  <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>Nova senha</label>
                  <PasswordInput value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" style={inp} autoFocus
                    onFocus={e=>e.target.style.borderColor='#1a2d4f'} onBlur={e=>e.target.style.borderColor='#e2e8f0'} />
                </div>
                <div style={{ marginBottom:24 }}>
                  <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>Confirmar senha</label>
                  <PasswordInput value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Repita a senha" style={inp}
                    onFocus={e=>e.target.style.borderColor='#1a2d4f'} onBlur={e=>e.target.style.borderColor='#e2e8f0'} />
                </div>
                <button type="submit" disabled={loading}
                  style={{ ...btnPri, background:loading?'#94a3b8':'#1a2d4f', cursor:loading?'not-allowed':'pointer' }}
                  onMouseEnter={e=>{if(!loading)e.currentTarget.style.background='#2e6db4'}}
                  onMouseLeave={e=>{if(!loading)e.currentTarget.style.background='#1a2d4f'}}>
                  {loading ? 'Salvando…' : 'Redefinir senha'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
