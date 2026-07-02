import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { configApi } from '../api'
import { Ic } from './Icon'
import EmailInput from './EmailInput'
import Dropdown from './Dropdown'
import CsvImportPopup from './CsvImportPopup'
import { exportSectionCsv } from '../utils/sectionCsv'
import { CSV_SAMPLES } from '../utils/csvSamples'

const PIX_TYPE_OPTS = [
  { value: 'cpf',       label: 'CPF' },
  { value: 'cnpj',      label: 'CNPJ' },
  { value: 'email',     label: 'E-mail' },
  { value: 'telefone',  label: 'Telefone' },
  { value: 'aleatorio', label: 'Chave aleatória' },
]

const inp = { padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:6, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b', boxSizing:'border-box' }
const lbl = { fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em', display:'block', marginBottom:5 }
const btnPri = { padding:'8px 16px', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }
const btnCsv = (color) => ({
  padding: '8px 13px', borderRadius: 7, border: `1.5px solid ${color}20`,
  background: `${color}10`, color, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
})

/* ── Dados da UneWorld como operadora — pré-preenchem automaticamente a seção
 * "Operadora" de todo contrato novo. Antes era um popup dentro de "Cláusulas de
 * Contrato"; agora é uma configuração própria. ── */
export default function OperatingCompanyManager({ canEdit = true, canImport = false, canExport = true }) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [form, setForm] = useState({
    company_name: '', cnpj: '', seller: '', phone: '', mobile: '', email: '', address: '',
    pix_key_type: '', pix_key: '',
    default_signature_type: 'fisica',
    ceo_name: '', ceo_email: '', ceo_autentique_token: '', ceo_auto_sign: false,
  })

  useEffect(() => {
    configApi.operatingCompany()
      .then(r => {
        const d = r.data
        setForm({
          company_name: d.company_name ?? '', cnpj: d.cnpj ?? '', seller: d.seller ?? '',
          phone: d.phone ?? '', mobile: d.mobile ?? '', email: d.email ?? '', address: d.address ?? '',
          pix_key_type: d.pix_key_type ?? '', pix_key: d.pix_key ?? '',
          default_signature_type: d.default_signature_type ?? 'fisica',
          ceo_name: d.ceo_name ?? '', ceo_email: d.ceo_email ?? '',
          ceo_autentique_token: d.ceo_autentique_token ?? '', ceo_auto_sign: !!d.ceo_auto_sign,
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

  const handleExport = () => {
    exportSectionCsv('operating_company', 'Operadora', [form], 'operadora.csv')
  }

  const handleImportFile = async (file) => {
    const csvText = await file.text()
    // Singleton — sem nomes existentes, pra que a linha importada seja sempre
    // aplicada (sobrescreve os dados vigentes da operadora).
    navigate('/configuracoes/import', {
      state: { csvText, filename: file.name, type: 'operating_company', existingNames: [], existingItems: [] },
    })
  }

  if (loading) {
    return <p style={{ padding:'24px 0', textAlign:'center', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      {(canExport || canImport) && (
        <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
          {canExport && <button onClick={handleExport} style={btnCsv('#059669')} title="Exportar como CSV">⬇ Exportar</button>}
          {canImport && <button onClick={() => setShowImport(true)} style={btnCsv('#2e6db4')} title="Importar de CSV">⬆ Importar</button>}
        </div>
      )}
      {canImport && showImport && (
        <CsvImportPopup
          title="Importar Operadora"
          sampleContent={CSV_SAMPLES.operating_company?.content}
          sampleFilename={CSV_SAMPLES.operating_company?.filename}
          onClose={() => setShowImport(false)}
          onFile={handleImportFile}
        />
      )}
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
        <EmailInput style={{ ...inp, width:'100%' }} value={form.email} onChange={v => set('email')({ target: { value: v } })} disabled={!canEdit} />
      </div>
      <div>
        <label style={lbl}>Endereço</label>
        <input style={{ ...inp, width:'100%' }} value={form.address} onChange={set('address')} disabled={!canEdit} />
      </div>

      {/* PIX da UneWorld — aparece no contrato quando a agência marca "usar PIX da UneWorld". */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:12 }}>
        <div>
          <label style={lbl}>Tipo de chave PIX</label>
          <Dropdown value={form.pix_key_type || null} options={PIX_TYPE_OPTS} placeholder="Selecione"
            disabled={!canEdit} searchable={false}
            onChange={v => setForm(f => ({ ...f, pix_key_type: v || '' }))} />
        </div>
        <div>
          <label style={lbl}>Chave PIX</label>
          <input style={{ ...inp, width:'100%' }} value={form.pix_key} onChange={set('pix_key')} disabled={!canEdit} placeholder="Chave PIX da UneWorld" />
        </div>
      </div>

      <div>
        <label style={lbl}>Assinatura padrão dos contratos</label>
        <div style={{ display:'flex', gap:8 }}>
          {[{ v:'fisica', label:'Física (imprimir e assinar)' }, { v:'digital', label:'Digital' }].map(o => {
            const active = form.default_signature_type === o.v
            return (
              <button key={o.v} type="button" disabled={!canEdit}
                onClick={() => canEdit && setForm(f => ({ ...f, default_signature_type: o.v }))}
                style={{ flex:1, padding:'9px 10px', borderRadius:7, border:`1.5px solid ${active ? '#2e6db4' : '#e2e8f0'}`, background:active ? '#eff6ff' : '#fff', color:active ? '#1a2d4f' : '#64748b', fontSize:12.5, fontWeight:active ? 700 : 500, cursor:canEdit ? 'pointer' : 'not-allowed', fontFamily:'inherit' }}>
                {active ? '● ' : '○ '}{o.label}
              </button>
            )
          })}
        </div>
        <p style={{ fontSize:11, color:'#94a3b8', margin:'5px 0 0' }}>Padrão para contratos novos — cada contrato pode mudar no topo do formulário.</p>
      </div>

      {/* Assinatura automática do CEO (Autentique) */}
      <div style={{ border:'1px solid #e2e8f0', borderRadius:10, padding:'14px', background:'#f8fafc' }}>
        <label style={{ display:'flex', alignItems:'flex-start', gap:9, cursor: canEdit ? 'pointer' : 'not-allowed' }}>
          <input type="checkbox" checked={form.ceo_auto_sign} disabled={!canEdit}
            onChange={e => setForm(f => ({ ...f, ceo_auto_sign: e.target.checked }))}
            style={{ width:16, height:16, marginTop:1, accentColor:'#1a2d4f', cursor: canEdit ? 'pointer' : 'not-allowed', flexShrink:0 }} />
          <span>
            <span style={{ fontSize:13, fontWeight:700, color:'#1e293b' }}>Assinar automaticamente pelo CEO (contratos digitais)</span>
            <span style={{ display:'block', fontSize:11.5, color:'#94a3b8', marginTop:2 }}>
              O CEO entra como signatário oficial e o sistema assina por ele na Autentique ao enviar. Requer o e-mail da conta Autentique dele e o token de assinatura.
            </span>
          </span>
        </label>
        {form.ceo_auto_sign && (
          <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ display:'flex', gap:12 }}>
              <div style={{ flex:1 }}>
                <label style={lbl}>Nome do CEO</label>
                <input style={{ ...inp, width:'100%' }} value={form.ceo_name} onChange={set('ceo_name')} disabled={!canEdit} placeholder="Neil ..." />
              </div>
              <div style={{ flex:1 }}>
                <label style={lbl}>E-mail (conta Autentique)</label>
                <EmailInput style={{ ...inp, width:'100%' }} value={form.ceo_email} onChange={v => set('ceo_email')({ target: { value: v } })} disabled={!canEdit} />
              </div>
            </div>
            <div>
              <label style={lbl}>Token de assinatura da Autentique (do CEO)</label>
              <input style={{ ...inp, width:'100%', fontFamily:'ui-monospace, Menlo, monospace' }} value={form.ceo_autentique_token} onChange={set('ceo_autentique_token')} disabled={!canEdit} placeholder="token da API da conta do CEO" />
              <p style={{ fontSize:11, color:'#94a3b8', margin:'4px 0 0' }}>É o token da API da Autentique da conta do CEO — é ele que assina o documento automaticamente.</p>
            </div>
          </div>
        )}
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
