import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { configApi, listsApi, auditApi } from '../api'
import ConfirmModal from '../components/ConfirmModal'
import TrashTab from '../components/TrashTab'
import { useAuth } from '../context/AuthContext'
import { useWebSocket } from '../hooks/useWebSocket'
import DocTypesManager from '../components/DocTypesManager'
import AccommodationManager from '../components/AccommodationManager'
import AirportsManager from '../components/AirportsManager'
import AirlinesManager from '../components/AirlinesManager'
import BusMapsManager from '../components/BusMapsManager'
import ContractClausesManager from '../components/ContractClausesManager'
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
function exportCombinedCsvFull(simpleGroups, accoms, countries, states, cities, docTypes, airports, airlines, permProfiles, busMaps, contractClauses = [], termsContent = null, filename) {
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`
  const rows = ['lista,nome,pessoas,casal,pais,estado,codigo']
  simpleGroups.forEach(({ label, items }) => {
    items.forEach(i => rows.push(`${q(label)},${q(i.name)},,,,,`))
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
    rows.push(`${q('Países')},${q(c.name)},,,,,${q(c.code || '')}`)
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
function ItemList({ items, loading, onDelete, onAdd, onUpdate, placeholder, addTitle, editTitle, filename, type, canImport = false, canExport = true, onImportWeb = null }) {
  const [search,    setSearch]    = useState('')
  const [confirm,   setConfirm]   = useState(null) // {id, name}
  const [showAdd,   setShowAdd]   = useState(false)
  const [editing,   setEditing]   = useState(null) // {id, name}
  const [importing, setImporting] = useState(false)

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

  return (
    <>
    <div>
      {/* Toolbar: busca + adicionar + CSV */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
          style={{ ...inp, flex: 1, minWidth: 160 }}
          onFocus={e => e.target.style.borderColor = '#1a2d4f'}
          onBlur={e  => e.target.style.borderColor = '#e2e8f0'} />
        {onAdd && <button onClick={() => setShowAdd(true)} style={btnPri}>+ Adicionar</button>}
        {onImportWeb && (
          <button onClick={handleImportWeb} disabled={importing}
            style={{ padding:'6px 11px', borderRadius:7, border:'1.5px solid #7c3aed20', background:'#7c3aed10', color:'#7c3aed', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:4 }}
            title="Importar lista pronta da internet">
            {importing ? '⏳ Iniciando…' : '🌐 Importar da internet'}
          </button>
        )}
        <CsvButtons items={items} filename={filename} type={type} canImport={canImport} canExport={canExport} />
      </div>

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
        ) : filtered.map((item, idx) => (
          <div key={item.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '9px 14px', fontSize: 13, color: '#0f172a',
            borderBottom: idx < filtered.length - 1 ? '1px solid #f1f5f9' : 'none', background: '#fff',
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
function GeoCsvBar({ canEdit = true, canImport = false, canImportWeb = false, onImportCascade, importingCascade = false }) {
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
        CSV unificado — <span style={{ fontWeight: 400, color: '#94a3b8' }}>colunas: pais, estado, cidade</span>
      </span>
      <button onClick={doExport} disabled={exporting}
        style={{ ...btnCsv('#059669'), opacity: exporting ? .6 : 1 }}>
        ⬇ {exporting ? 'Exportando…' : 'Exportar tudo'}
      </button>
      {canImport && (
        <button onClick={() => setShowPopup(true)} style={btnCsv('#2e6db4')}>
          ⬆ Importar CSV
        </button>
      )}
      {canImportWeb && (
        <button onClick={onImportCascade} disabled={importingCascade} style={btnCsv('#7c3aed')}
          title="Importa todos os países e, em cascata, os estados e cidades de cada um — pode levar bastante tempo">
          🌐 {importingCascade ? 'Iniciando…' : 'Importar tudo da internet'}
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
const colAddInp = { ...inp, flex: 1, fontSize: 12, padding: '7px 10px' }
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
            style={{ flexShrink:0, padding:'3px 9px', borderRadius:6, border:'1.5px solid #7c3aed20', background:'#7c3aed10', color:'#7c3aed', fontSize:11, fontWeight:600, cursor: addDisabled ? 'default' : 'pointer', fontFamily:'inherit', opacity: addDisabled ? .5 : 1 }}>
            {importingWeb ? '⏳' : '🌐'}
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
function CountriesTab({ canEdit = true, canDelete = true, canImport = false, canImportWeb = false }) {
  const [countries,  setCountries]  = useState([])
  const [selCountry, setSelCountry] = useState(null)
  const [states,     setStates]     = useState([])
  const [selState,   setSelState]   = useState(null)
  const [cities,     setCities]     = useState([])
  const [loadingC,   setLoadingC]   = useState(true)
  const [loadingS,   setLoadingS]   = useState(false)
  const [loadingCi,  setLoadingCi]  = useState(false)
  const [searchC,    setSearchC]    = useState('')
  const [searchS,    setSearchS]    = useState('')
  const [searchCi,   setSearchCi]   = useState('')
  const [confirm,    setConfirm]    = useState(null) // {action, id, name}
  const [importingWeb, setImportingWeb] = useState(null) // 'country'|'state'|'city'|null
  const [form,       setForm]       = useState(null) // {kind:'country'|'state'|'city', item?}

  const loadCountries = () => {
    setLoadingC(true)
    configApi.countries().then(r => setCountries(r.data)).catch(() => {}).finally(() => setLoadingC(false))
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

  useEffect(() => { loadCountries() }, [])

  const { user } = useAuth()
  const wsUrl = user ? dashboardWsUrl() : null
  useWebSocket(wsUrl, useCallback((msg) => {
    if (msg.type !== 'job' || msg.status !== 'done') return
    if (msg.kind === 'countries' || msg.kind === 'countries_cascade') loadCountries()
    if ((msg.kind === 'states' || msg.kind === 'countries_cascade') && selCountry) loadStates(selCountry)
    if ((msg.kind === 'cities' || msg.kind === 'countries_cascade') && selState) loadCities(selState)
  }, [selCountry, selState]))

  const addCountry = async (name) => {
    try { await configApi.addCountry(name, ''); loadCountries() }
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

  const filteredC  = useMemo(() => { const q = searchC.toLowerCase();  return countries.filter(c => c.name.toLowerCase().includes(q)) }, [countries, searchC])
  const filteredS  = useMemo(() => { const q = searchS.toLowerCase();  return states.filter(s => s.name.toLowerCase().includes(q)) }, [states, searchS])
  const filteredCi = useMemo(() => { const q = searchCi.toLowerCase(); return cities.filter(c => c.name.toLowerCase().includes(q)) }, [cities, searchCi])

  const formSave = async (name) => {
    if (form.kind === 'country') return form.item ? updateCountry(form.item.id, name) : addCountry(name)
    if (form.kind === 'state')   return form.item ? updateState(form.item.id, name)   : addState(name)
    if (form.kind === 'city')    return form.item ? updateCity(form.item.id, name)    : addCity(name)
  }
  const formTitles = {
    country: form?.item ? 'Editar país'   : 'Novo país',
    state:   form?.item ? 'Editar estado' : 'Novo estado',
    city:    form?.item ? 'Editar cidade' : 'Nova cidade',
  }
  const formPlaceholders = { country: 'Nome do país…', state: 'Nome do estado…', city: 'Nome da cidade…' }

  return (
    <>
    <GeoCsvBar canEdit={canEdit} canImport={canImport} canImportWeb={canImportWeb}
      onImportCascade={importCascadeWeb} importingCascade={importingWeb === 'cascade'} />
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
      {/* ── Países ── */}
      <Col title="Países" count={countries.length}
        search={searchC} onSearch={setSearchC}
        onAddClick={() => setForm({ kind:'country' })}
        loading={loadingC} canEdit={canEdit}
        onImportWeb={canImportWeb ? importCountriesWeb : null} importingWeb={importingWeb === 'country'}
      >
        {filteredC.length === 0
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
          if (confirm.action === 'country') delCountry(confirm.id)
          if (confirm.action === 'state')   delState(confirm.id)
          if (confirm.action === 'city')    delCity(confirm.id)
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
const LIST_DEFS = [
  { key:'doc_types',        label:'Documentos',               perm:'settings_doc_types' },
  { key:'perm_profiles',    label:'Perfis de permissão',      perm:'settings_user_profiles' },
  { key:'professions',      label:'Profissões',               perm:'settings_professions' },
  { key:'languages',        label:'Idiomas',                  perm:'settings_languages' },
  { key:'vaccines',         label:'Vacinas',                  perm:'settings_vaccines' },
  { key:'genders',          label:'Gêneros',                  perm:'settings_genders' },
  { key:'prof_cards',       label:'Carteiras',                perm:'settings_prof_cards' },
  { key:'list_addits',      label:'Adicionais de Lista',      perm:'settings_list_additionals' },
  { key:'crew_roles',       label:'Equipe técnica',           perm:'settings_crew_roles' },
  { key:'accommodations',   label:'Tipos de Acomodação',      perm:'settings_accommodations' },
  { key:'list_categories',  label:'Categoria de Acomodações', perm:'settings_list_categories' },
  { key:'countries',        label:'Países & Estados',         perm:'settings_countries' },
  { key:'airports',         label:'Aeroportos',               perm:'settings_airports' },
  { key:'airlines',         label:'Companhias Aéreas',        perm:'settings_airlines' },
  { key:'bus_maps',         label:'Mapas de Ônibus',          perm:'settings_bus_maps' },
  { key:'contract_clauses', label:'Cláusulas de Contrato',    perm:'settings_contract_clauses' },
  { key:'terms',            label:'Termos e Condições',       perm:'settings_terms' },
]
const WIDE_LISTS = ['doc_types', 'perm_profiles', 'accommodations', 'countries', 'airports', 'airlines', 'bus_maps', 'contract_clauses', 'terms']

function exportEmailsCsv(emails) {
  const rows = ['email', ...emails.map(e => `"${e.replace(/"/g, '""')}"`)]
  downloadCsv(rows.join('\n'), 'emails_automaticos.csv', { model_label: 'Exportação CSV — E-mails automáticos' })
}

/* ── Gerenciador de Perfis de Permissão ─────────────────────────────────────── */

export function ProfileModal({ profile, onClose, onSaved }) {
  const isEdit = !!profile
  const [name,    setName]    = useState(profile?.name ?? '')
  const [perms,   setPerms]   = useState(sanitizePerms({ ...EMPTY_PERMISSIONS, ...(profile?.permissions ?? {}) }))
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
        await configApi.updatePermissionProfile(profile.id, { name: name.trim(), permissions: perms })
        toast.success('Perfil atualizado.')
      } else {
        await configApi.addPermissionProfile({ name: name.trim(), permissions: perms })
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
        <div style={{ padding:'16px 20px 14px', borderBottom:'1px solid #e2e8f0', flexShrink:0 }}>
          <p style={{ fontSize:14, fontWeight:600, color:'#1e293b', margin:0 }}>
            {isEdit ? 'Editar perfil' : 'Novo perfil de permissão'}
            {isEdit && <span style={{ fontSize:12, fontWeight:400, color:'#94a3b8', marginLeft:8 }}>{profile.name}</span>}
          </p>
        </div>
        <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:14, overflowY:'auto' }}>
          <div>
            <label style={lbl}>Nome do perfil</label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Vendedor, Atendente…" />
          </div>
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
  const [deletedCount,    setDeletedCount]    = useState(0)

  const load = useCallback(() => {
    setLoading(true)
    configApi.permissionProfiles()
      .then(r => setProfiles(r.data))
      .catch(() => toast.error('Erro ao carregar perfis.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  useEffect(() => {
    if (canDelete) {
      configApi.deletedPermissionProfiles().then(r => setDeletedCount((r.data.results ?? r.data).length)).catch(() => {})
    }
  }, [canDelete, showTrash])

  const handleDelete = async () => {
    try { await configApi.delPermissionProfile(delItem.id); load(); setDeletedCount(c => c + 1) }
    catch { toast.error('Erro ao excluir perfil.') }
    finally { setDelItem(null) }
  }

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
    return profiles.filter(p => p.name.toLowerCase().includes(q))
  }, [profiles, search])

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

  if (showTrash) {
    return (
      <div>
        {trashTabBar}
        <TrashTab
          fetchDeleted={() => configApi.deletedPermissionProfiles().then(r => r.data.results ?? r.data)}
          onRestore={(id) => configApi.restorePermissionProfile(id)}
          onPurge={(id) => configApi.purgePermissionProfile(id)}
          getLabel={row => row.name}
          isSuperuser={!!user?.is_superuser}
          emptyText="Nenhum perfil excluído."
          onCountChange={setDeletedCount}
        />
      </div>
    )
  }

  return (
    <>
    <div>
      {trashTabBar}
      <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center', flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
          style={{ ...inp, flex:1, minWidth:160 }}
          onFocus={e => e.target.style.borderColor='#1a2d4f'}
          onBlur={e  => e.target.style.borderColor='#e2e8f0'} />
        {canEdit && <button onClick={() => setModal('new')} style={btnPri}>+ Adicionar</button>}
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
      </div>

      <p style={{ fontSize:12, color:'#94a3b8', margin:'0 0 8px' }}>
        {loading ? 'Carregando…' : `${filtered.length} de ${profiles.length} ${profiles.length !== 1 ? 'perfis' : 'perfil'}`}
      </p>

      <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden', maxHeight:460, overflowY:'auto' }}>
        {loading ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
        ) : filtered.length === 0 ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>
            {profiles.length === 0 ? 'Nenhum perfil criado ainda.' : 'Nenhum resultado.'}
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
              {(canEdit || canDelete) && (
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
  const [activeList, setActiveList] = useState(null)
  const [professions, setProfessions] = useState([])
  const [languages,   setLanguages]   = useState([])
  const [vaccines,    setVaccines]    = useState([])
  const [genders,    setGenders]    = useState([])
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
      const wantStates = geoLevel === 'estados' || geoLevel === 'cidades'
      const wantCities = geoLevel === 'cidades'
      let cRes = { data: [] }, sRes = { data: [] }, cities = []
      let dtData = [], apData = [], alData = [], ppData = [], bmData = [], ccData = [], termsContent = null
      const fetches = []
      if (viewCountries) fetches.push(
        Promise.all([
          configApi.countries(),
          wantStates ? configApi.allStates() : Promise.resolve({ data: [] }),
          wantCities ? configApi.geoExport() : Promise.resolve(null),
        ]).then(async ([cr, sr, geoRes]) => {
            cRes = cr; sRes = sr
            if (geoRes) {
              const geoText = await geoRes.data.text()
              cities = geoText.split(/\r?\n/).slice(1).map(l => splitCsvLineSettings(l)).filter(c => c[2]).map(c => ({ country: c[0], state: c[1], name: c[2] }))
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
      await Promise.all(fetches)
      exportCombinedCsvFull(viewableGroups, viewAccoms ? accoms : [], cRes.data, sRes.data, cities, dtData, apData, alData, ppData, bmData, ccData, termsContent, 'todas_as_configuracoes.csv')
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
    const canImportBusMaps   = can('settings_bus_maps',       'edit')
    const canImportPermProfiles = can('settings_user_profiles', 'edit')
    const canImportContractClauses = can('settings_contract_clauses', 'edit')
    const canImportTerms = can('settings_terms', 'edit')
    let allCountries = [], allStates = [], allCities = [], allDocTypes = [], allAirports = [], allAirlines = [], allBusMaps = [], allPermProfiles = [], allContractClauses = [], allTermsContent = null
    const fetches2 = []
    if (canImportCountries) fetches2.push(
      Promise.all([configApi.countries(), configApi.allStates(), configApi.geoExport()])
        .then(async ([cr, sr, geoRes]) => {
          allCountries = cr.data; allStates = sr.data
          const geoText = await geoRes.data.text()
          allCities = geoText.split(/\r?\n/).slice(1).map(l => splitCsvLineSettings(l)).filter(c => c[2])
            .map(c => ({ country: c[0], state: c[1], name: c[2] }))
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
    await Promise.all(fetches2)
    const permittedKeys = [
      ...importableGroups.map(g => g.key),
      ...(canImportAccoms    ? ['accommodations']                   : []),
      ...(canImportCountries ? ['countries', 'states', 'cities']   : []),
      ...(canImportDocTypes  ? ['doc_types']                       : []),
      ...(canImportAirports  ? ['airports']                        : []),
      ...(canImportAirlines  ? ['airlines']                        : []),
      ...(canImportBusMaps   ? ['bus_maps']                        : []),
      ...(canImportPermProfiles ? ['perm_profiles']                 : []),
      ...(canImportContractClauses ? ['contract_clauses']           : []),
      ...(canImportTerms     ? ['terms']                            : []),
    ]
    navigate('/configuracoes/import', {
      state: {
        csvText, filename: file.name, type: 'all',
        existingByType: {
          ...Object.fromEntries(importableGroups.map(g => [g.key, g.items.map(i => i.name)])),
          ...(canImportAccoms    ? { accommodations: accoms.map(a => a.name) }        : {}),
          ...(canImportCountries ? {
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
        },
        existingItemsByType: {
          ...Object.fromEntries(importableGroups.map(g => [g.key, g.items])),
          ...(canImportAccoms    ? { accommodations: accoms }                                             : {}),
          ...(canImportCountries ? { countries: allCountries, states: allStates }                         : {}),
          ...(canImportDocTypes  ? { doc_types: allDocTypes.map(d => ({ id: d.id, name: d.label })) }    : {}),
          ...(canImportAirports  ? { airports: allAirports }                                              : {}),
          ...(canImportAirlines  ? { airlines: allAirlines }                                              : {}),
          ...(canImportBusMaps   ? { bus_maps: allBusMaps }                                                : {}),
          ...(canImportPermProfiles ? { perm_profiles: allPermProfiles }                                   : {}),
          ...(canImportContractClauses ? { contract_clauses: allContractClauses }                          : {}),
        },
        permittedKeys,
        allCountries,
      }
    })
  }

  const filteredListDefs = LIST_DEFS
    .filter(d => can(d.perm, 'view'))
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
    crew_roles: crewRoles.length, accommodations: accoms.length, list_categories: listCats.length,
    doc_types: cntDocTypes, perm_profiles: cntPermProfiles,
    countries: cntCountries, airports: cntAirports, airlines: cntAirlines, bus_maps: cntBusMaps,
    contract_clauses: cntContractClauses,
    terms: cntTerms,
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
          ...(can('settings_countries',      'view') ? [{ key: 'countries',      label: 'Países, Estados e Cidades' }] : []),
          ...(can('settings_user_profiles',  'view') ? [{ key: 'perm_profiles',  label: 'Perfis de Permissão' }] : []),
          ...(can('settings_bus_maps',       'view') ? [{ key: 'bus_maps',       label: 'Mapas de Ônibus' }] : []),
          ...(can('settings_contract_clauses', 'view') ? [{ key: 'contract_clauses', label: 'Cláusulas de Contrato' }] : []),
          ...(can('settings_terms', 'view') ? [{ key: 'terms', label: 'Termos e Condições' }] : []),
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
            <div style={{ position:'relative', background:'#fff', borderRadius:16, width:'100%', maxWidth: isWide ? 860 : 560, maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 64px rgba(0,0,0,.24)', animation:'mIn .18s ease' }}>
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
                {activeDef.key === 'doc_types'       && <DocTypesManager canEdit={can('settings_doc_types','edit')} canDelete={can('settings_doc_types','delete')} canImport={can('settings_doc_types','bulk_import')} canExport={can('settings_doc_types','view')} />}
                {activeDef.key === 'perm_profiles'   && <PermissionProfilesManager canEdit={can('settings_user_profiles','edit')} canDelete={can('settings_user_profiles','delete')} canImport={isSu || !!myP.manage_settings} canExport={can('settings_user_profiles','view')} />}
                {activeDef.key === 'professions'     && <ItemList items={professions} loading={loadingP}  onAdd={can('settings_professions','edit') ? addProfession : undefined}       onUpdate={can('settings_professions','edit') ? updateProfession : undefined}       onDelete={can('settings_professions','delete') ? delProfession : undefined}       canImport={can('settings_professions','bulk_import')}      canExport={can('settings_professions','view')}      placeholder="Nome da profissão…"  addTitle="Nova profissão"  editTitle="Editar profissão"  filename="profissoes.csv"       type="professions"      onImportWeb={can('settings_professions','import_web') ? () => configApi.importProfessions() : null} />}
                {activeDef.key === 'languages'       && <ItemList items={languages}   loading={loadingL}  onAdd={can('settings_languages','edit') ? addLanguage : undefined}           onUpdate={can('settings_languages','edit') ? updateLanguage : undefined}           onDelete={can('settings_languages','delete') ? delLanguage : undefined}           canImport={can('settings_languages','bulk_import')}        canExport={can('settings_languages','view')}        placeholder="Nome do idioma…"     addTitle="Novo idioma"     editTitle="Editar idioma"     filename="idiomas.csv"          type="languages"        onImportWeb={can('settings_languages','import_web') ? () => configApi.importLanguages() : null} />}
                {activeDef.key === 'vaccines'        && <ItemList items={vaccines}    loading={loadingV}  onAdd={can('settings_vaccines','edit') ? addVaccine : undefined}             onUpdate={can('settings_vaccines','edit') ? updateVaccine : undefined}             onDelete={can('settings_vaccines','delete') ? delVaccine : undefined}             canImport={can('settings_vaccines','bulk_import')}         canExport={can('settings_vaccines','view')}         placeholder="Nome da vacina…"     addTitle="Nova vacina"     editTitle="Editar vacina"     filename="vacinas.csv"          type="vaccines"         onImportWeb={can('settings_vaccines','import_web') ? () => configApi.importVaccines() : null} />}
                {activeDef.key === 'genders'         && <ItemList items={genders}     loading={loadingG}  onAdd={can('settings_genders','edit') ? addGender : undefined}               onUpdate={can('settings_genders','edit') ? updateGender : undefined}               onDelete={can('settings_genders','delete') ? delGender : undefined}               canImport={can('settings_genders','bulk_import')}          canExport={can('settings_genders','view')}          placeholder="Nome do gênero…"     addTitle="Novo gênero"     editTitle="Editar gênero"     filename="generos.csv"          type="genders" />}
                {activeDef.key === 'prof_cards'      && <ItemList items={profCards}   loading={loadingPC} onAdd={can('settings_prof_cards','edit') ? addProfCard : undefined}          onUpdate={can('settings_prof_cards','edit') ? updateProfCard : undefined}          onDelete={can('settings_prof_cards','delete') ? delProfCard : undefined}          canImport={can('settings_prof_cards','bulk_import')}       canExport={can('settings_prof_cards','view')}       placeholder="Nome da carteira…"   addTitle="Nova carteira"   editTitle="Editar carteira"   filename="carteiras.csv"        type="prof_cards"       onImportWeb={can('settings_prof_cards','import_web') ? () => configApi.importProfCards() : null} />}
                {activeDef.key === 'list_addits'     && <ItemList items={listAddits}  loading={loadingLA} onAdd={can('settings_list_additionals','edit') ? addListAddit : undefined}   onUpdate={can('settings_list_additionals','edit') ? updateListAddit : undefined}   onDelete={can('settings_list_additionals','delete') ? delListAddit : undefined}   canImport={can('settings_list_additionals','bulk_import')} canExport={can('settings_list_additionals','view')} placeholder="Nome do adicional…"  addTitle="Novo adicional"  editTitle="Editar adicional"  filename="adicionais.csv"       type="list_addits" />}
                {activeDef.key === 'crew_roles'      && <ItemList items={crewRoles}   loading={loadingCR} onAdd={can('settings_crew_roles','edit') ? addCrewRole : undefined}          onUpdate={can('settings_crew_roles','edit') ? updateCrewRole : undefined}          onDelete={can('settings_crew_roles','delete') ? delCrewRole : undefined}          canImport={can('settings_crew_roles','bulk_import')}       canExport={can('settings_crew_roles','view')}       placeholder="Nome da função…"     addTitle="Nova função"     editTitle="Editar função"     filename="equipe_tecnica.csv"   type="crew_roles" />}
                {activeDef.key === 'accommodations'  && <AccommodationManager canEdit={can('settings_accommodations','edit')} canDelete={can('settings_accommodations','delete')} canImport={can('settings_accommodations','bulk_import')} canExport={can('settings_accommodations','view')} items={accoms} loading={loadingAc} onRefresh={() => {
                  setLoadingAc(true)
                  configApi.accommodations().then(r => setAccoms(r.data.results ?? r.data)).catch(() => {}).finally(() => setLoadingAc(false))
                }} />}
                {activeDef.key === 'list_categories' && <ItemList items={listCats}    loading={loadingLC} onAdd={can('settings_list_categories','edit') ? addListCategory : undefined} onUpdate={can('settings_list_categories','edit') ? updateListCategory : undefined} onDelete={can('settings_list_categories','delete') ? delListCategory : undefined} canImport={can('settings_list_categories','bulk_import')} canExport={can('settings_list_categories','view')} placeholder="Nome da categoria…" addTitle="Nova categoria" editTitle="Editar categoria" filename="categorias_lista.csv" type="list_categories" />}
                {activeDef.key === 'countries'       && <CountriesTab canEdit={can('settings_countries','edit')} canDelete={can('settings_countries','delete')} canImport={can('settings_countries','bulk_import')} canImportWeb={can('settings_countries','import_web')} />}
                {activeDef.key === 'airports'        && <AirportsManager canEdit={can('settings_airports','edit')} canDelete={can('settings_airports','delete')} canImport={can('settings_airports','bulk_import')} canExport={can('settings_airports','view')} canImportWeb={can('settings_airports','import_web')} />}
                {activeDef.key === 'airlines'        && <AirlinesManager canEdit={can('settings_airlines','edit')} canDelete={can('settings_airlines','delete')} canImport={can('settings_airlines','bulk_import')} canExport={can('settings_airlines','view')} canImportWeb={can('settings_airlines','import_web')} />}
                {activeDef.key === 'bus_maps'        && <BusMapsManager canEdit={can('settings_bus_maps','edit')} canDelete={can('settings_bus_maps','delete')} canImport={can('settings_bus_maps','edit')} canExport={can('settings_bus_maps','view')} />}
                {activeDef.key === 'contract_clauses' && <ContractClausesManager canEdit={can('settings_contract_clauses','edit')} canDelete={can('settings_contract_clauses','delete')} canImport={can('settings_contract_clauses','edit')} canExport={can('settings_contract_clauses','view')} />}
                {activeDef.key === 'terms'           && <TermsAndConditionsManager canEdit={can('settings_terms','edit')} canImport={can('settings_terms','edit')} canExport={can('settings_terms','view')} onSaved={() => setActiveList(null)} />}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
