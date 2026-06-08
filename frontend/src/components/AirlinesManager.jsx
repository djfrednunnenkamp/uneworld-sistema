import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { configApi } from '../api'
import ConfirmModal from './ConfirmModal'
import { Ic } from './Icon'

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

function AirlineFormModal({ title, initial, onSave, onClose }) {
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

function Row({ item, onEdit, onDelete }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom:'1px solid #f1f5f9', background:'#fff' }}
      onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
      onMouseLeave={e => e.currentTarget.style.background='#fff'}>
      {item.iata_code && (
        <span style={{ fontSize:12, fontWeight:700, color:'#1a2d4f', background:'#eff6ff', padding:'2px 8px', borderRadius:6, fontFamily:'monospace', flexShrink:0 }}>
          {item.iata_code}
        </span>
      )}
      <span style={{ flex:1, fontSize:13, color:'#1e293b', fontWeight:500 }}>{item.name}</span>
      {item.country && (
        <span style={{ fontSize:12, color:'#64748b' }}>{item.country}</span>
      )}
      <div className="r-acts">
        <button className="r-btn edit" title="Editar"  onClick={() => onEdit(item)}><Ic n="edit"  s={13}/></button>
        <button className="r-btn del"  title="Excluir" onClick={() => setConfirm(true)}><Ic n="trash" s={13}/></button>
      </div>
      {confirm && (
        <ConfirmModal
          message={`Remover "${item.name}"?`}
          onOk={() => { onDelete(item.id); setConfirm(false) }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  )
}

export default function AirlinesManager({ items, loading, onRefresh }) {
  const [search,   setSearch]   = useState('')
  const [showForm, setShowForm] = useState(false)
  const [seeding,  setSeeding]  = useState(false)

  const handleSeed = async () => {
    if (!window.confirm('Importar todas as companhias aéreas do mundo via OpenFlights?')) return
    setSeeding(true)
    try {
      await configApi.seedAirlines()
      toast.success('Importação iniciada! Recarregando em alguns segundos…', { duration: 5000 })
      setTimeout(() => onRefresh(), 4000)
    } catch {
      toast.error('Erro ao iniciar importação.')
    } finally { setSeeding(false) }
  }

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.iata_code || '').toLowerCase().includes(search.toLowerCase()) ||
    (i.country || '').toLowerCase().includes(search.toLowerCase())
  )

  const create = async (data) => {
    try { await configApi.addAirline(data); toast.success('Companhia adicionada.'); onRefresh() }
    catch { toast.error('Erro ao adicionar.') }
  }

  const update = async (data) => {
    try { await configApi.updateAirline(showForm.id, data); toast.success('Atualizado.'); onRefresh() }
    catch { toast.error('Erro ao salvar.') }
  }

  const del = async (id) => {
    await configApi.delAirline(id).catch(() => toast.error('Erro ao remover.'))
    onRefresh()
  }

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center', flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nome, código IATA ou país…"
          style={{ ...inp, flex:1, minWidth:200 }} onFocus={onF} onBlur={onB} />
        <button onClick={() => setShowForm(true)}
          style={{ padding:'8px 16px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
          + Adicionar
        </button>
        <button
          style={{ padding:'6px 11px', borderRadius:7, border:'1.5px solid #7c3aed20', background:'#7c3aed10', color:'#7c3aed', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:4 }}
          onClick={handleSeed} disabled={seeding}>
          {seeding ? '⏳ Importando…' : '🌐 Base mundial'}
        </button>
      </div>

      <p style={{ fontSize:12, color:'#94a3b8', margin:'0 0 8px' }}>
        {loading ? 'Carregando…' : `${filtered.length} de ${items.length} companhia${items.length !== 1 ? 's' : ''}`}
      </p>

      <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden' }}>
        {loading ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
        ) : filtered.length === 0 ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>
            {items.length === 0 ? 'Nenhuma companhia cadastrada.' : 'Nenhum resultado.'}
          </p>
        ) : filtered.map(item => (
          <Row key={item.id} item={item} onEdit={setShowForm} onDelete={del} />
        ))}
      </div>

      {showForm === true && (
        <AirlineFormModal title="Nova companhia aérea" onSave={create} onClose={() => setShowForm(false)} />
      )}
      {showForm && showForm !== true && (
        <AirlineFormModal title="Editar companhia" initial={showForm} onSave={update} onClose={() => setShowForm(false)} />
      )}
    </div>
  )
}
