import { useState, useRef, useEffect } from 'react'
import toast from 'react-hot-toast'
import { configApi } from '../api'
import ConfirmModal from './ConfirmModal'
import { Ic } from './Icon'

const inp = { padding:'7px 10px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:13, outline:'none', fontFamily:'inherit', color:'#1e293b' }
const onF  = e => e.target.style.borderColor = '#1a2d4f'
const onB  = e => e.target.style.borderColor = '#e2e8f0'
const btnCsv = (color) => ({
  padding: '6px 11px', borderRadius: 7, border: `1.5px solid ${color}20`,
  background: `${color}10`, color, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
})

function AirportFormModal({ title, initial, onSave, onClose }) {
  const [name,     setName]     = useState(initial?.name ?? '')
  const [iata,     setIata]     = useState(initial?.iata_code ?? '')
  const [city,     setCity]     = useState(initial?.city ?? '')
  const [country,  setCountry]  = useState(initial?.country ?? '')
  const [saving,   setSaving]   = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  const handleSave = async () => {
    const v = name.trim(); if (!v) return
    setSaving(true)
    try {
      await onSave({ name: v, iata_code: iata.trim().toUpperCase(), city: city.trim(), country: country.trim() })
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="mbox" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">{title}</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="mbody">
          <div className="ff">
            <label className="fl">Nome do aeroporto *</label>
            <input ref={inputRef} className="fi" value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="Ex: Aeroporto Internacional de Guarulhos" />
          </div>
          <div style={{ display:'flex', gap:12 }}>
            <div className="ff" style={{ flex:'0 0 120px', marginBottom:0 }}>
              <label className="fl">Código IATA</label>
              <input className="fi" value={iata} onChange={e => setIata(e.target.value.toUpperCase())}
                maxLength={10} placeholder="Ex: GRU" style={{ textTransform:'uppercase' }} />
            </div>
            <div className="ff" style={{ flex:1, marginBottom:0 }}>
              <label className="fl">Cidade</label>
              <input className="fi" value={city} onChange={e => setCity(e.target.value)}
                placeholder="Ex: São Paulo" />
            </div>
          </div>
          <div className="ff">
            <label className="fl">País</label>
            <input className="fi" value={country} onChange={e => setCountry(e.target.value)}
              placeholder="Ex: Brasil" />
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
      {(item.city || item.country) && (
        <span style={{ fontSize:12, color:'#64748b' }}>
          {[item.city, item.country].filter(Boolean).join(', ')}
        </span>
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

export default function AirportsManager({ items, loading, onRefresh }) {
  const [search,   setSearch]   = useState('')
  const [showForm, setShowForm] = useState(false)
  const fileRef = useRef(null)

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.iata_code || '').toLowerCase().includes(search.toLowerCase()) ||
    (i.city || '').toLowerCase().includes(search.toLowerCase())
  )

  const create = async (data) => {
    try {
      await configApi.addAirport(data)
      toast.success('Aeroporto adicionado.')
      onRefresh()
    } catch { toast.error('Erro ao adicionar.') }
  }

  const update = async (data) => {
    try {
      await configApi.updateAirport(showForm.id, data)
      toast.success('Atualizado.')
      onRefresh()
    } catch { toast.error('Erro ao salvar.') }
  }

  const del = async (id) => {
    await configApi.delAirport(id).catch(() => toast.error('Erro ao remover.'))
    onRefresh()
  }

  const exportCsv = () => {
    const rows = ['nome,iata,cidade,pais', ...items.map(i =>
      [`"${(i.name || '').replace(/"/g, '""')}"`,
       `"${(i.iata_code || '').replace(/"/g, '""')}"`,
       `"${(i.city || '').replace(/"/g, '""')}"`,
       `"${(i.country || '').replace(/"/g, '""')}"`].join(',')
    )]
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'aeroportos.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const text  = await file.text()
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
    if (!lines.length) return
    const splitLine = (line) => {
      const out = []; let cur = '', inQ = false
      for (let i = 0; i < line.length; i++) {
        const c = line[i]
        if (inQ) { if (c==='"') { if (line[i+1]==='"') { cur+='"'; i++ } else inQ=false } else cur+=c }
        else { if (c==='"') inQ=true; else if (c===',') { out.push(cur); cur='' } else cur+=c }
      }
      out.push(cur); return out.map(s => s.trim())
    }
    const head = splitLine(lines[0]).map(s => s.toLowerCase())
    const hasHeader = head.includes('nome') || head.includes('iata')
    const start = hasHeader ? 1 : 0
    const ni = hasHeader ? (head.indexOf('nome') >= 0 ? head.indexOf('nome') : 0) : 0
    const ii = hasHeader ? (head.indexOf('iata') >= 0 ? head.indexOf('iata') : 1) : 1
    const ci = hasHeader ? (head.indexOf('cidade') >= 0 ? head.indexOf('cidade') : 2) : 2
    const pi = hasHeader ? (head.indexOf('pais') >= 0 ? head.indexOf('pais') : 3) : 3
    const parsed = lines.slice(start).map(l => {
      const cols = splitLine(l)
      return { name: cols[ni]||'', iata_code: (cols[ii]||'').toUpperCase(), city: cols[ci]||'', country: cols[pi]||'' }
    }).filter(r => r.name)
    const existing = new Set(items.map(i => i.name.toLowerCase()))
    const toAdd    = parsed.filter(r => !existing.has(r.name.toLowerCase()))
    if (!toAdd.length) { toast.success('Nenhum aeroporto novo encontrado — tudo já estava cadastrado.'); return }
    let added = 0, skipped = 0
    for (const row of toAdd) {
      try { await configApi.addAirport(row); added++ } catch { skipped++ }
    }
    toast.success(`${added} adicionado${added !== 1 ? 's' : ''}${skipped ? `, ${skipped} com erro` : ''}.`)
    onRefresh()
  }

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center', flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome, código IATA ou cidade…"
          style={{ ...inp, flex:1, minWidth:200 }} onFocus={onF} onBlur={onB} />
        <button onClick={() => setShowForm(true)}
          style={{ padding:'8px 16px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
          + Adicionar
        </button>
        <button style={btnCsv('#059669')} onClick={exportCsv} title="Exportar como CSV">⬇ Exportar</button>
        <button style={btnCsv('#2e6db4')} onClick={() => fileRef.current?.click()} title="Importar de CSV">⬆ Importar</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display:'none' }} onChange={handleFileChosen} />
      </div>

      <p style={{ fontSize:12, color:'#94a3b8', margin:'0 0 8px' }}>
        {loading ? 'Carregando…' : `${filtered.length} de ${items.length} aeroporto${items.length !== 1 ? 's' : ''}`}
      </p>

      <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden' }}>
        {loading ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
        ) : filtered.length === 0 ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>
            {items.length === 0 ? 'Nenhum aeroporto cadastrado.' : 'Nenhum resultado.'}
          </p>
        ) : filtered.map(item => (
          <Row key={item.id} item={item} onEdit={setShowForm} onDelete={del} />
        ))}
      </div>

      {showForm === true && (
        <AirportFormModal title="Novo aeroporto" onSave={create} onClose={() => setShowForm(false)} />
      )}
      {showForm && showForm !== true && (
        <AirportFormModal title="Editar aeroporto" initial={showForm} onSave={update} onClose={() => setShowForm(false)} />
      )}
    </div>
  )
}
