import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { configApi } from '../api'
import { Ic } from './Icon'
import RichTextEditor from './RichTextEditor'
import ConfirmModal from './ConfirmModal'
import CsvImportPopup from './CsvImportPopup'
import PaymentPlanManager from './PaymentPlanManager'
import { exportSectionCsv } from '../utils/sectionCsv'
import { CSV_SAMPLES } from '../utils/csvSamples'

const btnCsv = (color) => ({
  padding: '8px 13px', borderRadius: 7, border: `1.5px solid ${color}20`,
  background: `${color}10`, color, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
})

const inp = { padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b', boxSizing: 'border-box' }
const lbl = { fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 5 }
const btnPri = { padding: '8px 16px', borderRadius: 7, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }

const TEMPLATE_KINDS = [
  { value: 'seguro',       label: 'Adicional de Seguro Viagem' },
  // 'pagamento' saiu daqui: a forma de pagamento agora é estruturada
  // (Configurações › Modelos de Pagamento), não mais texto livre.
  { value: 'condicoes',    label: 'Condições Gerais para Compra do Pacote' },
  { value: 'documentacao', label: 'Documentação Necessária para a Viagem' },
]

/* ── Modal de criação/edição de um modelo — popup com editor rico ── */
function TemplateModal({ kind, template, onClose, onSaved }) {
  const isEdit = !!template
  const [name,    setName]    = useState(template?.name ?? '')
  const [content, setContent] = useState(template?.content ?? '')
  const [saving,  setSaving]  = useState(false)

  const save = async () => {
    if (!name.trim()) { toast.error('Informe um nome para o modelo.'); return }
    setSaving(true)
    const payload = { kind, name: name.trim(), content }
    try {
      if (isEdit) {
        await configApi.updateItineraryTemplate(template.id, payload)
        toast.success('Modelo atualizado.')
      } else {
        await configApi.addItineraryTemplate(payload)
        toast.success('Modelo criado.')
      }
      onSaved()
    } catch {
      toast.error('Erro ao salvar modelo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 600, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 880, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.24)' }}>
        <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>
            {isEdit ? 'Editar modelo' : 'Novo modelo'}
          </p>
          <button type="button" onClick={onClose} title="Fechar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, flexShrink: 0 }}><Ic n="x" s={16} /></button>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>
          <div>
            <label style={lbl}>Nome do modelo</label>
            <input style={{ ...inp, width: '100%' }} value={name} onChange={e => setName(e.target.value)}
              placeholder="Ex: Padrão internacional, Seguro premium…" />
          </div>
          <div>
            <label style={lbl}>Conteúdo</label>
            <RichTextEditor title={name || 'Conteúdo do modelo'} value={content} onChange={setContent} />
          </div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancelar
          </button>
          <button onClick={save} disabled={saving} style={{ ...btnPri, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Ic n="check" s={13} />{saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar modelo'}
          </button>
        </div>
      </div>
    </div>
  )
}

const PAYMENT_KIND = '__pagamento__'   // aba especial: modelos de pagamento (estruturados)

/* ── Gerenciador de modelos do Roteiro — uma aba por tipo de texto, mais uma
   aba "Modelos de Pagamento" (estruturada, reaproveita o PaymentPlanManager) ── */
export default function ItineraryTemplatesManager({
  canEdit = true, canDelete = true, canImport = false, canExport = true,
  // showText: mostra as abas de texto (seguro/condições/documentação). Pode vir
  // false p/ quem só tem permissão de Modelos de Pagamento.
  showText = true,
  // Permissões da aba de pagamento (settings_payment_methods). showPayment
  // controla se a aba aparece.
  showPayment = false, canEditPayment = false, canDeletePayment = false,
  canImportPayment = false, canExportPayment = false,
}) {
  const navigate = useNavigate()
  // Se o usuário não vê texto (só pagamento), já abre na aba de pagamento.
  const [kind,      setKind]      = useState(showText ? TEMPLATE_KINDS[0].value : PAYMENT_KIND)
  const [templates, setTemplates] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [modal,     setModal]     = useState(null)
  const [delItem,   setDelItem]   = useState(null)
  const [showImport, setShowImport] = useState(false)

  const load = useCallback(() => {
    if (kind === PAYMENT_KIND) return   // aba de pagamento tem carregamento próprio
    setLoading(true)
    configApi.itineraryTemplates(kind)
      .then(r => setTemplates(r.data))
      .catch(() => toast.error('Erro ao carregar modelos.'))
      .finally(() => setLoading(false))
  }, [kind])
  useEffect(load, [load])

  const handleDelete = async () => {
    try { await configApi.delItineraryTemplate(delItem.id); load() }
    catch { toast.error('Erro ao excluir modelo.') }
    finally { setDelItem(null) }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(t => t.name.toLowerCase().includes(q))
  }, [templates, search])

  /* Exporta TODOS os modelos (de todos os tipos), não só os da aba atual */
  const handleExport = async () => {
    try {
      const r = await configApi.itineraryTemplates()
      const all = r.data
      if (!all.length) { toast.error('Nenhum modelo para exportar.'); return }
      exportSectionCsv('itinerary_templates', 'Modelos de Texto do Roteiro', all, 'modelos_roteiro.csv')
    } catch { toast.error('Erro ao exportar modelos.') }
  }

  const handleImportFile = async (file) => {
    const csvText = await file.text()
    const r = await configApi.itineraryTemplates().catch(() => ({ data: templates }))
    const all = r.data
    navigate('/configuracoes/import', {
      state: {
        csvText, filename: file.name, type: 'itinerary_templates',
        existingNames: all.map(t => t.name), existingItems: all,
      },
    })
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', borderBottom: '1px solid #e2e8f0', paddingBottom: 10 }}>
        {[...(showText ? TEMPLATE_KINDS : []), ...(showPayment ? [{ value: PAYMENT_KIND, label: 'Modelos de Pagamento' }] : [])].map(k => (
          <button key={k.value} type="button" onClick={() => setKind(k.value)}
            style={{
              padding: '6px 13px', borderRadius: 20, border: `1.5px solid ${kind === k.value ? '#1a2d4f' : '#e2e8f0'}`,
              background: kind === k.value ? '#1a2d4f' : '#fff', color: kind === k.value ? '#fff' : '#475569',
              fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {k.label}
          </button>
        ))}
      </div>

      {kind === PAYMENT_KIND ? (
        <PaymentPlanManager canEdit={canEditPayment} canDelete={canDeletePayment}
          canImport={canImportPayment} canExport={canExportPayment} />
      ) : (<>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome…"
          style={{ ...inp, flex: 1, minWidth: 160 }}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'}
          onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
        {canEdit && <button onClick={() => setModal('new')} style={btnPri}>+ Adicionar</button>}
        {canExport && <button onClick={handleExport} style={btnCsv('#059669')} title="Exportar como CSV">⬇ Exportar</button>}
        {canImport && <button onClick={() => setShowImport(true)} style={btnCsv('#2e6db4')} title="Importar de CSV">⬆ Importar</button>}
      </div>

      <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px' }}>
        {loading ? 'Carregando…' : `${filtered.length} de ${templates.length} modelo${templates.length !== 1 ? 's' : ''}`}
      </p>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', maxHeight: 400, overflowY: 'auto' }}>
        {loading ? (
          <p style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 13 }}>Carregando…</p>
        ) : filtered.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 13 }}>
            {templates.length === 0 ? 'Nenhum modelo criado ainda.' : 'Nenhum resultado.'}
          </p>
        ) : filtered.map((t, idx) => (
          <div key={t.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            padding: '9px 14px', fontSize: 13, color: '#0f172a',
            borderBottom: idx < filtered.length - 1 ? '1px solid #f1f5f9' : 'none', background: '#fff',
          }}
            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
            onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
            <span style={{ fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            {(canEdit || canDelete) && (
              <div className="r-acts" style={{ flexShrink: 0 }}>
                {canEdit   && <button className="r-btn edit" title="Editar"  onClick={() => setModal(t)}><Ic n="edit"  s={13} /></button>}
                {canDelete && <button className="r-btn del"  title="Excluir" onClick={() => setDelItem(t)}><Ic n="trash" s={13} /></button>}
              </div>
            )}
          </div>
        ))}
      </div>

      {modal && (
        <TemplateModal
          kind={kind}
          template={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
      {canImport && showImport && (
        <CsvImportPopup
          title="Importar Modelos de Texto do Roteiro"
          sampleContent={CSV_SAMPLES.itinerary_templates?.content}
          sampleFilename={CSV_SAMPLES.itinerary_templates?.filename}
          onClose={() => setShowImport(false)}
          onFile={handleImportFile}
        />
      )}
      {delItem && (
        <ConfirmModal
          message={`Excluir o modelo "${delItem.name}"?`}
          detail="Roteiros que já usaram este modelo não são afetados — o texto fica salvo no próprio roteiro."
          onOk={handleDelete}
          onCancel={() => setDelItem(null)}
        />
      )}
      </>)}
    </>
  )
}
