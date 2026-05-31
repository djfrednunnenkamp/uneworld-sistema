import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usersApi } from '../api'

export default function ForgotPassword() {
  const [email,   setEmail]   = useState('')
  const [sent,    setSent]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim()) { setError('Informe o e-mail.'); return }
    setLoading(true); setError('')
    try {
      await usersApi.forgotPassword(email.trim())
      setSent(true)
    } catch { setError('Erro ao enviar. Tente novamente.') }
    finally  { setLoading(false) }
  }

  const cardStyle = { background:'#fff', borderRadius:14, padding:'36px 32px', boxShadow:'0 24px 60px rgba(0,0,0,.35)' }
  const inp = { width:'100%', padding:'10px 13px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:14, outline:'none', fontFamily:'inherit', color:'#0f172a', background:'#fff', boxSizing:'border-box', transition:'border-color .15s' }

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#0f1b3d 0%,#1a2d4f 60%,#1e3a5f 100%)', display:'flex', alignItems:'center', justifyContent:'center', padding:20, fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif' }}>
      <div style={{ width:'100%', maxWidth:400 }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <img src="/logo.png" alt="UneWorld" style={{ height:60, width:'auto' }} onError={e=>{e.target.style.display='none'}} />
          <p style={{ color:'rgba(255,255,255,.45)', fontSize:12, fontWeight:600, letterSpacing:'.15em', textTransform:'uppercase', margin:'8px 0 0' }}>Sistema de Gestão</p>
        </div>

        <div style={cardStyle}>
          {sent ? (
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:48, marginBottom:16 }}>📬</div>
              <h2 style={{ fontSize:20, fontWeight:700, color:'#0f172a', margin:'0 0 12px' }}>E-mail enviado!</h2>
              <p style={{ fontSize:14, color:'#64748b', lineHeight:1.6, margin:'0 0 24px' }}>
                Se este e-mail estiver cadastrado, você receberá um link para redefinir sua senha em breve. Verifique também a caixa de spam.
              </p>
              <Link to="/login" style={{ display:'inline-block', padding:'10px 24px', borderRadius:8, background:'#1a2d4f', color:'#fff', textDecoration:'none', fontSize:14, fontWeight:600 }}>
                Voltar ao login
              </Link>
            </div>
          ) : (
            <>
              <h1 style={{ fontSize:22, fontWeight:700, color:'#0f172a', margin:'0 0 6px' }}>Esqueci minha senha</h1>
              <p style={{ fontSize:14, color:'#94a3b8', margin:'0 0 28px' }}>
                Informe seu e-mail e enviaremos um link para redefinir sua senha.
              </p>
              {error && <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'10px 14px', marginBottom:20, color:'#dc2626', fontSize:13 }}>{error}</div>}
              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom:20 }}>
                  <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>E-mail</label>
                  <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="seu@email.com" style={inp} autoFocus
                    onFocus={e=>e.target.style.borderColor='#1a2d4f'} onBlur={e=>e.target.style.borderColor='#e2e8f0'} />
                </div>
                <button type="submit" disabled={loading}
                  style={{ width:'100%', padding:12, borderRadius:8, border:'none', background:loading?'#94a3b8':'#1a2d4f', color:'#fff', fontSize:14, fontWeight:700, cursor:loading?'not-allowed':'pointer', fontFamily:'inherit' }}
                  onMouseEnter={e=>{if(!loading)e.currentTarget.style.background='#2e6db4'}}
                  onMouseLeave={e=>{if(!loading)e.currentTarget.style.background='#1a2d4f'}}>
                  {loading ? 'Enviando…' : 'Enviar link'}
                </button>
              </form>
              <p style={{ textAlign:'center', marginTop:20, fontSize:13 }}>
                <Link to="/login" style={{ color:'#2e6db4', textDecoration:'none' }}>← Voltar ao login</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
