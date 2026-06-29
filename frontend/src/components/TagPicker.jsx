import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Ic } from './Icon'
import { computeAnchor } from '../utils/dropdownAnchor'

/**
 * TagPicker — seleção múltipla exibida como chips removíveis (× Nome),
 * com botão "+" que abre um popup de busca pra adicionar mais itens.
 * Usado pra "Destinos e Cidades" / "Países" no Roteiro, onde cada item
 * selecionado precisa ficar visível e removível direto, sem abrir modal.
 *
 * Props:
 *   selected   — [{ id, label }] já selecionados
 *   onRemove   — (id) => void
 *   onAdd      — (item) => void — chamado ao escolher um item na busca
 *   search     — (query) => Promise<[{ id, label }]> — busca assíncrona de opções
 *   onCreate   — (name) => Promise<{ id, label }> — opcional; se passado, mostra
 *                "+ Criar 'X'" quando a busca não encontra nada com esse nome
 *   placeholder
 */
export default function TagPicker({ selected = [], onRemove, onAdd, search, onCreate, placeholder = 'Buscar…' }) {
  const [open,    setOpen]    = useState(false)
  const [query,   setQuery]   = useState('')
  const [options, setOptions] = useState([])
  const [creating, setCreating] = useState(false)
  const [dropStyle, setDropStyle] = useState({})
  const btnRef = useRef(null)

  useEffect(() => {
    const h = e => {
      if (btnRef.current && !btnRef.current.contains(e.target) && !e.target.closest('[data-tagpicker-drop]')) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      search(query).then(setOptions).catch(() => setOptions([]))
    }, 200)
    return () => clearTimeout(t)
  }, [query, open, search])

  const reposition = () => {
    if (!btnRef.current) return
    setDropStyle(computeAnchor(btnRef.current, { gap: 4, cap: 300, minWidth: 260 }))
  }

  const toggleOpen = () => {
    if (!open) reposition()
    setQuery('')
    setOpen(o => !o)
  }

  useEffect(() => {
    if (!open) return
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (item) => { onAdd(item); setOpen(false) }
  const selectedIds = new Set(selected.map(s => s.id))
  const filteredOptions = options.filter(o => !selectedIds.has(o.id))

  const trimmedQuery = query.trim()
  const hasExactMatch = filteredOptions.some(o => o.label.toLowerCase() === trimmedQuery.toLowerCase())
  const showCreate = !!onCreate && trimmedQuery.length > 0 && !hasExactMatch

  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    try {
      const item = await onCreate(trimmedQuery)
      pick(item)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {selected.map(item => (
        <span key={item.id} style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px 4px 10px',
          borderRadius: 20, background: '#f1f5f9', border: '1px solid #e2e8f0', fontSize: 12.5, color: '#334155',
        }}>
          {item.label}
          <span role="button" tabIndex={-1} onClick={() => onRemove(item.id)} title="Remover"
            style={{ display: 'flex', cursor: 'pointer', color: '#94a3b8', borderRadius: '50%' }}
            onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
            onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}>
            <Ic n="x" s={11} />
          </span>
        </span>
      ))}

      <button type="button" ref={btnRef} onClick={toggleOpen} title="Adicionar"
        style={{
          width: 26, height: 26, borderRadius: '50%', border: '1px solid #cbd5e1', background: '#fff',
          color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
        <Ic n="plus" s={13} />
      </button>

      {open && createPortal(
        <div data-tagpicker-drop
          style={{
            ...dropStyle, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
            zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,.14)', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}>
          <div style={{ padding: 8, borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={placeholder}
              style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
          </div>
          <div style={{ overflowY: 'auto' }}>
            {filteredOptions.length === 0 && !showCreate && (
              <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12.5, padding: '12px 0', margin: 0 }}>
                {query ? 'Nenhum resultado.' : 'Digite para buscar…'}
              </p>
            )}
            {filteredOptions.map(opt => (
              <div key={opt.id} onMouseDown={e => { e.preventDefault(); pick(opt) }}
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#1e293b', borderBottom: '1px solid #f8fafc' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                {opt.label}
              </div>
            ))}
            {showCreate && (
              <div onMouseDown={e => { e.preventDefault(); handleCreate() }}
                style={{ padding: '8px 12px', cursor: creating ? 'default' : 'pointer', fontSize: 13, color: '#1a2d4f', fontWeight: 600, borderTop: filteredOptions.length ? '1px solid #f1f5f9' : 'none' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                {creating ? 'Criando…' : `+ Criar "${trimmedQuery}"`}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
