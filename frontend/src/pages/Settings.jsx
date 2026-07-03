import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { configApi, listsApi, auditApi } from '../api'
import ConfirmModal from '../components/ConfirmModal'
import TrashRowActions from '../components/TrashRowActions'
import { useAuth } from '../context/AuthContext'
import { useWebSocket } from '../hooks/useWebSocket'
import DocTypesManager from '../components/DocTypesManager'
import AccommodationManager from '../components/AccommodationManager'
import AirportsManager from '../components/AirportsManager'
import AirlinesManager from '../components/AirlinesManager'
import BusMapsManager from '../components/BusMapsManager'
import ContractClausesManager from '../components/ContractClausesManager'
import OperatingCompanyManager from '../components/OperatingCompanyManager'
import ItineraryTemplatesManager from '../components/ItineraryTemplatesManager'
import ExchangeRateManager from '../components/ExchangeRateManager'
import TermsAndConditionsManager from '../components/TermsAndConditionsManager'
import { Ic } from '../components/Icon'
import { PermPresetBar, PermAccordionItem } from '../components/PermAccordion'
import { PERM_GROUPS, EMPTY_PERMISSIONS, sanitizePerms, applyPermChanges } from '../utils/permGroups'
import CsvImportPopup from '../components/CsvImportPopup'
import CsvExportModal from '../components/CsvExportModal'
import { CSV_SAMPLES } from '../utils/csvSamples'
import { CARD_META } from '../utils/sectionMeta'
import { exportSectionCsv, downloadCsv } from '../utils/sectionCsv'
import { hasVisibleText } from '../utils/richText'
import { dashboardWsUrl } from '../utils/ws'

/* ── CSV global: Países → Estados → Cidades ── */
async function handleGeoExport() {
  try {
    const r = await configApi.geoExport()
    const url = URL.createObjectURL(r.data)
    const a = document.createElement('a')
    a.href = url; a.download = 'paises_estados_cidades.csv'; a.click()
    URL.revokeObjectURL(url)
    auditApi.logDownload({
      label: 'paises_estados_cidades.csv',
      model_label: 'Exportação CSV — Países/Estados/Cidades',
      model_name: 'CsvExportGeo',
    }).catch(() => {})
  } catch { toast.error('Erro ao exportar.') }
}

async function handleGeoImport(file, onDone) {
  const fd = new FormData()
  fd.append('file', file)
  try {
    const r = await configApi.geoImport(fd)
    const { countries, states, cities, rows } = r.data
    toast.success(`${rows} linhas lidas — ${countries} países, ${states} estados, ${cities} cidades criados.`)
    onDone()
  } catch { toast.error('Erro ao importar CSV.') }
}

/* ── CSV helpers ── */
function exportCsv(items, filename) {
  const rows = ['nome', ...items.map(i => `"${i.name.replace(/"/g, '""')}"`)]
  downloadCsv(rows.join('\n'), filename)
}

function splitCsvLineSettings(line) {
  const out = []; let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) { if (c === '"') { if (line[i+1]==='"'){cur+='"';i++}else inQ=false } else cur+=c }
    else { if (c==='"') inQ=true; else if (c===','){out.push(cur);cur=''}else cur+=c }
  }
  out.push(cur); return out.map(s=>s.trim())
}

/* CSV combinado — inclui listas simples + acomodações + países + estados + cidades
                  + tipos de documento + aeroportos + companhias aéreas
                  + perfis de permissão + mapas de ônibus
   Formato: lista,nome,pessoas,casal,pais,estado,codigo */
function exportCombinedCsvFull(simpleGroups, accoms, continents, countries, states, cities, docTypes, airports, airlines, permProfiles, busMaps, contractClauses = [], termsContent = null, paymentMethods = [], exchangeRates = [], itineraryTemplates = [], operatingCompany = null, paymentPlans = [], filename) {
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`
  const rows = ['lista,nome,pessoas,casal,pais,estado,codigo']
  simpleGroups.forEach(({ label, items }) => {
    items.forEach(i => rows.push(`${q(label)},${q(i.name)},,,,,`))
  })
  continents.forEach(c => {
    rows.push(`${q('Continentes')},${q(c.name)},,,,,`)
  })
  accoms.forEach(a => {
    rows.push(`${q('Acomodações')},${q(a.name)},${a.capacity},${a.is_couple ? 'sim' : 'não'},,,`)
  })
  docTypes.forEach(d => {
    rows.push(`${q('Documentos')},${q(d.label)},,,,,${q(d.key || '')}`)
  })
  airports.forEach(a => {
    rows.push(`${q('Aeroportos')},${q(a.name)},,${a.is_favorite ? 'sim' : 'não'},${q(a.country || '')},${q(a.city || '')},${q(a.iata_code || '')}`)
  })
  airlines.forEach(a => {
    rows.push(`${q('Companhias Aéreas')},${q(a.name)},,${a.is_favorite ? 'sim' : 'não'},${q(a.country || '')},,${q(a.iata_code || '')}`)
  })
  countries.forEach(c => {
    rows.push(`${q('Países')},${q(c.name)},,,${q(c.continent_name || '')},,${q(c.code || '')}`)
  })
  states.forEach(s => {
    rows.push(`${q('Estados')},${q(s.name)},,,${q(s.country_name || '')},,${q(s.code || '')}`)
  })
  cities.forEach(c => {
    rows.push(`${q('Cidades')},${q(c.name)},,,${q(c.country)},${q(c.state)},`)
  })
  permProfiles.forEach(p => {
    const active = Object.entries(p.permissions ?? {}).filter(([, v]) => v).map(([k]) => k).join('|')
    rows.push(`${q('Perfis de Permissão')},${q(p.name)},,,,,${q(active)}`)
  })
  busMaps.forEach(m => {
    const payload = JSON.stringify({
      key: m.key, deck_count: m.deck_count, order: m.order, is_active: m.is_active,
      rows: (m.rows ?? []).map(r => ({
        deck: r.deck, left_seats: r.left_seats, right_seats: r.right_seats,
        left_labels: r.left_labels, right_labels: r.right_labels,
      })),
    })
    rows.push(`${q('Mapas de Ônibus')},${q(m.label)},${m.rows?.length ?? 0},,,,${q(payload)}`)
  })
  contractClauses.forEach(c => {
    const payload = JSON.stringify({ content: c.content || '', is_default: !!c.is_default })
    rows.push(`${q('Cláusulas de Contrato')},${q(c.name)},,,,,${q(payload)}`)
  })
  if (termsContent != null) {
    const payload = JSON.stringify({ content: termsContent || '' })
    rows.push(`${q('Termos e Condições')},${q('Termos e Condições')},,,,,${q(payload)}`)
  }
  paymentMethods.forEach(pm => {
    rows.push(`${q('Formas de Pagamento')},${q(pm.name)},,,,,`)
  })
  exchangeRates.forEach(er => {
    const payload = JSON.stringify({
      from_currency: er.from_currency, to_currency: er.to_currency,
      base_rate: er.base_rate ?? er.rate, markup_percent: er.markup_percent ?? 0,
      is_favorite: !!er.is_favorite, auto_update: !!er.auto_update,
      source_url: er.source_url || '', script: er.script || '',
      update_time: er.update_time ? String(er.update_time).slice(0, 5) : '',
    })
    rows.push(`${q('Câmbio')},${q(`${er.from_currency} → ${er.to_currency}`)},,,,,${q(payload)}`)
  })
  itineraryTemplates.forEach(t => {
    const payload = JSON.stringify({ kind: t.kind, content: t.content || '' })
    rows.push(`${q('Modelos de Texto do Roteiro')},${q(t.name)},,,,,${q(payload)}`)
  })
  if (operatingCompany) {
    const o = operatingCompany
    const payload = JSON.stringify({
      company_name: o.company_name || '', cnpj: o.cnpj || '', seller: o.seller || '',
      phone: o.phone || '', mobile: o.mobile || '', email: o.email || '', address: o.address || '',
      pix_key_type: o.pix_key_type || '', pix_key: o.pix_key || '',
      default_signature_type: o.default_signature_type || 'fisica',
    })
    rows.push(`${q('Operadora')},${q(o.company_name || 'Operadora')},,,,,${q(payload)}`)
  }
  paymentPlans.forEach(p => {
    const payload = JSON.stringify({
      has_down_payment: !!p.has_down_payment, down_payment_mode: p.down_payment_mode || 'percent',
      down_payment_value: p.down_payment_value ?? 0, installments_count: p.installments_count ?? 0,
      payment_method: p.payment_method || '', first_due_days: p.first_due_days ?? 30, interval_days: p.interval_days ?? 30,
    })
    rows.push(`${q('Modelos de Pagamento')},${q(p.name)},,,,,${q(payload)}`)
  })
  downloadCsv(rows.join('\n'), filename, { model_label: 'Exportação CSV — Todas as configurações' })
}

function readCsv(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = (e) => {
      const lines = e.target.result.split(/\r?\n/)
      // pula a primeira linha se for cabeçalho "nome"
      const start = lines[0]?.trim().toLowerCase() === 'nome' ? 1 : 0
      const names = lines.slice(start)
        .map(l => l.trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
        .filter(Boolean)
      resolve(names)
    }
    reader.readAsText(file, 'utf-8')
  })
}

/* ── Shared styles ── */
const inp = {
  padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8,
  fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#0f172a',
  background: '#fff', transition: 'border-color .15s',
}
const btnPri = {
  padding: '8px 16px', borderRadius: 8, border: 'none',
  background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
}
const btnCsv = (color) => ({
  padding: '6px 11px', borderRadius: 7, border: `1.5px solid ${color}20`,
  background: `${color}10`, color, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
})

/* ── CsvButtons — abre popup de importação antes de navegar para revisão ── */
function CsvButtons({ items, filename, type, canImport = false, canExport = true }) {
  const navigate    = useNavigate()
  const [showPopup, setShowPopup] = useState(false)

  const handleFile = async (file) => {
    const csvText = await file.text()
    navigate('/configuracoes/import', {
      state: {
        csvText,
        filename:      file.name,
        type,
        existingNames: items.map(i => i.name),
        existingItems: items,
      }
    })
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {canExport && (
        <button style={btnCsv('#059669')} onClick={() => exportCsv(items, filename)} title="Exportar como CSV">
          ⬇ Exportar
        </button>
      )}
      {canImport && (
        <button style={btnCsv('#2e6db4')} onClick={() => setShowPopup(true)} title="Importar de CSV">
          ⬆ Importar
        </button>
      )}
      {canImport && showPopup && (
        <CsvImportPopup
          title="Importar CSV"
          sampleContent={CSV_SAMPLES[type]?.content}
          sampleFilename={CSV_SAMPLES[type]?.filename}
          onClose={() => setShowPopup(false)}
          onFile={handleFile}
        />
      )}
    </div>
  )
}

/* ── ItemList (Profissões / Idiomas) ── */
const ITEMLIST_PAGE_SIZE = 50

function ItemList({ items, loading, onDelete, onAdd, onUpdate, placeholder, addTitle, editTitle, filename, type, canImport = false, canExport = true, onImportWeb = null }) {
  const [search,    setSearch]    = useState('')
  const [confirm,   setConfirm]   = useState(null) // {id, name}
  const [showAdd,   setShowAdd]   = useState(false)
  const [editing,   setEditing]   = useState(null) // {id, name}
  const [importing, setImporting] = useState(false)
  const [page,      setPage]      = useState(1)

  const handleImportWeb = async () => {
    setImporting(true)
    try { await onImportWeb(); toast.success('Importação iniciada — acompanhe o progresso na barra lateral.') }
    catch { toast.error('Erro ao iniciar importação.') }
    finally { setImporting(false) }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return items.filter(i => i.name.toLowerCase().includes(q))
  }, [items, search])

  // Paginação client-side — listas longas (ex.: Profissões) ganham botões de
  // navegação embaixo, igual aos Aeroportos. Os botões só aparecem quando há
  // mais de uma página.
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMLIST_PAGE_SIZE))
  useEffect(() => { setPage(1) }, [search, items])
  const safePage = Math.min(page, totalPages)
  const pageItems = useMemo(
    () => filtered.slice((safePage - 1) * ITEMLIST_PAGE_SIZE, safePage * ITEMLIST_PAGE_SIZE),
    [filtered, safePage]
  )

  return (
    <>
    <div>
      {onImportWeb ? (
        /* Layout em duas linhas (igual ao Câmbio): botões utilitários
           centralizados em cima, busca + adicionar embaixo. */
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <CsvButtons items={items} filename={filename} type={type} canImport={canImport} canExport={canExport} />
            <button onClick={handleImportWeb} disabled={importing}
              style={{ padding:'6px 11px', borderRadius:7, border:'1.5px solid #7c3aed20', background:'#7c3aed10', color:'#7c3aed', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:4 }}
              title="Importar lista pronta da internet">
              {importing ? '⏳ Iniciando…' : '🌐 Importar da internet'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
              style={{ ...inp, flex: 1, minWidth: 160 }}
              onFocus={e => e.target.style.borderColor = '#1a2d4f'}
              onBlur={e  => e.target.style.borderColor = '#e2e8f0'} />
            {onAdd && <button onClick={() => setShowAdd(true)} style={btnPri}>+ Adicionar</button>}
          </div>
        </div>
      ) : (
        /* Toolbar padrão (uma linha): busca + adicionar + CSV */
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
            style={{ ...inp, flex: 1, minWidth: 160 }}
            onFocus={e => e.target.style.borderColor = '#1a2d4f'}
            onBlur={e  => e.target.style.borderColor = '#e2e8f0'} />
          {onAdd && <button onClick={() => setShowAdd(true)} style={btnPri}>+ Adicionar</button>}
          <CsvButtons items={items} filename={filename} type={type} canImport={canImport} canExport={canExport} />
        </div>
      )}

      <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px' }}>
        {loading ? 'Carregando…' : `${filtered.length} de ${items.length} ${items.length !== 1 ? 'itens' : 'item'}`}
      </p>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', maxHeight: 460, overflowY: 'auto' }}>
        {loading ? (
          <p style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 13 }}>Carregando…</p>
        ) : filtered.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 13 }}>
            {items.length === 0 ? 'Nenhum item.' : 'Nenhum resultado.'}
          </p>
        ) : pageItems.map((item, idx) => (
          <div key={item.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '9px 14px', fontSize: 13, color: '#0f172a',
            borderBottom: idx < pageItems.length - 1 ? '1px solid #f1f5f9' : 'none', background: '#fff',
          }}
            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
            onMouseLeave={e => e.currentTarget.style.background = '#fff'}
          >
            <span>{item.name}</span>
            {(onUpdate || onDelete) && (
              <div className="r-acts">
                {onUpdate && <button className="r-btn edit" title="Editar" onClick={() => setEditing({ id: item.id, name: item.name })}><Ic n="edit" s={13}/></button>}
                {onDelete && <button className="r-btn del"  title="Excluir" onClick={() => setConfirm({ id: item.id, name: item.name })}><Ic n="trash" s={13}/></button>}
              </div>
            )}
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:12, marginTop:10 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
            style={{ padding:'5px 12px', borderRadius:7, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:12, fontWeight:600, cursor: safePage <= 1 ? 'not-allowed' : 'pointer', fontFamily:'inherit', opacity: safePage <= 1 ? .5 : 1 }}>
            ‹ Anterior
          </button>
          <span style={{ fontSize:12, color:'#64748b' }}>Página {safePage} de {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
            style={{ padding:'5px 12px', borderRadius:7, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:12, fontWeight:600, cursor: safePage >= totalPages ? 'not-allowed' : 'pointer', fontFamily:'inherit', opacity: safePage >= totalPages ? .5 : 1 }}>
            Próxima ›
          </button>
        </div>
      )}
    </div>
    {confirm && onDelete && (
      <ConfirmModal
        message={`Remover "${confirm.name}"?`}
        onOk={() => { onDelete(confirm.id); setConfirm(null) }}
        onCancel={() => setConfirm(null)}
      />
    )}
    {showAdd && onAdd && (
      <AddItemModal
        title={addTitle || 'Adicionar item'}
        placeholder={placeholder}
        onAdd={onAdd}
        onClose={() => setShowAdd(false)}
      />
    )}
    {editing && onUpdate && (
      <NameFormModal
        title={editTitle || 'Editar item'}
        placeholder={placeholder}
        initial={editing.name}
        onSave={(name) => onUpdate(editing.id, name)}
        onClose={() => setEditing(null)}
      />
    )}
  </>
  )
}

/* ── Pop-up para adicionar um item com campo de texto ── */
function AddItemModal({ title, placeholder, onAdd, onClose }) {
  const [val,    setVal]    = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  const handleSave = async () => {
    const v = val.trim(); if (!v) return
    setSaving(true)
    try { await onAdd(v); onClose() }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:600, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:380, boxShadow:'0 32px 80px rgba(0,0,0,.25)' }}>
        <div style={{ padding:'18px 22px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>{title}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>
        <div style={{ padding:'18px 22px' }}>
          <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder={placeholder} style={{ ...inp, width:'100%' }}
            onFocus={e => e.target.style.borderColor = '#1a2d4f'}
            onBlur={e  => e.target.style.borderColor = '#e2e8f0'} />
        </div>
        <div style={{ padding:'14px 22px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'flex-end', gap:8 }}>
          <button onClick={onClose}
            style={{ padding:'8px 16px', borderRadius:8, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !val.trim()} style={{ ...btnPri, opacity: (saving || !val.trim()) ? .6 : 1 }}>
            {saving ? 'Adicionando…' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Pop-up genérico para exibir o conteúdo de uma lista ── */
function ListDetailModal({ title, onClose, wide, children }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:500, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth: wide ? 980 : 540, maxHeight:'88vh', display:'flex', flexDirection:'column', boxShadow:'0 32px 80px rgba(0,0,0,.25)' }}>
        <div style={{ padding:'18px 24px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'#0f172a' }}>{title}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

/* ── Barra de CSV global da aba Países & Estados ── */
function GeoCsvBar({ canEdit = true, canImport = false, canImportWeb = false, canExport = true, onImportCascade, importingCascade = false }) {
  const navigate  = useNavigate()
  const [exporting,  setExporting]  = useState(false)
  const [showPopup,  setShowPopup]  = useState(false)

  const doExport = async () => {
    setExporting(true)
    await handleGeoExport()
    setExporting(false)
  }

  const handleFile = async (file) => {
    const csvText = await file.text()
    navigate('/configuracoes/geo-import', { state: { csvText, filename: file.name } })
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', padding: '10px 14px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
      <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600, flex: 1 }}>
        CSV unificado — <span style={{ fontWeight: 400, color: '#94a3b8' }}>colunas: continente, pais, estado, cidade</span>
      </span>
      {canExport && (
        <button onClick={doExport} disabled={exporting}
          style={{ ...btnCsv('#059669'), opacity: exporting ? .6 : 1 }}>
          <Ic n="dl" s={12} /> {exporting ? 'Exportando…' : 'Exportar tudo'}
        </button>
      )}
      {canImport && (
        <button onClick={() => setShowPopup(true)} style={btnCsv('#2e6db4')}>
          <Ic n="ul" s={12} /> Importar CSV
        </button>
      )}
      {canImportWeb && (
        <button onClick={onImportCascade} disabled={importingCascade} style={btnCsv('#7c3aed')}
          title="Importa todos os países e, em cascata, os estados e cidades de cada um — pode levar bastante tempo">
          <Ic n="globe" s={12} /> {importingCascade ? 'Iniciando…' : 'Importar tudo da internet'}
        </button>
      )}
      {canImport && showPopup && (
        <CsvImportPopup
          title="Importar Países, Estados e Cidades"
          sampleContent={CSV_SAMPLES.geo.content}
          sampleFilename={CSV_SAMPLES.geo.filename}
          onClose={() => setShowPopup(false)}
          onFile={handleFile}
        />
      )}
    </div>
  )
}

/* ── Estilos de coluna (módulo-level para não recriar a cada render) ── */
const colAddInp = { ...inp, flex: 1, minWidth: 0, fontSize: 12, padding: '7px 10px' }
const colAddBtn = { ...btnPri, fontSize: 12, padding: '7px 10px', whiteSpace: 'nowrap' }
const colBox    = { border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', maxHeight: 380, overflowY: 'auto' }

/* Pop-up para criar/editar um nome simples (país, estado, cidade) — mesmo padrão do sistema */
export function NameFormModal({ title, placeholder, initial, onSave, onClose }) {
  const [val,    setVal]    = useState(initial ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  const handleSave = async () => {
    const v = val.trim(); if (!v) return
    setSaving(true)
    try { await onSave(v); onClose() }
    finally { setSaving(false) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="mbox" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">{title}</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="mbody">
          <div className="ff" style={{ marginBottom: 0 }}>
            <input ref={inputRef} className="fi" value={val} onChange={e => setVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder={placeholder} />
          </div>
        </div>
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !val.trim()}>
            {saving ? 'Salvando…' : (initial != null ? 'Salvar' : '+ Adicionar')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* Col é um componente de módulo (nunca redefinido dentro de CountriesTab) */
function Col({ title, count, search, onSearch, onAddClick, addDisabled, loading, canEdit = true, onImportWeb, importingWeb, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: 0, whiteSpace: 'nowrap' }}>
          {title}
          {count != null && <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400, marginLeft: 5 }}>({count})</span>}
        </h3>
        {onImportWeb && (
          <button onClick={onImportWeb} disabled={addDisabled || importingWeb} title="Importar da internet"
            style={{ flexShrink:0, display:'flex', alignItems:'center', padding:'4px 8px', borderRadius:6, border:'1.5px solid #7c3aed20', background:'#7c3aed10', color:'#7c3aed', cursor: addDisabled ? 'default' : 'pointer', fontFamily:'inherit', opacity: addDisabled ? .5 : 1 }}>
            <Ic n={importingWeb ? 'clock' : 'globe'} s={12} />
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
        <input value={search} onChange={e => onSearch(e.target.value)} placeholder="Buscar…"
          style={{ ...colAddInp }}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'}
          onBlur={e  => e.target.style.borderColor = '#e2e8f0'} />
        {canEdit && (
          <button onClick={onAddClick} disabled={addDisabled} style={{ ...colAddBtn, opacity: addDisabled ? .5 : 1, cursor: addDisabled ? 'default' : 'pointer' }}>
            + Adicionar
          </button>
        )}
      </div>
      <div style={colBox}>
        {loading
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>Carregando…</p>
          : children}
      </div>
    </div>
  )
}

/* Linha de país/estado/cidade — com ações de editar/excluir no padrão do sistema */
function GeoRow({ label, extra, selected, onClick, onEdit, onDelete, canEdit = true, canDelete = true }) {
  return (
    <div onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        padding: '6px 6px 6px 10px', fontSize: 12, cursor: onClick ? 'pointer' : 'default',
        borderBottom: '1px solid #f1f5f9',
        background: selected ? '#f0f6ff' : '#fff',
        borderLeft: selected ? '3px solid #2e6db4' : '3px solid transparent',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#f8fafc' }}
      onMouseLeave={e => { e.currentTarget.style.background = selected ? '#f0f6ff' : '#fff' }}
    >
      <span style={{ fontWeight: selected ? 600 : 400, color: selected ? '#2e6db4' : '#0f172a', fontSize: 12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
        {label}
        {extra != null && <span style={{ color: '#94a3b8', marginLeft: 5, fontWeight: 400 }}>{extra}</span>}
      </span>
      {(canEdit || canDelete) && (
        <div style={{ display:'flex', gap:3, flexShrink:0 }} onClick={e => e.stopPropagation()}>
          {canEdit   && <button className="r-btn edit" title="Editar"  style={{ width:24, height:24 }} onClick={onEdit}><Ic n="edit"  s={11}/></button>}
          {canDelete && <button className="r-btn del"  title="Excluir" style={{ width:24, height:24 }} onClick={onDelete}><Ic n="trash" s={11}/></button>}
        </div>
      )}
    </div>
  )
}

/* ── CountriesTab ── */
function CountriesTab({ canEdit = true, canDelete = true, canImport = false, canImportWeb = false, canExport = true }) {
  const [continents,   setContinents]   = useState([])
  const [selContinent, setSelContinent] = useState(null)
  const [countries,  setCountries]  = useState([])
  const [selCountry, setSelCountry] = useState(null)
  const [states,     setStates]     = useState([])
  const [selState,   setSelState]   = useState(null)
  const [cities,     setCities]     = useState([])
  const [loadingCo,  setLoadingCo]  = useState(true)
  const [loadingC,   setLoadingC]   = useState(true)
  const [loadingS,   setLoadingS]   = useState(false)
  const [loadingCi,  setLoadingCi]  = useState(false)
  const [searchCo,   setSearchCo]   = useState('')
  const [searchC,    setSearchC]    = useState('')
  const [searchS,    setSearchS]    = useState('')
  const [searchCi,   setSearchCi]   = useState('')
  const [confirm,    setConfirm]    = useState(null) // {action, id, name}
  const [importingWeb, setImportingWeb] = useState(null) // 'country'|'state'|'city'|null
  const [form,       setForm]       = useState(null) // {kind:'continent'|'country'|'state'|'city', item?}

  const loadContinents = () => {
    setLoadingCo(true)
    configApi.continents().then(r => setContinents(r.data)).catch(() => {}).finally(() => setLoadingCo(false))
  }
  const loadCountries = () => {
    setLoadingC(true)
    configApi.countries().then(r => setCountries(r.data)).catch(() => {}).finally(() => setLoadingC(false))
  }
  const selectContinent = (continent) => {
    setSelContinent(continent); setSelCountry(null); setSelState(null)
    setStates([]); setCities([])
  }
  const loadStates = (country) => {
    setSelCountry(country); setSelState(null); setCities([])
    setStates([]); setLoadingS(true)
    configApi.states(country.id).then(r => setStates(r.data)).catch(() => {}).finally(() => setLoadingS(false))
  }
  const loadCities = (state) => {
    setSelState(state); setCities([]); setLoadingCi(true)
    configApi.cities(state.id).then(r => setCities(r.data)).catch(() => {}).finally(() => setLoadingCi(false))
  }

  useEffect(() => { loadContinents(); loadCountries() }, [])

  const { user } = useAuth()
  const wsUrl = user ? dashboardWsUrl() : null
  useWebSocket(wsUrl, useCallback((msg) => {
    if (msg.type !== 'job' || msg.status !== 'done') return
    if (msg.kind === 'countries' || msg.kind === 'countries_cascade') loadCountries()
    if ((msg.kind === 'states' || msg.kind === 'countries_cascade') && selCountry) loadStates(selCountry)
    if ((msg.kind === 'cities' || msg.kind === 'countries_cascade') && selState) loadCities(selState)
  }, [selCountry, selState]))

  const addContinent = async (name) => {
    try { const r = await configApi.addContinent(name); setContinents(c => [...c, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt'))) }
    catch { toast.error('Erro ao adicionar continente.') }
  }
  const updateContinent = async (id, name) => {
    try {
      const r = await configApi.updateContinent(id, name)
      setContinents(c => c.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
      if (selContinent?.id === id) setSelContinent(r.data)
    } catch { toast.error('Erro ao salvar continente.') }
  }
  const delContinent = async (id) => {
    try {
      await configApi.delContinent(id)
      setContinents(c => c.filter(x => x.id !== id))
      if (selContinent?.id === id) selectContinent(null)
    } catch { toast.error('Erro ao remover continente.') }
  }
  const addCountry = async (name) => {
    try { await configApi.addCountry(name, '', selContinent?.id ?? null); loadCountries() }
    catch { toast.error('Erro ao adicionar país.') }
  }
  const updateCountry = async (id, name) => {
    try {
      await configApi.updateCountry(id, name)
      if (selCountry?.id === id) setSelCountry(c => ({ ...c, name }))
      loadCountries()
    } catch { toast.error('Erro ao salvar país.') }
  }
  const delCountry = async (id) => {
    try {
      await configApi.delCountry(id)
      if (selCountry?.id === id) { setSelCountry(null); setStates([]); setSelState(null); setCities([]) }
      loadCountries()
    } catch { toast.error('Erro ao remover país.') }
  }
  const addState = async (name) => {
    if (!selCountry) return
    try { await configApi.addState(selCountry.id, name, ''); loadStates(selCountry) }
    catch { toast.error('Erro ao adicionar estado.') }
  }
  const updateState = async (id, name) => {
    try {
      await configApi.updateState(id, name)
      if (selState?.id === id) setSelState(s => ({ ...s, name }))
      if (selCountry) loadStates(selCountry)
    } catch { toast.error('Erro ao salvar estado.') }
  }
  const delState = async (id) => {
    try {
      await configApi.delState(id)
      if (selState?.id === id) { setSelState(null); setCities([]) }
      setStates(s => s.filter(x => x.id !== id))
    } catch { toast.error('Erro ao remover estado.') }
  }
  const addCity = async (name) => {
    if (!selState) return
    try { await configApi.addCity(selState.id, name); loadCities(selState) }
    catch { toast.error('Erro ao adicionar cidade.') }
  }
  const updateCity = async (id, name) => {
    try { await configApi.updateCity(id, name); if (selState) loadCities(selState) }
    catch { toast.error('Erro ao salvar cidade.') }
  }
  const delCity = async (id) => {
    try { await configApi.delCity(id); setCities(c => c.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover cidade.') }
  }

  const importWeb = async (kind, fn) => {
    setImportingWeb(kind)
    try { await fn(); toast.success('Importação iniciada — acompanhe o progresso na barra lateral.') }
    catch { toast.error('Erro ao iniciar importação.') }
    finally { setImportingWeb(null) }
  }
  const importCountriesWeb = () => importWeb('country', () => configApi.importCountries())
  const importStatesWeb    = () => selCountry && importWeb('state', () => configApi.importStates(selCountry.id))
  const importCitiesWeb    = () => selState   && importWeb('city',  () => configApi.importCities(selState.id))
  const importCascadeWeb   = () => importWeb('cascade', () => configApi.importCountriesCascade())

  const filteredCo = useMemo(() => { const q = searchCo.toLowerCase(); return continents.filter(c => c.name.toLowerCase().includes(q)) }, [continents, searchCo])
  const filteredC  = useMemo(() => {
    const q = searchC.toLowerCase()
    return countries
      .filter(c => !selContinent || c.continent === selContinent.id)
      .filter(c => c.name.toLowerCase().includes(q))
  }, [countries, searchC, selContinent])
  const filteredS  = useMemo(() => { const q = searchS.toLowerCase();  return states.filter(s => s.name.toLowerCase().includes(q)) }, [states, searchS])
  const filteredCi = useMemo(() => { const q = searchCi.toLowerCase(); return cities.filter(c => c.name.toLowerCase().includes(q)) }, [cities, searchCi])

  const countryCountByContinent = useMemo(() => {
    const m = {}
    countries.forEach(c => { if (c.continent) m[c.continent] = (m[c.continent] || 0) + 1 })
    return m
  }, [countries])

  const formSave = async (name) => {
    if (form.kind === 'continent') return form.item ? updateContinent(form.item.id, name) : addContinent(name)
    if (form.kind === 'country')   return form.item ? updateCountry(form.item.id, name) : addCountry(name)
    if (form.kind === 'state')     return form.item ? updateState(form.item.id, name)   : addState(name)
    if (form.kind === 'city')      return form.item ? updateCity(form.item.id, name)    : addCity(name)
  }
  const formTitles = {
    continent: form?.item ? 'Editar continente' : 'Novo continente',
    country:   form?.item ? 'Editar país'   : 'Novo país',
    state:     form?.item ? 'Editar estado' : 'Novo estado',
    city:      form?.item ? 'Editar cidade' : 'Nova cidade',
  }
  const formPlaceholders = { continent: 'Nome do continente…', country: 'Nome do país…', state: 'Nome do estado…', city: 'Nome da cidade…' }

  return (
    <>
    <GeoCsvBar canEdit={canEdit} canImport={canImport} canImportWeb={canImportWeb} canExport={canExport}
      onImportCascade={importCascadeWeb} importingCascade={importingWeb === 'cascade'} />
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14 }}>
      {/* ── Continentes ── */}
      <Col title="Continentes" count={continents.length}
        search={searchCo} onSearch={setSearchCo}
        onAddClick={() => setForm({ kind:'continent' })}
        loading={loadingCo} canEdit={canEdit}
      >
        {filteredCo.length === 0
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>Nenhum continente.</p>
          : filteredCo.map(c => (
            <GeoRow key={c.id}
              label={c.name}
              extra={countryCountByContinent[c.id] > 0 ? countryCountByContinent[c.id] : null}
              selected={selContinent?.id === c.id}
              onClick={() => selectContinent(c)}
              onEdit={() => setForm({ kind:'continent', item:c })}
              onDelete={() => setConfirm({ action:'continent', id:c.id, name:c.name })}
              canEdit={canEdit} canDelete={canDelete}
            />
          ))
        }
      </Col>

      {/* ── Países ── */}
      <Col title={selContinent ? `${selContinent.name} — Países` : 'Países'}
        count={selContinent ? filteredC.length : null}
        search={searchC} onSearch={setSearchC}
        onAddClick={() => setForm({ kind:'country' })}
        addDisabled={!selContinent}
        loading={loadingC} canEdit={canEdit}
        onImportWeb={canImportWeb ? importCountriesWeb : null} importingWeb={importingWeb === 'country'}
      >
        {!selContinent
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>← Selecione um continente</p>
          : filteredC.length === 0
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>Nenhum país.</p>
          : filteredC.map(c => (
            <GeoRow key={c.id}
              label={c.name}
              extra={c.state_count > 0 ? c.state_count : null}
              selected={selCountry?.id === c.id}
              onClick={() => loadStates(c)}
              onEdit={() => setForm({ kind:'country', item:c })}
              onDelete={() => setConfirm({ action:'country', id:c.id, name:c.name })}
              canEdit={canEdit} canDelete={canDelete}
            />
          ))
        }
      </Col>

      {/* ── Estados ── */}
      <Col title={selCountry ? `${selCountry.name} — Estados` : 'Estados'}
        count={selCountry ? states.length : null}
        search={searchS} onSearch={setSearchS}
        onAddClick={() => setForm({ kind:'state' })}
        addDisabled={!selCountry}
        loading={loadingS} canEdit={canEdit}
        onImportWeb={canImportWeb ? importStatesWeb : null} importingWeb={importingWeb === 'state'}
      >
        {!selCountry
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>← Selecione um país</p>
          : filteredS.length === 0
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>Nenhum estado.</p>
          : filteredS.map(s => (
            <GeoRow key={s.id}
              label={s.name}
              extra={[s.code, s.city_count > 0 ? s.city_count : null].filter(Boolean).join(' · ') || null}
              selected={selState?.id === s.id}
              onClick={() => loadCities(s)}
              onEdit={() => setForm({ kind:'state', item:s })}
              onDelete={() => setConfirm({ action:'state', id:s.id, name:s.name })}
              canEdit={canEdit} canDelete={canDelete}
            />
          ))
        }
      </Col>

      {/* ── Cidades ── */}
      <Col title={selState ? `${selState.name} — Cidades` : 'Cidades'}
        count={selState ? cities.length : null}
        search={searchCi} onSearch={setSearchCi}
        onAddClick={() => setForm({ kind:'city' })}
        addDisabled={!selState}
        loading={loadingCi} canEdit={canEdit}
        onImportWeb={canImportWeb ? importCitiesWeb : null} importingWeb={importingWeb === 'city'}
      >
        {!selState
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>← Selecione um estado</p>
          : filteredCi.length === 0
          ? <p style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>Nenhuma cidade.</p>
          : filteredCi.map(c => (
            <GeoRow key={c.id}
              label={c.name}
              selected={false}
              onEdit={() => setForm({ kind:'city', item:c })}
              onDelete={() => setConfirm({ action:'city', id:c.id, name:c.name })}
              canEdit={canEdit} canDelete={canDelete}
            />
          ))
        }
      </Col>
    </div>
    {canEdit && form && (
      <NameFormModal
        title={formTitles[form.kind]}
        placeholder={formPlaceholders[form.kind]}
        initial={form.item ? form.item.name : null}
        onSave={formSave}
        onClose={() => setForm(null)}
      />
    )}
    {confirm && (
      <ConfirmModal
        message={`Remover "${confirm.name}"?`}
        onOk={() => {
          if (confirm.action === 'continent') delContinent(confirm.id)
          if (confirm.action === 'country')   delCountry(confirm.id)
          if (confirm.action === 'state')     delState(confirm.id)
          if (confirm.action === 'city')      delCity(confirm.id)
          setConfirm(null)
        }}
        onCancel={() => setConfirm(null)}
      />
    )}
    </>
  )
}

/* ── Página principal ── */
/* Listas configuráveis */
/* Áreas usadas no filtro da grade de Configurações — cada lista pode ser
 * relevante para mais de uma área (ex: Aeroportos serve Listas e Contratos). */
const AREA_DEFS = [
  { key:'passageiros', label:'Passageiros',            icon:'users' },
  { key:'agencias',    label:'Agências',               icon:'building' },
  { key:'contratos',   label:'Contratos',               icon:'docs' },
  { key:'roteiros',    label:'Roteiros',               icon:'mapicon' },
  { key:'listas',      label:'Listas de Passageiros',  icon:'plane' },
  { key:'sistema',     label:'Sistema',                icon:'settings' },
]

const LIST_DEFS = [
  { key:'doc_types',        label:'Documentos',               perm:'settings_doc_types',       areas:['passageiros'] },
  { key:'perm_profiles',    label:'Perfis de permissão',      perm:'settings_user_profiles',    areas:['sistema'] },
  { key:'professions',      label:'Profissões',               perm:'settings_professions',      areas:['passageiros'] },
  { key:'languages',        label:'Idiomas',                  perm:'settings_languages',        areas:['passageiros'] },
  { key:'vaccines',         label:'Vacinas',                  perm:'settings_vaccines',         areas:['passageiros'] },
  { key:'genders',          label:'Gêneros',                  perm:'settings_genders',          areas:['passageiros'] },
  { key:'itinerary_categories', label:'Categorias de Roteiro', perm:'settings_itinerary_categories', areas:['roteiros'] },
  { key:'destinations',     label:'Destinos',                 perm:'settings_destinations',     areas:['roteiros'] },
  { key:'holidays',         label:'Feriados',                 perm:'settings_holidays',         areas:['roteiros'] },
  { key:'services',         label:'Serviços',                 perm:'settings_services',         areas:['roteiros'] },
  { key:'itinerary_templates', label:'Modelos de Texto do Roteiro', perm:'settings_itinerary_templates', extraPerm:'settings_payment_methods', areas:['roteiros','contratos'] },
  { key:'prof_cards',       label:'Carteiras',                perm:'settings_prof_cards',        areas:['passageiros'] },
  { key:'list_addits',      label:'Adicionais de Lista',      perm:'settings_list_additionals', areas:['listas'] },
  { key:'crew_roles',       label:'Equipe técnica',           perm:'settings_crew_roles',        areas:['listas'] },
  { key:'accommodations',   label:'Tipos de Acomodação',      perm:'settings_accommodations',   areas:['listas','contratos'] },
  { key:'list_categories',  label:'Categoria de Acomodações', perm:'settings_list_categories',  areas:['listas'] },
  { key:'countries',        label:'Países & Estados',         perm:'settings_countries',         areas:['passageiros','roteiros','agencias'] },
  { key:'airports',         label:'Aeroportos',               perm:'settings_airports',          areas:['listas','contratos'] },
  { key:'airlines',         label:'Companhias Aéreas',        perm:'settings_airlines',          areas:['listas'] },
  { key:'bus_maps',         label:'Mapas de Ônibus',          perm:'settings_bus_maps',          areas:['listas'] },
  { key:'contract_clauses', label:'Cláusulas de Contrato',    perm:'settings_contract_clauses', areas:['contratos'] },
  { key:'operating_company', label:'Operadora',               perm:'settings_operating_company', areas:['contratos','sistema'] },
  { key:'terms',            label:'Termos e Condições',       perm:'settings_terms',             areas:['sistema'] },
  { key:'payment_methods',  label:'Formas de Pagamento',      perm:'settings_payment_methods',  areas:['contratos'] },
  // "Modelos de Pagamento" deixou de ser um card próprio: virou uma aba dentro
  // de "Modelos de Texto do Roteiro" (ver ItineraryTemplatesManager).
  { key:'exchange_rates',   label:'Câmbio',                   perm:'settings_exchange_rates',   areas:['contratos'] },
]
const WIDE_LISTS = ['doc_types', 'perm_profiles', 'accommodations', 'countries', 'airports', 'airlines', 'bus_maps', 'contract_clauses', 'terms', 'itinerary_templates']

function exportEmailsCsv(emails) {
  const rows = ['email', ...emails.map(e => `"${e.replace(/"/g, '""')}"`)]
  downloadCsv(rows.join('\n'), 'emails_automaticos.csv', { model_label: 'Exportação CSV — E-mails automáticos' })
}

/* ── Dropdown de filtro por área — fica ao lado da barra de busca ── */
function AreaFilterDropdown({ areas, selected, onToggle, onClear }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const active = selected.size > 0

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '10px 15px', borderRadius: 10,
          border: `1.5px solid ${active ? '#1a2d4f' : '#dbe2ec'}`, background: active ? '#eef2f7' : '#fff',
          color: active ? '#1a2d4f' : '#475569', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
          fontFamily: 'inherit', whiteSpace: 'nowrap',
        }}>
        <Ic n="filter" s={14} /> Área{active ? ` (${selected.size})` : ''}
        <span style={{ fontSize: 9, opacity: .7, marginLeft: 2 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200, minWidth: 250,
          background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
          boxShadow: '0 8px 24px rgba(0,0,0,.10)', overflow: 'hidden',
        }}>
          <div style={{ maxHeight: 280, overflowY: 'auto', padding: '6px 0' }}>
            {areas.map(a => {
              const checked = selected.has(a.key)
              return (
                <label key={a.key}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer', fontSize: 13.5, color: '#1e293b' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <input type="checkbox" checked={checked} onChange={() => onToggle(a.key)}
                    style={{ width: 15, height: 15, accentColor: '#1a2d4f', cursor: 'pointer', flexShrink: 0 }} />
                  <span style={{ color: '#64748b', display: 'flex', flexShrink: 0 }}><Ic n={a.icon} s={14} /></span>
                  {a.label}
                </label>
              )
            })}
          </div>
          {active && (
            <button type="button" onClick={onClear}
              style={{ width: '100%', padding: '10px 14px', border: 'none', borderTop: '1px solid #f1f5f9', background: '#fff', color: '#dc2626', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
              Limpar filtro
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Gerenciador de Perfis de Permissão ─────────────────────────────────────── */

export function ProfileModal({ profile, onClose, onSaved }) {
  const isEdit = !!profile
  const [name,    setName]    = useState(profile?.name ?? '')
  const [perms,   setPerms]   = useState(sanitizePerms({ ...EMPTY_PERMISSIONS, ...(profile?.permissions ?? {}) }))
  const [isAgencyDefault, setIsAgencyDefault] = useState(profile?.is_agency_default ?? false)
  const [saving,  setSaving]  = useState(false)

  const setPerm    = (key, val)  => setPerms(p => applyPermChanges(p, { [key]: val }))
  const setPermAll = (keys, val) => setPerms(p => applyPermChanges(p, Object.fromEntries(keys.map(k => [k, val]))))
  const setFormForBar = fn => {
    const prev = { permissions: perms }
    const next = fn(prev)
    setPerms(next.permissions)
  }

  const save = async () => {
    if (!name.trim()) { toast.error('Informe um nome para o perfil.'); return }
    setSaving(true)
    try {
      if (isEdit) {
        await configApi.updatePermissionProfile(profile.id, { name: name.trim(), permissions: perms, is_agency_default: isAgencyDefault })
        toast.success('Perfil atualizado.')
      } else {
        await configApi.addPermissionProfile({ name: name.trim(), permissions: perms, is_agency_default: isAgencyDefault })
        toast.success('Perfil criado.')
      }
      onSaved()
    } catch (e) { toast.error(e.response?.data?.name?.[0] ?? e.response?.data?.error ?? 'Erro ao salvar.') }
    finally { setSaving(false) }
  }

  const lbl = { fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em', display:'block', marginBottom:5 }
  const inp = { width:'100%', padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:6, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b', boxSizing:'border-box' }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:500, padding:20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:760, maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 64px rgba(0,0,0,.24)', animation:'mIn .15s ease' }}>
        <div style={{ padding:'16px 20px 14px', borderBottom:'1px solid #e2e8f0', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
          <p style={{ fontSize:14, fontWeight:600, color:'#1e293b', margin:0 }}>
            {isEdit ? 'Editar perfil' : 'Novo perfil de permissão'}
            {isEdit && <span style={{ fontSize:12, fontWeight:400, color:'#94a3b8', marginLeft:8 }}>{profile.name}</span>}
          </p>
          <button type="button" onClick={onClose} title="Fechar" style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', padding:4, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, flexShrink:0 }}><Ic n="x" s={16}/></button>
        </div>
        <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:14, overflowY:'auto' }}>
          <div>
            <label style={lbl}>Nome do perfil</label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Vendedor, Atendente…" />
          </div>
          <label style={{ display:'flex', alignItems:'flex-start', gap:8, cursor:'pointer' }}>
            <input type="checkbox" checked={isAgencyDefault} onChange={e => setIsAgencyDefault(e.target.checked)}
              style={{ width:15, height:15, marginTop:2, accentColor:'#1a2d4f', cursor:'pointer', flexShrink:0 }} />
            <span style={{ fontSize:13, color:'#475569', lineHeight:1.5 }}>
              <strong>Perfil padrão dos usuários de agência</strong> — todo usuário criado dentro de uma agência recebe automaticamente estas permissões. (Só um perfil pode ser o padrão.)
            </span>
          </label>
          <div style={{ borderTop:'1px solid #f1f5f9', paddingTop:12, display:'flex', flexDirection:'column', gap:6 }}>
            <PermPresetBar setForm={setFormForBar} />
            {PERM_GROUPS.map(g => (
              <PermAccordionItem key={g.title} group={g} permissions={perms} onToggle={setPerm} onToggleAll={setPermAll} />
            ))}
          </div>
        </div>
        <div style={{ padding:'12px 20px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'space-between' }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding:'8px 16px', borderRadius:7, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
          <button onClick={save} disabled={saving}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 18px', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            <Ic n="check" s={13}/>{saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar perfil'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PermissionProfilesManager({ canEdit = true, canDelete = true, canImport = false, canExport = true }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [profiles,        setProfiles]        = useState([])
  const [loading,         setLoading]         = useState(true)
  const [search,          setSearch]          = useState('')
  const [modal,           setModal]           = useState(null)
  const [delItem,         setDelItem]         = useState(null)
  const [showImportPopup, setShowImportPopup] = useState(false)
  const [showTrash,       setShowTrash]       = useState(false)
  const [deletedRows,     setDeletedRows]     = useState([])

  const load = useCallback(() => {
    setLoading(true)
    configApi.permissionProfiles()
      .then(r => setProfiles(r.data))
      .catch(() => toast.error('Erro ao carregar perfis.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const loadDeleted = useCallback(() => {
    if (!canDelete) return
    configApi.deletedPermissionProfiles().then(r => setDeletedRows(r.data.results ?? r.data)).catch(() => {})
  }, [canDelete])
  useEffect(() => { loadDeleted() }, [loadDeleted, showTrash])

  const deletedCount = deletedRows.length
  const canPurge = !!user?.is_superuser && !!user?.allow_hard_delete
  const reloadAll = () => { load(); loadDeleted() }

  const handleDelete = async () => {
    try { await configApi.delPermissionProfile(delItem.id); reloadAll() }
    catch { toast.error('Erro ao excluir perfil.') }
    finally { setDelItem(null) }
  }

  const getLabel = (row) => row.name || `#${row.id}`

  const handleImport = async (file) => {
    const csvText = await file.text()
    navigate('/configuracoes/import', {
      state: {
        csvText, filename: file.name, type: 'perm_profiles',
        existingNames: profiles.map(p => p.name),
        existingItems: profiles,
      },
    })
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const src = showTrash ? deletedRows : profiles
    return src.filter(p => (p.name || '').toLowerCase().includes(q))
  }, [profiles, deletedRows, showTrash, search])

  const trashTabBar = canDelete && (
    <div style={{ display:'flex', gap:0, borderBottom:'1.5px solid #e2e8f0', marginBottom:12 }}>
      {[{ key:false, label:'Perfis', color:'#2563eb' }, { key:true, label:'Excluídos', color:'#dc2626' }].map(t => {
        const sel = showTrash === t.key
        return (
          <button key={String(t.key)} type="button" onClick={() => setShowTrash(t.key)}
            style={{
              display:'flex', alignItems:'center', gap:8,
              padding:'10px 20px', border:'none', cursor:'pointer', fontFamily:'inherit',
              background:'transparent', fontSize:13.5, fontWeight: sel ? 600 : 400,
              color: sel ? t.color : '#94a3b8',
              borderBottom: sel ? `2px solid ${t.color}` : '2px solid transparent',
              marginBottom:'-1.5px', transition:'color .15s, border-color .15s',
              outline:'none',
            }}>
            {t.label}
            {t.key && (
              <span style={{
                fontSize:11, fontWeight:600, padding:'1px 8px', borderRadius:20,
                background: sel ? '#fee2e2' : '#f1f5f9',
                color:      sel ? t.color : '#94a3b8',
              }}>
                {deletedCount}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )

  return (
    <>
    <div>
      {trashTabBar}
      <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center', flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
          style={{ ...inp, flex:1, minWidth:160 }}
          onFocus={e => e.target.style.borderColor='#1a2d4f'}
          onBlur={e  => e.target.style.borderColor='#e2e8f0'} />
        {!showTrash && canEdit && <button onClick={() => setModal('new')} style={btnPri}>+ Adicionar</button>}
        {!showTrash && (
          <div style={{ display:'flex', gap:6 }}>
            {canExport && <button style={btnCsv('#059669')} onClick={() => exportSectionCsv('perm_profiles', 'Perfis de Permissão', profiles, 'perfis_permissao.csv')} title="Exportar como CSV">⬇ Exportar</button>}
            {canImport && <button style={btnCsv('#2e6db4')} onClick={() => setShowImportPopup(true)} title="Importar de CSV">⬆ Importar</button>}
            {canImport && showImportPopup && (
              <CsvImportPopup
                title="Importar Perfis de Permissão"
                sampleContent={CSV_SAMPLES.perm_profiles?.content}
                sampleFilename={CSV_SAMPLES.perm_profiles?.filename}
                onClose={() => setShowImportPopup(false)}
                onFile={handleImport}
              />
            )}
          </div>
        )}
      </div>

      <p style={{ fontSize:12, color:'#94a3b8', margin:'0 0 8px' }}>
        {loading && !showTrash ? 'Carregando…' : showTrash
          ? `${filtered.length} de ${deletedRows.length} ${deletedRows.length !== 1 ? 'perfis' : 'perfil'}`
          : `${filtered.length} de ${profiles.length} ${profiles.length !== 1 ? 'perfis' : 'perfil'}`}
      </p>

      <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden', maxHeight:460, overflowY:'auto' }}>
        {loading && !showTrash ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
        ) : filtered.length === 0 ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>
            {showTrash
              ? (deletedRows.length === 0 ? 'Nenhum perfil excluído.' : 'Nenhum resultado.')
              : (profiles.length === 0 ? 'Nenhum perfil criado ainda.' : 'Nenhum resultado.')}
          </p>
        ) : filtered.map((p, idx) => {
          const count = Object.values(p.permissions ?? {}).filter(Boolean).length
          return (
            <div key={p.id} style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'9px 14px', fontSize:13, color:'#0f172a',
              borderBottom: idx < filtered.length - 1 ? '1px solid #f1f5f9' : 'none', background:'#fff',
            }}
              onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
              onMouseLeave={e => e.currentTarget.style.background='#fff'}>
              <div>
                <span style={{ fontWeight:500 }}>{p.name}</span>
                <span style={{ marginLeft:10, fontSize:12, color:'#94a3b8' }}>{count} permiss{count !== 1 ? 'ões' : 'ão'}</span>
              </div>
              {showTrash ? (
                <div className="r-acts" style={{ display:'flex', gap:6 }}>
                  <TrashRowActions
                    row={p}
                    getLabel={getLabel}
                    onRestore={configApi.restorePermissionProfile}
                    onPurge={configApi.purgePermissionProfile}
                    canPurge={canPurge}
                    onChanged={reloadAll}
                  />
                </div>
              ) : (canEdit || canDelete) && (
                <div className="r-acts">
                  {canEdit   && <button className="r-btn edit" title="Editar"  onClick={() => setModal(p)}><Ic n="edit"  s={13}/></button>}
                  {canDelete && <button className="r-btn del"  title="Excluir" onClick={() => setDelItem(p)}><Ic n="trash" s={13}/></button>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
    {modal && (
      <ProfileModal
        profile={modal === 'new' ? null : modal}
        onClose={() => setModal(null)}
        onSaved={() => { setModal(null); load() }}
      />
    )}
    {delItem && (
      <ConfirmModal
        message={`Excluir o perfil "${delItem.name}"? Vai pra aba "Excluídos" — um superusuário pode restaurar depois. Usuários que o têm aplicado não serão alterados.`}
        onOk={handleDelete}
        onCancel={() => setDelItem(null)}
      />
    )}
    </>
  )
}

/* ── Modal "Importar tudo da internet" — escolhe quais seções importar, cada uma roda em
   background com sua própria barra de progresso na sidebar ── */
function ImportWebModal({ sections, onClose }) {
  const [selected, setSelected] = useState(() => new Set(sections.map(s => s.key)))
  const [starting, setStarting] = useState(false)

  const toggle = (key) => setSelected(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const handleStart = async () => {
    if (selected.size === 0) return
    setStarting(true)
    const chosen = sections.filter(s => selected.has(s.key))
    const results = await Promise.allSettled(chosen.map(s => s.run()))
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed) toast.error(`${failed} importação${failed !== 1 ? 'ões' : ''} não pôde${failed !== 1 ? 'ram' : ''} ser iniciada${failed !== 1 ? 's' : ''}.`)
    if (results.length - failed > 0) toast.success('Importação iniciada — acompanhe o progresso na barra lateral.')
    setStarting(false)
    onClose()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="mbox" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">Importar tudo da internet</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="mbody">
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>
            Escolha quais listas importar. Só aparecem aqui as seções para as quais você tem permissão.
            Cada uma roda em segundo plano com sua própria barra de progresso na barra lateral.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sections.map(s => (
              <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0', cursor: 'pointer', background: selected.has(s.key) ? '#f5f3ff' : '#fff' }}>
                <input type="checkbox" checked={selected.has(s.key)} onChange={() => toggle(s.key)}
                  style={{ width: 15, height: 15, accentColor: '#7c3aed', cursor: 'pointer' }} />
                <span style={{ fontSize: 13, color: '#1e293b' }}>{s.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleStart} disabled={starting || selected.size === 0}>
            {starting ? 'Iniciando…' : `🌐 Importar ${selected.size || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isSu = !!user?.is_superuser
  const myP  = user?.permissions ?? {}
  const canViewLog = isSu || !!myP.view_audit_log || !!myP.log_view || !!myP.settings_view_logs
  const can  = (permBase, action) => {
    if (isSu || myP.manage_settings) return true
    if (action === 'view')         return !!(myP[`${permBase}_view`]         || myP[permBase])
    if (action === 'edit')         return !!(myP[`${permBase}_edit`]         || myP[permBase])
    if (action === 'delete')       return !!(myP[`${permBase}_delete`]       || myP[permBase])
    if (action === 'bulk_delete')  return !!(myP[`${permBase}_bulk_delete`])
    if (action === 'bulk_import')  return !!(myP[`${permBase}_bulk_import`])
    if (action === 'import_web')   return !!(myP[`${permBase}_import_web`])
    if (action === 'export')       return !!(myP[`${permBase}_export`])
    if (action === 'advanced')     return !!(myP[`${permBase}_advanced`])
    if (action === 'rounding')     return !!(myP[`${permBase}_rounding`])
    return false
  }
  /* Seções que fazem parte do CSV combinado */
  const CSV_SECTION_PERMS = [
    'settings_doc_types',
    'settings_professions', 'settings_languages', 'settings_vaccines',
    'settings_genders', 'settings_prof_cards', 'settings_list_additionals',
    'settings_crew_roles', 'settings_list_categories',
    'settings_accommodations', 'settings_countries',
    'settings_airports', 'settings_airlines',
    'settings_user_profiles', 'settings_bus_maps',
    'settings_contract_clauses', 'settings_payment_methods',
    'settings_exchange_rates', 'settings_terms', 'settings_operating_company',
  ]
  /* Seções que podem ser importadas "da internet" — usadas no botão/modal "Importar tudo da internet" */
  const WEB_IMPORT_SECTIONS = [
    { key: 'professions', label: 'Profissões',                         perm: 'settings_professions', run: () => configApi.importProfessions() },
    { key: 'languages',   label: 'Idiomas',                             perm: 'settings_languages',   run: () => configApi.importLanguages() },
    { key: 'vaccines',    label: 'Vacinas',                             perm: 'settings_vaccines',    run: () => configApi.importVaccines() },
    { key: 'prof_cards',  label: 'Carteiras profissionais',             perm: 'settings_prof_cards',  run: () => configApi.importProfCards() },
    { key: 'countries',   label: 'Países + Estados + Cidades (tudo)',   perm: 'settings_countries',   run: () => configApi.importCountriesCascade() },
    { key: 'airports',    label: 'Aeroportos (base mundial)',          perm: 'settings_airports',    run: () => configApi.seedAirports() },
    { key: 'airlines',    label: 'Companhias Aéreas (base mundial)',   perm: 'settings_airlines',    run: () => configApi.seedAirlines() },
  ].filter(s => can(s.perm, 'import_web'))
  const canImportWebAny = WEB_IMPORT_SECTIONS.length > 0

  /* Botão Exportar: requer permissão explícita "Exportar CSV global" (settings_csv_export)
     Botão Importar tudo: visível se tem bulk_import em pelo menos uma seção */
  const canCsvExport = isSu || !!myP.manage_settings || !!myP.settings_csv_export
  const canCsvImport = isSu || !!myP.manage_settings
    || CSV_SECTION_PERMS.some(p => !!(myP[`${p}_bulk_import`]))

  const [showExportModal,    setShowExportModal]    = useState(false)
  const [showImportAllPopup, setShowImportAllPopup] = useState(false)
  const [showImportWebModal, setShowImportWebModal] = useState(false)
  const [exportCountriesList, setExportCountriesList] = useState([])
  const [listSearch, setListSearch] = useState('')
  const [areaFilters, setAreaFilters] = useState(() => new Set())
  const toggleArea = (key) => setAreaFilters(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const [activeList, setActiveList] = useState(null)
  const [professions, setProfessions] = useState([])
  const [languages,   setLanguages]   = useState([])
  const [vaccines,    setVaccines]    = useState([])
  const [genders,    setGenders]    = useState([])
  const [itineraryCategories, setItineraryCategories] = useState([])
  const [destinations, setDestinations] = useState([])
  const [loadingDe, setLoadingDe] = useState(true)
  const [holidays, setHolidays] = useState([])
  const [loadingHo, setLoadingHo] = useState(true)
  const [services, setServices] = useState([])
  const [loadingSv, setLoadingSv] = useState(true)
  const [loadingIC, setLoadingIC] = useState(true)
  const [paymentMethods, setPaymentMethods] = useState([])
  const [exchangeRates,  setExchangeRates]  = useState([])
  const [loadingPM, setLoadingPM] = useState(true)
  const [loadingER, setLoadingER] = useState(true)
  const [listCats,   setListCats]   = useState([])
  const [profCards,    setProfCards]    = useState([])
  const [listAddits,   setListAddits]   = useState([])
  const [crewRoles,    setCrewRoles]    = useState([])
  const [accoms,       setAccoms]       = useState([])
  const [loadingAc,    setLoadingAc]    = useState(true)
  const [loadingP,     setLoadingP]     = useState(true)
  const [loadingL,     setLoadingL]     = useState(true)
  const [loadingV,     setLoadingV]     = useState(true)
  const [loadingG,     setLoadingG]     = useState(true)
  const [loadingLC,    setLoadingLC]    = useState(true)
  const [loadingPC,    setLoadingPC]    = useState(true)
  const [loadingLA,    setLoadingLA]    = useState(true)
  const [loadingCR,    setLoadingCR]    = useState(true)
  const [cntDocTypes,     setCntDocTypes]     = useState(null)
  const [cntPermProfiles, setCntPermProfiles] = useState(null)
  const [cntCountries,    setCntCountries]    = useState(null)
  const [cntAirports,     setCntAirports]     = useState(null)
  const [cntAirlines,     setCntAirlines]     = useState(null)
  const [cntBusMaps,      setCntBusMaps]      = useState(null)
  const [cntContractClauses, setCntContractClauses] = useState(null)
  const [cntTerms, setCntTerms] = useState(null)

  useEffect(() => {
    configApi.professions().then(r => setProfessions(r.data)).catch(() => {}).finally(() => setLoadingP(false))
    configApi.languages().then(r => setLanguages(r.data)).catch(() => {}).finally(() => setLoadingL(false))
    configApi.vaccines().then(r => setVaccines(r.data)).catch(() => {}).finally(() => setLoadingV(false))
    configApi.genders().then(r => setGenders(r.data)).catch(() => {}).finally(() => setLoadingG(false))
    configApi.itineraryCategories().then(r => setItineraryCategories(r.data)).catch(() => {}).finally(() => setLoadingIC(false))
    configApi.destinations().then(r => setDestinations(r.data)).catch(() => {}).finally(() => setLoadingDe(false))
    configApi.holidays().then(r => setHolidays(r.data)).catch(() => {}).finally(() => setLoadingHo(false))
    configApi.services().then(r => setServices(r.data)).catch(() => {}).finally(() => setLoadingSv(false))
    configApi.paymentMethods().then(r => setPaymentMethods(r.data)).catch(() => {}).finally(() => setLoadingPM(false))
    configApi.exchangeRates().then(r => setExchangeRates(r.data)).catch(() => {}).finally(() => setLoadingER(false))
    configApi.listCategories().then(r => setListCats(r.data)).catch(() => {}).finally(() => setLoadingLC(false))
    configApi.profCards().then(r => setProfCards(r.data)).catch(() => {}).finally(() => setLoadingPC(false))
    listsApi.listAdditionals().then(r => setListAddits(r.data.results ?? r.data)).catch(() => {}).finally(() => setLoadingLA(false))
    listsApi.listCrewRoles().then(r => setCrewRoles(r.data.results ?? r.data)).catch(() => {}).finally(() => setLoadingCR(false))
    configApi.accommodations().then(r => setAccoms(r.data.results ?? r.data)).catch(() => {}).finally(() => setLoadingAc(false))
    configApi.docTypes().then(r => setCntDocTypes(r.data.length)).catch(() => {})
    configApi.permissionProfiles().then(r => setCntPermProfiles(r.data.length)).catch(() => {})
    configApi.countries().then(r => setCntCountries(r.data.length)).catch(() => {})
    configApi.airports({ page_size: 1 }).then(r => setCntAirports(r.data.count ?? (r.data.results ?? r.data).length)).catch(() => {})
    configApi.airlines({ page_size: 1 }).then(r => setCntAirlines(r.data.count ?? (r.data.results ?? r.data).length)).catch(() => {})
    configApi.busMaps?.().then(r => setCntBusMaps((r.data.results ?? r.data).length)).catch(() => {})
    configApi.contractClauses().then(r => setCntContractClauses(r.data.length)).catch(() => {})
    configApi.terms().then(r => setCntTerms(hasVisibleText(r.data.content) ? 1 : 0)).catch(() => {})
  }, [])

  const silentReloadConfig = useCallback(() => {
    configApi.professions().then(r => setProfessions(r.data)).catch(() => {})
    configApi.languages().then(r => setLanguages(r.data)).catch(() => {})
    configApi.vaccines().then(r => setVaccines(r.data)).catch(() => {})
    configApi.genders().then(r => setGenders(r.data)).catch(() => {})
    configApi.itineraryCategories().then(r => setItineraryCategories(r.data)).catch(() => {})
    configApi.destinations().then(r => setDestinations(r.data)).catch(() => {})
    configApi.holidays().then(r => setHolidays(r.data)).catch(() => {})
    configApi.services().then(r => setServices(r.data)).catch(() => {})
    configApi.paymentMethods().then(r => setPaymentMethods(r.data)).catch(() => {})
    configApi.exchangeRates().then(r => setExchangeRates(r.data)).catch(() => {})
    configApi.listCategories().then(r => setListCats(r.data)).catch(() => {})
    configApi.profCards().then(r => setProfCards(r.data)).catch(() => {})
    listsApi.listAdditionals().then(r => setListAddits(r.data.results ?? r.data)).catch(() => {})
    listsApi.listCrewRoles().then(r => setCrewRoles(r.data.results ?? r.data)).catch(() => {})
    configApi.accommodations().then(r => setAccoms(r.data.results ?? r.data)).catch(() => {})
  }, [])

  const wsUrl = user ? dashboardWsUrl() : null
  useWebSocket(wsUrl, useCallback(({ scope }) => {
    if (scope === 'config' || scope === 'all') silentReloadConfig()
  }, [silentReloadConfig]))

  const addProfession = async (name) => {
    try {
      const r = await configApi.addProfession(name)
      setProfessions(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar profissão.') }
  }
  const updateProfession = async (id, name) => {
    try {
      const r = await configApi.updateProfession(id, name)
      setProfessions(p => p.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar profissão.') }
  }
  const delProfession = async (id) => {
    try { await configApi.delProfession(id); setProfessions(p => p.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover profissão.') }
  }
  const addLanguage = async (name) => {
    try {
      const r = await configApi.addLanguage(name)
      setLanguages(l => [...l, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar idioma.') }
  }
  const updateLanguage = async (id, name) => {
    try {
      const r = await configApi.updateLanguage(id, name)
      setLanguages(l => l.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar idioma.') }
  }
  const delLanguage = async (id) => {
    try { await configApi.delLanguage(id); setLanguages(l => l.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover idioma.') }
  }
  const addVaccine = async (name) => {
    try {
      const r = await configApi.addVaccine(name)
      setVaccines(v => [...v, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar vacina.') }
  }
  const updateVaccine = async (id, name) => {
    try {
      const r = await configApi.updateVaccine(id, name)
      setVaccines(v => v.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar vacina.') }
  }
  const delVaccine = async (id) => {
    try { await configApi.delVaccine(id); setVaccines(v => v.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover vacina.') }
  }
  const addGender = async (name) => {
    try {
      const r = await configApi.addGender(name)
      setGenders(g => [...g, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar gênero.') }
  }
  const updateGender = async (id, name) => {
    try {
      const r = await configApi.updateGender(id, name)
      setGenders(g => g.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar gênero.') }
  }
  const delGender = async (id) => {
    try { await configApi.delGender(id); setGenders(g => g.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover gênero.') }
  }
  const addItineraryCategory = async (name) => {
    try {
      const r = await configApi.addItineraryCategory(name)
      setItineraryCategories(c => [...c, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar categoria de roteiro.') }
  }
  const updateItineraryCategory = async (id, name) => {
    try {
      const r = await configApi.updateItineraryCategory(id, name)
      setItineraryCategories(c => c.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar categoria de roteiro.') }
  }
  const delItineraryCategory = async (id) => {
    try { await configApi.delItineraryCategory(id); setItineraryCategories(c => c.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover categoria de roteiro.') }
  }
  const addDestination = async (name) => {
    try {
      const r = await configApi.addDestination(name)
      setDestinations(d => [...d, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar destino.') }
  }
  const updateDestination = async (id, name) => {
    try {
      const r = await configApi.updateDestination(id, name)
      setDestinations(d => d.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar destino.') }
  }
  const delDestination = async (id) => {
    try { await configApi.delDestination(id); setDestinations(d => d.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover destino.') }
  }
  const addHoliday = async (name) => {
    try {
      const r = await configApi.addHoliday(name)
      setHolidays(h => [...h, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar feriado.') }
  }
  const updateHoliday = async (id, name) => {
    try {
      const r = await configApi.updateHoliday(id, name)
      setHolidays(h => h.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar feriado.') }
  }
  const delHoliday = async (id) => {
    try { await configApi.delHoliday(id); setHolidays(h => h.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover feriado.') }
  }
  const addService = async (name) => {
    try {
      const r = await configApi.addService(name)
      setServices(s => [...s, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar serviço.') }
  }
  const updateService = async (id, name) => {
    try {
      const r = await configApi.updateService(id, name)
      setServices(s => s.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar serviço.') }
  }
  const delService = async (id) => {
    try { await configApi.delService(id); setServices(s => s.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover serviço.') }
  }
  const addPaymentMethod = async (name) => {
    try {
      const r = await configApi.addPaymentMethod(name)
      setPaymentMethods(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar forma de pagamento.') }
  }
  const updatePaymentMethod = async (id, name) => {
    try {
      const r = await configApi.updatePaymentMethod(id, name)
      setPaymentMethods(p => p.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar forma de pagamento.') }
  }
  const delPaymentMethod = async (id) => {
    try { await configApi.delPaymentMethod(id); setPaymentMethods(p => p.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover forma de pagamento.') }
  }
  const addExchangeRate = async (data) => {
    try {
      const r = await configApi.addExchangeRate(data)
      setExchangeRates(e => [...e, r.data])
    } catch { toast.error('Erro ao adicionar câmbio.') }
  }
  const updateExchangeRate = async (id, data) => {
    try {
      const r = await configApi.updateExchangeRate(id, data)
      setExchangeRates(e => e.map(x => x.id === id ? r.data : x))
    } catch { toast.error('Erro ao salvar câmbio.') }
  }
  const delExchangeRate = async (id) => {
    try { await configApi.delExchangeRate(id); setExchangeRates(e => e.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover câmbio.') }
  }
  const pullExchangeInternet = async () => {
    try {
      const r = await configApi.pullExchangeInternet()
      const { created = 0, updated = 0 } = r.data || {}
      toast.success(`Câmbio atualizado da internet: ${created} nova(s), ${updated} atualizada(s).`)
      const list = await configApi.exchangeRates()
      setExchangeRates(list.data)
    } catch (e) { toast.error(e?.response?.data?.error || 'Erro ao puxar câmbio da internet.') }
  }
  const runExchangeNow = async () => {
    try {
      const r = await configApi.runExchangeNow()
      const { updated = 0 } = r.data || {}
      toast.success(updated ? `Câmbio atualizado agora: ${updated} moeda(s).` : 'Nenhuma moeda com atualização automática ligada.')
      const list = await configApi.exchangeRates()
      setExchangeRates(list.data)
    } catch (e) { toast.error(e?.response?.data?.error || 'Erro ao atualizar o câmbio agora.') }
  }
  const updateOneExchange = async (id) => {
    try {
      const r = await configApi.updateExchangeRateNow(id)
      setExchangeRates(e => e.map(x => x.id === id ? r.data : x))
      toast.success(`${r.data.from_currency} atualizada.`)
    } catch (e) { toast.error(e?.response?.data?.error || 'Erro ao atualizar a moeda.') }
  }
  const addListCategory = async (name) => {
    try {
      const r = await configApi.addListCategory(name)
      setListCats(c => [...c, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar categoria.') }
  }
  const updateListCategory = async (id, name) => {
    try {
      const r = await configApi.updateListCategory(id, name)
      setListCats(c => c.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar categoria.') }
  }
  const delListCategory = async (id) => {
    try { await configApi.delListCategory(id); setListCats(c => c.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover categoria.') }
  }
  const addProfCard = async (name) => {
    try {
      const r = await configApi.addProfCard(name)
      setProfCards(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar carteira.') }
  }
  const updateProfCard = async (id, name) => {
    try {
      const r = await configApi.updateProfCard(id, name)
      setProfCards(p => p.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar carteira.') }
  }
  const delProfCard = async (id) => {
    try { await configApi.delProfCard(id); setProfCards(p => p.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover carteira.') }
  }

  const addAccom = async (name) => {
    try {
      const r = await configApi.addAccommodation(name)
      setAccoms(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar.') }
  }
  const delAccom = async (id) => {
    try { await configApi.delAccommodation(id); setAccoms(p => p.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover.') }
  }

  const addListAddit = async (name) => {
    try {
      const r = await listsApi.addAdditional(name)
      setListAddits(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar.') }
  }
  const updateListAddit = async (id, name) => {
    try {
      const r = await listsApi.updateAdditional(id, name)
      setListAddits(p => p.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar adicional.') }
  }
  const delListAddit = async (id) => {
    try { await listsApi.removeAdditional(id); setListAddits(p => p.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover.') }
  }

  const addCrewRole = async (name) => {
    try {
      const r = await listsApi.addCrewRole(name)
      setCrewRoles(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao adicionar.') }
  }
  const updateCrewRole = async (id, name) => {
    try {
      const r = await listsApi.updateCrewRole(id, name)
      setCrewRoles(p => p.map(x => x.id === id ? r.data : x).sort((a, b) => a.name.localeCompare(b.name, 'pt')))
    } catch { toast.error('Erro ao salvar função.') }
  }
  const delCrewRole = async (id) => {
    try { await listsApi.removeCrewRole(id); setCrewRoles(p => p.filter(x => x.id !== id)) }
    catch { toast.error('Erro ao remover.') }
  }

  /* ── CSV combinado: exporta/importa todas as listas simples (nome único) de uma vez ── */
  const SIMPLE_LIST_GROUPS = [
    { key:'professions',     label:'Profissões',               perm:'settings_professions',       items: professions },
    { key:'languages',       label:'Idiomas',                  perm:'settings_languages',         items: languages   },
    { key:'vaccines',        label:'Vacinas',                  perm:'settings_vaccines',          items: vaccines    },
    { key:'genders',         label:'Gêneros',                  perm:'settings_genders',           items: genders     },
    { key:'itinerary_categories', label:'Categorias de Roteiro', perm:'settings_itinerary_categories', items: itineraryCategories },
    { key:'destinations',    label:'Destinos',                 perm:'settings_destinations',      items: destinations },
    { key:'holidays',        label:'Feriados',                  perm:'settings_holidays',          items: holidays },
    { key:'services',        label:'Serviços',                  perm:'settings_services',          items: services },
    { key:'prof_cards',      label:'Carteiras',                perm:'settings_prof_cards',        items: profCards   },
    { key:'list_addits',     label:'Adicionais de Lista',      perm:'settings_list_additionals',  items: listAddits  },
    { key:'crew_roles',      label:'Equipe técnica',           perm:'settings_crew_roles',        items: crewRoles   },
    { key:'list_categories', label:'Categoria de Acomodações', perm:'settings_list_categories',   items: listCats    },
  ]

  const handleExportAll = async ({ selectedKeys, geoLevel = 'cidades' } = {}) => {
    try {
      const sel = selectedKeys ?? null
      const include = (key) => !sel || sel.has(key)
      const viewableGroups  = SIMPLE_LIST_GROUPS.filter(g => can(g.perm, 'view') && include(g.key))
      const viewCountries   = can('settings_countries',      'view') && include('countries')
      const viewAccoms      = can('settings_accommodations', 'view') && include('accommodations')
      const viewDocTypes    = can('settings_doc_types',      'view') && include('doc_types')
      const viewAirports    = can('settings_airports',       'view') && include('airports')
      const viewAirlines    = can('settings_airlines',       'view') && include('airlines')
      const viewPermProfiles= can('settings_user_profiles',  'view') && include('perm_profiles')
      const viewBusMaps     = can('settings_bus_maps',       'view') && include('bus_maps')
      const viewContractClauses = can('settings_contract_clauses', 'view') && include('contract_clauses')
      const viewTerms       = can('settings_terms', 'view') && include('terms')
      const viewPaymentMethods = can('settings_payment_methods', 'view') && include('payment_methods')
      const viewPaymentPlans   = can('settings_payment_methods', 'view') && include('payment_plans')
      const viewExchangeRates  = can('settings_exchange_rates',  'view') && include('exchange_rates')
      const viewItineraryTemplates = can('settings_itinerary_templates', 'view') && include('itinerary_templates')
      const viewOperatingCompany   = can('settings_operating_company',   'view') && include('operating_company')
      // Continentes → Países → Estados → Cidades: cada nível inclui os anteriores.
      const wantCountries = geoLevel === 'paises' || geoLevel === 'estados' || geoLevel === 'cidades'
      const wantStates    = geoLevel === 'estados' || geoLevel === 'cidades'
      const wantCities    = geoLevel === 'cidades'
      let ctRes = { data: [] }, cRes = { data: [] }, sRes = { data: [] }, cities = []
      let dtData = [], apData = [], alData = [], ppData = [], bmData = [], ccData = [], termsContent = null
      let pmData = [], erData = [], itData = [], ocData = null, planData = []
      const fetches = []
      if (viewCountries) fetches.push(configApi.continents().then(r => { ctRes = r }))
      if (viewCountries && wantCountries) fetches.push(
        Promise.all([
          configApi.countries(),
          wantStates ? configApi.allStates() : Promise.resolve({ data: [] }),
          wantCities ? configApi.geoExport() : Promise.resolve(null),
        ]).then(async ([cr, sr, geoRes]) => {
            cRes = cr; sRes = sr
            if (geoRes) {
              const geoText = await geoRes.data.text()
              cities = geoText.split(/\r?\n/).slice(1).map(l => splitCsvLineSettings(l)).filter(c => c[3]).map(c => ({ country: c[1], state: c[2], name: c[3] }))
            }
          })
      )
      if (viewDocTypes)     fetches.push(configApi.docTypes().then(r => { dtData = r.data }))
      if (viewAirports)     fetches.push(configApi.airports({ page_size: 10000 }).then(r => { apData = r.data.results ?? r.data }))
      if (viewAirlines)     fetches.push(configApi.airlines({ page_size: 10000 }).then(r => { alData = r.data.results ?? r.data }))
      if (viewPermProfiles) fetches.push(configApi.permissionProfiles().then(r => { ppData = r.data.results ?? r.data }))
      if (viewBusMaps)      fetches.push(configApi.busMaps().then(r => { bmData = r.data.results ?? r.data }))
      if (viewContractClauses) fetches.push(configApi.contractClauses().then(r => { ccData = r.data.results ?? r.data }))
      if (viewTerms) fetches.push(configApi.terms().then(r => { termsContent = r.data.content || '' }))
      if (viewPaymentMethods) fetches.push(configApi.paymentMethods().then(r => { pmData = r.data }))
      if (viewExchangeRates)  fetches.push(configApi.exchangeRates().then(r => { erData = r.data }))
      if (viewItineraryTemplates) fetches.push(configApi.itineraryTemplates().then(r => { itData = r.data }))
      if (viewOperatingCompany)   fetches.push(configApi.operatingCompany().then(r => { ocData = r.data }))
      if (viewPaymentPlans)       fetches.push(configApi.paymentPlans().then(r => { planData = r.data.results ?? r.data }))
      await Promise.all(fetches)
      exportCombinedCsvFull(viewableGroups, viewAccoms ? accoms : [], ctRes.data, cRes.data, sRes.data, cities, dtData, apData, alData, ppData, bmData, ccData, termsContent, pmData, erData, itData, ocData, planData, 'todas_as_configuracoes.csv')
    } catch { toast.error('Erro ao exportar.') }
  }

  const handleImportAllFile = async (file) => {
    const csvText = await file.text()
    const importableGroups   = SIMPLE_LIST_GROUPS.filter(g => can(g.perm, 'bulk_import'))
    const canImportCountries = can('settings_countries',      'bulk_import')
    const canImportAccoms    = can('settings_accommodations', 'bulk_import')
    const canImportDocTypes  = can('settings_doc_types',      'bulk_import')
    const canImportAirports  = can('settings_airports',       'bulk_import')
    const canImportAirlines  = can('settings_airlines',       'bulk_import')
    const canImportBusMaps   = can('settings_bus_maps',       'bulk_import')
    const canImportPermProfiles = can('settings_user_profiles', 'bulk_import')
    const canImportContractClauses = can('settings_contract_clauses', 'bulk_import')
    const canImportTerms = can('settings_terms', 'bulk_import')
    const canImportPaymentMethods = can('settings_payment_methods', 'bulk_import')
    const canImportExchangeRates  = can('settings_exchange_rates',  'bulk_import')
    const canImportItineraryTemplates = can('settings_itinerary_templates', 'bulk_import')
    const canImportOperatingCompany   = can('settings_operating_company',   'bulk_import')
    let allContinents = [], allCountries = [], allStates = [], allCities = [], allDocTypes = [], allAirports = [], allAirlines = [], allBusMaps = [], allPermProfiles = [], allContractClauses = [], allTermsContent = null
    let allPaymentMethods = [], allExchangeRates = [], allItineraryTemplates = []
    const fetches2 = []
    if (canImportCountries) fetches2.push(configApi.continents().then(r => { allContinents = r.data }).catch(() => {}))
    if (canImportCountries) fetches2.push(
      Promise.all([configApi.countries(), configApi.allStates(), configApi.geoExport()])
        .then(async ([cr, sr, geoRes]) => {
          allCountries = cr.data; allStates = sr.data
          const geoText = await geoRes.data.text()
          allCities = geoText.split(/\r?\n/).slice(1).map(l => splitCsvLineSettings(l)).filter(c => c[3])
            .map(c => ({ country: c[1], state: c[2], name: c[3] }))
        })
        .catch(() => {})
    )
    if (canImportDocTypes)  fetches2.push(configApi.docTypes().then(r => { allDocTypes = r.data }).catch(() => {}))
    if (canImportAirports)  fetches2.push(configApi.airports({ page_size: 10000 }).then(r => { allAirports = r.data.results ?? r.data }).catch(() => {}))
    if (canImportAirlines)  fetches2.push(configApi.airlines({ page_size: 10000 }).then(r => { allAirlines = r.data.results ?? r.data }).catch(() => {}))
    if (canImportBusMaps)   fetches2.push(configApi.busMaps().then(r => { allBusMaps = r.data.results ?? r.data }).catch(() => {}))
    if (canImportPermProfiles) fetches2.push(configApi.permissionProfiles().then(r => { allPermProfiles = r.data.results ?? r.data }).catch(() => {}))
    if (canImportContractClauses) fetches2.push(configApi.contractClauses().then(r => { allContractClauses = r.data.results ?? r.data }).catch(() => {}))
    if (canImportTerms) fetches2.push(configApi.terms().then(r => { allTermsContent = r.data.content || '' }).catch(() => {}))
    if (canImportPaymentMethods) fetches2.push(configApi.paymentMethods().then(r => { allPaymentMethods = r.data }).catch(() => {}))
    if (canImportExchangeRates)  fetches2.push(configApi.exchangeRates().then(r => { allExchangeRates = r.data }).catch(() => {}))
    if (canImportItineraryTemplates) fetches2.push(configApi.itineraryTemplates().then(r => { allItineraryTemplates = r.data }).catch(() => {}))
    await Promise.all(fetches2)
    const permittedKeys = [
      ...importableGroups.map(g => g.key),
      ...(canImportAccoms    ? ['accommodations']                   : []),
      ...(canImportCountries ? ['continents', 'countries', 'states', 'cities'] : []),
      ...(canImportDocTypes  ? ['doc_types']                       : []),
      ...(canImportAirports  ? ['airports']                        : []),
      ...(canImportAirlines  ? ['airlines']                        : []),
      ...(canImportBusMaps   ? ['bus_maps']                        : []),
      ...(canImportPermProfiles ? ['perm_profiles']                 : []),
      ...(canImportContractClauses ? ['contract_clauses']           : []),
      ...(canImportTerms     ? ['terms']                            : []),
      ...(canImportPaymentMethods ? ['payment_methods']             : []),
      ...(canImportExchangeRates  ? ['exchange_rates']              : []),
      ...(canImportItineraryTemplates ? ['itinerary_templates']     : []),
      ...(canImportOperatingCompany   ? ['operating_company']       : []),
    ]
    navigate('/configuracoes/import', {
      state: {
        csvText, filename: file.name, type: 'all',
        existingByType: {
          ...Object.fromEntries(importableGroups.map(g => [g.key, g.items.map(i => i.name)])),
          ...(canImportAccoms    ? { accommodations: accoms.map(a => a.name) }        : {}),
          ...(canImportCountries ? {
            continents: allContinents.map(c => c.name),
            countries: allCountries.map(c => c.name),
            states: allStates.map(s => s.name),
            cities: allCities.map(c => `${c.country}|${c.state}|${c.name}`),
          } : {}),
          ...(canImportDocTypes  ? { doc_types: allDocTypes.map(d => d.label) }       : {}),
          ...(canImportAirports  ? { airports: allAirports.map(a => a.name) }         : {}),
          ...(canImportAirlines  ? { airlines: allAirlines.map(a => a.name) }         : {}),
          ...(canImportBusMaps   ? { bus_maps: allBusMaps.map(m => m.label) }         : {}),
          ...(canImportPermProfiles ? { perm_profiles: allPermProfiles.map(p => p.name) } : {}),
          ...(canImportContractClauses ? { contract_clauses: allContractClauses.map(c => c.name) } : {}),
          ...(canImportPaymentMethods ? { payment_methods: allPaymentMethods.map(pm => pm.name) } : {}),
          ...(canImportExchangeRates  ? { exchange_rates: allExchangeRates.map(er => `${er.from_currency} → ${er.to_currency}`) } : {}),
          ...(canImportItineraryTemplates ? { itinerary_templates: allItineraryTemplates.map(t => t.name) } : {}),
        },
        existingItemsByType: {
          ...Object.fromEntries(importableGroups.map(g => [g.key, g.items])),
          ...(canImportAccoms    ? { accommodations: accoms }                                             : {}),
          ...(canImportCountries ? { continents: allContinents, countries: allCountries, states: allStates } : {}),
          ...(canImportDocTypes  ? { doc_types: allDocTypes.map(d => ({ id: d.id, name: d.label })) }    : {}),
          ...(canImportAirports  ? { airports: allAirports }                                              : {}),
          ...(canImportAirlines  ? { airlines: allAirlines }                                              : {}),
          ...(canImportBusMaps   ? { bus_maps: allBusMaps }                                                : {}),
          ...(canImportPermProfiles ? { perm_profiles: allPermProfiles }                                   : {}),
          ...(canImportContractClauses ? { contract_clauses: allContractClauses }                          : {}),
          ...(canImportPaymentMethods ? { payment_methods: allPaymentMethods }                              : {}),
          ...(canImportExchangeRates  ? { exchange_rates: allExchangeRates.map(er => ({ ...er, name: `${er.from_currency} → ${er.to_currency}` })) } : {}),
          ...(canImportItineraryTemplates ? { itinerary_templates: allItineraryTemplates } : {}),
        },
        permittedKeys,
        allCountries,
      }
    })
  }

  const filteredListDefs = LIST_DEFS
    // extraPerm: card visível também por uma permissão alternativa (ex.: Modelos
    // do Roteiro aparece p/ quem só tem permissão de Modelos de Pagamento).
    .filter(d => can(d.perm, 'view') || (d.extraPerm && can(d.extraPerm, 'view')))
    .filter(d => areaFilters.size === 0 || (d.areas || []).some(a => areaFilters.has(a)))
    .filter(d => {
      const q = listSearch.trim().toLowerCase()
      if (!q) return true
      const meta = CARD_META[d.key]
      return d.label.toLowerCase().includes(q) || (meta?.desc || '').toLowerCase().includes(q)
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'pt'))
  const activeDef = LIST_DEFS.find(d => d.key === activeList)

  const cfgCount = {
    professions: professions.length, languages: languages.length, vaccines: vaccines.length,
    genders: genders.length, prof_cards: profCards.length, list_addits: listAddits.length,
    itinerary_categories: itineraryCategories.length, holidays: holidays.length, services: services.length,
    destinations: destinations.length,
    crew_roles: crewRoles.length, accommodations: accoms.length, list_categories: listCats.length,
    doc_types: cntDocTypes, perm_profiles: cntPermProfiles,
    countries: cntCountries, airports: cntAirports, airlines: cntAirlines, bus_maps: cntBusMaps,
    contract_clauses: cntContractClauses,
    terms: cntTerms,
    payment_methods: paymentMethods.length,
    exchange_rates: exchangeRates.length,
  }

  return (
    <div style={{ background:'#eef1f6', minHeight:'100%' }}>
      <div className="ph" style={{ marginBottom:0, padding:'20px 24px' }}>
        <div>
          <h1 className="ph-title">Configurações</h1>
          <p style={{ margin:'3px 0 0', fontSize:13.5, color:'#64748b' }}>
            Gerencie os cadastros e parâmetros que alimentam o sistema.
          </p>
        </div>
        <div className="ph-actions">
          {canCsvExport && (
            <button onClick={() => {
              setShowExportModal(true)
              if (can('settings_countries', 'view') && exportCountriesList.length === 0) {
                configApi.countries().then(r => setExportCountriesList(r.data)).catch(() => {})
              }
            }} style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 16px', borderRadius:9, border:'1px solid #cdebd9', background:'#f3fbf6', color:'#16a34a', fontFamily:'inherit', fontSize:13.5, fontWeight:600, cursor:'pointer' }}>
              <Ic n="dl" s={16}/> Exportar tudo
            </button>
          )}
          {canCsvImport && (
            <button onClick={() => setShowImportAllPopup(true)} style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 16px', borderRadius:9, border:'1px solid #2563eb', background:'#2563eb', color:'#fff', fontFamily:'inherit', fontSize:13.5, fontWeight:600, cursor:'pointer', boxShadow:'0 2px 8px rgba(37,99,235,.28)' }}>
              <Ic n="ul" s={16}/> Importar tudo
            </button>
          )}
          {canImportWebAny && (
            <button onClick={() => setShowImportWebModal(true)} style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 16px', borderRadius:9, border:'1px solid #7c3aed', background:'#7c3aed', color:'#fff', fontFamily:'inherit', fontSize:13.5, fontWeight:600, cursor:'pointer', boxShadow:'0 2px 8px rgba(124,58,237,.28)' }}>
              🌐 Importar tudo da internet
            </button>
          )}
        </div>
      </div>

      <div style={{ padding:'24px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:22, flexWrap:'wrap' }}>
          <div style={{ position:'relative', flex:1, minWidth:260, maxWidth:440 }}>
            <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:'#94a3b8', display:'flex', alignItems:'center', pointerEvents:'none' }}>
              <Ic n="search" s={17}/>
            </span>
            <input
              value={listSearch}
              onChange={e => setListSearch(e.target.value)}
              placeholder="Buscar configuração..."
              style={{ width:'100%', padding:'11px 14px 11px 42px', borderRadius:10, border:'1px solid #dbe2ec', background:'#fff', fontFamily:'inherit', fontSize:14, color:'#1e293b', outline:'none', boxSizing:'border-box' }}
            />
          </div>
          <AreaFilterDropdown areas={AREA_DEFS} selected={areaFilters} onToggle={toggleArea} onClear={() => setAreaFilters(new Set())} />
          <span style={{ fontSize:13, color:'#94a3b8', fontWeight:500 }}>{filteredListDefs.length} categorias</span>
          {canViewLog && (
            <button
              type="button"
              onClick={() => navigate('/log?scope=settings')}
              title="Ver log de atividades"
              style={{
                marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 7,
                border: '1.5px solid #e2e8f0', background: '#fff',
                color: '#475569', fontSize: 13, fontWeight: 500,
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all .12s', whiteSpace: 'nowrap', flexShrink: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#1a2d4f'; e.currentTarget.style.color = '#1a2d4f' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#475569' }}
            >
              <Ic n="list" s={13} /> Log
            </button>
          )}
        </div>

        {filteredListDefs.length === 0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'80px 20px', color:'#94a3b8', textAlign:'center' }}>
            <Ic n="search" s={42}/>
            <div style={{ marginTop:16, fontSize:16, fontWeight:600, color:'#475569' }}>Nenhuma configuração encontrada</div>
            <div style={{ marginTop:4, fontSize:14 }}>Tente outro termo de busca.</div>
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(284px,1fr))', gap:16 }}>
            {filteredListDefs.map(d => {
              const meta = CARD_META[d.key] || { icon:'list', hue:220, desc:'' }
              const cnt = cfgCount[d.key] ?? null
              const tileBg = `oklch(0.955 0.035 ${meta.hue})`
              const tileFg = `oklch(0.52 0.15 ${meta.hue})`
              return (
                <button key={d.key} onClick={() => setActiveList(d.key)} className="cfg-card"
                  style={{ textAlign:'left', background:'#fff', border:'1px solid #e6eaf1', borderRadius:15, padding:20, cursor:'pointer', fontFamily:'inherit', display:'flex', flexDirection:'column', gap:14, transition:'transform .15s ease,box-shadow .15s ease,border-color .15s ease', boxShadow:'0 1px 2px rgba(16,24,40,.04)', width:'100%' }}>
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
                    <div style={{ width:46, height:46, borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', background:tileBg, color:tileFg, flexShrink:0 }}>
                      <Ic n={meta.icon} s={22}/>
                    </div>
                    {cnt !== null && (
                      <span style={{ fontSize:12, fontWeight:600, color:'#64748b', background:'#f1f5f9', padding:'4px 10px', borderRadius:20, whiteSpace:'nowrap' }}>
                        {cnt} {cnt === 1 ? 'item' : 'itens'}
                      </span>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize:16, fontWeight:700, color:'#0f172a', letterSpacing:'-.2px' }}>{d.label}</div>
                    <div style={{ fontSize:13, color:'#64748b', lineHeight:1.45, marginTop:5 }}>{meta.desc}</div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:600, color:'#2563eb', marginTop:2 }}>
                    Gerenciar <Ic n="chevron" s={15}/>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {showExportModal && (() => {
        const allSections = [
          ...SIMPLE_LIST_GROUPS.filter(g => can(g.perm, 'view')).map(g => ({ key: g.key, label: g.label })),
          ...(can('settings_accommodations', 'view') ? [{ key: 'accommodations', label: 'Acomodações' }] : []),
          ...(can('settings_doc_types',      'view') ? [{ key: 'doc_types',      label: 'Documentos' }] : []),
          ...(can('settings_airports',       'view') ? [{ key: 'airports',       label: 'Aeroportos' }] : []),
          ...(can('settings_airlines',       'view') ? [{ key: 'airlines',       label: 'Companhias Aéreas' }] : []),
          ...(can('settings_countries',      'view') ? [{ key: 'countries',      label: 'Continentes, Países, Estados e Cidades' }] : []),
          ...(can('settings_user_profiles',  'view') ? [{ key: 'perm_profiles',  label: 'Perfis de Permissão' }] : []),
          ...(can('settings_bus_maps',       'view') ? [{ key: 'bus_maps',       label: 'Mapas de Ônibus' }] : []),
          ...(can('settings_contract_clauses', 'view') ? [{ key: 'contract_clauses', label: 'Cláusulas de Contrato' }] : []),
          ...(can('settings_terms', 'view') ? [{ key: 'terms', label: 'Termos e Condições' }] : []),
          ...(can('settings_payment_methods', 'view') ? [{ key: 'payment_methods', label: 'Formas de Pagamento' }] : []),
          ...(can('settings_payment_methods', 'view') ? [{ key: 'payment_plans',   label: 'Modelos de Pagamento' }] : []),
          ...(can('settings_exchange_rates',  'view') ? [{ key: 'exchange_rates',  label: 'Câmbio' }] : []),
          ...(can('settings_itinerary_templates', 'view') ? [{ key: 'itinerary_templates', label: 'Modelos de Texto do Roteiro' }] : []),
          ...(can('settings_operating_company',   'view') ? [{ key: 'operating_company',   label: 'Operadora' }] : []),
        ]
        return (
          <CsvExportModal
            sections={allSections}
            countries={exportCountriesList}
            onClose={() => setShowExportModal(false)}
            onExport={({ selectedKeys, geoLevel }) => handleExportAll({ selectedKeys, geoLevel })}
          />
        )
      })()}

      {showImportAllPopup && (
        <CsvImportPopup
          title="Importar CSV — todas as configurações"
          sampleContent={CSV_SAMPLES.all.content}
          sampleFilename={CSV_SAMPLES.all.filename}
          onClose={() => setShowImportAllPopup(false)}
          onFile={handleImportAllFile}
        />
      )}

      {showImportWebModal && (
        <ImportWebModal
          sections={WEB_IMPORT_SECTIONS}
          onClose={() => setShowImportWebModal(false)}
        />
      )}

      {activeDef && (() => {
        const meta = CARD_META[activeDef.key] || { icon:'list', hue:220, desc:'' }
        const tileBg = `oklch(0.955 0.035 ${meta.hue})`
        const tileFg = `oklch(0.52 0.15 ${meta.hue})`
        const isWide = WIDE_LISTS.includes(activeDef.key)
        return (
          <div style={{ position:'fixed', inset:0, zIndex:400, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
            <div onClick={() => setActiveList(null)} style={{ position:'absolute', inset:0, background:'rgba(15,23,42,.4)', animation:'fadeIn .2s ease' }}/>
            <div style={{ position:'relative', background:'#fff', borderRadius:16, width:'100%', maxWidth: activeDef.key === 'countries' ? 1080 : activeDef.key === 'exchange_rates' ? 900 : (isWide ? 860 : 560), maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 64px rgba(0,0,0,.24)', animation:'mIn .18s ease' }}>
              <div style={{ padding:'20px 24px', borderBottom:'1px solid #eef2f7', display:'flex', alignItems:'flex-start', gap:14, flexShrink:0 }}>
                <div style={{ width:46, height:46, flexShrink:0, borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', background:tileBg, color:tileFg }}>
                  <Ic n={meta.icon} s={22}/>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:18, fontWeight:800, color:'#0f172a' }}>{activeDef.label}</div>
                  <div style={{ fontSize:13, color:'#64748b', lineHeight:1.45, marginTop:2 }}>{meta.desc}</div>
                </div>
                <button onClick={() => setActiveList(null)} style={{ flexShrink:0, width:32, height:32, borderRadius:8, border:'1px solid #e6eaf1', background:'#fff', color:'#64748b', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <Ic n="x" s={16}/>
                </button>
              </div>
              <div style={{ flex:1, overflowY:'auto', padding:'18px 24px' }}>
                {activeDef.key === 'doc_types'       && <DocTypesManager canEdit={can('settings_doc_types','edit')} canDelete={can('settings_doc_types','delete')} canImport={can('settings_doc_types','bulk_import')} canExport={can('settings_doc_types','export')} />}
                {activeDef.key === 'perm_profiles'   && <PermissionProfilesManager canEdit={can('settings_user_profiles','edit')} canDelete={can('settings_user_profiles','delete')} canImport={can('settings_user_profiles','bulk_import')} canExport={can('settings_user_profiles','export')} />}
                {activeDef.key === 'professions'     && <ItemList items={professions} loading={loadingP}  onAdd={can('settings_professions','edit') ? addProfession : undefined}       onUpdate={can('settings_professions','edit') ? updateProfession : undefined}       onDelete={can('settings_professions','delete') ? delProfession : undefined}       canImport={can('settings_professions','bulk_import')}      canExport={can('settings_professions','export')}      placeholder="Nome da profissão…"  addTitle="Nova profissão"  editTitle="Editar profissão"  filename="profissoes.csv"       type="professions"      onImportWeb={can('settings_professions','import_web') ? () => configApi.importProfessions() : null} />}
                {activeDef.key === 'languages'       && <ItemList items={languages}   loading={loadingL}  onAdd={can('settings_languages','edit') ? addLanguage : undefined}           onUpdate={can('settings_languages','edit') ? updateLanguage : undefined}           onDelete={can('settings_languages','delete') ? delLanguage : undefined}           canImport={can('settings_languages','bulk_import')}        canExport={can('settings_languages','export')}        placeholder="Nome do idioma…"     addTitle="Novo idioma"     editTitle="Editar idioma"     filename="idiomas.csv"          type="languages"        onImportWeb={can('settings_languages','import_web') ? () => configApi.importLanguages() : null} />}
                {activeDef.key === 'vaccines'        && <ItemList items={vaccines}    loading={loadingV}  onAdd={can('settings_vaccines','edit') ? addVaccine : undefined}             onUpdate={can('settings_vaccines','edit') ? updateVaccine : undefined}             onDelete={can('settings_vaccines','delete') ? delVaccine : undefined}             canImport={can('settings_vaccines','bulk_import')}         canExport={can('settings_vaccines','export')}         placeholder="Nome da vacina…"     addTitle="Nova vacina"     editTitle="Editar vacina"     filename="vacinas.csv"          type="vaccines"         onImportWeb={can('settings_vaccines','import_web') ? () => configApi.importVaccines() : null} />}
                {activeDef.key === 'genders'         && <ItemList items={genders}     loading={loadingG}  onAdd={can('settings_genders','edit') ? addGender : undefined}               onUpdate={can('settings_genders','edit') ? updateGender : undefined}               onDelete={can('settings_genders','delete') ? delGender : undefined}               canImport={can('settings_genders','bulk_import')}          canExport={can('settings_genders','export')}          placeholder="Nome do gênero…"     addTitle="Novo gênero"     editTitle="Editar gênero"     filename="generos.csv"          type="genders" />}
                {activeDef.key === 'itinerary_categories' && <ItemList items={itineraryCategories} loading={loadingIC} onAdd={can('settings_itinerary_categories','edit') ? addItineraryCategory : undefined} onUpdate={can('settings_itinerary_categories','edit') ? updateItineraryCategory : undefined} onDelete={can('settings_itinerary_categories','delete') ? delItineraryCategory : undefined} canImport={can('settings_itinerary_categories','bulk_import')} canExport={can('settings_itinerary_categories','export')} placeholder="Nome da categoria…" addTitle="Nova categoria de roteiro" editTitle="Editar categoria de roteiro" filename="categorias_de_roteiro.csv" type="itinerary_categories" />}
                {activeDef.key === 'destinations'    && <ItemList items={destinations} loading={loadingDe} onAdd={can('settings_destinations','edit') ? addDestination : undefined} onUpdate={can('settings_destinations','edit') ? updateDestination : undefined} onDelete={can('settings_destinations','delete') ? delDestination : undefined} canImport={can('settings_destinations','bulk_import')} canExport={can('settings_destinations','export')} placeholder="Nome do destino…" addTitle="Novo destino" editTitle="Editar destino" filename="destinos.csv" type="destinations" />}
                {activeDef.key === 'holidays'        && <ItemList items={holidays} loading={loadingHo} onAdd={can('settings_holidays','edit') ? addHoliday : undefined} onUpdate={can('settings_holidays','edit') ? updateHoliday : undefined} onDelete={can('settings_holidays','delete') ? delHoliday : undefined} canImport={can('settings_holidays','bulk_import')} canExport={can('settings_holidays','export')} placeholder="Nome do feriado…" addTitle="Novo feriado" editTitle="Editar feriado" filename="feriados.csv" type="holidays" />}
                {activeDef.key === 'services'        && <ItemList items={services} loading={loadingSv} onAdd={can('settings_services','edit') ? addService : undefined} onUpdate={can('settings_services','edit') ? updateService : undefined} onDelete={can('settings_services','delete') ? delService : undefined} canImport={can('settings_services','bulk_import')} canExport={can('settings_services','export')} placeholder="Nome do serviço…" addTitle="Novo serviço" editTitle="Editar serviço" filename="servicos.csv" type="services" />}
                {activeDef.key === 'payment_methods' && <ItemList items={paymentMethods} loading={loadingPM} onAdd={can('settings_payment_methods','edit') ? addPaymentMethod : undefined} onUpdate={can('settings_payment_methods','edit') ? updatePaymentMethod : undefined} onDelete={can('settings_payment_methods','delete') ? delPaymentMethod : undefined} canImport={can('settings_payment_methods','bulk_import')} canExport={can('settings_payment_methods','export')} placeholder="Nome da forma de pagamento…" addTitle="Nova forma de pagamento" editTitle="Editar forma de pagamento" filename="formas_pagamento.csv" type="payment_methods" />}
                {activeDef.key === 'exchange_rates'  && <ExchangeRateManager items={exchangeRates} canEdit={can('settings_exchange_rates','edit')} canDelete={can('settings_exchange_rates','delete')} canImport={can('settings_exchange_rates','bulk_import')} canExport={can('settings_exchange_rates','export')} canAdvanced={can('settings_exchange_rates','advanced')} canRounding={can('settings_exchange_rates','rounding')} onAdd={addExchangeRate} onUpdate={updateExchangeRate} onDelete={delExchangeRate} onPullInternet={can('settings_exchange_rates','advanced') ? pullExchangeInternet : undefined} onRunNow={can('settings_exchange_rates','update_now') ? runExchangeNow : undefined} onUpdateOne={can('settings_exchange_rates','update_now') ? updateOneExchange : undefined} canScript={isSu} />}
                {activeDef.key === 'prof_cards'      && <ItemList items={profCards}   loading={loadingPC} onAdd={can('settings_prof_cards','edit') ? addProfCard : undefined}          onUpdate={can('settings_prof_cards','edit') ? updateProfCard : undefined}          onDelete={can('settings_prof_cards','delete') ? delProfCard : undefined}          canImport={can('settings_prof_cards','bulk_import')}       canExport={can('settings_prof_cards','export')}       placeholder="Nome da carteira…"   addTitle="Nova carteira"   editTitle="Editar carteira"   filename="carteiras.csv"        type="prof_cards"       onImportWeb={can('settings_prof_cards','import_web') ? () => configApi.importProfCards() : null} />}
                {activeDef.key === 'list_addits'     && <ItemList items={listAddits}  loading={loadingLA} onAdd={can('settings_list_additionals','edit') ? addListAddit : undefined}   onUpdate={can('settings_list_additionals','edit') ? updateListAddit : undefined}   onDelete={can('settings_list_additionals','delete') ? delListAddit : undefined}   canImport={can('settings_list_additionals','bulk_import')} canExport={can('settings_list_additionals','export')} placeholder="Nome do adicional…"  addTitle="Novo adicional"  editTitle="Editar adicional"  filename="adicionais.csv"       type="list_addits" />}
                {activeDef.key === 'crew_roles'      && <ItemList items={crewRoles}   loading={loadingCR} onAdd={can('settings_crew_roles','edit') ? addCrewRole : undefined}          onUpdate={can('settings_crew_roles','edit') ? updateCrewRole : undefined}          onDelete={can('settings_crew_roles','delete') ? delCrewRole : undefined}          canImport={can('settings_crew_roles','bulk_import')}       canExport={can('settings_crew_roles','export')}       placeholder="Nome da função…"     addTitle="Nova função"     editTitle="Editar função"     filename="equipe_tecnica.csv"   type="crew_roles" />}
                {activeDef.key === 'accommodations'  && <AccommodationManager canEdit={can('settings_accommodations','edit')} canDelete={can('settings_accommodations','delete')} canImport={can('settings_accommodations','bulk_import')} canExport={can('settings_accommodations','export')} items={accoms} loading={loadingAc} onRefresh={() => {
                  setLoadingAc(true)
                  configApi.accommodations().then(r => setAccoms(r.data.results ?? r.data)).catch(() => {}).finally(() => setLoadingAc(false))
                }} />}
                {activeDef.key === 'list_categories' && <ItemList items={listCats}    loading={loadingLC} onAdd={can('settings_list_categories','edit') ? addListCategory : undefined} onUpdate={can('settings_list_categories','edit') ? updateListCategory : undefined} onDelete={can('settings_list_categories','delete') ? delListCategory : undefined} canImport={can('settings_list_categories','bulk_import')} canExport={can('settings_list_categories','export')} placeholder="Nome da categoria…" addTitle="Nova categoria" editTitle="Editar categoria" filename="categorias_lista.csv" type="list_categories" />}
                {activeDef.key === 'countries'       && <CountriesTab canEdit={can('settings_countries','edit')} canDelete={can('settings_countries','delete')} canImport={can('settings_countries','bulk_import')} canImportWeb={can('settings_countries','import_web')} canExport={can('settings_countries','export')} />}
                {activeDef.key === 'airports'        && <AirportsManager canEdit={can('settings_airports','edit')} canDelete={can('settings_airports','delete')} canImport={can('settings_airports','bulk_import')} canExport={can('settings_airports','export')} canImportWeb={can('settings_airports','import_web')} />}
                {activeDef.key === 'airlines'        && <AirlinesManager canEdit={can('settings_airlines','edit')} canDelete={can('settings_airlines','delete')} canImport={can('settings_airlines','bulk_import')} canExport={can('settings_airlines','export')} canImportWeb={can('settings_airlines','import_web')} />}
                {activeDef.key === 'bus_maps'        && <BusMapsManager canEdit={can('settings_bus_maps','edit')} canDelete={can('settings_bus_maps','delete')} canImport={can('settings_bus_maps','bulk_import')} canExport={can('settings_bus_maps','export')} />}
                {activeDef.key === 'contract_clauses' && <ContractClausesManager canEdit={can('settings_contract_clauses','edit')} canDelete={can('settings_contract_clauses','delete')} canImport={can('settings_contract_clauses','bulk_import')} canExport={can('settings_contract_clauses','export')} />}
                {activeDef.key === 'operating_company' && <OperatingCompanyManager canEdit={can('settings_operating_company','edit')} canImport={can('settings_operating_company','bulk_import')} canExport={can('settings_operating_company','export')} />}
                {activeDef.key === 'itinerary_templates' && <ItineraryTemplatesManager canEdit={can('settings_itinerary_templates','edit')} canDelete={can('settings_itinerary_templates','delete')} canImport={can('settings_itinerary_templates','bulk_import')} canExport={can('settings_itinerary_templates','export')}
                  showText={can('settings_itinerary_templates','view')}
                  showPayment={can('settings_payment_methods','view')} canEditPayment={can('settings_payment_methods','edit')} canDeletePayment={can('settings_payment_methods','delete')} canImportPayment={can('settings_payment_methods','bulk_import')} canExportPayment={can('settings_payment_methods','export')} />}
                {activeDef.key === 'terms'           && <TermsAndConditionsManager canEdit={can('settings_terms','edit')} canImport={can('settings_terms','bulk_import')} canExport={can('settings_terms','export')} onSaved={() => setActiveList(null)} />}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
