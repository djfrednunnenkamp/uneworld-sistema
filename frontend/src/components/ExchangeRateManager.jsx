import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Ic } from './Icon'
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

/* ── Popup de criação/edição de um câmbio ── */
function RateModal({ initial, onSave, onClose }) {
  const isEdit = !!initial
  const [fromCurrency, setFromCurrency] = useState(initial?.from_currency ?? 'USD')
  const [toCurrency,   setToCurrency]   = useState(initial?.to_currency ?? 'BRL')
  const [rate,         setRate]         = useState(initial?.rate ?? '')
  const [saving,        setSaving]       = useState(false)

  const save = async () => {
    if (!fromCurrency.trim() || !toCurrency.trim() || !rate) { toast.error('Preencha as moedas e a taxa.'); return }
    setSaving(true)
    try {
      await onSave({ from_currency: fromCurrency.trim().toUpperCase(), to_currency: toCurrency.trim().toUpperCase(), rate })
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:500, padding:20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:380, boxShadow:'0 24px 64px rgba(0,0,0,.24)' }}>
        <div style={{ padding:'16px 20px 14px', borderBottom:'1px solid #e2e8f0' }}>
          <p style={{ fontSize:14, fontWeight:600, color:'#1e293b', margin:0 }}>{isEdit ? 'Editar câmbio' : 'Novo câmbio'}</p>
        </div>
        <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'flex', gap:12 }}>
            <div style={{ flex:1 }}>
              <label style={lbl}>De</label>
              <input style={{ ...inp, width:'100%' }} value={fromCurrency} onChange={e => setFromCurrency(e.target.value)} placeholder="USD" />
            </div>
            <div style={{ flex:1 }}>
              <label style={lbl}>Para</label>
              <input style={{ ...inp, width:'100%' }} value={toCurrency} onChange={e => setToCurrency(e.target.value)} placeholder="BRL" />
            </div>
          </div>
          <div>
            <label style={lbl}>Taxa (1 {fromCurrency || 'USD'} = X {toCurrency || 'BRL'})</label>
            <input style={{ ...inp, width:'100%' }} type="number" step="0.0001" value={rate}
              onChange={e => setRate(e.target.value)} placeholder="5.30" />
          </div>
        </div>
        <div style={{ padding:'12px 20px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'space-between' }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding:'8px 16px', borderRadius:7, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
          <button onClick={save} disabled={saving} style={{ ...btnPri, display:'flex', alignItems:'center', gap:6 }}>
            <Ic n="check" s={13}/>{saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Lista de câmbios — usada para preencher automaticamente os contratos ── */
export default function ExchangeRateManager({ items = [], canEdit = true, canDelete = true, canImport = false, canExport = true, onAdd, onUpdate, onDelete }) {
  const navigate = useNavigate()
  const [search,  setSearch]  = useState('')
  const [modal,   setModal]   = useState(null) // null | 'new' | item
  const [delItem, setDelItem] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [showImportPopup, setShowImportPopup] = useState(false)

  const itemsWithName = useMemo(() => items.map(i => ({ ...i, name: `${i.from_currency} → ${i.to_currency}` })), [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(i => `${i.from_currency} ${i.to_currency}`.toLowerCase().includes(q))
  }, [items, search])

  const handleExport = () => {
    setExporting(true)
    try { exportSectionCsv('exchange_rates', 'Câmbio', itemsWithName, 'cambio.csv') }
    finally { setExporting(false) }
  }

  const handleImportFile = async (file) => {
    const csvText = await file.text()
    navigate('/configuracoes/import', {
      state: {
        csvText, filename: file.name, type: 'exchange_rates',
        existingNames: itemsWithName.map(i => i.name),
        existingItems: itemsWithName,
      },
    })
  }

  return (
    <>
      <div>
        <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center', flexWrap:'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por moeda…"
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
                title="Importar Câmbio"
                sampleContent={CSV_SAMPLES.exchange_rates?.content}
                sampleFilename={CSV_SAMPLES.exchange_rates?.filename}
                onClose={() => setShowImportPopup(false)}
                onFile={handleImportFile}
              />
            )}
          </div>
        </div>

        <p style={{ fontSize:12, color:'#94a3b8', margin:'0 0 8px' }}>
          {`${filtered.length} de ${items.length} ${items.length !== 1 ? 'itens' : 'item'}`}
        </p>

        <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden' }}>
          {filtered.length === 0 ? (
            <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>
              {items.length === 0 ? 'Nenhum câmbio cadastrado.' : 'Nenhum resultado.'}
            </p>
          ) : filtered.map((item, idx) => (
            <div key={item.id} style={{
              display:'flex', alignItems:'center', justifyContent:'space-between', gap:10,
              padding:'9px 14px', fontSize:13, color:'#0f172a',
              borderBottom: idx < filtered.length - 1 ? '1px solid #f1f5f9' : 'none', background:'#fff',
            }}
              onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
              onMouseLeave={e => e.currentTarget.style.background='#fff'}>
              <span style={{ fontWeight:500 }}>{item.from_currency} → {item.to_currency}</span>
              <span style={{ color:'#64748b' }}>1 {item.from_currency} = {Number(item.rate).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} {item.to_currency}</span>
              {(canEdit || canDelete) && (
                <div className="r-acts" style={{ flexShrink:0 }}>
                  {canEdit   && <button className="r-btn edit" title="Editar"  onClick={() => setModal(item)}><Ic n="edit"  s={13}/></button>}
                  {canDelete && <button className="r-btn del"  title="Excluir" onClick={() => setDelItem(item)}><Ic n="trash" s={13}/></button>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {modal && (
        <RateModal
          initial={modal === 'new' ? null : modal}
          onSave={(data) => modal === 'new' ? onAdd(data) : onUpdate(modal.id, data)}
          onClose={() => setModal(null)}
        />
      )}
      {delItem && (
        <ConfirmModal
          message={`Remover o câmbio "${delItem.from_currency} → ${delItem.to_currency}"?`}
          onOk={() => { onDelete(delItem.id); setDelItem(null) }}
          onCancel={() => setDelItem(null)}
        />
      )}
    </>
  )
}
