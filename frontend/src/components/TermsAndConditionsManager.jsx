import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { configApi } from '../api'
import { Ic } from './Icon'
import RichTextEditor from './RichTextEditor'
import CsvImportPopup from './CsvImportPopup'
import { CSV_SAMPLES } from '../utils/csvSamples'
import { exportSectionCsv } from '../utils/sectionCsv'

const btnPri = { padding:'8px 16px', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }
const btnCsv = (color) => ({
  padding: '6px 11px', borderRadius: 7, border: `1.5px solid ${color}20`,
  background: `${color}10`, color, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
})

/* ── Editor único dos Termos e Condições — toda edição pede aceite de novo
 * de quem já tinha aceitado, já que muda o updated_at do singleton. ── */
export default function TermsAndConditionsManager({ canEdit = true, canImport = false, canExport = true }) {
  const navigate = useNavigate()
  const [content,   setContent]   = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [dirty,     setDirty]     = useState(false)
  const [showImportPopup, setShowImportPopup] = useState(false)

  const load = () => {
    setLoading(true)
    configApi.terms()
      .then(r => { setContent(r.data.content || ''); setUpdatedAt(r.data.updated_at) })
      .catch(() => toast.error('Erro ao carregar termos.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const save = async () => {
    setSaving(true)
    try {
      await configApi.updateTerms({ content })
      toast.success('Termos e Condições atualizados. Quem já tinha aceitado vai precisar aceitar de novo.')
      setDirty(false)
      load()
    } catch {
      toast.error('Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  const handleExport = () => {
    exportSectionCsv('terms', 'Termos e Condições', [{ name: 'Termos e Condições', content }], 'termos_e_condicoes.csv')
  }

  const handleImportFile = async (file) => {
    const csvText = await file.text()
    navigate('/configuracoes/import', {
      state: { csvText, filename: file.name, type: 'terms', existingNames: [], existingItems: [] },
    })
  }

  if (loading) return <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>Carregando…</p>

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:14, alignItems:'center', justifyContent:'flex-end', flexWrap:'wrap' }}>
        {updatedAt && (
          <span style={{ fontSize:12, color:'#94a3b8', marginRight:'auto' }}>
            Última atualização: {new Date(updatedAt).toLocaleString('pt-BR')}
          </span>
        )}
        {canExport && (
          <button style={btnCsv('#059669')} onClick={handleExport} title="Exportar como CSV">⬇ Exportar</button>
        )}
        {canImport && (
          <button style={btnCsv('#2e6db4')} onClick={() => setShowImportPopup(true)} title="Importar de CSV">⬆ Importar</button>
        )}
        {canImport && showImportPopup && (
          <CsvImportPopup
            title="Importar Termos e Condições"
            sampleContent={CSV_SAMPLES.terms?.content}
            sampleFilename={CSV_SAMPLES.terms?.filename}
            onClose={() => setShowImportPopup(false)}
            onFile={handleImportFile}
          />
        )}
      </div>

      <RichTextEditor
        title="Termos e Condições"
        placeholder="Digite aqui os termos e condições, leis aplicáveis etc…"
        value={content}
        onChange={v => { setContent(v); setDirty(true) }}
      />

      {canEdit && (
        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:14 }}>
          <button onClick={save} disabled={saving || !dirty} style={{ ...btnPri, opacity: (!dirty || saving) ? .6 : 1, display:'flex', alignItems:'center', gap:6 }}>
            <Ic n="check" s={13}/>{saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      )}
    </div>
  )
}
