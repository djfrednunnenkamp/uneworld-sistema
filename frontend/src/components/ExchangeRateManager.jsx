import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { configApi } from '../api'
import { Ic } from './Icon'
import TimePicker from './TimePicker'
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

/* ── Popup de criação/edição de um câmbio ──
 * Taxa de mercado + acréscimo (%) → o câmbio efetivo (usado nos contratos) é
 * taxa × (1 + %/100). Pode atualizar automaticamente todo dia num horário. */
function RateModal({ initial, onSave, onClose, canScript = false }) {
  const isEdit = !!initial
  const [fromCurrency, setFromCurrency] = useState(initial?.from_currency ?? 'USD')
  const [toCurrency,   setToCurrency]   = useState(initial?.to_currency ?? 'BRL')
  const [baseRate,     setBaseRate]     = useState(initial?.base_rate ?? initial?.rate ?? '')
  const [markup,       setMarkup]       = useState(initial?.markup_percent ?? 0)
  const [autoUpdate,   setAutoUpdate]   = useState(initial?.auto_update ?? false)
  const [sourceUrl,    setSourceUrl]    = useState(initial?.source_url ?? '')
  const [script,       setScript]       = useState(initial?.script ?? '')
  const [testing,      setTesting]      = useState(false)
  const [testResult,   setTestResult]   = useState(null)
  const [updateTime,   setUpdateTime]   = useState((initial?.update_time ?? '').slice(0, 5))
  const [saving,        setSaving]       = useState(false)

  const testScript = async () => {
    setTesting(true); setTestResult(null)
    try { const r = await configApi.testExchangeScript(script); setTestResult(r.data) }
    catch (e) { setTestResult({ error: e?.response?.data?.error || 'Erro ao testar o script.' }) }
    finally { setTesting(false) }
  }

  const effective = baseRate !== '' && !isNaN(Number(baseRate))
    ? Number(baseRate) * (1 + (Number(markup) || 0) / 100) : null

  const save = async () => {
    if (!fromCurrency.trim() || !toCurrency.trim() || baseRate === '') { toast.error('Preencha as moedas e a taxa de mercado.'); return }
    setSaving(true)
    try {
      await onSave({
        from_currency: fromCurrency.trim().toUpperCase(),
        to_currency: toCurrency.trim().toUpperCase(),
        base_rate: baseRate,
        markup_percent: Number(markup) || 0,
        auto_update: autoUpdate,
        source_url: autoUpdate ? sourceUrl.trim() : '',
        update_time: (autoUpdate && updateTime) ? updateTime : null,
        ...(canScript ? { script: autoUpdate ? script : '' } : {}),
      })
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:500, padding:20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:420, boxShadow:'0 24px 64px rgba(0,0,0,.24)' }}>
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
          <div style={{ display:'flex', gap:12 }}>
            <div style={{ flex:1 }}>
              <label style={lbl}>Taxa de mercado</label>
              <input style={{ ...inp, width:'100%' }} type="number" step="0.0001" value={baseRate}
                onChange={e => setBaseRate(e.target.value)} placeholder="5.30" />
            </div>
            <div style={{ flex:1 }}>
              <label style={lbl}>Acréscimo (%)</label>
              <input style={{ ...inp, width:'100%' }} type="number" step="0.01" value={markup}
                onChange={e => setMarkup(e.target.value)} placeholder="0" />
            </div>
          </div>
          {effective != null && (
            <div style={{ background:'#f0f6ff', border:'1px solid #d6e4fb', borderRadius:8, padding:'9px 12px', fontSize:12.5, color:'#1a2d4f' }}>
              Câmbio final: <strong>1 {fromCurrency || 'USD'} = {effective.toLocaleString('pt-BR', { minimumFractionDigits: 4 })} {toCurrency || 'BRL'}</strong>
            </div>
          )}
          <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', marginTop:2 }}>
            <input type="checkbox" checked={autoUpdate} onChange={e => setAutoUpdate(e.target.checked)}
              style={{ width:15, height:15, accentColor:'#1a2d4f', cursor:'pointer' }} />
            <span style={{ fontSize:13, fontWeight:600, color:'#475569' }}>Atualizar automaticamente da internet, todo dia</span>
          </label>
          {autoUpdate && (
            <>
              <div>
                <label style={lbl}>Link da taxa (opcional)</label>
                <input style={{ ...inp, width:'100%' }} type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}
                  placeholder="https://… (JSON com a taxa)" />
                <p style={{ fontSize:11, color:'#94a3b8', margin:'4px 0 0' }}>Se preenchido, a taxa desta moeda é puxada deste link (JSON). Vazio = usa a fonte global.</p>
              </div>
              {canScript && (
                <div>
                  <label style={lbl}>Script de cálculo — Python (opcional)</label>
                  <textarea value={script} onChange={e => { setScript(e.target.value); setTestResult(null) }}
                    rows={7} spellCheck={false} placeholder={'# Defina result com a taxa de mercado (X → BRL).\n# Helpers: fetch_json(url), fetch_text(url), Decimal\na = fetch_json("https://fonte1...")["rate"]\nb = fetch_json("https://fonte2...")["rate"]\nresult = (a + b) / 2 * 1.02   # média + 2%'}
                    style={{ ...inp, width:'100%', fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize:12, lineHeight:1.5, resize:'vertical', background:'#0f172a', color:'#e2e8f0', border:'1px solid #334155' }} />
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:6 }}>
                    <button type="button" onClick={testScript} disabled={testing || !script.trim()}
                      style={{ ...btnCsv('#059669'), opacity: (testing || !script.trim()) ? .6 : 1 }}>
                      {testing ? 'Testando…' : '▶ Testar'}
                    </button>
                    {testResult?.rate != null && (
                      <span style={{ fontSize:12.5, fontWeight:600, color:'#15803d' }}>✓ Taxa: {Number(testResult.rate).toLocaleString('pt-BR', { minimumFractionDigits:4 })}</span>
                    )}
                    {testResult?.error && (
                      <span style={{ fontSize:12, color:'#dc2626' }}>✕ {testResult.error}</span>
                    )}
                  </div>
                  <p style={{ fontSize:11, color:'#94a3b8', margin:'6px 0 0', lineHeight:1.5 }}>
                    Roda num <strong>sandbox seguro</strong> (sem acesso a arquivos/sistema, com tempo limite). Tem <strong>precedência</strong> sobre o link. Defina a variável <code>result</code> com a taxa.
                  </p>
                </div>
              )}
              <div>
                <label style={lbl}>Horário específico (opcional)</label>
                <div style={{ width:170 }}><TimePicker value={updateTime} onChange={setUpdateTime} fixed /></div>
                <p style={{ fontSize:11, color:'#94a3b8', margin:'4px 0 0' }}>Se vazio, usa o <strong>horário geral</strong>. O acréscimo (%) é reaplicado após puxar a taxa.</p>
              </div>
            </>
          )}
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
export default function ExchangeRateManager({ items = [], canEdit = true, canDelete = true, canImport = false, canExport = true, canScript = false, onAdd, onUpdate, onDelete, onPullInternet }) {
  const navigate = useNavigate()
  const [search,  setSearch]  = useState('')
  const [modal,   setModal]   = useState(null) // null | 'new' | item
  const [delItem, setDelItem] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [showImportPopup, setShowImportPopup] = useState(false)
  const [confirmPull, setConfirmPull] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [showDefaultTime, setShowDefaultTime] = useState(false)
  const [defaultTime, setDefaultTime] = useState('')
  const [savingDT, setSavingDT] = useState(false)

  const handlePull = async () => {
    setPulling(true)
    try { await onPullInternet?.(); setConfirmPull(false) }
    finally { setPulling(false) }
  }

  const openDefaultTime = async () => {
    setShowDefaultTime(true)
    try { const r = await configApi.exchangeDefaultTime(); setDefaultTime((r.data?.default_update_time ?? '').slice(0, 5)) }
    catch { /* mantém vazio */ }
  }
  const saveDefaultTime = async () => {
    setSavingDT(true)
    try {
      await configApi.setExchangeDefaultTime(defaultTime || null)
      toast.success(defaultTime ? `Horário geral definido para ${defaultTime}.` : 'Horário geral removido.')
      setShowDefaultTime(false)
    } catch { toast.error('Erro ao salvar o horário geral.') }
    finally { setSavingDT(false) }
  }

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
          {canEdit && onPullInternet && (
            <button onClick={() => setConfirmPull(true)} disabled={pulling} style={btnCsv('#7c3aed')} title="Puxar todas as moedas da internet (→ BRL)">
              <Ic n="globe" s={13} /> {pulling ? 'Puxando…' : 'Atualizar da internet'}
            </button>
          )}
          {canEdit && (
            <button onClick={openDefaultTime} style={btnCsv('#b45309')} title="Horário geral da atualização automática">
              <Ic n="clock" s={13} /> Horário geral
            </button>
          )}
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
              <span style={{ fontWeight:500, display:'flex', alignItems:'center', gap:7 }}>
                {item.from_currency} → {item.to_currency}
                {item.auto_update && (
                  <span title={item.update_time ? `Atualiza automaticamente às ${String(item.update_time).slice(0,5)}` : 'Atualiza automaticamente no horário geral'}
                    style={{ display:'inline-flex', alignItems:'center', gap:3, fontSize:10.5, fontWeight:700, color:'#7c3aed', background:'#f3e8ff', padding:'1px 7px', borderRadius:10 }}>
                    <Ic n="clock" s={10} /> auto {item.update_time ? String(item.update_time).slice(0,5) : '(geral)'}
                  </span>
                )}
                {item.auto_update && item.script && (
                  <span title="Calculado por script Python" style={{ fontSize:10, fontWeight:800, color:'#0f172a', background:'#e2e8f0', padding:'1px 6px', borderRadius:10, letterSpacing:.3 }}>Py</span>
                )}
                {item.auto_update && !item.script && item.source_url && (
                  <span title={`Link próprio: ${item.source_url}`} style={{ display:'inline-flex', alignItems:'center', color:'#2e6db4' }}>
                    <Ic n="globe" s={11} />
                  </span>
                )}
                {Number(item.markup_percent) > 0 && (
                  <span title="Acréscimo sobre a taxa de mercado" style={{ fontSize:10.5, fontWeight:700, color:'#b45309', background:'#fffbeb', padding:'1px 7px', borderRadius:10 }}>+{Number(item.markup_percent)}%</span>
                )}
              </span>
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
          canScript={canScript}
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
      {showDefaultTime && (
        <div onClick={e => { if (e.target === e.currentTarget && !savingDT) setShowDefaultTime(false) }}
          style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:500, padding:20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:400, boxShadow:'0 24px 64px rgba(0,0,0,.24)' }}>
            <div style={{ padding:'16px 20px 14px', borderBottom:'1px solid #e2e8f0' }}>
              <p style={{ fontSize:14, fontWeight:600, color:'#1e293b', margin:0 }}>Horário geral de atualização</p>
            </div>
            <div style={{ padding:'16px 20px' }}>
              <p style={{ fontSize:12.5, color:'#64748b', margin:'0 0 12px', lineHeight:1.5 }}>
                Horário em que as moedas com atualização automática são puxadas da internet. Cada moeda pode ter um <strong>horário próprio</strong>, que sobrescreve este geral.
              </p>
              <label style={lbl}>Horário</label>
              <div style={{ width:170 }}><TimePicker value={defaultTime} onChange={setDefaultTime} fixed /></div>
              <p style={{ fontSize:11, color:'#94a3b8', margin:'6px 0 0' }}>Deixe vazio para não atualizar nada automaticamente sem horário próprio.</p>
            </div>
            <div style={{ padding:'12px 20px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'space-between' }}>
              <button onClick={() => setShowDefaultTime(false)} disabled={savingDT}
                style={{ padding:'8px 16px', borderRadius:7, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>Cancelar</button>
              <button onClick={saveDefaultTime} disabled={savingDT} style={{ ...btnPri, display:'flex', alignItems:'center', gap:6 }}>
                <Ic n="check" s={13}/>{savingDT ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmPull && (
        <ConfirmModal
          title="Atualizar câmbio da internet"
          message="Puxar as taxas de todas as moedas do mundo (→ BRL) da internet? Isso cria/atualiza um câmbio para cada moeda, mantendo o acréscimo (%) já configurado em cada um."
          okLabel={pulling ? 'Puxando…' : 'Puxar da internet'}
          onOk={handlePull}
          onCancel={() => !pulling && setConfirmPull(false)}
        />
      )}
    </>
  )
}
