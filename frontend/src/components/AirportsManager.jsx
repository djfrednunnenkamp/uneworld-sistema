import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
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

/* ── Input com autocomplete — dropdown via portal para não ser cortado pelo modal ── */
function SuggestInput({ value, onChange, fetchSuggestions, placeholder, disabled }) {
  const [open,    setOpen]    = useState(false)
  const [options, setOptions] = useState([])
  const [query,   setQuery]   = useState(value)
  const [dropStyle, setDropStyle] = useState({})
  const inputRef = useRef(null)

  // Sincroniza query quando value muda externamente (ex: limpar ao trocar país)
  useEffect(() => { setQuery(value) }, [value]) // eslint-disable-line react-hooks/set-state-in-effect

  // Fecha ao clicar fora
  useEffect(() => {
    const h = e => {
      if (inputRef.current && !inputRef.current.contains(e.target) &&
          !e.target.closest('[data-suggest-dropdown]')) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Calcula posição fixed quando abre
  const openDropdown = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect()
      setDropStyle({ top: r.bottom + 2, left: r.left, width: r.width })
    }
    setOpen(true)
  }

  // Busca com debounce
  useEffect(() => {
    if (!open) return
    const t = setTimeout(async () => {
      try {
        const r = await fetchSuggestions(query)
        setOptions(r.data ?? [])
      } catch { setOptions([]) }
    }, 180)
    return () => clearTimeout(t)
  }, [query, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const select = (opt) => { setQuery(opt); onChange(opt); setOpen(false) }

  return (
    <>
      <input
        ref={inputRef}
        className="fi"
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); if (!open) openDropdown() }}
        onFocus={openDropdown}
        style={disabled ? { background:'#f8fafc', color:'#94a3b8', cursor:'not-allowed' } : {}}
      />
      {open && options.length > 0 && createPortal(
        <div data-suggest-dropdown
          style={{ position:'fixed', ...dropStyle, background:'#fff', border:'1.5px solid #e2e8f0', borderRadius:8, maxHeight:220, overflowY:'auto', zIndex:9999, boxShadow:'0 8px 24px rgba(0,0,0,.14)' }}>
          {options.map((opt, i) => (
            <div key={i}
              onMouseDown={e => { e.preventDefault(); select(opt) }}
              style={{ padding:'9px 12px', cursor:'pointer', fontSize:13, color:'#1e293b', borderBottom: i < options.length-1 ? '1px solid #f1f5f9' : 'none' }}
              onMouseEnter={e => e.currentTarget.style.background='#f0f7ff'}
              onMouseLeave={e => e.currentTarget.style.background='#fff'}>
              {opt}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

function AirportFormModal({ title, initial, onSave, onClose }) {
  const [name,    setName]    = useState(initial?.name ?? '')
  const [iata,    setIata]    = useState(initial?.iata_code ?? '')
  const [country, setCountry] = useState(initial?.country ?? '')
  const [city,    setCity]    = useState(initial?.city ?? '')
  const [saving,  setSaving]  = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  const handleCountryChange = (v) => {
    setCountry(v)
    // Limpa cidade ao trocar país
    if (v !== country) setCity('')
  }

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
          <div className="ff" style={{ flex:'0 0 120px' }}>
            <label className="fl">Código IATA</label>
            <input className="fi" value={iata} onChange={e => setIata(e.target.value.toUpperCase())}
              maxLength={10} placeholder="Ex: GRU" style={{ textTransform:'uppercase' }} />
          </div>
          <div className="ff">
            <label className="fl">País</label>
            <SuggestInput
              value={country}
              onChange={handleCountryChange}
              fetchSuggestions={q => configApi.airportCountrySuggest(q)}
              placeholder="Ex: Brasil"
            />
          </div>
          <div className="ff">
            <label className="fl">Cidade</label>
            <SuggestInput
              value={city}
              onChange={setCity}
              fetchSuggestions={q => configApi.airportCitySuggest(country, q)}
              placeholder={country ? 'Ex: São Paulo' : 'Selecione o país primeiro…'}
              disabled={!country.trim()}
            />
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

const PAGE_SIZE = 50

export default function AirportsManager() {
  const [items,    setItems]    = useState([])
  const [count,    setCount]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [search,   setSearch]   = useState('')
  const [debounced,setDebounced]= useState('')
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [seeding,  setSeeding]  = useState(false)
  const [exporting,setExporting]= useState(false)
  const [importing,setImporting]= useState(false)
  const fileRef = useRef(null)

  // Busca com debounce — evita disparar uma requisição a cada tecla digitada
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  const reload = () => {
    setLoading(true)
    configApi.airports({ q: debounced, page, page_size: PAGE_SIZE })
      .then(r => {
        setItems(r.data.results ?? r.data)
        setCount(r.data.count ?? (r.data.results ?? r.data).length)
      })
      .catch(() => toast.error('Erro ao carregar aeroportos.'))
      .finally(() => setLoading(false))
  }

  useEffect(reload, [debounced, page])

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))

  const handleSeed = async () => {
    if (!window.confirm('Importar todos os aeroportos do mundo inteiro via OurAirports? Isso pode levar alguns segundos.')) return
    setSeeding(true)
    try {
      await configApi.seedAirports()
      toast.success('Importação iniciada! Aguarde alguns segundos e recarregue a lista.', { duration: 5000 })
      setTimeout(reload, 4000)
    } catch {
      toast.error('Erro ao iniciar importação.')
    } finally {
      setSeeding(false)
    }
  }

  const create = async (data) => {
    try {
      await configApi.addAirport(data)
      toast.success('Aeroporto adicionado.')
      reload()
    } catch { toast.error('Erro ao adicionar.') }
  }

  const update = async (data) => {
    try {
      await configApi.updateAirport(showForm.id, data)
      toast.success('Atualizado.')
      reload()
    } catch { toast.error('Erro ao salvar.') }
  }

  const del = async (id) => {
    await configApi.delAirport(id).catch(() => toast.error('Erro ao remover.'))
    reload()
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const r = await configApi.airports({ page_size: 10000 })
      const all = r.data.results ?? r.data
      const rows = ['nome,iata,cidade,pais', ...all.map(i =>
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
    } catch {
      toast.error('Erro ao exportar.')
    } finally {
      setExporting(false)
    }
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

    setImporting(true)
    try {
      const resp = await configApi.airports({ page_size: 10000 })
      const all = resp.data.results ?? resp.data
      const existing = new Set(all.map(i => i.name.toLowerCase()))
      const toAdd    = parsed.filter(p => !existing.has(p.name.toLowerCase()))
      if (!toAdd.length) { toast.success('Nenhum aeroporto novo encontrado — tudo já estava cadastrado.'); return }
      let added = 0, skipped = 0
      for (const row of toAdd) {
        try { await configApi.addAirport(row); added++ } catch { skipped++ }
      }
      toast.success(`${added} adicionado${added !== 1 ? 's' : ''}${skipped ? `, ${skipped} com erro` : ''}.`)
      reload()
    } catch {
      toast.error('Erro ao importar.')
    } finally {
      setImporting(false)
    }
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
        <button style={btnCsv('#059669')} onClick={exportCsv} disabled={exporting} title="Exportar como CSV">
          {exporting ? '⏳ Exportando…' : '⬇ Exportar'}
        </button>
        <button style={btnCsv('#2e6db4')} onClick={() => fileRef.current?.click()} disabled={importing} title="Importar de CSV">
          {importing ? '⏳ Importando…' : '⬆ Importar'}
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display:'none' }} onChange={handleFileChosen} />
        <button style={btnCsv('#7c3aed')} onClick={handleSeed} disabled={seeding} title="Importar todos os aeroportos do mundo via OurAirports">
          {seeding ? '⏳ Importando…' : '🌐 Base mundial'}
        </button>
      </div>

      <p style={{ fontSize:12, color:'#94a3b8', margin:'0 0 8px' }}>
        {loading ? 'Carregando…' : `${count} aeroporto${count !== 1 ? 's' : ''}${debounced ? ` (busca: "${debounced}")` : ''}`}
      </p>

      <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden' }}>
        {loading ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
        ) : items.length === 0 ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>
            {count === 0 ? 'Nenhum aeroporto cadastrado.' : 'Nenhum resultado.'}
          </p>
        ) : items.map(item => (
          <Row key={item.id} item={item} onEdit={setShowForm} onDelete={del} />
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

      {showForm === true && (
        <AirportFormModal title="Novo aeroporto" onSave={create} onClose={() => setShowForm(false)} />
      )}
      {showForm && showForm !== true && (
        <AirportFormModal title="Editar aeroporto" initial={showForm} onSave={update} onClose={() => setShowForm(false)} />
      )}
    </div>
  )
}
