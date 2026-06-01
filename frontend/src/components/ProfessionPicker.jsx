import { useState, useRef, useEffect, useMemo } from 'react'
import axios from 'axios'

const URL_CSV  = 'https://raw.githubusercontent.com/okfn-brasil/datasets-br-cbo/master/data/lista_canonicos.csv'
const URL_JSON = 'https://raw.githubusercontent.com/lucassmacedo/cbo-brasil/master/json/CBO2002%20-%20Ocupacao.json'
let cachedProfessions = null

async function loadProfessions() {
  if (cachedProfessions) return cachedProfessions
  const [csvRes, jsonRes] = await Promise.allSettled([
    axios.get(URL_CSV),
    axios.get(URL_JSON),
  ])
  const names = new Set()
  if (csvRes.status === 'fulfilled') {
    csvRes.value.data.split('\n').slice(1).forEach((l) => {
      l = l.trim(); if (!l) return
      const name = l.substring(l.indexOf(',') + 1).replace(/\r/g, '').trim()
      if (name) names.add(name)
    })
  }
  if (jsonRes.status === 'fulfilled') {
    jsonRes.value.data.forEach((item) => { if (item.name) names.add(item.name.trim()) })
  }
  cachedProfessions = [...names].sort((a, b) => a.localeCompare(b, 'pt'))
  return cachedProfessions
}

const drop = {
  position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0,
  background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 300,
  display: 'flex', flexDirection: 'column', maxHeight: 260,
}

export default function ProfessionPicker({ value, onChange }) {
  const [query,       setQuery]       = useState('')
  const [open,        setOpen]        = useState(false)
  const [professions, setProfessions] = useState(cachedProfessions ?? [])
  const [loading,     setLoading]     = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const wrapRef  = useRef(null)
  const inputRef = useRef(null)
  const listRef  = useRef(null)

  /* fecha ao clicar fora */
  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  /* carrega profissões na primeira abertura */
  const ensureLoaded = () => {
    if (professions.length > 0 || loading) return
    setLoading(true)
    loadProfessions().then(setProfessions).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { setHighlighted(-1) }, [query])
  useEffect(() => {
    if (listRef.current && highlighted >= 0) {
      listRef.current.children[highlighted]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlighted])

  const filtered = useMemo(() => {
    if (!query.trim()) return professions.slice(0, 80)
    return professions.filter(p => p.toLowerCase().includes(query.toLowerCase())).slice(0, 120)
  }, [query, professions])

  const pick = (prof) => {
    onChange(prof)
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)) }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered.length > 0) {
        pick(highlighted >= 0 ? filtered[highlighted] : filtered[0])
      } else if (query.trim()) {
        pick(query.trim())
      }
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          className="fi"
          value={open ? query : (value || '')}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { setQuery(''); setOpen(true); ensureLoaded() }}
          onKeyDown={handleKeyDown}
          placeholder="Digite para buscar profissão…"
          style={{ paddingRight: value && !open ? 28 : undefined }}
        />
        {value && !open && (
          <button
            onMouseDown={(e) => { e.preventDefault(); onChange('') }}
            style={{ position:'absolute', right:7, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:16, lineHeight:1, padding:2 }}
          >×</button>
        )}
      </div>

      {open && (
        <div style={drop}>
          {loading ? (
            <p style={{ textAlign:'center', padding:'20px 0', color:'#94a3b8', fontSize:13, margin:0 }}>Carregando ocupações CBO…</p>
          ) : filtered.length === 0 && query.trim() ? (
            <div style={{ padding:'12px 14px' }}>
              <p style={{ fontSize:13, color:'#94a3b8', margin:'0 0 8px' }}>Nenhuma ocupação encontrada.</p>
              <button
                onMouseDown={(e) => { e.preventDefault(); pick(query.trim()) }}
                style={{ fontSize:12, color:'#2e6db4', background:'none', border:'1px solid #2e6db4', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontFamily:'inherit' }}
              >Usar "{query.trim()}" mesmo assim</button>
            </div>
          ) : (
            <div ref={listRef} style={{ overflowY:'auto', flex:1 }}>
              {filtered.map((prof, idx) => {
                const isHl  = idx === highlighted
                const isSel = prof === value
                return (
                  <div key={prof}
                    onMouseDown={(e) => { e.preventDefault(); pick(prof) }}
                    onMouseEnter={() => setHighlighted(idx)}
                    onMouseLeave={() => setHighlighted(-1)}
                    style={{
                      padding:'8px 14px', cursor:'pointer', fontSize:13,
                      color: isSel ? '#2e6db4' : '#1e293b',
                      background: isHl ? '#e8f0fe' : isSel ? '#f0f6ff' : 'transparent',
                      fontWeight: isSel ? 600 : 400,
                      borderLeft: isSel ? '3px solid #2e6db4' : '3px solid transparent',
                    }}
                  >{prof}</div>
                )
              })}
            </div>
          )}
          {!loading && professions.length > 0 && (
            <div style={{ padding:'4px 14px 5px', borderTop:'1px solid #f1f5f9', flexShrink:0 }}>
              <span style={{ fontSize:11, color:'#cbd5e1' }}>{professions.length.toLocaleString('pt-BR')} ocupações (CBO)</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
