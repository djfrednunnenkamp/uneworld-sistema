import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { configApi, listsApi } from '../api'
import ConfirmModal from '../components/ConfirmModal'
import { useAuth } from '../context/AuthContext'
import { Ic } from '../components/Icon'

function parseCsvNames(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const isHeader = (s) => ['nome','name','profissão','profissao','idioma','language']
    .includes(s.toLowerCase().replace(/["""]/g,'').trim())
  const start = lines.length > 0 && isHeader(lines[0]) ? 1 : 0
  return lines.slice(start)
    .map(l => l.trim().replace(/^[""""]|[""""]$/g,'').trim())
    .filter(Boolean)
}

/* Faz o parse de uma linha CSV simples, respeitando aspas e vírgulas internas */
function splitCsvLine(line) {
  const out = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false }
      else cur += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out.map(s => s.trim())
}

/* CSV combinado: colunas "lista,nome[,pessoas,casal,pais,estado,codigo]" */
function parseCombinedCsv(text, labelToKey) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  if (!lines.length) return []
  const head = splitCsvLine(lines[0]).map(s => s.toLowerCase())
  const hasHeader = head.includes('lista') && head.includes('nome')
  const idx = (col) => hasHeader ? head.indexOf(col) : -1
  const listIdx    = hasHeader ? head.indexOf('lista') : 0
  const nameIdx    = hasHeader ? head.indexOf('nome')  : 1
  const pessoasIdx = idx('pessoas')
  const casalIdx   = idx('casal')
  const paisIdx    = idx('pais')
  const estadoIdx  = idx('estado')
  const codigoIdx  = idx('codigo')
  return lines.slice(hasHeader ? 1 : 0).map(line => {
    const cols = splitCsvLine(line)
    const listLabel = (cols[listIdx] || '').trim()
    const name      = (cols[nameIdx] || '').trim()
    const extras    = {}
    if (pessoasIdx >= 0 && cols[pessoasIdx]) extras.capacity       = Number(cols[pessoasIdx]) || 1
    if (casalIdx   >= 0) extras.is_couple    = ['sim','true','1','yes'].includes((cols[casalIdx] || '').trim().toLowerCase())
    if (paisIdx    >= 0 && cols[paisIdx])    extras.parent_country = cols[paisIdx].trim()
    if (estadoIdx  >= 0 && cols[estadoIdx])  extras.parent_state   = cols[estadoIdx].trim()
    if (codigoIdx  >= 0 && cols[codigoIdx])  extras.code           = cols[codigoIdx].trim()
    return { listLabel, listKey: labelToKey[listLabel.toLowerCase()] || null, name, extras }
  }).filter(r => r.listLabel || r.name)
}

const API_MAP = {
  professions:     { add: (name)         => configApi.addProfession(name),    del: (id) => configApi.delProfession(id),    label: 'Profissões' },
  languages:       { add: (name)         => configApi.addLanguage(name),      del: (id) => configApi.delLanguage(id),      label: 'Idiomas' },
  vaccines:        { add: (name)         => configApi.addVaccine(name),       del: (id) => configApi.delVaccine(id),       label: 'Vacinas' },
  genders:         { add: (name)         => configApi.addGender(name),        del: (id) => configApi.delGender(id),        label: 'Gêneros' },
  prof_cards:      { add: (name)         => configApi.addProfCard(name),      del: (id) => configApi.delProfCard(id),      label: 'Carteiras' },
  list_addits:     { add: (name)         => listsApi.addAdditional(name),     del: (id) => listsApi.removeAdditional(id),  label: 'Adicionais de Lista' },
  crew_roles:      { add: (name)         => listsApi.addCrewRole(name),       del: (id) => listsApi.removeCrewRole(id),    label: 'Equipe técnica' },
  list_categories: { add: (name)         => configApi.addListCategory(name),  del: (id) => configApi.delListCategory(id),  label: 'Categoria de Acomodações' },
  accommodations:  { add: (name, extras) => configApi.addAccommodation({ name, capacity: extras.capacity || 1, is_couple: extras.is_couple || false }), del: (id) => configApi.delAccommodation(id), label: 'Acomodações' },
  doc_types:       { add: (name, extras) => configApi.addDocType({ label: name, key: extras.code || name.toLowerCase().replace(/[^a-z0-9]+/g, '_'), icon: '📄', color: '#475569' }), del: (id) => configApi.delDocType(id), label: 'Documentos' },
  airports:        { add: (name, extras) => configApi.addAirport({ name, iata_code: extras.code || '', city: extras.parent_state || '', country: extras.parent_country || '' }), del: (id) => configApi.delAirport(id), label: 'Aeroportos' },
  airlines:        { add: (name, extras) => configApi.addAirline({ name, iata_code: extras.code || '', country: extras.parent_country || '' }), del: (id) => configApi.delAirline(id), label: 'Companhias Aéreas' },
  countries:       { add: (name, extras) => configApi.addCountry(name, extras.code || ''), del: (id) => configApi.delCountry(id), label: 'Países' },
  states:          { add: (name, extras, ctx) => {
    const c = (ctx?.allCountries || []).find(x => x.name.toLowerCase() === (extras.parent_country || '').toLowerCase())
    if (!c) return Promise.reject(new Error('País não encontrado'))
    return configApi.addState(c.id, name, extras.code || '')
  }, del: (id) => configApi.delState(id), label: 'Estados' },
  cities:          { add: null, del: null, label: 'Cidades' }, // importadas em batch via geoImport
}

const LABEL_TO_KEY = Object.fromEntries(
  Object.entries(API_MAP).map(([key, def]) => [def.label.toLowerCase(), key])
)

const MODES = [
  { key:'new',    label:'Somente adicionar',   desc:'Mantém os existentes, insere apenas os novos.' },
  { key:'all',    label:'Substituir lista',     desc:'Apaga quem não está no arquivo e insere os novos.' },
  { key:'delete', label:'Apagar os importados', desc:'Apaga exatamente os registros listados no arquivo.' },
]

const pill = (bg, color) => ({
  padding:'3px 10px', borderRadius:20, fontSize:12, fontWeight:600,
  background:bg, color, display:'inline-block', whiteSpace:'nowrap',
})
const th = {
  padding:'9px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'#64748b',
  textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1.5px solid #e2e8f0',
  background:'#f8fafc', whiteSpace:'nowrap', position:'sticky', top:0, zIndex:1,
}

function Editable({ value, onChange }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  const commit = () => { setEditing(false); if (val.trim() !== value) onChange(val.trim()) }
  if (editing) return (
    <input autoFocus value={val} onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key==='Enter') commit(); if (e.key==='Escape') { setVal(value); setEditing(false) } }}
      style={{ width:'100%', padding:'4px 8px', border:'1.5px solid #2e6db4', borderRadius:6, fontSize:13, outline:'none', fontFamily:'inherit' }}
    />
  )
  return (
    <span onClick={() => { setVal(value); setEditing(true) }}
      style={{ cursor:'text', display:'block', minWidth:80 }}
      title="Clique para editar">
      {value || <em style={{ color:'#cbd5e1' }}>—</em>}
    </span>
  )
}

function Spin() {
  return (
    <>
      <span style={{ display:'inline-block', width:14, height:14, border:'2px solid rgba(255,255,255,.3)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  )
}

/* Mapeamento de listKey → permissão de bulk_delete */
const BULK_DELETE_PERM = {
  professions:     'settings_professions_bulk_delete',
  languages:       'settings_languages_bulk_delete',
  vaccines:        'settings_vaccines_bulk_delete',
  genders:         'settings_genders_bulk_delete',
  prof_cards:      'settings_prof_cards_bulk_delete',
  list_addits:     'settings_list_additionals_bulk_delete',
  crew_roles:      'settings_crew_roles_bulk_delete',
  list_categories: 'settings_list_categories_bulk_delete',
  accommodations:  'settings_accommodations_bulk_delete',
  doc_types:       'settings_doc_types_bulk_delete',
  airports:        'settings_airports_bulk_delete',
  airlines:        'settings_airlines_bulk_delete',
  countries:       'settings_countries_bulk_delete',
  states:          'settings_countries_bulk_delete',
  cities:          'settings_countries_bulk_delete',
}

export default function FlatImport() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { csvText, filename, type, existingNames = [], existingByType = {}, existingItems = [], existingItemsByType = {}, allCountries = [], permittedKeys } = location.state || {}
  const isAll    = type === 'all'
  const apiDef   = API_MAP[type] || API_MAP.professions
  const backPath = '/configuracoes'

  const isSu = !!user?.is_superuser
  const myP  = user?.permissions || {}
  const canBulkDeleteKey = (key) => isSu || !!myP[BULK_DELETE_PERM[key]]
  /* canDestructive: true se o usuário tem bulk_delete para pelo menos uma seção presente */
  const canDestructive = useMemo(() => {
    if (isSu) return true
    if (isAll) return Object.keys(existingByType).some(k => canBulkDeleteKey(k))
    return canBulkDeleteKey(type)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSu, isAll, type, myP, existingByType])

  const [rows,        setRows]        = useState([])
  const [mode,        setMode]        = useState('new')
  const [phase,       setPhase]       = useState('review')
  const [result,      setResult]      = useState(null)
  const [filter,      setFilter]      = useState('all')
  const [search,      setSearch]      = useState('')
  const [selected,    setSelected]    = useState(new Set())
  const [confirm,     setConfirm]     = useState(null) // { type:'bulk'|'single', id?, count? }
  const [parsing,     setParsing]     = useState(!!csvText)
  const [visibleCount,setVisibleCount]= useState(20)

  /* Conjuntos de nomes já existentes — um por lista (modo combinado) ou um único (modo simples) */
  const existingSets = useMemo(() => {
    if (isAll) {
      return Object.fromEntries(
        Object.entries(existingByType).map(([key, names]) => [key, new Set(names.map(n => n.toLowerCase()))])
      )
    }
    return { [type]: new Set(existingNames.map(n => n.toLowerCase())) }
  }, [isAll, existingByType, existingNames, type])

  const permittedKeySet = useMemo(
    () => (permittedKeys ? new Set(permittedKeys) : null),
    [permittedKeys]
  )

  const rowStatus = (name, listKey, extras = {}) => {
    if (!name.trim()) return 'error'
    if (isAll && !listKey) return 'error'
    if (isAll && permittedKeySet && listKey && !permittedKeySet.has(listKey)) return 'error'
    if (listKey === 'states' && !extras.parent_country) return 'error'
    if (listKey === 'cities' && (!extras.parent_country || !extras.parent_state)) return 'error'
    const set = existingSets[listKey ?? type]
    return set?.has(name.toLowerCase()) ? 'duplicate' : 'valid'
  }

  useEffect(() => {
    if (!csvText) { navigate(backPath); return }
    // Defer heavy parsing so the loading screen renders first
    const timer = setTimeout(() => {
      if (isAll) {
        const parsed = parseCombinedCsv(csvText, LABEL_TO_KEY)
        setRows(parsed.map((r, i) => ({
          id: i + 1, name: r.name, listKey: r.listKey, listLabel: r.listKey ? API_MAP[r.listKey].label : r.listLabel,
          extras: r.extras || {},
          status: rowStatus(r.name, r.listKey, r.extras || {}),
        })))
      } else {
        const names = parseCsvNames(csvText)
        setRows(names.map((name, i) => ({
          id: i + 1, name, listKey: type, listLabel: apiDef.label, extras: {},
          status: rowStatus(name, type),
        })))
      }
      setParsing(false)
    }, 60)
    return () => clearTimeout(timer)
  }, [])

  // Reset pagination when filter/search changes
  useEffect(() => { setVisibleCount(20) }, [filter, search])

  const editRow = (id, name) => setRows(prev => prev.map(r => r.id === id
    ? { ...r, name, status: rowStatus(name, r.listKey) }
    : r
  ))

  const removeRows = (ids) => {
    setRows(prev => prev.filter(r => !ids.has(r.id)))
    setSelected(new Set())
    setConfirm(null)
  }

  const stats = useMemo(() => ({
    valid:     rows.filter(r => r.status === 'valid').length,
    duplicate: rows.filter(r => r.status === 'duplicate').length,
    error:     rows.filter(r => r.status === 'error').length,
  }), [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (filter !== 'all') list = list.filter(r => r.status === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r => r.name.toLowerCase().includes(q))
    }
    return list
  }, [rows, filter, search])

  /* seleção */
  const allFilteredSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id))
  const toggleAll  = () => {
    if (allFilteredSelected) setSelected(p => { const n = new Set(p); filtered.forEach(r => n.delete(r.id)); return n })
    else                     setSelected(p => { const n = new Set(p); filtered.forEach(r => n.add(r.id));    return n })
  }
  const toggleRow  = (id) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const doConfirm = async () => {
    const nonError = rows.filter(r => r.status !== 'error')
    let toAdd = mode === 'new' ? nonError.filter(r => r.status === 'valid') : nonError
    if (!nonError.length) return
    setPhase('importing')
    let added = 0, deleted = 0, skipped = 0

    // ── Exclusão (modos 'delete' e 'all') ─────────────────────────────────
    if (mode === 'delete' || mode === 'all') {
      if (isAll) {
        // Agrupa nomes do CSV por seção
        const csvNamesByKey = {}
        nonError.forEach(r => {
          if (!r.listKey) return
          if (!csvNamesByKey[r.listKey]) csvNamesByKey[r.listKey] = new Set()
          csvNamesByKey[r.listKey].add(r.name.toLowerCase())
        })
        for (const [key, csvNames] of Object.entries(csvNamesByKey)) {
          if (!canBulkDeleteKey(key)) continue
          const delFn = API_MAP[key]?.del
          if (!delFn) continue
          const sectionItems = existingItemsByType[key] || []
          const toDelete = mode === 'delete'
            ? sectionItems.filter(i => csvNames.has((i.name || '').toLowerCase()))
            : sectionItems.filter(i => !csvNames.has((i.name || '').toLowerCase()))
          for (const item of toDelete) {
            try { await delFn(item.id); deleted++ } catch { skipped++ }
          }
        }
      } else {
        const csvNames = new Set(nonError.map(r => r.name.toLowerCase()))
        const delFn = API_MAP[type]?.del
        if (delFn && canDestructive) {
          const toDelete = mode === 'delete'
            ? existingItems.filter(i => csvNames.has((i.name || '').toLowerCase()))
            : existingItems.filter(i => !csvNames.has((i.name || '').toLowerCase()))
          for (const item of toDelete) {
            try { await delFn(item.id); deleted++ } catch { skipped++ }
          }
        }
      }
      // Modo 'delete' só exclui, não adiciona nada
      if (mode === 'delete') {
        setResult({ added, deleted, skipped })
        setPhase('done')
        return
      }
      // Modo 'all': após excluir, inserir apenas os válidos (ex-duplicados podem agora ser novos)
      toAdd = nonError.filter(r => r.status === 'valid')
    }

    // ── Inserção ──────────────────────────────────────────────────────────
    if (!toAdd.length) { setResult({ added, deleted, skipped }); setPhase('done'); return }

    const cityRows  = isAll ? toAdd.filter(r => r.listKey === 'cities') : []
    const otherRows = isAll ? toAdd.filter(r => r.listKey !== 'cities') : toAdd

    for (const row of otherRows) {
      try {
        const fn = isAll ? API_MAP[row.listKey]?.add : apiDef.add
        if (fn) await fn(row.name, row.extras || {}, { allCountries })
        added++
      } catch { skipped++ }
    }

    if (cityRows.length > 0) {
      const esc = s => (s || '').replace(/"/g, '""')
      const lines = ['pais,estado,cidade', ...cityRows.map(r =>
        `"${esc(r.extras.parent_country || '')}","${esc(r.extras.parent_state || '')}","${esc(r.name)}"`
      )]
      const fd = new FormData()
      fd.append('file', new Blob([lines.join('\n')], { type: 'text/csv' }), 'cities.csv')
      try {
        const res = await configApi.geoImport(fd)
        added += res.data.cities || 0
      } catch { skipped += cityRows.length }
    }

    setResult({ added, deleted, skipped })
    setPhase('done')
  }

  if (parsing) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:20, padding:60 }}>
      <div style={{ color:'#2e6db4' }}><Ic n="ul" s={48}/></div>
      <div style={{ textAlign:'center' }}>
        <h2 style={{ fontSize:18, fontWeight:700, color:'#0f172a', margin:'0 0 8px' }}>Analisando arquivo…</h2>
        <p style={{ fontSize:13, color:'#64748b', margin:0 }}>Aguarde enquanto processamos o CSV.</p>
      </div>
      <div style={{ width:280, background:'#e2e8f0', borderRadius:99, height:8, overflow:'hidden' }}>
        <div style={{ height:'100%', borderRadius:99, background:'#2e6db4', animation:'parseProgress 1.4s ease-in-out infinite alternate' }}/>
      </div>
      <style>{`@keyframes parseProgress { from { width:20% } to { width:88% } }`}</style>
    </div>
  )

  if (phase === 'done' && result) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:24, padding:48 }}>
      <div style={{ fontSize:56 }}>✅</div>
      <h2 style={{ fontSize:22, fontWeight:700, color:'#0f172a', margin:0 }}>Importação concluída!</h2>
      <div style={{ display:'flex', gap:16 }}>
        {result.added > 0 && (
          <div style={{ textAlign:'center', padding:'20px 32px', background:'#dcfce7', borderRadius:12, border:'1px solid #bbf7d0' }}>
            <div style={{ fontSize:36, fontWeight:700, color:'#16a34a' }}>{result.added}</div>
            <div style={{ fontSize:13, color:'#15803d', marginTop:4 }}>adicionados</div>
          </div>
        )}
        {result.deleted > 0 && (
          <div style={{ textAlign:'center', padding:'20px 32px', background:'#fee2e2', borderRadius:12, border:'1px solid #fecaca' }}>
            <div style={{ fontSize:36, fontWeight:700, color:'#dc2626' }}>{result.deleted}</div>
            <div style={{ fontSize:13, color:'#b91c1c', marginTop:4 }}>excluídos</div>
          </div>
        )}
        {result.skipped > 0 && (
          <div style={{ textAlign:'center', padding:'20px 32px', background:'#fef9c3', borderRadius:12, border:'1px solid #fde68a' }}>
            <div style={{ fontSize:36, fontWeight:700, color:'#ca8a04' }}>{result.skipped}</div>
            <div style={{ fontSize:13, color:'#a16207', marginTop:4 }}>com erro</div>
          </div>
        )}
      </div>
      <button onClick={() => navigate(backPath)}
        style={{ padding:'10px 28px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
        ← Voltar para Configurações
      </button>
    </div>
  )

  return (
    <div style={{ margin:'-26px -28px', background:'#f8fafc' }}>

      {/* Header */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'11px 28px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <button onClick={() => navigate(backPath)}
            style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:7, padding:'6px 12px', cursor:'pointer', color:'#475569', fontSize:13, fontFamily:'inherit' }}>
            ← Cancelar
          </button>
          <h1 style={{ fontSize:16, fontWeight:700, color:'#0f172a', margin:0 }}>
            Revisão de Importação — {isAll ? 'Todas as listas' : apiDef.label}
          </h1>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <span style={pill('#dcfce7','#16a34a')}>{stats.valid} válido{stats.valid!==1?'s':''}</span>
          <span style={pill('#fef9c3','#ca8a04')}>{stats.duplicate} duplicado{stats.duplicate!==1?'s':''}</span>
          <span style={pill('#fee2e2','#dc2626')}>{stats.error} com erro</span>
        </div>
      </div>

      <div style={{ padding:'20px 28px', display:'flex', flexDirection:'column', gap:14 }}>

        {/* Info */}
        <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'10px 16px', display:'flex', gap:10 }}>
          <span style={{ fontSize:16 }}>ℹ️</span>
          <p style={{ fontSize:13, color:'#1e40af', margin:0 }}>
            Revise os itens antes de confirmar. Clique em qualquer nome para editar. Selecione e apague linhas indesejadas antes de importar.
          </p>
        </div>

        {/* Modo */}
        <div>
          <p style={{ fontSize:11, fontWeight:700, color:'#64748b', margin:'0 0 8px', textTransform:'uppercase', letterSpacing:'.06em' }}>Modo de Importação:</p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
            {MODES.map(m => {
              const locked = (m.key === 'all' || m.key === 'delete') && !canDestructive
              return (
                <div key={m.key}
                  onClick={() => !locked && setMode(m.key)}
                  title={locked ? 'Você não tem permissão de exclusão em massa para nenhuma seção deste CSV' : undefined}
                  style={{ border:`2px solid ${mode===m.key?'#2e6db4':locked?'#f1f5f9':'#e2e8f0'}`, borderRadius:10, padding:'12px 16px', cursor:locked?'not-allowed':'pointer',
                    background: mode===m.key?'#f0f6ff':locked?'#f8fafc':'#fff', transition:'all .12s', opacity: locked ? .55 : 1 }}>
                  <p style={{ fontSize:14, fontWeight:700, color:mode===m.key?'#1a2d4f':locked?'#94a3b8':'#1e293b', margin:'0 0 4px' }}>{m.label}</p>
                  <p style={{ fontSize:12, color:'#64748b', margin:0 }}>{locked ? 'Permissão necessária: exclusão em massa' : m.desc}</p>
                </div>
              )
            })}
          </div>
          {isAll && (mode === 'all' || mode === 'delete') && (
            <p style={{ fontSize:12, color:'#b45309', margin:'8px 0 0', background:'#fef9c3', border:'1px solid #fde68a', borderRadius:6, padding:'6px 12px' }}>
              ⚠️ Para importação combinada, a exclusão aplica-se apenas às seções onde você tem permissão de exclusão em massa.
            </p>
          )}
        </div>

        {/* Toolbar: busca + filtros + seleção */}
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={`Buscar entre ${rows.length} itens…`}
            style={{ padding:'7px 12px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', fontFamily:'inherit', width:230 }}
            onFocus={e => e.target.style.borderColor='#1a2d4f'}
            onBlur={e  => e.target.style.borderColor='#e2e8f0'} />
          {[
            {key:'all',       label:`Todos (${rows.length})`},
            {key:'valid',     label:`Válidos (${stats.valid})`},
            {key:'duplicate', label:`Duplicados (${stats.duplicate})`},
            {key:'error',     label:`Com erro (${stats.error})`},
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{ padding:'6px 13px', borderRadius:20, border:'1.5px solid', fontFamily:'inherit',
                borderColor: filter===f.key?'#1a2d4f':'#e2e8f0',
                background:  filter===f.key?'#1a2d4f':'#fff',
                color:       filter===f.key?'#fff':'#475569',
                fontSize:12, fontWeight:500, cursor:'pointer' }}>
              {f.label}
            </button>
          ))}
          {selected.size > 0 && (
            <button
              onClick={() => setConfirm({ type:'bulk', count: selected.size })}
              style={{ marginLeft:'auto', padding:'6px 14px', borderRadius:8, border:'1px solid #fecaca', background:'#fef2f2', color:'#dc2626', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              Apagar {selected.size} selecionado{selected.size!==1?'s':''}
            </button>
          )}
        </div>

        {/* Tabela */}
        <div style={{ background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', overflow:'hidden' }}>
          <div style={{ overflowY:'auto', maxHeight:'calc(100vh - 520px)', minHeight:200 }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width:44, textAlign:'center' }}>
                    <input type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAll}
                      title={allFilteredSelected ? 'Desmarcar todos' : 'Selecionar todos visíveis'}
                    />
                  </th>
                  <th style={{...th, width:60}}>Linha</th>
                  <th style={{...th, width:130}}>Status</th>
                  {isAll && <th style={{...th, width:180}}>Lista</th>}
                  <th style={th}>Nome</th>
                  {isAll && <th style={{...th, width:150}}>Detalhes</th>}
                  <th style={{...th, width:80, textAlign:'center'}}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={isAll ? 7 : 5} style={{textAlign:'center',padding:'36px 0',color:'#94a3b8',fontSize:13}}>
                    {search ? 'Nenhum resultado para a busca.' : 'Nenhum item nesta categoria.'}
                  </td></tr>
                ) : filtered.slice(0, visibleCount).map((row, idx) => {
                  const isSel = selected.has(row.id)
                  return (
                    <tr key={row.id} style={{ borderTop:'1px solid #f1f5f9', background: isSel ? '#f0f6ff' : idx%2===0 ? '#fff' : '#fafafa' }}>
                      <td style={{padding:'9px 12px', textAlign:'center'}}>
                        <input type="checkbox" checked={isSel} onChange={() => toggleRow(row.id)} />
                      </td>
                      <td style={{padding:'9px 12px', color:'#94a3b8', fontSize:12}}>{row.id}</td>
                      <td style={{padding:'9px 12px'}}>
                        {row.status==='valid'     && <span style={pill('#dcfce7','#16a34a')}>Válido</span>}
                        {row.status==='duplicate' && <span style={pill('#fef9c3','#ca8a04')}>Duplicado</span>}
                        {row.status==='error'     && <span style={pill('#fee2e2','#dc2626')}>Inválido</span>}
                      </td>
                      {isAll && (
                        <td style={{padding:'9px 12px', fontSize:12.5, color: row.listKey ? '#1e293b' : '#dc2626'}}>
                          {row.listKey ? row.listLabel : (row.listLabel ? `"${row.listLabel}" — lista desconhecida` : '—')}
                        </td>
                      )}
                      <td style={{padding:'9px 12px'}}>
                        <Editable value={row.name} onChange={v => editRow(row.id, v)} />
                      </td>
                      {isAll && (
                        <td style={{padding:'9px 12px', fontSize:12, color:'#64748b'}}>
                          {row.listKey === 'accommodations' && row.extras && (
                            <span>{row.extras.capacity ?? 1}p{row.extras.is_couple ? ' · casal' : ''}</span>
                          )}
                          {row.listKey === 'doc_types' && row.extras?.code && (
                            <span style={{fontFamily:'monospace'}}>{row.extras.code}</span>
                          )}
                          {row.listKey === 'airports' && (
                            <span>{[row.extras?.code, row.extras?.parent_state, row.extras?.parent_country].filter(Boolean).join(' · ')}</span>
                          )}
                          {row.listKey === 'airlines' && (
                            <span>{[row.extras?.code, row.extras?.parent_country].filter(Boolean).join(' · ')}</span>
                          )}
                          {row.listKey === 'countries' && row.extras?.code && (
                            <span style={{fontFamily:'monospace'}}>{row.extras.code}</span>
                          )}
                          {row.listKey === 'states' && (
                            <span>{row.extras?.parent_country || <em style={{color:'#dc2626'}}>sem país</em>}{row.extras?.code ? ` (${row.extras.code})` : ''}</span>
                          )}
                          {row.listKey === 'cities' && (
                            <span>{row.extras?.parent_state || <em style={{color:'#dc2626'}}>sem estado</em>}{row.extras?.parent_country ? `, ${row.extras.parent_country}` : ''}</span>
                          )}
                        </td>
                      )}
                      <td style={{padding:'9px 12px', textAlign:'center'}}>
                        <button
                          onClick={() => setConfirm({ type:'single', id: row.id, name: row.name })}
                          style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:6,cursor:'pointer',color:'#dc2626',fontSize:13,padding:'4px 9px',fontFamily:'inherit'}}
                          title="Remover linha">✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Carregar mais */}
        {visibleCount < filtered.length && (
          <div style={{ display:'flex', justifyContent:'center', padding:'4px 0 2px' }}>
            <button
              onClick={() => setVisibleCount(c => c + 20)}
              style={{ padding:'8px 28px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              Carregar mais — mostrando {Math.min(visibleCount, filtered.length)} de {filtered.length}
            </button>
          </div>
        )}

        {/* Footer */}
        <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:12, color:'#94a3b8' }}>
            {filtered.length} de {rows.length} item{rows.length!==1?'s':''} · {selected.size > 0 && `${selected.size} selecionado${selected.size!==1?'s':''}`}
          </span>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => navigate(backPath)}
              style={{padding:'9px 20px',borderRadius:8,border:'1.5px solid #e2e8f0',background:'#fff',color:'#475569',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
              Cancelar
            </button>
            <button onClick={doConfirm}
              disabled={phase==='importing' || rows.filter(r=>r.status!=='error').length===0}
              style={{padding:'9px 22px',borderRadius:8,border:'none',background:'#1a2d4f',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:8,
                opacity: rows.filter(r=>r.status!=='error').length===0?.5:1}}>
              {phase==='importing' ? <><Spin/> Importando…</> : <>✓ Confirmar Importação</>}
            </button>
          </div>
        </div>

      </div>

      {/* Modal de confirmação */}
      {confirm?.type === 'bulk' && (
        <ConfirmModal
          message={`Remover ${confirm.count} linha${confirm.count!==1?'s':''} selecionada${confirm.count!==1?'s':''}?`}
          detail="As linhas serão removidas apenas desta lista de importação, não do banco de dados."
          okLabel="Remover"
          onOk={() => removeRows(selected)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.type === 'single' && (
        <ConfirmModal
          message={`Remover a linha "${confirm.name}"?`}
          detail="Será removida apenas desta lista de importação."
          okLabel="Remover"
          onOk={() => removeRows(new Set([confirm.id]))}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
