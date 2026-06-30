import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { configApi } from '../api'
import { Ic } from './Icon'
import TimePicker from './TimePicker'
import CodeEditor from './CodeEditor'
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

/* ── Documentação do script de cálculo ── */
function ScriptDocsModal({ onClose }) {
  const code = { fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace', background:'#0f172a', color:'#e2e8f0', borderRadius:8, padding:'10px 12px', fontSize:12, lineHeight:1.6, whiteSpace:'pre-wrap', overflowX:'auto', margin:'6px 0 0' }
  const h = { fontSize:13.5, fontWeight:700, color:'#1e293b', margin:'16px 0 4px' }
  const p = { fontSize:13, color:'#475569', lineHeight:1.65, margin:'0 0 4px' }
  const mono = { fontFamily:'ui-monospace, Menlo, monospace', background:'#f1f5f9', color:'#0f172a', padding:'1px 5px', borderRadius:4, fontSize:12 }
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.55)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:700, padding:20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:640, maxHeight:'88vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 64px rgba(0,0,0,.3)', overflow:'hidden' }}>
        <div style={{ padding:'14px 18px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <span style={{ fontSize:14, fontWeight:700, color:'#1e293b' }}>📖 Como escrever o script de câmbio</span>
          <button onClick={onClose} style={{ width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#94a3b8', cursor:'pointer' }}><Ic n="x" s={14}/></button>
        </div>
        <div style={{ padding:'14px 20px', overflowY:'auto' }}>
          <p style={p}>O script calcula a <strong>taxa de mercado</strong> da moeda (quanto vale <strong>1 unidade dela em BRL</strong>) e a coloca na variável <span style={mono}>result</span>. O <strong>Acréscimo (%)</strong> do formulário ainda é somado por cima — então, se quiser embutir o % no script, deixe o campo de acréscimo em 0.</p>

          <p style={h}>Obrigatório</p>
          <p style={p}>Defina <span style={mono}>result</span> com um número (a taxa). Sem isso, dá erro.</p>
          <pre style={code}>{'result = 5.42'}</pre>

          <p style={h}>Funções disponíveis</p>
          <p style={p}>• <span style={mono}>fetch_json(url)</span> — faz GET e devolve o JSON (dicionário/lista). Ex.: <span style={mono}>fetch_json(url)["rates"]["BRL"]</span></p>
          <p style={p}>• <span style={mono}>fetch_text(url)</span> — devolve o texto da resposta.</p>
          <p style={p}>• <span style={mono}>Decimal("5.40")</span> — para precisão em dinheiro.</p>
          <p style={p}>• <span style={mono}>print(...)</span> — para depurar; a saída aparece ao clicar em <strong>Testar</strong>.</p>
          <p style={p}>• Cálculo: <span style={mono}>min, max, sum, round, abs, len, sorted, float, int, range, zip…</span></p>

          <p style={h}>Exemplo — média de 2 fontes + 2%</p>
          <pre style={code}>{'a = fetch_json("https://fonte1.com/usd")["rate"]\nb = fetch_json("https://fonte2.com/usd")["bid"]\nprint("fonte 1:", a, "| fonte 2:", b)\nresult = (float(a) + float(b)) / 2 * 1.02'}</pre>

          <p style={h}>Segurança (o que NÃO é permitido)</p>
          <p style={p}>Roda num <strong>sandbox isolado</strong>: sem <span style={mono}>import</span>, sem acesso a arquivos/sistema (<span style={mono}>open</span>, <span style={mono}>os</span>…), sem <span style={mono}>exec/eval</span>, sem URLs internas (localhost/rede interna) e com <strong>tempo limite</strong> (script travado é interrompido). Só superusuário pode escrever/rodar.</p>
        </div>
        <div style={{ padding:'12px 20px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'flex-end', flexShrink:0 }}>
          <button onClick={onClose} style={btnPri}>Entendi</button>
        </div>
      </div>
    </div>
  )
}

/* ── Popup de criação/edição de um câmbio ──
 * Taxa de mercado + acréscimo (%) → o câmbio efetivo (usado nos contratos) é
 * taxa × (1 + %/100). Pode atualizar automaticamente todo dia num horário. */
function RateModal({ initial, onSave, onClose, canScript = false, canAdvanced = true, canRounding = true }) {
  const isEdit = !!initial
  const [fromCurrency, setFromCurrency] = useState(initial?.from_currency ?? 'USD')
  const [toCurrency,   setToCurrency]   = useState(initial?.to_currency ?? 'BRL')
  const [baseRate,     setBaseRate]     = useState(initial?.base_rate ?? initial?.rate ?? '')
  const [markup,       setMarkup]       = useState(initial?.markup_percent ?? 0)
  const [markupInst,   setMarkupInst]   = useState(initial?.markup_percent_installment ?? 0)
  const [autoUpdate,   setAutoUpdate]   = useState(initial?.auto_update ?? false)
  const [customTime,   setCustomTime]   = useState(!!(initial?.update_time))   // horário próprio (senão usa o geral)
  const [customSource, setCustomSource] = useState(!!(initial?.source_url || initial?.script))  // fonte externa (senão API global)
  const [sourceMode,   setSourceMode]   = useState(initial?.script ? 'python' : 'link')          // 'link' | 'python'
  const [sourceUrl,    setSourceUrl]    = useState(initial?.source_url ?? '')
  const [script,       setScript]       = useState(initial?.script ?? '')
  const [testing,      setTesting]      = useState(false)
  const [testResult,   setTestResult]   = useState(null)
  const [showBig,      setShowBig]      = useState(false)
  const [showDocs,     setShowDocs]     = useState(false)
  const [updateTime,   setUpdateTime]   = useState((initial?.update_time ?? '').slice(0, 5))
  const [roundEnabled, setRoundEnabled] = useState(initial?.rounding_decimals != null)
  const [roundDecimals,setRoundDecimals]= useState(initial?.rounding_decimals ?? 2)
  const [roundMode,    setRoundMode]    = useState(initial?.rounding_mode ?? 'nearest')
  const [saving,        setSaving]       = useState(false)

  const testScript = async () => {
    setTesting(true); setTestResult(null)
    try { const r = await configApi.testExchangeScript(script); setTestResult(r.data) }
    catch (e) { setTestResult({ error: e?.response?.data?.error || 'Erro ao testar o script.' }) }
    finally { setTesting(false) }
  }

  const applyRound = (v) => {
    if (v == null || !roundEnabled) return v
    const f = Math.pow(10, Number(roundDecimals) || 0)
    if (roundMode === 'up')   return Math.ceil(v * f) / f
    if (roundMode === 'down') return Math.floor(v * f) / f
    return Math.round(v * f) / f
  }
  const effective = baseRate !== '' && !isNaN(Number(baseRate))
    ? applyRound(Number(baseRate) * (1 + (Number(markup) || 0) / 100)) : null
  const effectiveInst = baseRate !== '' && !isNaN(Number(baseRate))
    ? applyRound(Number(baseRate) * (1 + (Number(markupInst) || 0) / 100)) : null

  const save = async () => {
    if (!fromCurrency.trim() || !toCurrency.trim() || baseRate === '') { toast.error('Preencha as moedas e a taxa de mercado.'); return }
    setSaving(true)
    try {
      await onSave({
        from_currency: fromCurrency.trim().toUpperCase(),
        to_currency: toCurrency.trim().toUpperCase(),
        base_rate: baseRate,
        markup_percent: Number(markup) || 0,
        markup_percent_installment: Number(markupInst) || 0,
        rounding_decimals: roundEnabled ? Number(roundDecimals) : null,
        rounding_mode: roundMode,
        auto_update: autoUpdate,
        source_url: (autoUpdate && customSource && sourceMode === 'link') ? sourceUrl.trim() : '',
        update_time: (autoUpdate && customTime && updateTime) ? updateTime : null,
        ...(canScript ? { script: (autoUpdate && customSource && sourceMode === 'python') ? script : '' } : {}),
      })
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <>
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
          <div>
            <label style={lbl}>Taxa de mercado</label>
            <input style={{ ...inp, width:'100%' }} type="number" step="0.0001" value={baseRate}
              onChange={e => setBaseRate(e.target.value)} placeholder="5.30" />
          </div>
          <div style={{ display:'flex', gap:12 }}>
            <div style={{ flex:1 }}>
              <label style={lbl}>Acréscimo à vista (%)</label>
              <input style={{ ...inp, width:'100%' }} type="number" step="0.01" value={markup}
                onChange={e => setMarkup(e.target.value)} placeholder="0" />
            </div>
            <div style={{ flex:1 }}>
              <label style={lbl}>Acréscimo parcelado (%)</label>
              <input style={{ ...inp, width:'100%' }} type="number" step="0.01" value={markupInst}
                onChange={e => setMarkupInst(e.target.value)} placeholder="0" />
            </div>
          </div>
          {effective != null && (
            <div style={{ background:'#f0f6ff', border:'1px solid #d6e4fb', borderRadius:8, padding:'9px 12px', fontSize:12.5, color:'#1a2d4f', display:'flex', flexDirection:'column', gap:4 }}>
              <span>À vista: <strong>1 {fromCurrency || 'USD'} = {effective.toLocaleString('pt-BR', { minimumFractionDigits: roundEnabled ? 0 : 4, maximumFractionDigits: 4 })} {toCurrency || 'BRL'}</strong></span>
              <span>Parcelado: <strong>1 {fromCurrency || 'USD'} = {effectiveInst.toLocaleString('pt-BR', { minimumFractionDigits: roundEnabled ? 0 : 4, maximumFractionDigits: 4 })} {toCurrency || 'BRL'}</strong></span>
            </div>
          )}

          {/* Arredondamento da taxa final */}
          <div style={{ border:'1px solid #e2e8f0', borderRadius:9, padding:'12px', background:'#f8fafc', opacity: canRounding ? 1 : .6 }}>
            <label style={{ display:'flex', alignItems:'center', gap:8, cursor: canRounding ? 'pointer' : 'not-allowed' }} title={canRounding ? undefined : 'Você não tem permissão para as opções de arredondamento.'}>
              <input type="checkbox" checked={roundEnabled} disabled={!canRounding} onChange={e => setRoundEnabled(e.target.checked)}
                style={{ width:15, height:15, accentColor:'#1a2d4f', cursor: canRounding ? 'pointer' : 'not-allowed' }} />
              <span style={{ fontSize:13, fontWeight:600, color:'#475569' }}>Arredondar a taxa final</span>
              {!canRounding && <span style={{ fontSize:10.5, color:'#94a3b8', fontWeight:500 }}>🔒 sem permissão</span>}
            </label>
            {!roundEnabled ? (
              <p style={{ fontSize:11, color:'#94a3b8', margin:'4px 0 0 23px' }}>Sem arredondar — mantém até 4 casas decimais.</p>
            ) : (
              <div style={{ marginTop:10, marginLeft:23, display:'flex', flexDirection:'column', gap:10, ...(canRounding ? {} : { pointerEvents:'none', opacity:.6 }) }}>
                <div>
                  <label style={{ ...lbl, marginBottom:5 }}>Casas decimais</label>
                  <div style={{ display:'flex', border:'1.5px solid #e2e8f0', borderRadius:8, overflow:'hidden', width:'fit-content' }}>
                    {[0, 1, 2, 3, 4].map((d, i) => {
                      const active = Number(roundDecimals) === d
                      return (
                        <button key={d} type="button" onClick={() => setRoundDecimals(d)} style={{
                          padding:'6px 13px', border:'none', borderLeft: i === 0 ? 'none' : '1.5px solid #e2e8f0',
                          background: active ? '#1a2d4f' : '#fff', color: active ? '#fff' : '#64748b',
                          fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
                        }}>{d}</button>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <label style={{ ...lbl, marginBottom:5 }}>Modo</label>
                  <div style={{ display:'flex', border:'1.5px solid #e2e8f0', borderRadius:8, overflow:'hidden', width:'fit-content' }}>
                    {[['nearest','Mais próximo'],['up','↑ Pra cima'],['down','↓ Pra baixo']].map(([v, label], i) => {
                      const active = roundMode === v
                      return (
                        <button key={v} type="button" onClick={() => setRoundMode(v)} style={{
                          padding:'6px 13px', border:'none', borderLeft: i === 0 ? 'none' : '1.5px solid #e2e8f0',
                          background: active ? '#1a2d4f' : '#fff', color: active ? '#fff' : '#64748b',
                          fontSize:12.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
                        }}>{label}</button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:8, cursor: canAdvanced ? 'pointer' : 'not-allowed', marginTop:2, opacity: canAdvanced ? 1 : .6 }} title={canAdvanced ? undefined : 'Você não tem permissão para as opções avançadas.'}>
            <input type="checkbox" checked={autoUpdate} disabled={!canAdvanced} onChange={e => setAutoUpdate(e.target.checked)}
              style={{ width:15, height:15, accentColor:'#1a2d4f', cursor: canAdvanced ? 'pointer' : 'not-allowed' }} />
            <span style={{ fontSize:13, fontWeight:600, color:'#475569' }}>Atualizar automaticamente da internet, todo dia</span>
            {!canAdvanced && <span style={{ fontSize:10.5, color:'#94a3b8', fontWeight:500 }}>🔒 sem permissão</span>}
          </label>
          {autoUpdate && (
            <div style={{ display:'flex', flexDirection:'column', gap:12, marginTop:2, padding:'12px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:9, ...(canAdvanced ? {} : { pointerEvents:'none', opacity:.6 }) }}>

              {/* Controle 1 — horário */}
              <div>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                  <input type="checkbox" checked={customTime} onChange={e => setCustomTime(e.target.checked)} style={{ width:15, height:15, accentColor:'#1a2d4f', cursor:'pointer' }} />
                  <span style={{ fontSize:12.5, fontWeight:600, color:'#475569' }}>Usar um horário diferente do padrão</span>
                </label>
                {customTime ? (
                  <div style={{ marginTop:7, marginLeft:23 }}>
                    <div style={{ width:170 }}><TimePicker value={updateTime} onChange={setUpdateTime} fixed /></div>
                  </div>
                ) : (
                  <p style={{ fontSize:11, color:'#94a3b8', margin:'4px 0 0 23px' }}>Usa o <strong>horário geral</strong> definido em "Horário geral".</p>
                )}
              </div>

              {/* Controle 2 — fonte da taxa */}
              <div style={{ borderTop:'1px solid #e2e8f0', paddingTop:12 }}>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                  <input type="checkbox" checked={customSource} onChange={e => setCustomSource(e.target.checked)} style={{ width:15, height:15, accentColor:'#1a2d4f', cursor:'pointer' }} />
                  <span style={{ fontSize:12.5, fontWeight:600, color:'#475569' }}>Buscar a taxa de uma fonte externa específica</span>
                </label>
                {!customSource ? (
                  <p style={{ fontSize:11, color:'#94a3b8', margin:'4px 0 0 23px' }}>Usa a <strong>fonte global</strong> (open.er-api) para esta moeda.</p>
                ) : (
                  <div style={{ marginTop:8, marginLeft:23 }}>
                    {/* duas opções: link ou python */}
                    <div style={{ display:'inline-flex', border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden', marginBottom:10 }}>
                      {[['link','Por link (URL)'], ...(canScript ? [['python','Por script (Python)']] : [])].map(([v, label]) => {
                        const sel = sourceMode === v
                        return (
                          <button key={v} type="button" onClick={() => { setSourceMode(v); setTestResult(null) }}
                            style={{ padding:'7px 14px', border:'none', background: sel ? '#1a2d4f' : '#fff', color: sel ? '#fff' : '#475569', fontSize:12.5, fontWeight: sel ? 600 : 500, cursor:'pointer', fontFamily:'inherit' }}>{label}</button>
                        )
                      })}
                    </div>

                    {sourceMode === 'link' && (
                      <div>
                        <label style={lbl}>Link da taxa (JSON)</label>
                        <input style={{ ...inp, width:'100%' }} type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://… (JSON com a taxa)" />
                        <p style={{ fontSize:11, color:'#94a3b8', margin:'4px 0 0' }}>A taxa desta moeda é puxada deste link (JSON com o número da taxa).</p>
                      </div>
                    )}

                    {sourceMode === 'python' && canScript && (
                      <div>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:5, flexWrap:'wrap' }}>
                          <label style={{ ...lbl, marginBottom:0 }}>Script de cálculo — Python</label>
                          <div style={{ display:'flex', gap:6 }}>
                            <button type="button" onClick={() => setShowDocs(true)} style={btnCsv('#2e6db4')} title="Como escrever o script">📖 Documentação</button>
                            <button type="button" onClick={() => setShowBig(true)} style={btnCsv('#7c3aed')} title="Abrir editor grande">⤢ Abrir editor</button>
                          </div>
                        </div>
                        <CodeEditor value={script} onChange={v => { setScript(v); setTestResult(null) }} minHeight={130}
                          placeholder={'# Defina result com a taxa de mercado (X -> BRL).\n# Helpers: fetch_json(url), fetch_text(url), Decimal, print()\na = fetch_json("https://fonte1...")["rate"]\nb = fetch_json("https://fonte2...")["rate"]\nresult = (a + b) / 2'} />
                        <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:6 }}>
                          <button type="button" onClick={testScript} disabled={testing || !script.trim()} style={{ ...btnCsv('#059669'), opacity: (testing || !script.trim()) ? .6 : 1 }}>
                            {testing ? 'Testando…' : '▶ Testar'}
                          </button>
                          {testResult?.rate != null && <span style={{ fontSize:12.5, fontWeight:600, color:'#15803d' }}>✓ Taxa: {Number(testResult.rate).toLocaleString('pt-BR', { minimumFractionDigits:4 })}</span>}
                          {testResult?.error && <span style={{ fontSize:12, color:'#dc2626' }}>✕ {testResult.error}</span>}
                        </div>
                        {testResult?.output && (
                          <pre style={{ margin:'6px 0 0', padding:'8px 10px', background:'#0f172a', color:'#cbd5e1', borderRadius:6, fontSize:11.5, lineHeight:1.5, maxHeight:120, overflow:'auto', whiteSpace:'pre-wrap', fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{testResult.output}</pre>
                        )}
                        <p style={{ fontSize:11, color:'#94a3b8', margin:'6px 0 0', lineHeight:1.5 }}>Roda num <strong>sandbox seguro</strong>. Defina a variável <code>result</code> com a taxa.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <p style={{ fontSize:11, color:'#94a3b8', margin:0 }}>O acréscimo (%) é reaplicado depois de puxar a taxa.</p>
            </div>
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

    {/* Editor grande */}
    {showBig && (
      <div onClick={e => { if (e.target === e.currentTarget) setShowBig(false) }}
        style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.55)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:600, padding:20 }}>
        <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:840, height:'88vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 64px rgba(0,0,0,.3)', overflow:'hidden' }}>
          <div style={{ padding:'14px 18px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexShrink:0 }}>
            <span style={{ fontSize:14, fontWeight:700, color:'#1e293b' }}>Script de cálculo — {fromCurrency} → {toCurrency}</span>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <button type="button" onClick={() => setShowDocs(true)} style={btnCsv('#2e6db4')}>📖 Documentação</button>
              <button type="button" onClick={() => setShowBig(false)} style={btnPri}>Concluir</button>
            </div>
          </div>
          <div style={{ flex:1, minHeight:0, padding:16, display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ flex:1, minHeight:0 }}>
              <CodeEditor value={script} onChange={v => { setScript(v); setTestResult(null) }} minHeight={'100%'} autoFocus
                placeholder={'# Defina result com a taxa de mercado (X -> BRL).\n# Helpers: fetch_json(url), fetch_text(url), Decimal, print()\n\na = fetch_json("https://fonte1...")["rate"]\nb = fetch_json("https://fonte2...")["rate"]\nresult = (a + b) / 2'} />
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
              <button type="button" onClick={testScript} disabled={testing || !script.trim()} style={{ ...btnCsv('#059669'), opacity:(testing || !script.trim()) ? .6 : 1 }}>
                {testing ? 'Testando…' : '▶ Testar'}
              </button>
              {testResult?.rate != null && <span style={{ fontSize:12.5, fontWeight:600, color:'#15803d' }}>✓ Taxa: {Number(testResult.rate).toLocaleString('pt-BR', { minimumFractionDigits:4 })}</span>}
              {testResult?.error && <span style={{ fontSize:12, color:'#dc2626' }}>✕ {testResult.error}</span>}
            </div>
            {testResult?.output && (
              <pre style={{ margin:0, padding:'8px 10px', background:'#0f172a', color:'#cbd5e1', borderRadius:6, fontSize:11.5, lineHeight:1.5, maxHeight:120, overflow:'auto', whiteSpace:'pre-wrap', flexShrink:0, fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{testResult.output}</pre>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Documentação */}
    {showDocs && <ScriptDocsModal onClose={() => setShowDocs(false)} />}
    </>
  )
}

/* ── Lista de câmbios — usada para preencher automaticamente os contratos ── */
export default function ExchangeRateManager({ items = [], canEdit = true, canDelete = true, canImport = false, canExport = true, canScript = false, canAdvanced = true, canRounding = true, onAdd, onUpdate, onDelete, onPullInternet }) {
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
        {/* Linha de cima — botões utilitários */}
        <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center', flexWrap:'wrap', justifyContent:'center' }}>
          {canEdit && onPullInternet && (
            <button onClick={() => setConfirmPull(true)} disabled={pulling} style={btnCsv('#7c3aed')} title="Puxar todas as moedas da internet (→ BRL)">
              <Ic n="globe" s={13} /> {pulling ? 'Puxando…' : 'Atualizar da internet'}
            </button>
          )}
          {canAdvanced && (
            <button onClick={openDefaultTime} style={btnCsv('#b45309')} title="Horário geral da atualização automática">
              <Ic n="clock" s={13} /> Horário geral
            </button>
          )}
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

        {/* Linha de baixo — busca + adicionar */}
        <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center', flexWrap:'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por moeda…"
            style={{ ...inp, flex:1, minWidth:160 }}
            onFocus={e => e.target.style.borderColor='#1a2d4f'}
            onBlur={e  => e.target.style.borderColor='#e2e8f0'} />
          {canEdit && <button onClick={() => setModal('new')} style={btnPri}>+ Adicionar</button>}
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
              display:'grid', gridTemplateColumns:'1fr auto 1fr', alignItems:'center', gap:14,
              padding:'9px 14px', fontSize:13, color:'#0f172a',
              borderBottom: idx < filtered.length - 1 ? '1px solid #f1f5f9' : 'none', background:'#fff',
            }}
              onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
              onMouseLeave={e => e.currentTarget.style.background='#fff'}>
              <span style={{ fontWeight:500, display:'flex', alignItems:'center', gap:7, whiteSpace:'nowrap' }}>
                {canEdit && (
                  <button type="button" onClick={() => onUpdate(item.id, { is_favorite: !item.is_favorite })}
                    title={item.is_favorite ? 'Remover dos favoritos' : 'Marcar como favorito'}
                    style={{ background:'none', border:'none', cursor:'pointer', padding:0, fontSize:15, lineHeight:1, color: item.is_favorite ? '#f59e0b' : '#cbd5e1', flexShrink:0 }}>
                    {item.is_favorite ? '★' : '☆'}
                  </button>
                )}
                <span style={{ whiteSpace:'nowrap' }}>{item.from_currency} → {item.to_currency}</span>
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
                {(Number(item.markup_percent) > 0 || Number(item.markup_percent_installment) > 0) && (
                  <span title="Acréscimo à vista / parcelado sobre a taxa de mercado" style={{ fontSize:10.5, fontWeight:700, color:'#b45309', background:'#fffbeb', padding:'1px 7px', borderRadius:10 }}>+{Number(item.markup_percent)}% / +{Number(item.markup_percent_installment)}%</span>
                )}
              </span>
              <span style={{ color:'#64748b', whiteSpace:'nowrap', justifySelf:'center', textAlign:'center', gridColumn:2 }}>
                1 {item.from_currency} = {Number(item.rate).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} {item.to_currency}
                <span style={{ fontSize:11, color:'#94a3b8' }}> à vista</span>
                {Number(item.rate_installment) > 0 && (
                  <> · {Number(item.rate_installment).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}<span style={{ fontSize:11, color:'#94a3b8' }}> parcelado</span></>
                )}
              </span>
              {(canEdit || canDelete) && (
                <div className="r-acts" style={{ flexShrink:0, justifySelf:'flex-end' }}>
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
          canAdvanced={canAdvanced}
          canRounding={canRounding}
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
