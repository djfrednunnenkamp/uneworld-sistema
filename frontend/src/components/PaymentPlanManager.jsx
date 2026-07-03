import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { configApi } from '../api'
import { Ic } from './Icon'
import { exportSectionCsv } from '../utils/sectionCsv'
import { CSV_SAMPLES } from '../utils/csvSamples'
import CsvImportPopup from './CsvImportPopup'
import PaymentPlanFields from './PaymentPlanFields'

const inp    = { padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, outline: 'none', fontFamily: 'inherit', color: '#0f172a', boxSizing: 'border-box', transition: 'border-color .15s' }
const btnPri = { padding: '9px 16px', borderRadius: 8, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
const btnCsv = (color) => ({ padding: '9px 12px', borderRadius: 8, border: `1.5px solid ${color}33`, background: `${color}11`, color, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' })

/* Configurações › Modelos de Pagamento — CRUD autossuficiente (carrega e salva
 * sozinho). Cada modelo é uma sugestão reutilizável (entrada % + nº de parcelas +
 * forma + vencimentos) que os roteiros podem copiar. */

const BLANK = { name: '', has_down_payment: false, down_payment_mode: 'percent', down_payment_value: '', down_payment_method: '', down_payment_rounding: 0.01, installments_count: '', payment_method: '', installment_rounding: 0.01, first_due_days: 30, interval_days: 30 }

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }
const card = { background: '#fff', borderRadius: 14, width: '100%', maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.25)', position: 'relative' }

function describe(p) {
  const n = Number(p.installments_count) || 0
  const parts = []
  if (p.has_down_payment) {
    const val = Number(p.down_payment_value) || 0
    let entrada = 'entrada ' + (p.down_payment_mode === 'valor' ? `R$ ${val.toLocaleString('pt-BR')}` : `${val}%`)
    if (p.down_payment_method) entrada += ` (${p.down_payment_method})`
    parts.push(entrada)
  }
  parts.push(n > 0 ? `${n}x` : 'à vista')
  if (p.payment_method) parts.push(p.payment_method)
  if (n > 0) parts.push(`1º venc. ${p.first_due_days || 0}d, a cada ${p.interval_days || 0}d`)
  return parts.join(' · ')
}

export default function PaymentPlanManager({ canEdit, canDelete, canImport, canExport }) {
  const navigate = useNavigate()
  const [plans, setPlans]     = useState([])
  const [methods, setMethods] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // objeto em edição ({} = novo) ou null
  const [saving, setSaving]   = useState(false)
  const [search, setSearch]   = useState('')
  const [showImport, setShowImport] = useState(false)

  const filtered = useMemo(() => {
    const query = search.toLowerCase()
    return plans.filter(p => (p.name || '').toLowerCase().includes(query))
  }, [plans, search])

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
      has_down_payment: !!e.has_down_payment,
      down_payment_mode: e.down_payment_mode || 'percent',
      down_payment_value: Number(e.down_payment_value) || 0,
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
      {/* Toolbar padrão: busca + adicionar + CSV (igual às outras configurações) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome…"
          style={{ ...inp, flex: 1, minWidth: 160 }}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
        {canEdit && <button onClick={openNew} style={btnPri}>+ Adicionar</button>}
        {canExport && <button onClick={() => exportSectionCsv('payment_plans', 'Modelos de Pagamento', plans, 'modelos_pagamento.csv')} style={btnCsv('#059669')} title="Exportar como CSV">⬇ Exportar</button>}
        {canImport && <button onClick={() => setShowImport(true)} style={btnCsv('#2e6db4')} title="Importar de CSV">⬆ Importar</button>}
      </div>

      <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px' }}>
        {loading ? 'Carregando…' : `${filtered.length} de ${plans.length} ${plans.length !== 1 ? 'modelos' : 'modelo'}`}
      </p>

      {loading ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Carregando…</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>{plans.length === 0 ? 'Nenhum modelo cadastrado ainda.' : 'Nenhum resultado.'}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{p.name}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{describe(p)}</div>
              </div>
              {(canEdit || canDelete) && (
                <div className="r-acts" style={{ flexShrink: 0 }}>
                  {canEdit   && <button className="r-btn edit" title="Editar"  onClick={() => openEdit(p)}><Ic n="edit"  s={13} /></button>}
                  {canDelete && <button className="r-btn del"  title="Excluir" onClick={() => remove(p)}><Ic n="trash" s={13} /></button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div style={overlay} onMouseDown={e => { if (e.target === e.currentTarget) setEditing(null) }}>
          <div style={card}>
            <button onClick={() => setEditing(null)} style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 22, lineHeight: 1, padding: 2 }}>×</button>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e2e8f0', fontSize: 16, fontWeight: 700, color: '#0f172a', flexShrink: 0 }}>
              {editing.id ? 'Editar modelo de pagamento' : 'Novo modelo de pagamento'}
            </div>
            <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>Nome do modelo</label>
                <input className="fi" value={editing.name || ''} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} placeholder="Ex.: Sinal + 10x boleto" autoFocus />
              </div>
              <PaymentPlanFields value={editing} onChange={setEditing} methodOptions={methods} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '16px 24px', borderTop: '1px solid #e2e8f0', flexShrink: 0 }}>
              <button onClick={() => setEditing(null)} style={{ padding: '9px 18px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
              <button onClick={save} disabled={saving} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: saving ? '#94a3b8' : '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <CsvImportPopup
          title="Importar CSV — Modelos de Pagamento"
          sampleContent={CSV_SAMPLES['payment_plans']?.content}
          sampleFilename={CSV_SAMPLES['payment_plans']?.filename}
          onClose={() => setShowImport(false)}
          onFile={async (file) => {
            const csvText = await file.text()
            navigate('/configuracoes/import', { state: { csvText, filename: file.name, type: 'payment_plans', existingNames: plans.map(p => p.name), existingItems: plans } })
          }}
        />
      )}
    </div>
  )
}
