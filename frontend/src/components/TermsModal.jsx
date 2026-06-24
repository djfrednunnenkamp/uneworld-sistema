import { useState, useEffect } from 'react'
import { configApi } from '../api'
import { Ic } from './Icon'

/* ── Popup só de leitura com o texto vigente dos Termos e Condições ── */
export default function TermsModal({ onClose }) {
  const [content, setContent] = useState(null)
  const [loading,  setLoading] = useState(true)

  useEffect(() => {
    configApi.terms()
      .then(r => setContent(r.data.content || ''))
      .catch(() => setContent(''))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:800, padding:20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:680, maxHeight:'85vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 64px rgba(0,0,0,.24)' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <p style={{ fontSize:15, fontWeight:700, color:'#1e293b', margin:0 }}>Termos e Condições</p>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:20, lineHeight:1, padding:4 }}><Ic n="x" s={18}/></button>
        </div>
        <div style={{ padding:'20px 24px', overflowY:'auto', flex:1, fontSize:14, color:'#334155', lineHeight:1.7 }}>
          {loading ? (
            <p style={{ textAlign:'center', color:'#94a3b8' }}>Carregando…</p>
          ) : content ? (
            <div dangerouslySetInnerHTML={{ __html: content }} />
          ) : (
            <p style={{ textAlign:'center', color:'#94a3b8' }}>Nenhum termo cadastrado ainda.</p>
          )}
        </div>
        <div style={{ padding:'12px 20px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'flex-end', flexShrink:0 }}>
          <button onClick={onClose}
            style={{ padding:'8px 20px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
