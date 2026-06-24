import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { configApi } from '../api'
import { Ic } from './Icon'
import RichTextEditor from './RichTextEditor'
import ConfirmModal from './ConfirmModal'
import CsvImportPopup from './CsvImportPopup'
import { CSV_SAMPLES } from '../utils/csvSamples'
import { exportSectionCsv } from '../utils/sectionCsv'

const inp = { padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:6, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b', boxSizing:'border-box' }
const lbl = { fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em', display:'block', marginBottom:5 }
const btnPri = { padding:'8px 16px', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }
const btnCsv = (color) => ({
  padding: '6px 11px', borderRadius: 7, border: `1.5px solid ${color}20`,
  background: `${color}10`, color, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
})

/* ── Modal de edição/criação de cláusula — popup grande com editor rico ── */
function ClauseModal({ clause, onClose, onSaved }) {
  const isEdit = !!clause
  const [name,      setName]      = useState(clause?.name ?? '')
  const [isDefault, setIsDefault] = useState(clause?.is_default ?? false)
  const [content,   setContent]   = useState(clause?.content ?? '')
  const [saving,    setSaving]    = useState(false)

  const save = async () => {
    if (!name.trim()) { toast.error('Informe um nome para a cláusula.'); return }
    setSaving(true)
    const payload = { name: name.trim(), is_default: isDefault, content }
    try {
      if (isEdit) {
        await configApi.updateContractClause(clause.id, payload)
        toast.success('Cláusula atualizada.')
      } else {
        await configApi.addContractClause(payload)
        toast.success('Cláusula criada.')
      }
      onSaved()
    } catch (e) {
      toast.error(e.response?.data?.error ?? 'Erro ao salvar cláusula.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:500, padding:20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:880, maxHeight:'92vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 64px rgba(0,0,0,.24)' }}>
        <div style={{ padding:'16px 20px 14px', borderBottom:'1px solid #e2e8f0', flexShrink:0 }}>
          <p style={{ fontSize:14, fontWeight:600, color:'#1e293b', margin:0 }}>
            {isEdit ? 'Editar cláusula' : 'Nova cláusula de contrato'}
          </p>
        </div>

        <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:14, overflowY:'auto', flex:1 }}>
          <div>
            <label style={lbl}>Nome da cláusula</label>
            <input style={{ ...inp, width:'100%' }} value={name} onChange={e => setName(e.target.value)}
              placeholder="Ex: Cancelamento de voo, Política de hospedagem…" />
          </div>

          <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', width:'fit-content' }}>
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)}
              style={{ width:16, height:16, accentColor:'#1a2d4f', cursor:'pointer' }} />
            <span style={{ fontSize:13, color:'#1e293b' }}>
              ★ Cláusula padrão — sempre entra no contrato, além das específicas escolhidas pro caso.
            </span>
          </label>

          <div>
            <label style={lbl}>Texto da cláusula</label>
            <RichTextEditor
              title={name || 'Texto da cláusula'}
              placeholder="Digite o texto da cláusula…"
              value={content}
              onChange={setContent}
            />
          </div>
        </div>

        <div style={{ padding:'12px 20px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'space-between', flexShrink:0 }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding:'8px 16px', borderRadius:7, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
          <button onClick={save} disabled={saving} style={{ ...btnPri, display:'flex', alignItems:'center', gap:6 }}>
            <Ic n="check" s={13}/>{saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar cláusula'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Lista de cláusulas — base do futuro gerador de contratos ── */
export default function ContractClausesManager({ canEdit = true, canDelete = true, canImport = false, canExport = true }) {
  const navigate = useNavigate()
  const [clauses, setClauses] = useState([])
  const [loading,  setLoading] = useState(true)
  const [search,   setSearch]  = useState('')
  const [modal,    setModal]   = useState(null)
  const [delItem,  setDelItem] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [showImportPopup, setShowImportPopup] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    configApi.contractClauses()
      .then(r => setClauses(r.data))
      .catch(() => toast.error('Erro ao carregar cláusulas.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const handleDelete = async () => {
    try { await configApi.delContractClause(delItem.id); load() }
    catch { toast.error('Erro ao excluir cláusula.') }
    finally { setDelItem(null) }
  }

  const handleExport = () => {
    setExporting(true)
    try { exportSectionCsv('contract_clauses', 'Cláusulas de Contrato', clauses, 'clausulas_contrato.csv') }
    finally { setExporting(false) }
  }

  const handleImportFile = async (file) => {
    const csvText = await file.text()
    navigate('/configuracoes/import', {
      state: {
        csvText, filename: file.name, type: 'contract_clauses',
        existingNames: clauses.map(c => c.name),
        existingItems: clauses,
      },
    })
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clauses
    return clauses.filter(c => c.name.toLowerCase().includes(q))
  }, [clauses, search])

  return (
    <>
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center', flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome…"
          style={{ ...inp, flex:1, minWidth:160 }}
          onFocus={e => e.target.style.borderColor='#1a2d4f'}
          onBlur={e  => e.target.style.borderColor='#e2e8f0'} />
        {canEdit && <button onClick={() => setModal('new')} style={btnPri}>+ Adicionar</button>}
        <div style={{ display:'flex', gap:6 }}>
          {canExport && (
            <button style={btnCsv('#059669')} onClick={handleExport} disabled={exporting} title="Exportar como CSV">
              {exporting ? '⏳ Exportando…' : '⬇ Exportar'}
            </button>
          )}
          {canImport && (
            <button style={btnCsv('#2e6db4')} onClick={() => setShowImportPopup(true)} title="Importar de CSV">⬆ Importar</button>
          )}
          {canImport && showImportPopup && (
            <CsvImportPopup
              title="Importar Cláusulas de Contrato"
              sampleContent={CSV_SAMPLES.contract_clauses?.content}
              sampleFilename={CSV_SAMPLES.contract_clauses?.filename}
              onClose={() => setShowImportPopup(false)}
              onFile={handleImportFile}
            />
          )}
        </div>
      </div>

      <p style={{ fontSize:12, color:'#94a3b8', margin:'0 0 8px' }}>
        {loading ? 'Carregando…' : `${filtered.length} de ${clauses.length} cláusula${clauses.length !== 1 ? 's' : ''}`}
      </p>

      <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden', maxHeight:460, overflowY:'auto' }}>
        {loading ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
        ) : filtered.length === 0 ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>
            {clauses.length === 0 ? 'Nenhuma cláusula criada ainda.' : 'Nenhum resultado.'}
          </p>
        ) : filtered.map((c, idx) => (
          <div key={c.id} style={{
            display:'flex', alignItems:'center', justifyContent:'space-between', gap:10,
            padding:'9px 14px', fontSize:13, color:'#0f172a',
            borderBottom: idx < filtered.length - 1 ? '1px solid #f1f5f9' : 'none', background:'#fff',
          }}
            onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
            onMouseLeave={e => e.currentTarget.style.background='#fff'}>
            <div style={{ minWidth:0, overflow:'hidden' }}>
              <span style={{ fontWeight:500 }}>{c.name}</span>
              {c.is_default && (
                <span title="Cláusula padrão — sempre entra no contrato" style={{ marginLeft:8, fontSize:12, color:'#f59e0b' }}>★</span>
              )}
            </div>
            {(canEdit || canDelete) && (
              <div className="r-acts" style={{ flexShrink:0 }}>
                {canEdit   && <button className="r-btn edit" title="Editar"  onClick={() => setModal(c)}><Ic n="edit"  s={13}/></button>}
                {canDelete && <button className="r-btn del"  title="Excluir" onClick={() => setDelItem(c)}><Ic n="trash" s={13}/></button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
    {modal && (
      <ClauseModal
        clause={modal === 'new' ? null : modal}
        onClose={() => setModal(null)}
        onSaved={() => { setModal(null); load() }}
      />
    )}
    {delItem && (
      <ConfirmModal
        message={`Excluir a cláusula "${delItem.name}"?`}
        detail="Cláusulas já usadas em contratos não são afetadas — o texto fica salvo no próprio contrato."
        onOk={handleDelete}
        onCancel={() => setDelItem(null)}
      />
    )}
    </>
  )
}
