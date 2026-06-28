import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { configApi } from '../api'
import { Ic } from './Icon'

const inp = { padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:6, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b', boxSizing:'border-box' }
const lbl = { fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em', display:'block', marginBottom:5 }
const btnPri = { padding:'8px 16px', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }

/* ── Dados da UneWorld como operadora — pré-preenchem automaticamente a seção
 * "Operadora" de todo contrato novo. Antes era um popup dentro de "Cláusulas de
 * Contrato"; agora é uma configuração própria. ── */
export default function OperatingCompanyManager({ canEdit = true }) {
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [form, setForm] = useState({
    company_name: '', cnpj: '', seller: '', phone: '', mobile: '', email: '', address: '',
  })

  useEffect(() => {
    configApi.operatingCompany()
      .then(r => {
        const d = r.data
        setForm({
          company_name: d.company_name ?? '', cnpj: d.cnpj ?? '', seller: d.seller ?? '',
          phone: d.phone ?? '', mobile: d.mobile ?? '', email: d.email ?? '', address: d.address ?? '',
        })
      })
      .catch(() => toast.error('Erro ao carregar dados da operadora.'))
      .finally(() => setLoading(false))
  }, [])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    setSaving(true)
    try {
      await configApi.updateOperatingCompany(form)
      toast.success('Dados da operadora salvos.')
    } catch {
      toast.error('Erro ao salvar dados da operadora.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p style={{ padding:'24px 0', textAlign:'center', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div>
        <label style={lbl}>Nome/Empresa</label>
        <input style={{ ...inp, width:'100%' }} value={form.company_name} onChange={set('company_name')} disabled={!canEdit} placeholder="UneWorld Viagens e Turismo" />
      </div>
      <div style={{ display:'flex', gap:12 }}>
        <div style={{ flex:1 }}>
          <label style={lbl}>CNPJ</label>
          <input style={{ ...inp, width:'100%' }} value={form.cnpj} onChange={set('cnpj')} disabled={!canEdit} placeholder="00.000.000/0000-00" />
        </div>
        <div style={{ flex:1 }}>
          <label style={lbl}>Vendedor</label>
          <input style={{ ...inp, width:'100%' }} value={form.seller} onChange={set('seller')} disabled={!canEdit} />
        </div>
      </div>
      <div style={{ display:'flex', gap:12 }}>
        <div style={{ flex:1 }}>
          <label style={lbl}>Telefone fixo</label>
          <input style={{ ...inp, width:'100%' }} value={form.phone} onChange={set('phone')} disabled={!canEdit} />
        </div>
        <div style={{ flex:1 }}>
          <label style={lbl}>Celular</label>
          <input style={{ ...inp, width:'100%' }} value={form.mobile} onChange={set('mobile')} disabled={!canEdit} />
        </div>
      </div>
      <div>
        <label style={lbl}>E-mail</label>
        <input style={{ ...inp, width:'100%' }} value={form.email} onChange={set('email')} disabled={!canEdit} type="email" />
      </div>
      <div>
        <label style={lbl}>Endereço</label>
        <input style={{ ...inp, width:'100%' }} value={form.address} onChange={set('address')} disabled={!canEdit} />
      </div>

      {canEdit && (
        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:4 }}>
          <button onClick={save} disabled={saving} style={{ ...btnPri, display:'flex', alignItems:'center', gap:6 }}>
            <Ic n="check" s={13}/>{saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      )}
    </div>
  )
}
