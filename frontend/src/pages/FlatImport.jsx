import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { configApi, listsApi, auditApi } from '../api'
import ConfirmModal from '../components/ConfirmModal'
import { useAuth } from '../context/AuthContext'
import { Ic } from '../components/Icon'
import { CARD_META } from '../utils/sectionMeta'
import { NameFormModal, ProfileModal } from './Settings'
import { AccomFormModal } from '../components/AccommodationManager'
import { AirportFormModal } from '../components/AirportsManager'
import { AirlineFormModal } from '../components/AirlinesManager'
import { BusMapModal } from '../components/BusMapsManager'
import { setLocalJob, finishLocalJob } from '../utils/localJobs'

const NAME_EDIT_KEYS = new Set([
  'professions', 'languages', 'vaccines', 'genders', 'prof_cards',
  'list_addits', 'crew_roles', 'list_categories', 'countries', 'states', 'cities',
])
const NAME_UPDATE_FN = {
  professions:     (id, name) => configApi.updateProfession(id, name),
  languages:       (id, name) => configApi.updateLanguage(id, name),
  vaccines:        (id, name) => configApi.updateVaccine(id, name),
  genders:         (id, name) => configApi.updateGender(id, name),
  prof_cards:      (id, name) => configApi.updateProfCard(id, name),
  list_addits:     (id, name) => listsApi.updateAdditional(id, name),
  crew_roles:      (id, name) => listsApi.updateCrewRole(id, name),
  list_categories: (id, name) => configApi.updateListCategory(id, name),
  countries:       (id, name) => configApi.updateCountry(id, name),
  states:          (id, name) => configApi.updateState(id, name),
  cities:          (id, name) => configApi.updateCity(id, name),
}
const OBJECT_EDIT_KEYS = new Set(['accommodations', 'airports', 'airlines', 'bus_maps'])
const MATCH_FIELD = { bus_maps: 'label' } // demais tipos casam pelo campo "name"

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
    const listKey = labelToKey[listLabel.toLowerCase()] || null
    if (listKey === 'bus_maps' && extras.code) {
      try {
        const parsed = JSON.parse(extras.code)
        extras.key = parsed.key
        extras.deck_count = parsed.deck_count
        extras.rows = parsed.rows
      } catch { /* mapa exportado em formato antigo, sem dados de fileiras */ }
    }
    if (listKey === 'perm_profiles') {
      extras.permissionKeys = extras.code ? extras.code.split('|').filter(Boolean) : []
    }
    if (listKey === 'doc_types' && extras.code) {
      try {
        const parsed = JSON.parse(extras.code)
        extras.key = parsed.key
        extras.icon = parsed.icon
        extras.color = parsed.color
      } catch { extras.key = extras.code } // formato antigo: codigo era só a key, sem ícone/cor
    }
    return { listLabel, listKey, name, extras }
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
  doc_types:       { add: (name, extras) => configApi.addDocType({
                       label: name, key: extras.key || name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
                       icon: extras.icon || '📄', color: extras.color || '#475569',
                     }), del: (id) => configApi.delDocType(id), label: 'Documentos' },
  airports:        { add: (name, extras) => configApi.addAirport({ name, iata_code: extras.code || '', city: extras.parent_state || '', country: extras.parent_country || '' }), del: (id) => configApi.delAirport(id), label: 'Aeroportos' },
  airlines:        { add: (name, extras) => configApi.addAirline({ name, iata_code: extras.code || '', country: extras.parent_country || '' }), del: (id) => configApi.delAirline(id), label: 'Companhias Aéreas' },
  countries:       { add: (name, extras) => configApi.addCountry(name, extras.code || ''), del: (id) => configApi.delCountry(id), label: 'Países' },
  states:          { add: (name, extras, ctx) => {
    const c = (ctx?.allCountries || []).find(x => x.name.toLowerCase() === (extras.parent_country || '').toLowerCase())
    if (!c) return Promise.reject(new Error('País não encontrado'))
    return configApi.addState(c.id, name, extras.code || '')
  }, del: (id) => configApi.delState(id), label: 'Estados' },
  cities:          { add: null, del: null, label: 'Cidades' }, // importadas em batch via geoImport
  perm_profiles:   { add: (name, extras) => configApi.addPermissionProfile({
                       name, permissions: Object.fromEntries((extras.permissionKeys || []).map(k => [k, true])),
                     }), del: (id) => configApi.delPermissionProfile(id), label: 'Perfis de Permissão' },
  bus_maps:        { add: (name, extras) => configApi.addBusMap({
                       key: extras.key || name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
                       label: name, order: extras.order || 0, is_active: extras.is_active ?? true,
                       deck_count: extras.deck_count || 1, rows: extras.rows || [],
                     }), del: (id) => configApi.delBusMap(id), label: 'Mapas de Ônibus' },
}

const LABEL_TO_KEY = Object.fromEntries(
  Object.entries(API_MAP).map(([key, def]) => [def.label.toLowerCase(), key])
)

// Tipos com campos extras (não só "nome") — usam o mesmo parser rico do CSV combinado
const RICH_TYPES = new Set(['accommodations', 'doc_types', 'airports', 'airlines', 'bus_maps', 'perm_profiles'])

// Seções que aparecem no CSV exportado mas não podem ser importadas
const EXPORT_ONLY_KEYS = new Set()

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
  bus_maps:        'settings_bus_maps_delete',
  perm_profiles:   'settings_user_profiles_delete',
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
  const [listFilter,  setListFilter]  = useState('all')
  const [listFilterOpen, setListFilterOpen] = useState(false)
  const listFilterRef = useRef(null)
  const [search,      setSearch]      = useState('')
  const [selected,    setSelected]    = useState(new Set())
  const [confirm,     setConfirm]     = useState(null) // { type:'bulk'|'single', id?, count? }
  const [confirmDestructive, setConfirmDestructive] = useState(false) // gate vermelho antes de excluir de verdade (modo 'all'/'delete')
  const [parsing,            setParsing]           = useState(!!csvText)
  const [visibleCount,       setVisibleCount]       = useState(20)
  const [skippedExportOnly,  setSkippedExportOnly]  = useState(0)
  const [itemsByType, setItemsByType] = useState(() => isAll ? existingItemsByType : { [type]: existingItems })
  const [editingRow,  setEditingRow]  = useState(null) // { listKey, item, rowId }

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
    if (listKey === 'bus_maps' && !extras.rows) return 'error'
    const set = existingSets[listKey ?? type]
    const key = listKey === 'cities'
      ? `${extras.parent_country || ''}|${extras.parent_state || ''}|${name}`.toLowerCase()
      : name.toLowerCase()
    return set?.has(key) ? 'duplicate' : 'valid'
  }

  useEffect(() => {
    if (!csvText) { navigate(backPath); return }
    // Defer heavy parsing so the loading screen renders first
    const timer = setTimeout(() => {
      if (isAll) {
        const parsed = parseCombinedCsv(csvText, LABEL_TO_KEY)
        const importable = parsed.filter(r => !EXPORT_ONLY_KEYS.has(r.listKey))
        setSkippedExportOnly(parsed.length - importable.length)
        setRows(importable.map((r, i) => ({
          id: i + 1, name: r.name, listKey: r.listKey, listLabel: r.listKey ? API_MAP[r.listKey].label : r.listLabel,
          extras: r.extras || {},
          status: rowStatus(r.name, r.listKey, r.extras || {}),
        })))
      } else if (RICH_TYPES.has(type) && /(^|\n)\s*lista\s*,\s*nome\b/i.test(csvText)) {
        const parsed = parseCombinedCsv(csvText, LABEL_TO_KEY)
        setRows(parsed.map((r, i) => ({
          id: i + 1, name: r.name, listKey: type, listLabel: apiDef.label,
          extras: r.extras || {},
          status: rowStatus(r.name, type, r.extras || {}),
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
  useEffect(() => { setVisibleCount(20) }, [filter, listFilter, search])

  useEffect(() => {
    if (!listFilterOpen) return
    const onClick = (e) => { if (listFilterRef.current && !listFilterRef.current.contains(e.target)) setListFilterOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [listFilterOpen])

  const editRow = (id, name) => setRows(prev => prev.map(r => r.id === id
    ? { ...r, name, status: rowStatus(name, r.listKey, r.extras) }
    : r
  ))

  const removeRows = (ids) => {
    setRows(prev => prev.filter(r => !ids.has(r.id)))
    setSelected(new Set())
    setConfirm(null)
  }

  /* Edição de itens já existentes (linhas "Duplicado") a partir da própria revisão de importação */
  const findExistingItem = (row) => {
    const key = row.listKey ?? type
    const items = itemsByType[key] || []
    const field = MATCH_FIELD[key] || 'name'
    return items.find(i => (i[field] || '').toLowerCase() === row.name.toLowerCase())
  }

  const canEditRow = (row) => row.status === 'duplicate'
    && (NAME_EDIT_KEYS.has(row.listKey ?? type) || OBJECT_EDIT_KEYS.has(row.listKey ?? type) || (row.listKey ?? type) === 'perm_profiles')
    && !!findExistingItem(row)

  const openEdit = (row) => {
    const item = findExistingItem(row)
    if (!item) return
    setEditingRow({ listKey: row.listKey ?? type, item, rowId: row.id })
  }

  const patchAfterEdit = (listKey, itemId, patch) => {
    setItemsByType(prev => ({
      ...prev,
      [listKey]: (prev[listKey] || []).map(i => i.id === itemId ? { ...i, ...patch } : i),
    }))
    setRows(prev => prev.map(r => {
      if (r.id !== editingRow?.rowId) return r
      const nextExtras = { ...r.extras }
      if ('capacity'   in patch) nextExtras.capacity   = patch.capacity
      if ('is_couple'  in patch) nextExtras.is_couple   = patch.is_couple
      if ('rows'       in patch) nextExtras.rows        = patch.rows
      if ('deck_count' in patch) nextExtras.deck_count  = patch.deck_count
      return { ...r, name: patch.name ?? patch.label ?? r.name, extras: nextExtras }
    }))
  }

  const refreshPermProfileRow = async () => {
    const rowId = editingRow?.rowId
    try {
      const r = await configApi.permissionProfiles()
      const list = r.data.results ?? r.data
      setItemsByType(prev => ({ ...prev, perm_profiles: list }))
      const updated = list.find(p => p.id === editingRow.item.id)
      if (updated && rowId != null) {
        setRows(prev => prev.map(row => row.id === rowId ? {
          ...row, name: updated.name,
          extras: { ...row.extras, permissionKeys: Object.entries(updated.permissions || {}).filter(([, v]) => v).map(([k]) => k) },
        } : row))
      }
    } catch { /* mantém os dados antigos em cache se a atualização falhar */ }
  }

  const stats = useMemo(() => ({
    valid:     rows.filter(r => r.status === 'valid').length,
    duplicate: rows.filter(r => r.status === 'duplicate').length,
    error:     rows.filter(r => r.status === 'error').length,
  }), [rows])

  const listOptions = useMemo(() => {
    if (!isAll) return []
    const seen = new Map()
    rows.forEach(r => {
      if (!r.listKey) return
      const entry = seen.get(r.listKey) || { label: r.listLabel, count: 0 }
      entry.count++
      seen.set(r.listKey, entry)
    })
    return [...seen.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label))
  }, [rows, isAll])

  const filtered = useMemo(() => {
    let list = rows
    if (filter !== 'all') list = list.filter(r => r.status === filter)
    if (isAll && listFilter !== 'all') list = list.filter(r => r.listKey === listFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r => r.name.toLowerCase().includes(q))
    }
    return list
  }, [rows, filter, listFilter, isAll, search])

  /* seleção */
  const allFilteredSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id))
  const toggleAll  = () => {
    if (allFilteredSelected) setSelected(p => { const n = new Set(p); filtered.forEach(r => n.delete(r.id)); return n })
    else                     setSelected(p => { const n = new Set(p); filtered.forEach(r => n.add(r.id));    return n })
  }
  const toggleRow  = (id) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const logUploadSummary = (added, deleted, skipped) => {
    auditApi.logUpload({
      label: filename || (isAll ? 'todas_as_configuracoes.csv' : `${apiDef.label}.csv`),
      model_label: isAll ? 'Importação CSV (todas as configurações)' : `Importação CSV — ${apiDef.label}`,
      model_name: isAll ? 'CsvImportAll' : `CsvImport${type}`,
      summary: { Modo: MODES.find(m => m.key === mode)?.label || mode, Adicionados: added, Excluídos: deleted, 'Com erro': skipped },
    }).catch(() => {})
  }

  // Total é uma estimativa (cada linha do CSV ~ 1 unidade de trabalho, seja
  // ela uma exclusão ou uma inserção) — o bastante pra mostrar % e ETA
  // razoáveis na barra lateral, sem precisar duplicar toda a lógica de
  // filtragem de quem-vai-ser-excluído só para contar com exatidão.
  const runImportJob = async (jobId) => {
    const nonError = rows.filter(r => r.status !== 'error')
    let toAdd = mode === 'new' ? nonError.filter(r => r.status === 'valid') : nonError
    if (!nonError.length) { finishLocalJob(jobId); return }
    let added = 0, deleted = 0, skipped = 0
    const total = nonError.length
    const bump = () => setLocalJob(jobId, { done: Math.min(added + deleted + skipped, total) })

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
            bump()
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
            bump()
          }
        }
      }
      // Modo 'delete' só exclui, não adiciona nada
      if (mode === 'delete') {
        logUploadSummary(added, deleted, skipped)
        finishLocalJob(jobId)
        return
      }
      // Modo 'all': após excluir, inserir apenas os válidos (ex-duplicados podem agora ser novos)
      toAdd = nonError.filter(r => r.status === 'valid')
    }

    // ── Inserção ──────────────────────────────────────────────────────────
    if (!toAdd.length) {
      logUploadSummary(added, deleted, skipped)
      finishLocalJob(jobId)
      return
    }

    const cityRows  = isAll ? toAdd.filter(r => r.listKey === 'cities') : []
    const otherRows = isAll ? toAdd.filter(r => r.listKey !== 'cities') : toAdd

    for (const row of otherRows) {
      try {
        const fn = isAll ? API_MAP[row.listKey]?.add : apiDef.add
        if (fn) await fn(row.name, row.extras || {}, { allCountries })
        added++
      } catch { skipped++ }
      bump()
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
      bump()
    }

    logUploadSummary(added, deleted, skipped)
    finishLocalJob(jobId)
  }

  const startImportJob = () => {
    const nonError = rows.filter(r => r.status !== 'error')
    if (!nonError.length) return
    const jobId = `csvimport-${Date.now()}`
    const modeLabel = MODES.find(m => m.key === mode)?.label || ''
    setLocalJob(jobId, {
      kind: 'csv_import',
      label: isAll ? `Importação CSV — ${modeLabel}` : `${apiDef.label} — ${modeLabel}`,
      done: 0, total: nonError.length, status: 'running', _startedAt: Date.now(),
    })
    navigate(backPath)
    runImportJob(jobId)
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

        {/* Aviso de seções ignoradas (exportadas mas não importáveis) */}
        {skippedExportOnly > 0 && (
          <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, padding:'10px 16px', display:'flex', gap:10, alignItems:'flex-start' }}>
            <span style={{ fontSize:16, flexShrink:0 }}>⚠️</span>
            <p style={{ fontSize:13, color:'#92400e', margin:0 }}>
              <strong>{skippedExportOnly} linha{skippedExportOnly !== 1 ? 's' : ''} ignorada{skippedExportOnly !== 1 ? 's' : ''}:</strong> seções de somente exportação (Perfis de Permissão) não podem ser reimportadas e foram removidas da lista.
            </p>
          </div>
        )}

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

          {isAll && listOptions.length > 1 && (() => {
            const current = listFilter === 'all' ? null : CARD_META[listFilter]
            const currentLabel = listFilter === 'all' ? 'Todas as listas' : listOptions.find(([k]) => k === listFilter)?.[1].label
            const fg = current ? `oklch(0.52 0.15 ${current.hue})` : '#475569'
            return (
              <div ref={listFilterRef} style={{ position:'relative' }}>
                <button onClick={() => setListFilterOpen(o => !o)}
                  style={{ display:'flex', alignItems:'center', gap:7, padding:'6.5px 12px', borderRadius:8,
                    border:'1.5px solid #e2e8f0', background:'#fff', color: fg,
                    fontSize:12.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit', minWidth:170 }}>
                  <Ic n={current ? current.icon : 'grid'} s={14}/>
                  <span style={{ flex:1, textAlign:'left' }}>{currentLabel}</span>
                  <span style={{ transform: listFilterOpen ? 'rotate(180deg)' : 'none', transition:'transform .12s', color:'#94a3b8' }}>
                    <Ic n="chevron" s={12}/>
                  </span>
                </button>
                {listFilterOpen && (
                  <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, zIndex:20, width:240, maxHeight:340, overflowY:'auto',
                    background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, boxShadow:'0 8px 24px rgba(15,23,42,.12)', padding:6 }}>
                    <button onClick={() => { setListFilter('all'); setListFilterOpen(false) }}
                      style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'7px 9px', borderRadius:7, border:'none',
                        background: listFilter==='all' ? '#f1f5f9' : 'transparent', color:'#334155',
                        fontSize:12.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit', textAlign:'left' }}>
                      <Ic n="grid" s={14}/> Todas as listas
                    </button>
                    {listOptions.map(([key, { label, count }]) => {
                      const meta = CARD_META[key] || { icon:'list', hue:220 }
                      const active = listFilter === key
                      return (
                        <button key={key} onClick={() => { setListFilter(key); setListFilterOpen(false) }}
                          style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'7px 9px', borderRadius:7, border:'none',
                            background: active ? `oklch(0.955 0.035 ${meta.hue})` : 'transparent',
                            color: `oklch(0.52 0.15 ${meta.hue})`,
                            fontSize:12.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit', textAlign:'left' }}>
                          <Ic n={meta.icon} s={14}/>
                          <span style={{ flex:1, color:'#334155' }}>{label}</span>
                          <span style={{ opacity:.65, fontWeight:500 }}>{count}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}

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
                  <th style={{...th, width:110, textAlign:'center'}}>Ação</th>
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
                          {row.listKey === 'bus_maps' && (
                            row.extras?.rows
                              ? <span>{row.extras.rows.length} fileira{row.extras.rows.length!==1?'s':''} · {row.extras.deck_count===2?'2 andares':'1 andar'}</span>
                              : <em style={{color:'#dc2626'}}>sem dados de fileiras</em>
                          )}
                          {row.listKey === 'perm_profiles' && (() => {
                            const n = (row.extras?.permissionKeys || []).length
                            return <span>{n} {n === 1 ? 'permissão' : 'permissões'}</span>
                          })()}
                        </td>
                      )}
                      <td style={{padding:'9px 12px', textAlign:'center', display:'flex', gap:6, justifyContent:'center'}}>
                        {canEditRow(row) && (
                          <button
                            onClick={() => openEdit(row)}
                            style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:6,cursor:'pointer',color:'#2563eb',fontSize:13,padding:'4px 9px',fontFamily:'inherit'}}
                            title="Editar item">
                            <Ic n="edit" s={13}/>
                          </button>
                        )}
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
            <button
              onClick={() => (mode === 'delete' || mode === 'all') ? setConfirmDestructive(true) : startImportJob()}
              disabled={rows.filter(r=>r.status!=='error').length===0}
              style={{padding:'9px 22px',borderRadius:8,border:'none',
                background: (mode === 'delete' || mode === 'all') ? '#dc2626' : '#1a2d4f',
                color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:8,
                opacity: rows.filter(r=>r.status!=='error').length===0?.5:1}}>
              {(mode === 'delete' || mode === 'all') ? <>⚠ Confirmar Exclusão</> : <>✓ Confirmar Importação</>}
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

      {/* Confirmação vermelha antes de excluir de verdade do banco (modo "Substituir lista" ou "Apagar os importados") */}
      {confirmDestructive && (
        <ConfirmModal
          danger
          title="Confirmar exclusão definitiva"
          message={mode === 'delete'
            ? 'Isso vai apagar do banco de dados exatamente os registros listados neste CSV.'
            : 'Isso vai apagar do banco de dados todos os registros que NÃO estão neste CSV, e inserir os novos.'}
          detail="Essa exclusão é real — os registros não vão para nenhuma lixeira."
          okLabel="Excluir e importar"
          onOk={() => { setConfirmDestructive(false); startImportJob() }}
          onCancel={() => setConfirmDestructive(false)}
        />
      )}

      {/* Edição do item real (já existente no banco) a partir da revisão de importação */}
      {editingRow && NAME_EDIT_KEYS.has(editingRow.listKey) && (
        <NameFormModal
          title={`Editar ${(API_MAP[editingRow.listKey]?.label || '').toLowerCase()}`}
          initial={editingRow.item.name}
          onSave={async (name) => {
            await NAME_UPDATE_FN[editingRow.listKey](editingRow.item.id, name)
            patchAfterEdit(editingRow.listKey, editingRow.item.id, { name })
            toast.success('Atualizado.')
          }}
          onClose={() => setEditingRow(null)}
        />
      )}
      {editingRow?.listKey === 'accommodations' && (
        <AccomFormModal
          title="Editar acomodação"
          initial={editingRow.item}
          onSave={async (data) => {
            await configApi.updateAccommodation(editingRow.item.id, data)
            patchAfterEdit('accommodations', editingRow.item.id, data)
            toast.success('Atualizado.')
          }}
          onClose={() => setEditingRow(null)}
        />
      )}
      {editingRow?.listKey === 'airports' && (
        <AirportFormModal
          title="Editar aeroporto"
          initial={editingRow.item}
          onSave={async (data) => {
            await configApi.updateAirport(editingRow.item.id, data)
            patchAfterEdit('airports', editingRow.item.id, data)
            toast.success('Atualizado.')
          }}
          onClose={() => setEditingRow(null)}
        />
      )}
      {editingRow?.listKey === 'airlines' && (
        <AirlineFormModal
          title="Editar companhia aérea"
          initial={editingRow.item}
          onSave={async (data) => {
            await configApi.updateAirline(editingRow.item.id, data)
            patchAfterEdit('airlines', editingRow.item.id, data)
            toast.success('Atualizado.')
          }}
          onClose={() => setEditingRow(null)}
        />
      )}
      {editingRow?.listKey === 'bus_maps' && (
        <BusMapModal
          busMap={editingRow.item}
          onSave={async (data) => {
            await configApi.updateBusMap(editingRow.item.id, data)
            patchAfterEdit('bus_maps', editingRow.item.id, data)
            toast.success('Mapa atualizado.')
          }}
          onClose={() => setEditingRow(null)}
        />
      )}
      {editingRow?.listKey === 'perm_profiles' && (
        <ProfileModal
          profile={editingRow.item}
          onSaved={async () => { await refreshPermProfileRow(); setEditingRow(null) }}
          onClose={() => setEditingRow(null)}
        />
      )}
    </div>
  )
}
