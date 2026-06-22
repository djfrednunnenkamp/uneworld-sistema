import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { configApi } from '../api'
import ConfirmModal from './ConfirmModal'
import { Ic } from './Icon'
import { BusLayoutPreview, MapPreviewTooltip } from './BusLayoutPreview'
import CsvImportPopup from './CsvImportPopup'
import { CSV_SAMPLES } from '../utils/csvSamples'
import { exportSectionCsv } from '../utils/sectionCsv'

const btnCsv = (color) => ({
  padding: '6px 11px', borderRadius: 7, border: `1.5px solid ${color}20`,
  background: `${color}10`, color, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
})

const MAX_SEATS_PER_SIDE = 4

/* ── Stepper numérico para quantidade de assentos por lado ── */
function SeatStepper({ value, onChange }) {
  const btn = (disabled) => ({
    width:24, height:24, borderRadius:6, border:'1.5px solid #e2e8f0', background:'#fff',
    color: disabled ? '#cbd5e1' : '#475569', cursor: disabled ? 'default' : 'pointer',
    fontSize:14, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit',
  })
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0} style={btn(value <= 0)}>−</button>
      <span style={{ width:18, textAlign:'center', fontSize:14, fontWeight:700, color:'#0f172a' }}>{value}</span>
      <button type="button" onClick={() => onChange(Math.min(MAX_SEATS_PER_SIDE, value + 1))} disabled={value >= MAX_SEATS_PER_SIDE} style={btn(value >= MAX_SEATS_PER_SIDE)}>+</button>
    </div>
  )
}

/* ── Linha do editor de fileiras ── */
function RowEditor({ row, index, total, onUpdate, onRemove, onMoveUp, onMoveDown }) {
  const seats = row.left_seats + row.right_seats
  const moveBtn = (disabled) => ({
    background:'none', border:'none', cursor: disabled ? 'default' : 'pointer',
    color: disabled ? '#e2e8f0' : '#94a3b8', fontSize:10, lineHeight:1, padding:'1px 2px', fontFamily:'inherit',
  })
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'9px 12px', border:'1px solid #e2e8f0', borderRadius:8, marginBottom:6, background:'#fff', flexWrap:'wrap' }}>
      <div style={{ display:'flex', flexDirection:'column', gap:1, flexShrink:0 }}>
        <button onClick={onMoveUp} disabled={index === 0} style={moveBtn(index === 0)} title="Mover para cima">▲</button>
        <button onClick={onMoveDown} disabled={index === total - 1} style={moveBtn(index === total - 1)} title="Mover para baixo">▼</button>
      </div>
      <span style={{ fontSize:11, color:'#94a3b8', width:46, flexShrink:0, fontWeight:600 }}>{index + 1}ª fila</span>

      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:12, color:'#64748b' }}>Esquerda</span>
        <SeatStepper value={row.left_seats} onChange={v => onUpdate({ left_seats:v })} />
      </div>

      <span style={{ color:'#cbd5e1', fontSize:18, lineHeight:1 }}>│</span>

      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:12, color:'#64748b' }}>Direita</span>
        <SeatStepper value={row.right_seats} onChange={v => onUpdate({ right_seats:v })} />
      </div>

      <span style={{ marginLeft:'auto', fontSize:12, color:'#94a3b8', whiteSpace:'nowrap' }}>
        {seats} assento{seats !== 1 ? 's' : ''}
      </span>

      <button onClick={onRemove}
        style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:6, cursor:'pointer', color:'#dc2626', fontSize:13, padding:'5px 8px', fontFamily:'inherit', flexShrink:0 }}>✕</button>
    </div>
  )
}

/* Maior número (numérico) já usado entre as numerações de assento de todas as fileiras. */
function maxLabelNum(rows) {
  let max = 0
  rows.forEach(r => {
    [...(r.left_labels ?? []), ...(r.right_labels ?? [])].forEach(l => {
      const n = parseInt(l, 10)
      if (!isNaN(n) && n > max) max = n
    })
  })
  return max
}

/* Ajusta o tamanho do array de numeração para acompanhar o nº de assentos do lado,
   completando novos assentos com a próxima numeração sugerida (editável depois). */
function resizeLabels(labels, count, counter) {
  const arr = [...(labels ?? [])]
  while (arr.length < count) { counter.value += 1; arr.push(String(counter.value)) }
  while (arr.length > count) arr.pop()
  return arr
}

/* ── Modal de criação / edição de um mapa ── */
export function BusMapModal({ busMap, onSave, onClose }) {
  const isEdit = !!busMap
  const [name,       setName]       = useState(busMap?.label ?? '')
  const [deckCount,  setDeckCount]  = useState(busMap?.deck_count ?? 1)
  const [activeDeck, setActiveDeck] = useState(1)
  const [rowsByDeck, setRowsByDeck] = useState(() => {
    const grouped = { 1: [], 2: [] }
    ;(busMap?.rows ?? []).forEach(r => {
      const deck = r.deck === 2 ? 2 : 1
      grouped[deck].push({
        left_seats: r.left_seats, right_seats: r.right_seats,
        left_labels: r.left_labels ?? [], right_labels: r.right_labels ?? [],
      })
    })
    return grouped
  })
  const [saving,    setSaving]    = useState(false)
  const [nameError, setNameError] = useState(false)

  const currentDeck = deckCount === 2 ? activeDeck : 1
  const rows = rowsByDeck[currentDeck]
  const setRows = updater => setRowsByDeck(prev => ({
    ...prev,
    [currentDeck]: typeof updater === 'function' ? updater(prev[currentDeck]) : updater,
  }))

  const addRow = () => setRowsByDeck(prev => {
    const list = prev[currentDeck]
    const last = list[list.length - 1]
    const left_seats  = last?.left_seats  ?? 2
    const right_seats = last?.right_seats ?? 2
    const counter = { value: maxLabelNum([...prev[1], ...prev[2]]) }
    return {
      ...prev,
      [currentDeck]: [...list, {
        left_seats, right_seats,
        left_labels:  resizeLabels([], left_seats, counter),
        right_labels: resizeLabels([], right_seats, counter),
      }],
    }
  })
  const updateRow = (idx, patch) => setRowsByDeck(prev => {
    const counter = { value: maxLabelNum([...prev[1], ...prev[2]]) }
    return {
      ...prev,
      [currentDeck]: prev[currentDeck].map((r, i) => {
        if (i !== idx) return r
        const next = { ...r, ...patch }
        if ('left_seats'  in patch) next.left_labels  = resizeLabels(r.left_labels,  patch.left_seats,  counter)
        if ('right_seats' in patch) next.right_labels = resizeLabels(r.right_labels, patch.right_seats, counter)
        return next
      }),
    }
  })
  const updateLabel = (rowIdx, side, seatIdx, value) => {
    setRowsByDeck(prev => {
      const result = { 1: prev[1] ?? [], 2: prev[2] ?? [] }
      // If setting a non-empty value, clear it from every other seat across all decks first
      if (value) {
        for (const dk of [1, 2]) {
          result[dk] = result[dk].map((r, i) => {
            const isEditedRow = dk === currentDeck && i === rowIdx
            const dedupLabels = (labels, labelSide) =>
              labels.map((l, j) =>
                isEditedRow && labelSide === side && j === seatIdx
                  ? l  // skip the seat being edited
                  : l === value ? '' : l
              )
            return {
              ...r,
              left_labels:  dedupLabels(r.left_labels ?? [], 'left'),
              right_labels: dedupLabels(r.right_labels ?? [], 'right'),
            }
          })
        }
      }
      // Set the new value for the edited seat
      result[currentDeck] = result[currentDeck].map((r, i) => {
        if (i !== rowIdx) return r
        const key = side === 'left' ? 'left_labels' : 'right_labels'
        const arr = [...(r[key] ?? [])]
        arr[seatIdx] = value
        return { ...r, [key]: arr }
      })
      return result
    })
  }
  const removeRow = (idx) => setRows(prev => prev.filter((_, i) => i !== idx))
  const moveRow = (from, to) => {
    if (to < 0 || to >= rows.length) return
    setRows(prev => {
      const arr = [...prev]
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item)
      return arr
    })
  }

  const totalSeats = rows.reduce((s, r) => s + r.left_seats + r.right_seats, 0)

  const handleSave = async () => {
    if (!name.trim()) { setNameError(true); return }
    setSaving(true)
    try {
      const allRows = [
        ...rowsByDeck[1].map((r, i) => ({ ...r, deck: 1, order: i })),
        ...(deckCount === 2 ? rowsByDeck[2].map((r, i) => ({ ...r, deck: 2, order: i })) : []),
      ]
      await onSave({ label: name.trim(), deck_count: deckCount, rows: allRows })
      onClose()
    } catch { toast.error('Erro ao salvar.') }
    finally { setSaving(false) }
  }

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.5)', backdropFilter:'blur(3px)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:600, padding:20,
    }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background:'#fff', borderRadius:14, width:'100%', maxWidth:840,
        maxHeight:'90vh', display:'flex', flexDirection:'column',
        boxShadow:'0 32px 80px rgba(0,0,0,.25)',
      }}>

        {/* Header */}
        <div style={{ padding:'18px 24px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <h2 style={{ fontSize:16, fontWeight:700, color:'#0f172a', margin:0 }}>
            {isEdit ? `Editar: ${busMap.label}` : 'Novo mapa de ônibus'}
          </h2>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:2 }}>×</button>
        </div>

        {/* Corpo scrollável */}
        <div style={{ flex:1, minHeight:0, overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:18 }}>

          {/* Nome */}
          <div>
            <label style={{ display:'block', fontSize:11, color: nameError ? '#dc2626' : '#94a3b8', marginBottom:4 }}>Nome do mapa *</label>
            <input value={name} onChange={e => { setName(e.target.value); if (nameError && e.target.value.trim()) setNameError(false) }}
              placeholder="ex: Executivo 1+2, Convencional 2+2…"
              style={{ width:'100%', maxWidth:420, padding:'9px 12px', border:`1.5px solid ${nameError ? '#dc2626' : '#e2e8f0'}`, borderRadius:8, fontSize:14, outline:'none', fontFamily:'inherit', boxSizing:'border-box', background: nameError ? '#fef2f2' : '#fff' }}
              onFocus={e => e.target.style.borderColor = nameError ? '#dc2626' : '#1a2d4f'}
              onBlur={e  => e.target.style.borderColor = nameError ? '#dc2626' : '#e2e8f0'} />
            {nameError && <p style={{ fontSize:11, color:'#dc2626', margin:'3px 0 0', fontWeight:500 }}>Informe o nome do mapa</p>}
          </div>

          {/* Andares do ônibus */}
          <div style={{ display:'flex', gap:24, flexWrap:'wrap' }}>
            <div>
              <label style={{ display:'block', fontSize:11, color:'#94a3b8', marginBottom:4 }}>Andares do ônibus</label>
              <div style={{ display:'inline-flex', border:'1.5px solid #e2e8f0', borderRadius:8, overflow:'hidden' }}>
                {[[1, 'Andar único'], [2, 'Dois andares']].map(([val, lbl]) => (
                  <button key={val} type="button" onClick={() => setDeckCount(val)}
                    style={{ padding:'8px 14px', border:'none', background: deckCount === val ? '#1a2d4f' : '#fff', color: deckCount === val ? '#fff' : '#475569', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {deckCount === 2 && (
              <div>
                <label style={{ display:'block', fontSize:11, color:'#94a3b8', marginBottom:4 }}>Editando o andar</label>
                <div style={{ display:'inline-flex', border:'1.5px solid #e2e8f0', borderRadius:8, overflow:'hidden' }}>
                  {[[1, '1º andar'], [2, '2º andar']].map(([val, lbl]) => (
                    <button key={val} type="button" onClick={() => setActiveDeck(val)}
                      style={{ padding:'8px 14px', border:'none', background: activeDeck === val ? '#1a2d4f' : '#fff', color: activeDeck === val ? '#fff' : '#475569', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                      {lbl}{rowsByDeck[val].length > 0 ? ` (${rowsByDeck[val].length})` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {deckCount === 2 && (
            <p style={{ fontSize:11.5, color:'#94a3b8', margin:'-10px 0 0' }}>
              Ônibus de dois andares têm um mapa de assentos para cada andar — use o seletor acima para configurar as fileiras e a numeração de cada um separadamente.
            </p>
          )}

          {/* Fileiras + pré-visualização */}
          <div style={{ display:'flex', gap:24, alignItems:'flex-start', flexWrap:'wrap' }}>
            {/* Editor de fileiras */}
            <div style={{ flex:'1 1 380px', minWidth:320 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10, gap:10, flexWrap:'wrap' }}>
                <p style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', margin:0 }}>
                  Fileiras{deckCount === 2 ? ` do ${activeDeck}º andar` : ''} ({rows.length}) · {totalSeats} assento{totalSeats !== 1 ? 's' : ''}
                </p>
                <button onClick={addRow}
                  style={{ padding:'5px 12px', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                  + Adicionar fileira
                </button>
              </div>

              {rows.length === 0 ? (
                <p style={{ fontSize:13, color:'#94a3b8', textAlign:'center', padding:'20px 0', background:'#f8fafc', borderRadius:8, border:'1px dashed #e2e8f0' }}>
                  Nenhuma fileira. Clique em "Adicionar fileira" para começar.
                </p>
              ) : rows.map((row, idx) => (
                <RowEditor key={idx} row={row} index={idx} total={rows.length}
                  onUpdate={p => updateRow(idx, p)}
                  onRemove={() => removeRow(idx)}
                  onMoveUp={() => moveRow(idx, idx - 1)}
                  onMoveDown={() => moveRow(idx, idx + 1)}
                />
              ))}
            </div>

            {/* Pré-visualização */}
            <div style={{ flexShrink:0 }}>
              <p style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', margin:'0 0 4px' }}>
                Numeração dos assentos{deckCount === 2 ? ` · ${activeDeck}º andar` : ''}
              </p>
              <p style={{ fontSize:11.5, color:'#94a3b8', margin:'0 0 10px', maxWidth:200 }}>
                Clique em cada assento e digite o número correspondente — a numeração varia de ônibus para ônibus.
              </p>
              <BusLayoutPreview rows={rows} seatSize={36} editable onLabelChange={updateLabel} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding:'14px 24px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'flex-end', gap:10, flexShrink:0 }}>
          <button onClick={onClose}
            style={{ padding:'9px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            style={{ padding:'9px 20px', borderRadius:8, border:'none', background: saving || !name.trim() ? '#94a3b8' : '#1a2d4f', color:'#fff', fontSize:13, fontWeight:700, cursor: saving || !name.trim() ? 'default' : 'pointer', fontFamily:'inherit' }}>
            {saving ? 'Salvando…' : isEdit ? '✓ Salvar alterações' : '✓ Criar mapa'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Componente principal ── */
export default function BusMapsManager({ canEdit = true, canDelete = true, canImport = false, canExport = true }) {
  const navigate = useNavigate()
  const [busMaps, setBusMaps] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState(null) // null | { busMap?: obj }
  const [confirm, setConfirm] = useState(null) // { id, name }
  const [hover,   setHover]   = useState(null) // { id, rect }
  const [showPopup, setShowPopup] = useState(false)

  const load = () => {
    setLoading(true)
    configApi.busMaps().then(r => setBusMaps(r.data)).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleSave = async ({ label, deck_count, rows }) => {
    const busMap = modal?.busMap
    const payload = {
      label, deck_count,
      rows: rows.map(r => ({
        order:r.order, deck:r.deck, left_seats:r.left_seats, right_seats:r.right_seats,
        left_labels:r.left_labels, right_labels:r.right_labels,
      })),
    }

    if (busMap) {
      await configApi.updateBusMap(busMap.id, payload)
    } else {
      const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      await configApi.addBusMap({ ...payload, key, order: busMaps.length + 1 })
    }
    toast.success(busMap ? 'Mapa atualizado!' : 'Mapa criado!')
    load()
  }

  const delMap = async (id) => {
    try { await configApi.delBusMap(id); setConfirm(null); load() }
    catch { toast.error('Erro ao remover mapa.') }
  }

  const handleFileChosen = async (file) => {
    const csvText = await file.text()
    navigate('/configuracoes/import', {
      state: {
        csvText, filename: file.name, type: 'bus_maps',
        existingNames: busMaps.map(m => m.label),
        existingItems: busMaps,
      },
    })
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display:'flex', gap:10, marginBottom:18, alignItems:'center', flexWrap:'wrap' }}>
        {canEdit && (
          <button onClick={() => setModal({})}
            style={{ padding:'9px 18px', borderRadius:8, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            + Novo mapa de ônibus
          </button>
        )}
        {canExport && (
          <button style={btnCsv('#059669')} onClick={() => exportSectionCsv('bus_maps', 'Mapas de Ônibus', busMaps, 'mapas_de_onibus.csv')} title="Exportar como CSV">
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
            title="Importar Mapas de Ônibus"
            sampleContent={CSV_SAMPLES.bus_maps.content}
            sampleFilename={CSV_SAMPLES.bus_maps.filename}
            onClose={() => setShowPopup(false)}
            onFile={handleFileChosen}
          />
        )}
        <span style={{ fontSize:12, color:'#94a3b8', marginLeft:'auto' }}>
          {busMaps.length} mapa{busMaps.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Lista de mapas */}
      {loading ? (
        <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
      ) : busMaps.length === 0 ? (
        <div style={{ textAlign:'center', padding:'40px 0', background:'#f8fafc', borderRadius:10, border:'1px dashed #e2e8f0' }}>
          <p style={{ color:'#94a3b8', fontSize:13, margin:0 }}>Nenhum mapa cadastrado.</p>
        </div>
      ) : (
        <div style={{ border:'1px solid #e2e8f0', borderRadius:10, overflow:'hidden', background:'#fff' }}>
          {busMaps.map((bm, idx) => {
            const total   = (bm.rows ?? []).reduce((s, r) => s + r.left_seats + r.right_seats, 0)
            const isOpen  = hover?.id === bm.id
            return (
              <div key={bm.id}
                style={{ display:'flex', alignItems:'center', gap:14, padding:'13px 18px', background: isOpen ? '#f8fafc' : '#fff', transition:'background .12s', borderBottom: idx < busMaps.length - 1 ? '1px solid #f1f5f9' : 'none' }}
                onMouseEnter={e => setHover({ id: bm.id, rect: e.currentTarget.getBoundingClientRect() })}
                onMouseLeave={() => setHover(null)}
              >
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontSize:14, fontWeight:600, color:'#0f172a', margin:'0 0 2px' }}>{bm.label}</p>
                  <p style={{ fontSize:12, color:'#94a3b8', margin:0 }}>
                    {bm.rows?.length ?? 0} fileira{(bm.rows?.length ?? 0) !== 1 ? 's' : ''} · {total} assento{total !== 1 ? 's' : ''}
                  </p>
                </div>
                {bm.deck_count === 2 && (
                  <span style={{ padding:'2px 8px', borderRadius:20, background:'#ede9fe', color:'#7c3aed', fontSize:11, fontWeight:600, whiteSpace:'nowrap' }}>
                    2 andares
                  </span>
                )}
                {!bm.is_active && (
                  <span style={{ padding:'2px 8px', borderRadius:20, background:'#fee2e2', color:'#dc2626', fontSize:11, fontWeight:600 }}>Inativo</span>
                )}
                {(canEdit || canDelete) && (
                  <div className="r-acts">
                    {canEdit   && <button className="r-btn edit" title="Editar" onClick={() => setModal({ busMap: bm })}><Ic n="edit" s={13}/></button>}
                    {canDelete && <button className="r-btn del"  title="Excluir" onClick={() => setConfirm({ id: bm.id, name: bm.label })}><Ic n="trash" s={13}/></button>}
                  </div>
                )}

                {/* Pré-visualização flutuante — aparece ao passar o mouse */}
                {isOpen && <MapPreviewTooltip busMap={bm} anchorRect={hover.rect} />}
              </div>
            )
          })}
        </div>
      )}

      {/* Popup criar / editar */}
      {canEdit && modal !== null && (
        <BusMapModal
          busMap={modal.busMap ?? null}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {/* Confirmação de exclusão */}
      {confirm && (
        <ConfirmModal
          message={`Remover o mapa "${confirm.name}"?`}
          okLabel="Remover"
          onOk={() => delMap(confirm.id)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
