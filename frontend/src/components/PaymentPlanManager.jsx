import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { configApi } from '../api'
import PaymentPlanFields from './PaymentPlanFields'

/* Configurações › Modelos de Pagamento — CRUD autossuficiente (carrega e salva
 * sozinho). Cada modelo é uma sugestão reutilizável (entrada % + nº de parcelas +
 * forma + vencimentos) que os roteiros podem copiar. */

const BLANK = { name: '', down_payment_percent: '', installments_count: '', payment_method: '', first_due_days: 30, interval_days: 30 }

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }
const card = { background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, boxShadow: '0 24px 60px rgba(0,0,0,.25)', position: 'relative' }

function describe(p) {
  const n = Number(p.installments_count) || 0
  const pct = Number(p.down_payment_percent) || 0
  const parts = []
  parts.push(n > 0 ? (pct > 0 ? `entrada ${pct}% + ${n}x` : `${n}x sem entrada`) : 'à vista')
  if (p.payment_method) parts.push(p.payment_method)
  if (n > 0) parts.push(`1º venc. ${p.first_due_days || 0}d, a cada ${p.interval_days || 0}d`)
  return parts.join(' · ')
}

export default function PaymentPlanManager({ canEdit, canDelete }) {
  const [plans, setPlans]     = useState([])
  const [methods, setMethods] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // objeto em edição ({} = novo) ou null
  const [saving, setSaving]   = useState(false)

  const load = () => {
    setLoading(true)
    configApi.paymentPlans().then(r => setPlans(r.data.results ?? r.data)).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => {
    load()
    configApi.paymentMethods().then(r => setMethods((r.data.results ?? r.data).map(m => m.name))).catch(() => {})
  }, [])

  const openNew  = () => setEditing({ ...BLANK })
  const openEdit = (p) => setEditing({ ...p })

  const save = async () => {
    const e = editing
    if (!e.name?.trim()) { toast.error('Dê um nome ao modelo.'); return }
    const payload = {
      name: e.name.trim(),
      down_payment_percent: Number(e.down_payment_percent) || 0,
      installments_count: parseInt(e.installments_count) || 0,
      payment_method: e.payment_method || '',
      first_due_days: parseInt(e.first_due_days) || 0,
      interval_days: parseInt(e.interval_days) || 0,
    }
    setSaving(true)
    try {
      if (e.id) await configApi.updatePaymentPlan(e.id, payload)
      else await configApi.addPaymentPlan(payload)
      setEditing(null)
      load()
      toast.success('Modelo salvo.')
    } catch { toast.error('Erro ao salvar o modelo.') }
    finally { setSaving(false) }
  }

  const remove = async (p) => {
    if (!window.confirm(`Excluir o modelo "${p.name}"?`)) return
    try { await configApi.delPaymentPlan(p.id); load(); toast.success('Modelo excluído.') }
    catch { toast.error('Erro ao excluir.') }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
          Modelos de sugestão de pagamento — usados nos roteiros e aplicados nos contratos.
        </p>
        {canEdit && (
          <button onClick={openNew} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            + Novo modelo
          </button>
        )}
      </div>

      {loading ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Carregando…</p>
      ) : plans.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Nenhum modelo cadastrado ainda.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {plans.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{p.name}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{describe(p)}</div>
              </div>
              {canEdit && <button onClick={() => openEdit(p)} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 7, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}>Editar</button>}
              {canDelete && <button onClick={() => remove(p)} style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 7, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, color: '#dc2626', cursor: 'pointer', fontFamily: 'inherit' }}>Excluir</button>}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div style={overlay} onMouseDown={e => { if (e.target === e.currentTarget) setEditing(null) }}>
          <div style={card}>
            <button onClick={() => setEditing(null)} style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 22, lineHeight: 1, padding: 2 }}>×</button>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e2e8f0', fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
              {editing.id ? 'Editar modelo de pagamento' : 'Novo modelo de pagamento'}
            </div>
            <div style={{ padding: '18px 24px' }}>
              <PaymentPlanFields value={editing} onChange={setEditing} methodOptions={methods} showName />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '0 24px 22px' }}>
              <button onClick={() => setEditing(null)} style={{ padding: '9px 18px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
              <button onClick={save} disabled={saving} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: saving ? '#94a3b8' : '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
