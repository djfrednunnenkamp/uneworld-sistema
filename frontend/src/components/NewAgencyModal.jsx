import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CnpjInput from './CnpjInput'
import CpfInput from './CpfInput'
import { agenciesApi } from '../api'

function validateCnpj(cnpj) {
  const d = cnpj.replace(/\D/g, '')
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const calc = (len, weights) =>
    d.slice(0, len).split('').reduce((acc, n, i) => acc + parseInt(n) * weights[i], 0)
  const mod = (n) => { const r = n % 11; return r < 2 ? 0 : 11 - r }
  return parseInt(d[12]) === mod(calc(12, [5,4,3,2,9,8,7,6,5,4,3,2])) &&
         parseInt(d[13]) === mod(calc(13, [6,5,4,3,2,9,8,7,6,5,4,3,2]))
}

function validateCpf(cpf) {
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  const calc = (len) => {
    const sum = Array.from({ length: len }, (_, i) => parseInt(d[i]) * (len + 1 - i)).reduce((a, b) => a + b, 0)
    const rem = sum % 11; return rem < 2 ? 0 : 11 - rem
  }
  return parseInt(d[9]) === calc(9) && parseInt(d[10]) === calc(10)
}

const overlay = {
  position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)',
  display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20,
}
const card = {
  background:'#fff', borderRadius:14, width:'100%', maxWidth:420,
  boxShadow:'0 24px 60px rgba(0,0,0,.25)', overflow:'hidden',
}
const hdr = {
  padding:'20px 24px 16px', borderBottom:'1px solid #e2e8f0',
  display:'flex', alignItems:'center', justifyContent:'space-between',
}
const lbl = { display:'block', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }

export default function NewAgencyModal({ onClose }) {
  const navigate   = useNavigate()
  const [isFisica,  setIsFisica]  = useState(false)
  const [cnpj,      setCnpj]      = useState('')
  const [cpf,       setCpf]       = useState('')
  const [checking,  setChecking]  = useState(false)
  const [error,     setError]     = useState('')
  const [duplicate, setDuplicate] = useState(null)

  const reset = () => { setError(''); setDuplicate(null) }

  const handleToggle = () => { setIsFisica(f => !f); setCnpj(''); setCpf(''); reset() }

  const handleContinue = async () => {
    reset()

    if (isFisica) {
      // Pessoa Física → valida CPF e navega com person_type=fisica
      const digits = cpf.replace(/\D/g, '')
      if (digits.length !== 11) { setError('Digite o CPF completo (11 dígitos).'); return }
      if (!validateCpf(cpf))    { setError('CPF inválido. Verifique os dígitos.'); return }
      navigate(`/agencias/nova?person_type=fisica&cpf=${encodeURIComponent(cpf)}`)
      onClose()
      return
    }

    // Pessoa Jurídica → valida CNPJ e verifica duplicata
    const digits = cnpj.replace(/\D/g, '')
    if (digits.length !== 14) { setError('Digite o CNPJ completo (14 dígitos).'); return }
    if (!validateCnpj(cnpj))  { setError('CNPJ inválido. Verifique os dígitos.'); return }

    setChecking(true)
    try {
      const r = await agenciesApi.checkCnpj(cnpj)
      if (r.data.exists) {
        setDuplicate(r.data)
      } else {
        navigate(`/agencias/nova?cnpj=${encodeURIComponent(cnpj)}`)
        onClose()
      }
    } catch { setError('Erro ao verificar CNPJ. Tente novamente.') }
    finally  { setChecking(false) }
  }

  return (
    <div style={overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={card}>
        <div style={hdr}>
          <span style={{ fontSize:16, fontWeight:700, color:'#0f172a' }}>Nova agência</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:20, lineHeight:1, padding:2 }}>×</button>
        </div>

        <div style={{ padding:'20px 24px 24px' }}>
          {/* Toggle Pessoa Física */}
          <div style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginBottom:20, userSelect:'none' }}
            onClick={handleToggle}>
            <div style={{ width:40, height:22, borderRadius:11, transition:'background .2s', background: isFisica ? '#1a2d4f' : '#e2e8f0', position:'relative', flexShrink:0 }}>
              <div style={{ width:16, height:16, borderRadius:'50%', background:'#fff', position:'absolute', top:3, left: isFisica ? 21 : 3, transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.2)' }} />
            </div>
            <span style={{ fontSize:14, color:'#0f172a', fontWeight:500 }}>
              Pessoa física{' '}
              <span style={{ color:'#94a3b8', fontWeight:400 }}>(sem CNPJ)</span>
            </span>
          </div>

          {/* Campo principal: CPF ou CNPJ */}
          <div style={{ marginBottom:4 }}>
            <label style={lbl}>{isFisica ? 'CPF' : 'CNPJ'}</label>
            {isFisica ? (
              <CpfInput value={cpf} onChange={v => { setCpf(v); reset() }} />
            ) : (
              <CnpjInput value={cnpj} onChange={v => { setCnpj(v); reset() }} />
            )}
          </div>

          {/* Erro */}
          {error && (
            <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'9px 12px', marginTop:16, color:'#dc2626', fontSize:13 }}>
              {error}
            </div>
          )}

          {/* CNPJ duplicado */}
          {duplicate && (
            <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, padding:'12px 14px', marginTop:16 }}>
              <p style={{ fontSize:13, color:'#92400e', margin:'0 0 4px', fontWeight:700 }}>CNPJ já cadastrado</p>
              <p style={{ fontSize:13, color:'#78350f', margin:'0 0 10px' }}>
                Este CNPJ já pertence a <strong>{duplicate.name}</strong>.
              </p>
              <button onClick={() => { navigate(`/agencias/${duplicate.id}`); onClose() }}
                style={{ fontSize:12, color:'#92400e', background:'none', border:'1px solid #f59e0b', borderRadius:6, padding:'5px 12px', cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>
                Abrir cadastro →
              </button>
            </div>
          )}

          {/* Ações */}
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:24 }}>
            <button type="button" onClick={onClose}
              style={{ padding:'9px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              Cancelar
            </button>
            <button type="button" onClick={handleContinue} disabled={checking}
              style={{ padding:'9px 20px', borderRadius:8, border:'none', background: checking ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor: checking ? 'default' : 'pointer', fontFamily:'inherit', transition:'background .15s' }}>
              {checking ? 'Verificando…' : 'Continuar →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
