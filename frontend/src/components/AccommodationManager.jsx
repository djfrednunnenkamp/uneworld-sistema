import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
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

/* ── Pop-up de criação/edição — mesmo padrão dos demais modais do sistema ── */
function AccomFormModal({ title, initial, onSave, onClose }) {
  const [name,     setName]     = useState(initial?.name ?? '')
  const [capacity, setCapacity] = useState(initial?.capacity ?? 1)
  const [couple,   setCouple]   = useState(initial?.is_couple ?? false)
  const [saving,   setSaving]   = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  const handleSave = async () => {
    const v = name.trim(); if (!v) return
    setSaving(true)
    try { await onSave({ name: v, capacity: Number(capacity) || 1, is_couple: couple }); onClose() }
    finally { setSaving(false) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="mbox" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">{title}</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="mbody">
          <div className="ff">
            <label className="fl">Nome da acomodação</label>
            <input ref={inputRef} className="fi" value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="Ex: Duplo, Single, Suíte…" />
          </div>
          <div style={{ display:'flex', gap:16, alignItems:'flex-end' }}>
            <div className="ff" style={{ flex:1, marginBottom:0 }}>
              <label className="fl">Capacidade (pessoas)</label>
              <input type="number" min="1" max="20" className="fi" value={capacity}
                onChange={e => setCapacity(e.target.value)} />
            </div>
            <label style={{ display:'flex', alignItems:'center', gap:7, cursor:'pointer', userSelect:'none', fontSize:13, color:'#475569', paddingBottom:8 }}>
              <input type="checkbox" checked={couple} onChange={e => setCouple(e.target.checked)}
                style={{ width:15, height:15, accentColor:'#1a2d4f', cursor:'pointer' }} />
              É casal
            </label>
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

/* ── CSV helpers ── */
function exportAccomCsv(items, filename = 'tipos_acomodacao.csv') {
  const rows = ['nome,pessoas,casal', ...items.map(i =>
    `"${i.name.replace(/"/g, '""')}",${i.capacity},${i.is_couple ? 'sim' : 'não'}`
  )]
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

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

function parseAccomCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  if (!lines.length) return []
  const head = splitCsvLine(lines[0]).map(s => s.toLowerCase())
  const hasHeader = head.includes('nome')
  const start    = hasHeader ? 1 : 0
  const nameIdx  = hasHeader ? head.indexOf('nome')   : 0
  const capIdx   = hasHeader ? head.indexOf('pessoas') : 1
  const coupleIdx= hasHeader ? head.indexOf('casal')   : 2
  return lines.slice(start).map(line => {
    const cols = splitCsvLine(line)
    const name     = (cols[nameIdx] || '').trim()
    const capacity = Number(cols[capIdx]) || 1
    const coupleV  = (cols[coupleIdx] || '').trim().toLowerCase()
    const is_couple = ['sim', 'true', '1', 'yes'].includes(coupleV)
    return { name, capacity, is_couple }
  }).filter(r => r.name)
}

/* ── Linha da listagem ── */
function Row({ item, onEdit, onDelete }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderBottom:'1px solid #f1f5f9', background:'#fff' }}
      onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
      onMouseLeave={e => e.currentTarget.style.background='#fff'}>
      <span style={{ flex:1, fontSize:13, color:'#1e293b', fontWeight:500 }}>{item.name}</span>
      <span style={{ fontSize:12, color:'#64748b', background:'#f1f5f9', padding:'2px 8px', borderRadius:20 }}>
        {item.capacity} pessoa{item.capacity !== 1 ? 's' : ''}
      </span>
      {item.is_couple && (
        <span style={{ fontSize:11, color:'#7c3aed', background:'#ede9fe', padding:'2px 8px', borderRadius:20, fontWeight:600 }}>
          Casal
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

export default function AccommodationManager({ items, loading, onRefresh }) {
  const [search,   setSearch]   = useState('')
  const [showForm, setShowForm] = useState(false) // false | true (novo) | item (edição)
  const fileRef = useRef(null)

  const filtered = items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))

  const create = async (data) => {
    try {
      await configApi.addAccommodation(data)
      toast.success('Acomodação adicionada.')
      onRefresh()
    } catch { toast.error('Erro ao adicionar.') }
  }

  const update = async (data) => {
    try {
      await configApi.updateAccommodation(showForm.id, data)
      toast.success('Atualizado.')
      onRefresh()
    } catch { toast.error('Erro ao salvar.') }
  }

  const del = async (id) => {
    await configApi.delAccommodation(id).catch(() => toast.error('Erro ao remover.'))
    onRefresh()
  }

  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const csvText = await file.text()
    const parsed  = parseAccomCsv(csvText)
    const existing = new Set(items.map(i => i.name.toLowerCase()))
    const toAdd   = parsed.filter(r => !existing.has(r.name.toLowerCase()))
    if (!toAdd.length) { toast.success('Nenhum item novo encontrado no arquivo — tudo já estava cadastrado.'); return }
    let added = 0, skipped = 0
    for (const row of toAdd) {
      try { await configApi.addAccommodation(row); added++ } catch { skipped++ }
    }
    toast.success(`${added} adicionado${added !== 1 ? 's' : ''}${skipped ? `, ${skipped} com erro` : ''}.`)
    onRefresh()
  }

  return (
    <div>
      {/* Toolbar: busca + adicionar + CSV */}
      <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center', flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
          style={{ ...inp, flex:1, minWidth:160 }} onFocus={onF} onBlur={onB} />
        <button onClick={() => setShowForm(true)}
          style={{ padding:'8px 16px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
          + Adicionar
        </button>
        <button style={btnCsv('#059669')} onClick={() => exportAccomCsv(items)} title="Exportar como CSV">
          ⬇ Exportar
        </button>
        <button style={btnCsv('#2e6db4')} onClick={() => fileRef.current?.click()} title="Importar de CSV">
          ⬆ Importar
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display:'none' }} onChange={handleFileChosen} />
      </div>

      <p style={{ fontSize:12, color:'#94a3b8', margin:'0 0 8px' }}>
        {loading ? 'Carregando…' : `${filtered.length} de ${items.length} tipo${items.length !== 1 ? 's' : ''}`}
      </p>

      <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden' }}>
        {loading ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
        ) : filtered.length === 0 ? (
          <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>
            {items.length === 0 ? 'Nenhuma acomodação.' : 'Nenhum resultado.'}
          </p>
        ) : filtered.map(item => (
          <Row key={item.id} item={item} onEdit={setShowForm} onDelete={del} />
        ))}
      </div>

      {showForm === true && (
        <AccomFormModal title="Nova acomodação" onSave={create} onClose={() => setShowForm(false)} />
      )}
      {showForm && showForm !== true && (
        <AccomFormModal title="Editar acomodação" initial={showForm} onSave={update} onClose={() => setShowForm(false)} />
      )}
    </div>
  )
}
