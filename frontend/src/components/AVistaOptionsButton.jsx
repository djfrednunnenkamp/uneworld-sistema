import { useState } from 'react'
import { toast } from 'sonner'
import { configApi } from '../api'
import Dropdown from './Dropdown'
import { Ic } from './Icon'

/* Botão + mini-modal das OPÇÕES GLOBAIS de pagamento à vista (desconto único +
   forma sugerida), guardadas no singleton SystemSettings. Fica no cabeçalho do
   pop-up "Modelos de Pagamento". Autossuficiente: carrega e salva sozinho. */
const inp = { padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b', boxSizing: 'border-box', width: '100%' }
const lblStyle = { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }

export default function AVistaOptionsButton({ canEdit }) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [mode, setMode]       = useState('percent')
  const [value, setValue]     = useState('')
  const [method, setMethod]   = useState('')
  const [methods, setMethods] = useState([])

  const openModal = () => {
    setOpen(true); setLoading(true)
    Promise.all([configApi.systemSettings(), configApi.paymentMethods()])
      .then(([s, m]) => {
        const d = s.data || {}
        setMode(d.a_vista_discount_mode || 'percent')
        setValue(d.a_vista_discount_value != null ? String(d.a_vista_discount_value) : '')
        setMethod(d.a_vista_payment_method || '')
        setMethods((m.data.results ?? m.data).map(x => x.name))
      })
      .catch(() => toast.error('Erro ao carregar as opções à vista.'))
      .finally(() => setLoading(false))
  }

  const save = async () => {
    setSaving(true)
    try {
      await configApi.updateSystemSettings({
        a_vista_discount_mode: mode,
        a_vista_discount_value: Number(value) || 0,
        a_vista_payment_method: method || '',
      })
      toast.success('Opções de pagamento à vista salvas.')
      setOpen(false)
    } catch { toast.error('Erro ao salvar as opções à vista.') }
    finally { setSaving(false) }
  }

  const methodOpts = Array.from(new Set([...methods, method].filter(Boolean))).map(m => ({ value: m, label: m }))
  const modeBtn = (m, label) => (
    <button type="button" onClick={() => canEdit && setMode(m)} disabled={!canEdit}
      style={{ padding: '8px 14px', border: 'none', background: mode === m ? '#1a2d4f' : '#fff', color: mode === m ? '#fff' : '#475569', fontSize: 13, fontWeight: mode === m ? 700 : 500, cursor: canEdit ? 'pointer' : 'default', fontFamily: 'inherit' }}>
      {label}
    </button>
  )

  return (
    <>
      <button type="button" onClick={openModal} title="Opções de pagamento à vista"
        style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
        onMouseEnter={e => { e.currentTarget.style.background = '#dbeafe' }}
        onMouseLeave={e => { e.currentTarget.style.background = '#eff6ff' }}>
        <Ic n="card" s={14} /> Opções de pagamento à vista
      </button>

      {open && (
        <div onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', backdropFilter: 'blur(3px)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onMouseDown={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, boxShadow: '0 24px 60px rgba(0,0,0,.28)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 22px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Opções de pagamento à vista</span>
              <button type="button" onClick={() => setOpen(false)} title="Fechar"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex', padding: 2 }}><Ic n="x" s={16} /></button>
            </div>
            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {loading ? (
                <p style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', margin: '8px 0' }}>Carregando…</p>
              ) : (
                <>
                  <div>
                    <label style={lblStyle}>Desconto à vista</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                      <input style={inp} type="number" min="0" step="0.01" value={value} disabled={!canEdit}
                        onChange={e => setValue(e.target.value)} placeholder={mode === 'valor' ? 'Ex.: 500' : 'Ex.: 5'} />
                      <div style={{ display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
                        {modeBtn('valor', 'R$')}
                        {modeBtn('percent', '%')}
                      </div>
                    </div>
                    <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '6px 0 0' }}>0 = sem desconto. Pode ser em reais ou porcentagem.</p>
                  </div>
                  <div>
                    <label style={lblStyle}>Forma de pagamento à vista</label>
                    <Dropdown value={method || null} options={methodOpts} disabled={!canEdit}
                      placeholder="Selecione a forma" searchable clearable onChange={v => setMethod(v || '')} />
                  </div>
                </>
              )}
            </div>
            <div style={{ padding: '14px 22px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setOpen(false)} className="btn btn-outline">Fechar</button>
              {canEdit && <button type="button" onClick={save} disabled={saving || loading} className="btn btn-primary">{saving ? 'Salvando…' : 'Salvar'}</button>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
