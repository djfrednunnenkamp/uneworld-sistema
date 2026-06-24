import { useState } from 'react'
import { toast } from 'sonner'
import { usersApi } from '../api'
import TermsModal from './TermsModal'

/* ── Bloqueia o uso do sistema até o usuário confirmar que leu os Termos e
 * Condições vigentes — aparece no primeiro login de quem já tinha senha
 * definida pelo admin, e de novo sempre que o texto for atualizado. ── */
export default function TermsAcceptGate({ onAccepted }) {
  const [agreed,    setAgreed]    = useState(false)
  const [showTerms, setShowTerms] = useState(false)
  const [saving,    setSaving]    = useState(false)

  const confirm = async () => {
    if (!agreed) { toast.error('Marque que você leu e concorda com os Termos e Condições.'); return }
    setSaving(true)
    try {
      await usersApi.acceptTerms()
      onAccepted()
    } catch {
      toast.error('Erro ao confirmar. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.65)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 }}>
      <div style={{ background:'#fff', borderRadius:14, maxWidth:440, width:'100%', padding:'28px 26px', boxShadow:'0 24px 64px rgba(0,0,0,.3)' }}>
        <h2 style={{ fontSize:18, fontWeight:700, color:'#0f172a', margin:'0 0 10px' }}>Termos e Condições</h2>
        <p style={{ fontSize:14, color:'#475569', lineHeight:1.6, margin:'0 0 18px' }}>
          Antes de continuar, confirme que você leu e concorda com os Termos e Condições vigentes.
        </p>
        <label style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:22, cursor:'pointer' }}>
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
            style={{ width:16, height:16, marginTop:2, accentColor:'#1a2d4f', cursor:'pointer', flexShrink:0 }} />
          <span style={{ fontSize:13, color:'#475569', lineHeight:1.5 }}>
            Eu li e confirmo que concordo com os{' '}
            <button type="button" onClick={() => setShowTerms(true)}
              style={{ background:'none', border:'none', padding:0, color:'#2e6db4', fontWeight:600, fontSize:13, cursor:'pointer', fontFamily:'inherit', textDecoration:'underline' }}>
              Termos e Condições
            </button>.
          </span>
        </label>
        <button onClick={confirm} disabled={saving || !agreed}
          style={{ width:'100%', padding:12, borderRadius:8, border:'none', background: (!agreed || saving) ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:14, fontWeight:700, cursor: (!agreed || saving) ? 'not-allowed' : 'pointer', fontFamily:'inherit' }}>
          {saving ? 'Confirmando…' : 'Continuar'}
        </button>
      </div>
      {showTerms && <TermsModal onClose={() => setShowTerms(false)} />}
    </div>
  )
}
