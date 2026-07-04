import { useState } from 'react'
import { toast } from 'sonner'
import { configApi } from '../api'
import { Ic } from './Icon'
import AVistaOptionsFields from './AVistaOptionsFields'

/* Botão + mini-modal das OPÇÕES GLOBAIS de pagamento à vista (desconto único +
   forma sugerida), guardadas no singleton SystemSettings. Fica no cabeçalho do
   pop-up "Modelos de Pagamento". Autossuficiente: carrega e salva sozinho. */

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
                <AVistaOptionsFields mode={mode} value={value} method={method} methodOptions={methods} canEdit={canEdit}
                  onChange={p => { if ('mode' in p) setMode(p.mode); if ('value' in p) setValue(p.value); if ('method' in p) setMethod(p.method) }} />
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
