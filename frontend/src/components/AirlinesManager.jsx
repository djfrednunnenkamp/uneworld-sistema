import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { configApi } from '../api'
import ConfirmModal from './ConfirmModal'
import { Ic } from './Icon'
import CsvImportPopup from './CsvImportPopup'
import { CSV_SAMPLES } from '../utils/csvSamples'
import { exportSectionCsv } from '../utils/sectionCsv'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAuth } from '../context/AuthContext'
import { dashboardWsUrl } from '../utils/ws'

let _cachedCountries = null

function CountryField({ value, onChange }) {
  const [query,       setQuery]       = useState(value || '')
  const [open,        setOpen]        = useState(false)
  const [all,         setAll]         = useState(_cachedCountries || [])
  const [highlighted, setHighlighted] = useState(-1)
  const [dropStyle,   setDropStyle]   = useState({})
  const inputRef = useRef(null)

  useEffect(() => { setQuery(value || '') }, [value])

  useEffect(() => {
    if (_cachedCountries) return
    configApi.countries().then(r => {
      _cachedCountries = r.data
      setAll(r.data)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const h = e => {
      if (inputRef.current && !inputRef.current.contains(e.target) &&
          !e.target.closest('[data-cntry-drop]')) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const openDrop = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect()
      setDropStyle({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 220) })
    }
    setOpen(true)
    setHighlighted(-1)
  }

  const filtered = all.filter(c =>
    c.name.toLowerCase().includes((query || '').toLowerCase())
  ).slice(0, 80)

  const select = (c) => {
    onChange(c.name)
    setQuery(c.name)
    setOpen(false)
  }

  const handleKeyDown = (e) => {
    if (!open) { if (e.key !== 'Tab') openDrop(); return }
    if (e.key === 'Escape')    { setOpen(false) }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)) }
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault()
      select(highlighted >= 0 ? filtered[highlighted] : filtered[0])
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); if (!open) openDrop() }}
        onFocus={openDrop}
        onKeyDown={handleKeyDown}
        placeholder="Ex: Brasil"
        style={{ width:'100%', boxSizing:'border-box', padding:'7px 10px', border:'1.5px solid #e2e8f0', borderRadius:6, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b', background:'#fff' }}
        onBlur={e => { e.target.style.borderColor='#e2e8f0' }}
      />
      {open && createPortal(
        <div data-cntry-drop
          style={{ position:'fixed', ...dropStyle, background:'#fff', border:'1.5px solid #e2e8f0', borderRadius:8, maxHeight:220, overflowY:'auto', zIndex:9999, boxShadow:'0 8px 24px rgba(0,0,0,.14)' }}>
          {filtered.length === 0 ? (
            <p style={{ textAlign:'center', padding:'12px 0', color:'#94a3b8', fontSize:13, margin:0 }}>
              {all.length === 0 ? 'Carregando…' : 'Nenhum país encontrado.'}
            </p>
          ) : filtered.map((c, idx) => (
            <div key={c.id}
              data-cntry-drop
              onMouseDown={e => { e.preventDefault(); select(c) }}
              onMouseEnter={() => setHighlighted(idx)}
              style={{ padding:'8px 12px', cursor:'pointer', fontSize:13, color:'#1e293b', borderBottom:'1px solid #f1f5f9', background: idx === highlighted ? '#e8f0fe' : '#fff' }}>
              {c.name}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

const inp = { padding:'7px 10px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b' }
const onF  = e => e.target.style.borderColor = '#1a2d4f'
const onB  = e => e.target.style.borderColor = '#e2e8f0'
const btnCsv = (color) => ({
  padding: '6px 11px', borderRadius: 7, border: `1.5px solid ${color}20`,
  background: `${color}10`, color, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
})

export function AirlineFormModal({ title, initial, onSave, onClose }) {
  const [name,    setName]    = useState(initial?.name ?? '')
  const [iata,    setIata]    = useState(initial?.iata_code ?? '')
  const [country, setCountry] = useState(initial?.country ?? '')
  const [saving,  setSaving]  = useState(false)
  const inputRef = useRef(null)

  const handleSave = async () => {
    const v = name.trim(); if (!v) return
    setSaving(true)
    try {
      await onSave({ name: v, iata_code: iata.trim().toUpperCase(), country: country.trim() })
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="mbox" style={{ maxWidth:400 }} onClick={e => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">{title}</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="mbody">
          <div className="ff">
            <label className="fl">Nome da companhia *</label>
            <input ref={inputRef} className="fi" value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="Ex: LATAM Airlines" />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'100px 1fr', gap:10 }}>
            <div className="ff" style={{ margin:0 }}>
              <label className="fl">IATA</label>
              <input className="fi" value={iata} onChange={e => setIata(e.target.value.toUpperCase())}
                maxLength={3} placeholder="LA" style={{ textTransform:'uppercase' }} />
            </div>
            <div className="ff" style={{ margin:0 }}>
              <label className="fl">País</label>
              <CountryField value={country} onChange={setCountry} />
            </div>
          </div>
        </div>
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Salvando…' : (initial ? 'Salvar' : '+ Adicionar')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ item, onEdit, onDelete, onToggleFavorite, canEdit, canDelete }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom:'1px solid #f1f5f9', background:'#fff' }}
      onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
      onMouseLeave={e => e.currentTarget.style.background='#fff'}>
      {canEdit && (
        <button type="button" onClick={() => onToggleFavorite(item)}
          title={item.is_favorite ? 'Remover dos favoritos' : 'Marcar como favorito'}
          style={{ background:'none', border:'none', cursor:'pointer', padding:0, fontSize:16, lineHeight:1, color: item.is_favorite ? '#f59e0b' : '#cbd5e1', flexShrink:0 }}>
          {item.is_favorite ? '★' : '☆'}
        </button>
      )}
      {item.iata_code && (
        <span style={{ fontSize:12, fontWeight:700, color:'#1a2d4f', background:'#eff6ff', padding:'2px 8px', borderRadius:6, fontFamily:'monospace', flexShrink:0 }}>
          {item.iata_code}
        </span>
      )}
      <span style={{ flex:1, fontSize:13, color:'#1e293b', fontWeight:500 }}>{item.name}</span>
      {item.country && (
        <span style={{ fontSize:12, color:'#64748b' }}>{item.country}</span>
      )}
      {(canEdit || canDelete) && (
        <div className="r-acts">
          {canEdit   && <button className="r-btn edit" title="Editar"  onClick={() => onEdit(item)}><Ic n="edit"  s={13}/></button>}
          {canDelete && <button className="r-btn del"  title="Excluir" onClick={() => setConfirm(true)}><Ic n="trash" s={13}/></button>}
        </div>
      )}
      {confirm && canDelete && (
        <ConfirmModal
          message={`Remover "${item.name}"?`}
          onOk={() => { onDelete(item.id); setConfirm(false) }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  )
}

const PAGE_SIZE = 50

export default function AirlinesManager({ canEdit = true, canDelete = true, canImport = false, canExport = true, canImportWeb = false }) {
  const navigate = useNavigate()
  const [items,    setItems]    = useState([])
  const [count,    setCount]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [search,   setSearch]   = useState('')
  const [debounced,setDebounced]= useState('')
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [seeding,  setSeeding]  = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showPopup, setShowPopup] = useState(false)

  // Busca com debounce — evita disparar uma requisição a cada tecla digitada
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  const reload = () => {
    setLoading(true)
    configApi.airlines({ q: debounced, page, page_size: PAGE_SIZE })
      .then(r => {
        setItems(r.data.results ?? r.data)
        setCount(r.data.count ?? (r.data.results ?? r.data).length)
      })
      .catch(() => toast.error('Erro ao carregar companhias aéreas.'))
      .finally(() => setLoading(false))
  }

  useEffect(reload, [debounced, page])

  const { user } = useAuth()
  const wsUrl = user ? dashboardWsUrl() : null
  useWebSocket(wsUrl, (msg) => {
    if (msg.type === 'job' && msg.kind === 'airlines' && msg.status === 'done') reload()
  })

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))

  const handleSeed = async () => {
    if (!window.confirm('Importar todas as companhias aéreas do mundo via OpenFlights?')) return
    setSeeding(true)
    try {
      await configApi.seedAirlines()
      toast.success('Importação iniciada — acompanhe o progresso na barra lateral.')
    } catch {
      toast.error('Erro ao iniciar importação.')
    } finally { setSeeding(false) }
  }

  const create = async (data) => {
    try { await configApi.addAirline(data); toast.success('Companhia adicionada.'); reload() }
    catch { toast.error('Erro ao adicionar.') }
  }

  const update = async (data) => {
    try { await configApi.updateAirline(showForm.id, data); toast.success('Atualizado.'); reload() }
    catch { toast.error('Erro ao salvar.') }
  }

  const del = async (id) => {
    await configApi.delAirline(id).catch(() => toast.error('Erro ao remover.'))
    reload()
  }

  const toggleFavorite = (item) => {
    configApi.updateAirline(item.id, { is_favorite: !item.is_favorite })
      .then(() => setItems(its => its.map(i => i.id === item.id ? { ...i, is_favorite: !i.is_favorite } : i)))
      .catch(() => toast.error('Erro ao atualizar favorito.'))
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const r = await configApi.airlines({ page_size: 10000 })
      const all = r.data.results ?? r.data
      exportSectionCsv('airlines', 'Companhias Aéreas', all, 'companhias_aereas.csv')
    } catch {
      toast.error('Erro ao exportar.')
    } finally { setExporting(false) }
  }

  const handleFileChosen = async (file) => {
    const csvText = await file.text()
    setImporting(true)
    try {
      const resp = await configApi.airlines({ page_size: 10000 })
      const all = resp.data.results ?? resp.data
      navigate('/configuracoes/import', {
        state: {
          csvText, filename: file.name, type: 'airlines',
          existingNames: all.map(i => i.name),
          existingItems: all,
        },
      })
    } catch {
      toast.error('Erro ao preparar importação.')
    } finally { setImporting(false) }
  }

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center', flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nome, código IATA ou país…"
          style={{ ...inp, flex:1, minWidth:200 }} onFocus={onF} onBlur={onB} />
        {canEdit && (
          <button onClick={() => setShowForm(true)}
            style={{ padding:'8px 16px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            + Adicionar
          </button>
        )}
        {canImportWeb && (
          <button
            style={{ padding:'6px 11px', borderRadius:7, border:'1.5px solid #7c3aed20', background:'#7c3aed10', color:'#7c3aed', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:4 }}
            onClick={handleSeed} disabled={seeding}>
            {seeding ? '⏳ Importando…' : '🌐 Base mundial'}
          </button>
        )}
        {canExport && (
          <button style={btnCsv('#059669')} onClick={exportCsv} disabled={exporting} title="Exportar como CSV">
            {exporting ? '⏳ Exportando…' : '⬇ Exportar'}
          </button>
        )}
        {canImport && (
          <button style={btnCsv('#2e6db4')} onClick={() => setShowPopup(true)} disabled={importing} title="Importar de CSV">
            {importing ? '⏳ Importando…' : '⬆ Importar'}
          </button>
        )}
        {canImport && showPopup && (
          <CsvImportPopup
            title="Importar Companhias Aéreas"
            sampleContent={CSV_SAMPLES.airlines.content}
            sampleFilename={CSV_SAMPLES.airlines.filename}
            onClose={() => setShowPopup(false)}
            onFile={handleFileChosen}
          />
        )}
      </div>

      <p style={{ fontSize:12, color:'#94a3b8', margin:'0 0 8px' }}>
        {loading ? 'Carregando…' : `${count} companhia${count !== 1 ? 's' : ''}${debounced ? ` (busca: "${debounced}")` : ''}`}
      </p>

      <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden' }}>
        {loading ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
        ) : items.length === 0 ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>
            {count === 0 ? 'Nenhuma companhia cadastrada.' : 'Nenhum resultado.'}
          </p>
        ) : items.map(item => (
          <Row key={item.id} item={item} onEdit={setShowForm} onDelete={del} onToggleFavorite={toggleFavorite} canEdit={canEdit} canDelete={canDelete} />
        ))}
      </div>

      {totalPages > 1 && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:12, marginTop:10 }}>
          <button className="btn btn-outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ padding:'5px 12px' }}>
            ‹ Anterior
          </button>
          <span style={{ fontSize:12, color:'#64748b' }}>Página {page} de {totalPages}</span>
          <button className="btn btn-outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ padding:'5px 12px' }}>
            Próxima ›
          </button>
        </div>
      )}

      {canEdit && showForm === true && (
        <AirlineFormModal title="Nova companhia aérea" onSave={create} onClose={() => setShowForm(false)} />
      )}
      {canEdit && showForm && showForm !== true && (
        <AirlineFormModal title="Editar companhia" initial={showForm} onSave={update} onClose={() => setShowForm(false)} />
      )}
    </div>
  )
}
