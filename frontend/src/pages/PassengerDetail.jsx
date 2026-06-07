import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import usePersistedTab from '../hooks/usePersistedTab'
import toast from 'react-hot-toast'
import axios from 'axios'
import { passengersApi, documentsApi } from '../api'
import { Ic } from '../components/Icon'
import DelModal from '../components/DelModal'
import AgencyPicker from '../components/AgencyPicker'
import LocationPicker from '../components/LocationPicker'
import NationalityPicker from '../components/NationalityPicker'
import GenderPicker from '../components/GenderPicker'
import ProfessionPicker from '../components/ProfessionPicker'
import SeatPicker from '../components/SeatPicker'
import CountryStatePicker from '../components/CountryStatePicker'
import LanguagePicker from '../components/LanguagePicker'
import DietPicker from '../components/DietPicker'
import DatePicker from '../components/DatePicker'
import CountryPicker from '../components/CountryPicker'
import BrazilCityPicker from '../components/BrazilCityPicker'
import CnhClassPicker from '../components/CnhClassPicker'
import CpfInput from '../components/CpfInput'
import PhoneInput from '../components/PhoneInput'
import DocTypePicker from '../components/DocTypePicker'
import FormSelect from '../components/FormSelect'
import { configApi } from '../api'

// Fallback estático para quando a API ainda não carregou
const DOC_TYPES_FALLBACK = [
  { key:'passport',   label:'Passaporte',                icon:'🛂', color:'#2e6db4' },
  { key:'rg',         label:'Carteira de Identidade',    icon:'🪪', color:'#7c3aed' },
  { key:'cnh',        label:'Carteira de Motorista',     icon:'🚗', color:'#059669' },
  { key:'visa',       label:'Visto',                     icon:'✈️', color:'#0891b2' },
  { key:'birth_cert', label:'Certidão de Nascimento',    icon:'📄', color:'#b45309' },
  { key:'residence',  label:'Comprovante de Residência', icon:'🏠', color:'#92400e' },
  { key:'vaccine',    label:'Vacina',                    icon:'💉', color:'#0f766e' },
  { key:'other',      label:'Outro documento',           icon:'📎', color:'#475569' },
]

/* ── helpers ── */
const EMPTY = {
  first_name:'', last_name:'', full_name:'',
  parent1_first_name:'', parent1_last_name:'', parent1_birth_date:'',
  email:'', email_emergency1:'', email_emergency2:'',
  native_language:'', other_languages:'',
  birth_date:'', birth_place:'', nationality:'', other_nationalities:'',
  gender:'', gender_custom:'', profession:'', is_foreign:false, is_verified:false, is_guide:false,
  agencies:[],
  cpf:'',
  phone1:'', phone2:'', mobile:'',
  flight_class:'', seat_preference:'', seat_position:'', diet_type:'', diet_notes:'', receives_mail:false,
  cep:'', street:'', number:'', complement:'', neighborhood:'', city:'', state:'', country:'Brasil',
  status:'active', notes:'',
}

const STATES = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
]

/* ── Toggle component ── */
function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle-wrap">
      <span className="toggle">
        <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-slider" />
      </span>
      <span className="toggle-label">{checked ? 'Sim' : 'Não'}</span>
    </label>
  )
}

/* ── Field wrapper ── */
function F({ label, children, col }) {
  const style = col === 'full' ? { gridColumn: '1/-1' } : col === 2 ? { gridColumn: 'span 2' } : {}
  return (
    <div style={style}>
      <label className="fl">{label}</label>
      {children}
    </div>
  )
}

/* ── Helpers para o card de documento ── */
const lbl = { fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.05em', margin:0, marginBottom:2 }
function Cell({ label, value, width=100, sub, subColor }) {
  return (
    <div style={{ width, flexShrink:0, padding:'9px 10px', borderRight:'1px solid #f1f5f9' }}>
      <p style={lbl}>{label}</p>
      <p style={{ fontSize:12, color:value?'#1e293b':'#cbd5e1', margin:0, fontWeight:value?500:400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
        {value || '—'}
      </p>
      {sub && (
        <span style={{ display:'inline-block', marginTop:2, padding:'1px 6px', borderRadius:5, fontSize:10.5, fontWeight:700, background:'#eff6ff', color: subColor || '#2e6db4' }}>
          {sub}
        </span>
      )}
    </div>
  )
}

/* ── FilterDropdown — dropdown estilizado para filtros ── */
function FilterDropdown({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const active = value !== (options[0]?.value ?? 'all')
  const label  = options.find(o => o.value === value)?.label ?? placeholder

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 6,
          border: `1px solid ${active ? '#2e6db4' : '#e2e8f0'}`,
          background: active ? '#eff6ff' : '#fff',
          color: active ? '#2e6db4' : '#475569',
          fontSize: 13, fontWeight: active ? 600 : 400,
          cursor: 'pointer', fontFamily: 'inherit',
          transition: 'all .12s', whiteSpace: 'nowrap',
        }}
      >
        {label}
        <span style={{ fontSize: 9, opacity: .7, marginLeft: 2 }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200,
          background: '#fff', borderRadius: 8,
          border: '1px solid #e2e8f0',
          boxShadow: '0 8px 24px rgba(0,0,0,.10)',
          minWidth: 180, overflow: 'hidden',
          animation: 'mIn .12s ease',
        }}>
          {options.map(opt => {
            const selected = value === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '9px 14px', gap: 10,
                  background: selected ? '#eff6ff' : 'transparent',
                  border: 'none', borderBottom: '1px solid #f8fafc',
                  color: selected ? '#2e6db4' : '#1e293b',
                  fontSize: 13, fontWeight: selected ? 600 : 400,
                  cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                  transition: 'background .1s',
                }}
                onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#f8fafc' }}
                onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
              >
                <span>{opt.label}</span>
                {selected && <span style={{ color: '#2e6db4', fontSize: 14 }}>✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── CopyRow — linha clicável para copiar no popup de documento ── */
function CopyRow({ label, value, extra }) {
  const [copied, setCopied] = useState(false)
  if (!value && !extra) return null
  const copy = () => {
    if (!value) return
    navigator.clipboard.writeText(String(value)).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div style={{ display:'flex', gap:12, padding:'8px 0', borderBottom:'1px solid #f8fafc' }}>
      <span style={{ fontSize:12, fontWeight:700, color:'#94a3b8', minWidth:130, flexShrink:0 }}>{label}</span>
      <span
        onClick={copy}
        title={value ? 'Clique para copiar' : undefined}
        style={{ fontSize:13, color:'#1e293b', flex:1, cursor:value?'pointer':'default', display:'inline-flex', alignItems:'center', gap:8, flexWrap:'wrap' }}
      >
        {value ?? '—'}
        {extra}
        {copied && (
          <span style={{ fontSize:11, fontWeight:700, color:'#059669', background:'#d1fae5', padding:'1px 7px', borderRadius:20, flexShrink:0 }}>
            ✓ Copiado
          </span>
        )}
      </span>
    </div>
  )
}

/* ── Documents tab ── */
function DocumentsTab({ passengerId, isNew }) {
  const [docs,       setDocs]       = useState([])
  const [docTypes,   setDocTypes]   = useState(DOC_TYPES_FALLBACK)
  const [loading,    setLoading]    = useState(false)
  const [deleting,   setDeleting]   = useState(null)
  const [confirmDoc, setConfirmDoc] = useState(null)
  const [editDoc,    setEditDoc]    = useState(null)
  const [editForm,   setEditForm]   = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [notesDoc,   setNotesDoc]   = useState(null)
  const [notesText,  setNotesText]  = useState('')
  const [notesSaving,setNotesSaving]= useState(false)
  const [viewDoc,    setViewDoc]    = useState(null)
  const [docTab,     setDocTab]     = useState('current')  // 'current' | 'expired'
  const [search,     setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [expiryFilter, setExpiryFilter] = useState('all')

  const load = () => {
    if (isNew || !passengerId || passengerId === 'novo') return
    setLoading(true)
    documentsApi.list(passengerId)
      .then(r => setDocs(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [passengerId])

  // Carrega tipos do banco para exibir ícone/cor corretamente
  useEffect(() => {
    configApi.docTypes().then(r => {
      if (r.data?.length) setDocTypes(r.data)
    }).catch(() => {})
  }, [])

  const openNotes = (doc) => { setNotesDoc(doc); setNotesText(doc.notes ?? '') }

  const saveNotes = async () => {
    if (!notesDoc) return
    setNotesSaving(true)
    try {
      await documentsApi.patch(notesDoc.id, { notes: notesText })
      toast.success('Observações salvas.')
      setNotesDoc(null)
      load()
    } catch { toast.error('Erro ao salvar.') }
    finally { setNotesSaving(false) }
  }

  const openEdit = (doc) => {
    setEditDoc(doc)
    setEditForm({
      label:        doc.label        ?? '',
      doc_number:   doc.doc_number   ?? '',
      doc_category: doc.doc_category ?? '',
      issued_date:  doc.issued_date  ?? '',
      expiry_date:  doc.expiry_date  ?? '',
      issued_by:    doc.issued_by    ?? '',
      notes:        doc.notes        ?? '',
    })
  }

  const saveEdit = async () => {
    if (!editDoc) return
    setEditSaving(true)
    try {
      await documentsApi.patch(editDoc.id, editForm)
      toast.success('Documento atualizado.')
      setEditDoc(null)
      load()
    } catch { toast.error('Erro ao salvar.') }
    finally { setEditSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirmDoc) return
    setDeleting(confirmDoc.id)
    setConfirmDoc(null)
    await documentsApi.remove(confirmDoc.id).catch(() => toast.error('Erro ao remover.'))
    toast.success('Documento removido.')
    setDeleting(null)
    load()
  }

  const handleDownload = async (doc) => {
    try {
      const r = await documentsApi.download(doc.id)
      // Extrai o nome do header Content-Disposition enviado pelo backend
      const disposition = r.headers['content-disposition'] ?? ''
      const match = disposition.match(/filename[^;=\n]*=\s*["']?([^"';\n]+)["']?/)
      const filename = match?.[1]?.trim() || doc.original_name || 'documento'
      const url = URL.createObjectURL(r.data)
      const a   = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Erro ao baixar documento.') }
  }

  const fmt = (d) => d
    ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'

  /* Calcula badge de alerta de validade (só retorna badge, não a data em si) */
  const expiryStatus = (expiryDate) => {
    if (!expiryDate) return null
    const today = new Date(); today.setHours(0,0,0,0)
    const exp   = new Date(expiryDate + 'T00:00:00')
    const days  = Math.round((exp - today) / 86400000)
    if (days < 0)   return { label: 'Vencido',           color: '#dc2626', bg: '#fee2e2' }
    if (days <= 30) return { label: `Vence em ${days}d`, color: '#d97706', bg: '#fef3c7' }
    if (days <= 90) return { label: `Vence em ${days}d`, color: '#2563eb', bg: '#dbeafe' }
    return null  // válido por mais de 90 dias — só mostra a data, sem badge
  }

  /* Separa documentos atuais dos vencidos */
  const today = new Date(); today.setHours(0,0,0,0)
  const isExpired = (doc) => doc.expiry_date && new Date(doc.expiry_date + 'T00:00:00') < today

  const currentDocs = docs.filter(d => !isExpired(d))
  const expiredDocs = docs.filter(d =>  isExpired(d))
  const activeDocs  = docTab === 'expired' ? expiredDocs : currentDocs

  /* Filtros dentro da aba ativa */
  const filtered = activeDocs.filter(doc => {
    const matchSearch = !search ||
      doc.display_name?.toLowerCase().includes(search.toLowerCase()) ||
      doc.doc_type_label?.toLowerCase().includes(search.toLowerCase())
    const matchType = typeFilter === 'all' || doc.doc_type === typeFilter
    const status    = expiryStatus(doc.expiry_date)
    const matchExpiry = expiryFilter === 'all'
      || (expiryFilter === 'expired'  && isExpired(doc))
      || (expiryFilter === 'soon'     && status && doc.expiry_date && Math.round((new Date(doc.expiry_date + 'T00:00:00') - today) / 86400000) <= 90)
      || (expiryFilter === 'none'     && !doc.expiry_date)
    return matchSearch && matchType && matchExpiry
  })

  /* Tipos únicos presentes nos documentos */
  const presentTypes = [...new Set(docs.map(d => d.doc_type))]

  // Usa docTypes carregados do banco para rótulos
  const typeLabel = Object.fromEntries(docTypes.map(t => [t.key, t.label]))

  return (
    <div className="det-card">
      <div className="section">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { id: 'current', label: 'Documentos atuais',  count: currentDocs.length },
              { id: 'expired', label: 'Vencidos',           count: expiredDocs.length },
            ].map(t => (
              <button key={t.id} type="button" onClick={() => { setDocTab(t.id); setSearch(''); setTypeFilter('all'); setExpiryFilter('all') }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 12px', borderRadius: 6, border: 'none',
                  background: docTab === t.id ? (t.id === 'expired' ? '#fee2e2' : '#eff6ff') : 'transparent',
                  color: docTab === t.id ? (t.id === 'expired' ? '#dc2626' : '#2e6db4') : '#64748b',
                  fontSize: 13, fontWeight: docTab === t.id ? 600 : 400,
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s',
                }}
              >
                {t.label}
                {t.count > 0 && (
                  <span style={{
                    padding: '1px 6px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                    background: docTab === t.id ? (t.id === 'expired' ? '#dc2626' : '#2e6db4') : '#e2e8f0',
                    color: docTab === t.id ? '#fff' : '#64748b',
                  }}>{t.count}</span>
                )}
              </button>
            ))}
          </div>
          {!isNew && <DocTypePicker passengerId={passengerId} onUploaded={load} />}
          {isNew && (
            <span style={{ fontSize: 12, color: '#94a3b8', padding: '4px 10px', borderRadius: 6, border: '1px dashed #e2e8f0', background: '#fafafa' }}>
              Salve o passageiro para habilitar uploads
            </span>
          )}
        </div>

        {/* Busca + filtros */}
        {!isNew && docs.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Busca — largura fixa */}
            <div style={{ position: 'relative', width: 200, flexShrink: 0 }}>
              <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', display: 'flex' }}>
                <Ic n="search" s={13} />
              </span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar…"
                style={{ width: '100%', padding: '6px 10px 6px 29px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b' }}
                onFocus={e => e.target.style.borderColor = '#2e6db4'}
                onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>

            {/* Filtro por tipo */}
            {presentTypes.length > 1 && (
              <FilterDropdown
                value={typeFilter}
                onChange={setTypeFilter}
                placeholder="Todos os tipos"
                options={[
                  { value: 'all', label: 'Todos os tipos' },
                  ...presentTypes.map(t => ({ value: t, label: typeLabel[t] ?? t })),
                ]}
              />
            )}

            {/* Filtro por validade */}
            <FilterDropdown
              value={expiryFilter}
              onChange={setExpiryFilter}
              placeholder="Todas as validades"
              options={[
                { value: 'all',      label: 'Todas as validades'      },
                { value: 'expired',  label: 'Vencidos'                },
                { value: 'soon',     label: 'Vence em até 90 dias'    },
                { value: 'none',     label: 'Sem data de validade'    },
              ]}
            />
          </div>
        )}

        {/* Lista */}
        {loading ? (
          <p style={{ color: '#94a3b8', fontSize: 13, padding: '20px 0' }}>Carregando…</p>
        ) : docs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
            <p style={{ fontSize: 14, fontWeight: 500, color: '#475569', margin: 0 }}>Nenhum documento anexado</p>
            <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
              {isNew ? 'Salve o passageiro e volte aqui para anexar documentos' : 'Clique em "+ Adicionar documento" para enviar o primeiro'}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 13, padding: '16px 0', textAlign: 'center' }}>Nenhum documento encontrado com os filtros selecionados.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map((doc) => {
              const typeInfo = docTypes.find(t => t.key === doc.doc_type) ?? docTypes[docTypes.length - 1] ?? DOC_TYPES_FALLBACK[DOC_TYPES_FALLBACK.length - 1]
              const expSt    = expiryStatus(doc.expiry_date)
              return (
                <div key={doc.id}
                  style={{ display:'flex', alignItems:'center', gap:0, borderRadius:8, border:'1px solid #e2e8f0', background:'#fff', overflow:'hidden', transition:'background .1s' }}
                  onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
                  onMouseLeave={e=>e.currentTarget.style.background='#fff'}
                >
                  {/* Imagem / ícone + nome + badge — ocupa o espaço à esquerda */}
                  <div style={{ display:'flex', alignItems:'center', gap:9, padding:'10px 12px', flex:1, minWidth:0, borderRight:'1px solid #f1f5f9' }}>
                    {doc.preview_url
                      ? <img src={doc.preview_url} alt="" style={{ width:28,height:28,objectFit:'cover',borderRadius:4,flexShrink:0,border:'1px solid #e2e8f0' }} onError={e=>{e.currentTarget.style.display='none';e.currentTarget.nextSibling.style.display='block'}} />
                      : null}
                    <span style={{ fontSize:17, flexShrink:0, display:doc.preview_url?'none':'block' }}>{typeInfo.icon}</span>
                    <div style={{ minWidth:0, flex:1 }}>
                      <p style={{ fontSize:12.5, fontWeight:600, color:'#1e293b', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{doc.display_name}</p>
                      <span style={{ fontSize:10, fontWeight:700, color:typeInfo.color, opacity:.8 }}>{doc.doc_type_label}</span>
                    </div>
                  </div>

                  {/* Validade — data + badge de alerta */}
                  <div style={{ width:155, flexShrink:0, padding:'9px 10px', borderRight:'1px solid #f1f5f9' }}>
                    <p style={lbl}>Vencimento</p>
                    {doc.expiry_date ? (
                      <div>
                        <p style={{ fontSize:12.5, color:'#1e293b', margin:0, fontWeight:500 }}>
                          {fmt(doc.expiry_date)}
                        </p>
                        {expSt && (
                          <span style={{ display:'inline-block', marginTop:2, padding:'1px 6px', borderRadius:6, fontSize:10.5, fontWeight:700, background:expSt.bg, color:expSt.color }}>
                            {expSt.label}
                          </span>
                        )}
                      </div>
                    ) : (
                      <p style={{ fontSize:12, color:'#cbd5e1', margin:0 }}>Sem validade</p>
                    )}
                  </div>

                  {/* Observações — truncada, clicável para ver/editar tudo */}
                  <div
                    onClick={() => openNotes(doc)}
                    title={doc.notes ? 'Clique para ver e editar as observações' : 'Clique para adicionar observações'}
                    style={{ width:180, flexShrink:0, padding:'9px 10px', borderRight:'1px solid #f1f5f9', cursor:'pointer', transition:'background .1s' }}
                    onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                  >
                    <p style={lbl}>Observações</p>
                    <p style={{ fontSize:12, color:doc.notes?'#475569':'#cbd5e1', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontStyle:doc.notes?'italic':'normal' }}>
                      {doc.notes || '—'}
                    </p>
                  </div>

                  {/* Ações */}
                  <div style={{ display:'flex', gap:3, padding:'9px 10px', flexShrink:0 }}>
                    {[
                      { fn:()=>setViewDoc(doc),     title:'Ver detalhes', icon:'eye',   hc:'#2e6db4' },
                      { fn:()=>handleDownload(doc), title:'Baixar',       icon:'dl',    hc:'#059669' },
                      { fn:()=>setConfirmDoc(doc),  title:'Remover',      icon:'trash', hc:'#dc2626', danger:true, dis:deleting===doc.id },
                    ].map(({fn,title,icon,hc,danger,dis})=>(
                      <button key={title} onClick={fn} disabled={dis} title={title}
                        style={{ width:26,height:26,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:5,border:'1px solid #e2e8f0',background:'#fff',color:'#94a3b8',cursor:'pointer',transition:'all .12s',opacity:dis?.5:1 }}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=hc;e.currentTarget.style.color=hc;if(danger)e.currentTarget.style.background='#fee2e2'}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.color='#94a3b8';if(danger)e.currentTarget.style.background='#fff'}}>
                        <Ic n={icon} s={11}/>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Popup de detalhes do documento ── */}
      {viewDoc && (() => {
        const ti  = docTypes.find(t => t.key === viewDoc.doc_type) ?? docTypes[docTypes.length - 1] ?? DOC_TYPES_FALLBACK[DOC_TYPES_FALLBACK.length - 1]
        const exp = viewDoc.expiry_date ? (() => {
          const today = new Date(); today.setHours(0,0,0,0)
          const d     = new Date(viewDoc.expiry_date + 'T00:00:00')
          const days  = Math.round((d - today) / 86400000)
          if (days < 0)   return { label: 'Vencido',           color: '#dc2626', bg: '#fee2e2' }
          if (days <= 30) return { label: `Vence em ${days}d`, color: '#d97706', bg: '#fef3c7' }
          if (days <= 90) return { label: `Vence em ${days}d`, color: '#2563eb', bg: '#dbeafe' }
          return null
        })() : null

        // CopyRow definido fora do componente para respeitar regras dos hooks

        return (
          <div onClick={(e)=>{if(e.target===e.currentTarget)setViewDoc(null)}}
            style={{position:'fixed',inset:0,background:'rgba(15,23,42,.45)',backdropFilter:'blur(3px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:400,padding:20}}>
            <div onClick={e=>e.stopPropagation()}
              style={{background:'#fff',borderRadius:12,width:'100%',maxWidth:480,boxShadow:'0 24px 64px rgba(0,0,0,.24)',animation:'mIn .15s ease'}}>

              {/* Header */}
              <div style={{padding:'16px 20px 14px',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',gap:12}}>
                {viewDoc.preview_url
                  ? <img src={viewDoc.preview_url} alt="" style={{width:44,height:44,objectFit:'cover',borderRadius:6,border:'1px solid #e2e8f0',flexShrink:0}} />
                  : <span style={{fontSize:28,flexShrink:0}}>{ti.icon}</span>
                }
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontSize:15,fontWeight:700,color:'#1e293b',margin:0}}>{viewDoc.display_name}</p>
                  <span style={{padding:'2px 8px',borderRadius:8,fontSize:11,fontWeight:600,background:`${ti.color}15`,color:ti.color}}>{viewDoc.doc_type_label}</span>
                </div>
              </div>

              {/* Corpo — todos os campos */}
              <div style={{padding:'14px 20px'}}>
                <CopyRow label="Número do documento" value={viewDoc.doc_number} />
                {viewDoc.doc_type === 'cnh' && viewDoc.doc_category && (
                  <CopyRow label="Categoria" value={`Categoria ${viewDoc.doc_category}`} />
                )}
                <CopyRow label="Data de emissão"     value={fmt(viewDoc.issued_date)} />
                <CopyRow
                  label="Vencimento"
                  value={viewDoc.expiry_date ? fmt(viewDoc.expiry_date) : null}
                  extra={exp && <span style={{padding:'2px 7px',borderRadius:7,fontSize:11,fontWeight:700,background:exp.bg,color:exp.color}}>{exp.label}</span>}
                />
                <CopyRow label="Local / País emissor" value={viewDoc.issued_by} />
                {viewDoc.notes && (
                  <div style={{padding:'8px 0'}}>
                    <span style={{fontSize:12,fontWeight:700,color:'#94a3b8',display:'block',marginBottom:4}}>Observações</span>
                    <p style={{fontSize:13,color:'#475569',margin:0,lineHeight:1.6,fontStyle:'italic'}}>{viewDoc.notes}</p>
                  </div>
                )}
              </div>

              {/* Rodapé — Editar (esq) + OK (dir) */}
              <div style={{padding:'12px 20px',borderTop:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between'}}>
                <button
                  onClick={() => { setViewDoc(null); openEdit(viewDoc) }}
                  style={{display:'flex',alignItems:'center',gap:6,padding:'7px 16px',borderRadius:6,border:'1px solid #e2e8f0',background:'#fff',color:'#475569',fontSize:13,fontWeight:500,cursor:'pointer',fontFamily:'inherit',transition:'all .12s'}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='#7c3aed';e.currentTarget.style.color='#7c3aed'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';e.currentTarget.style.color='#475569'}}
                >
                  <Ic n="edit" s={13}/> Editar
                </button>
                <button
                  onClick={() => setViewDoc(null)}
                  style={{padding:'7px 24px',borderRadius:6,border:'none',background:'#2e6db4',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
                  onMouseEnter={e=>e.currentTarget.style.background='#275fa0'}
                  onMouseLeave={e=>e.currentTarget.style.background='#2e6db4'}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Popup de observações ── */}
      {notesDoc && (
        <div onClick={(e)=>{if(e.target===e.currentTarget)setNotesDoc(null)}}
          style={{position:'fixed',inset:0,background:'rgba(15,23,42,.45)',backdropFilter:'blur(3px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:400,padding:20}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:'#fff',borderRadius:12,width:'100%',maxWidth:480,boxShadow:'0 24px 64px rgba(0,0,0,.24)',animation:'mIn .15s ease'}}>
            <div style={{padding:'16px 20px 14px',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:18}}>{docTypes.find(t=>t.key===notesDoc.doc_type)?.icon ?? '📎'}</span>
              <div style={{flex:1,minWidth:0}}>
                <p style={{fontSize:14,fontWeight:600,color:'#1e293b',margin:0}}>Observações</p>
                <p style={{fontSize:12,color:'#94a3b8',margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{notesDoc.display_name}</p>
              </div>
            </div>
            <div style={{padding:'16px 20px'}}>
              <textarea
                autoFocus
                value={notesText}
                onChange={e=>setNotesText(e.target.value)}
                rows={6}
                placeholder="Ex.: Passaporte com validade próxima. Não pode embarcar para destinos que exigem visto…"
                style={{width:'100%',padding:'10px 12px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:13,fontFamily:'inherit',color:'#1e293b',outline:'none',resize:'vertical',lineHeight:1.6,transition:'border-color .12s'}}
                onFocus={e=>e.target.style.borderColor='#2e6db4'}
                onBlur={e=>e.target.style.borderColor='#e2e8f0'}
              />
              <p style={{fontSize:11,color:'#94a3b8',marginTop:4,textAlign:'right'}}>{notesText.length} caracteres</p>
            </div>
            <div style={{padding:'12px 20px',borderTop:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between'}}>
              <button onClick={()=>setNotesDoc(null)}
                style={{padding:'6px 14px',borderRadius:6,border:'1px solid #e2e8f0',background:'#fff',color:'#475569',fontSize:13,cursor:'pointer',fontFamily:'inherit'}}>
                Fechar
              </button>
              <button onClick={saveNotes} disabled={notesSaving}
                style={{padding:'6px 20px',borderRadius:6,border:'none',background:'#2e6db4',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit',opacity:notesSaving?.6:1}}>
                {notesSaving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de edição de metadados ── */}
      {editDoc && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setEditDoc(null) }}
          style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:400, padding:20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:460, boxShadow:'0 24px 64px rgba(0,0,0,.24)', animation:'mIn .15s ease' }}>
            <div style={{ padding:'16px 20px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:20 }}>{docTypes.find(t=>t.key===editDoc.doc_type)?.icon ?? '📎'}</span>
              <div>
                <p style={{ fontSize:14, fontWeight:600, color:'#1e293b', margin:0 }}>Editar documento</p>
                <p style={{ fontSize:12, color:'#94a3b8', margin:0 }}>{editDoc.doc_type_label} — apenas metadados (imagem não é alterada)</p>
              </div>
            </div>

            <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:12 }}>
              {/* Título — só para "Outro documento" */}
              {editDoc.doc_type === 'other' && (
                <div>
                  <label className="fl">Título do documento</label>
                  <input className="fi" value={editForm.label} onChange={e=>setEditForm(f=>({...f,label:e.target.value}))} placeholder="Ex.: Cartão de vacinação, Seguro viagem…" />
                </div>
              )}

              {/* Número */}
              {editDoc.doc_number !== undefined && (
                <div>
                  <label className="fl">Número do documento</label>
                  <input className="fi" value={editForm.doc_number} onChange={e=>setEditForm(f=>({...f,doc_number:e.target.value}))} />
                </div>
              )}

              {/* Categoria — só para CNH */}
              {editDoc.doc_type === 'cnh' && (
                <div>
                  <label className="fl">Categoria / Classe</label>
                  <CnhClassPicker value={editForm.doc_category} onChange={v=>setEditForm(f=>({...f,doc_category:v}))} />
                </div>
              )}

              {/* Datas em grid */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div>
                  <label className="fl">Data de emissão</label>
                  <DatePicker value={editForm.issued_date} onChange={v=>setEditForm(f=>({...f,issued_date:v}))} />
                </div>
                <div>
                  <label className="fl">Validade</label>
                  <DatePicker value={editForm.expiry_date} onChange={v=>setEditForm(f=>({...f,expiry_date:v}))} />
                </div>
              </div>

              {/* Local emissor */}
              <div>
                <label className="fl">Local / País emissor</label>
                {editDoc.doc_type === 'rg' || editDoc.doc_type === 'cnh' ? (
                  <BrazilCityPicker value={editForm.issued_by} onChange={v=>setEditForm(f=>({...f,issued_by:v}))} />
                ) : (
                  <CountryPicker value={editForm.issued_by} onChange={v=>setEditForm(f=>({...f,issued_by:v}))} />
                )}
              </div>

              {/* Notas */}
              <div>
                <label className="fl">Notas</label>
                <textarea className="fi" rows={2} style={{resize:'none'}} value={editForm.notes} onChange={e=>setEditForm(f=>({...f,notes:e.target.value}))} placeholder="Observações adicionais…" />
              </div>
            </div>

            <div style={{ padding:'12px 20px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'space-between' }}>
              <button onClick={() => setEditDoc(null)}
                style={{ padding:'6px 14px', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
                Cancelar
              </button>
              <button onClick={saveEdit} disabled={editSaving}
                style={{ padding:'6px 20px', borderRadius:6, border:'none', background:'#2e6db4', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', opacity:editSaving?.6:1 }}>
                {editSaving ? 'Salvando…' : 'Salvar alterações'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDoc && (
        <DelModal
          name={confirmDoc.display_name}
          onOk={handleDelete}
          onCancel={() => setConfirmDoc(null)}
        />
      )}
    </div>
  )
}

/* ── Main component ── */
export default function PassengerDetail() {
  const { id }         = useParams()
  const navigate       = useNavigate()
  const [searchParams] = useSearchParams()
  const isNew          = id === 'novo'

  const [form,       setForm]       = useState(() => {
    if (isNew) {
      const cpf       = searchParams.get('cpf') || ''
      const isForeign = searchParams.get('estrangeiro') === 'true'
      return { ...EMPTY, cpf, is_foreign: isForeign }
    }
    return { ...EMPTY }
  })
  const [loading,    setLoading]    = useState(!isNew)
  const [notesOpen,  setNotesOpen]  = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const [tab,        setTab]        = usePersistedTab('tab_passenger_detail', 'info')
  const [isDirty,    setIsDirty]    = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})  // { fieldKey: true }

  /* load passenger data */
  useEffect(() => {
    if (!isNew) {
      passengersApi.get(id)
        .then((r) => { setForm({ ...EMPTY, ...r.data, agencies: r.data.agencies ?? [] }); setIsDirty(false) })
        .catch(() => { toast.error('Passageiro não encontrado.'); navigate('/passageiros') })
        .finally(() => setLoading(false))
    }
  }, [id])

  /* Auto-limpa erros de validação quando o campo é preenchido */
  useEffect(() => {
    if (!Object.keys(fieldErrors).length) return
    setFieldErrors(prev => {
      const next = { ...prev }
      let changed = false
      for (const k of Object.keys(next)) {
        const v = form[k]
        const filled = v !== null && v !== undefined && v !== false &&
          (typeof v !== 'string' || v.replace(/\D/g,'').length > 0 || v.trim().length > 0)
        if (filled) { delete next[k]; changed = true }
      }
      return changed ? next : prev
    })
  }, [form])

  /* Avisa ao recarregar/fechar com alterações não salvas */
  useEffect(() => {
    const handler = (e) => {
      if (isDirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const markDirty = () => setIsDirty(true)
  const clearError = (k) => setFieldErrors((prev) => { const n = { ...prev }; delete n[k]; return n })

  const set  = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    markDirty()
    clearError(k)
  }
  const setB = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); markDirty() }

  /* Auto-preenche nacionalidade principal a partir do local de nascimento */
  const setBirthPlace = (v) => {
    const country = v ? v.split(', ').pop() : ''
    setForm((f) => ({
      ...f,
      birth_place: v,
      ...(country && !f.nationality ? { nationality: country } : {}),
    }))
    markDirty()
  }

  /* CEP lookup via ViaCEP */
  const lookupCep = async () => {
    const cep = (form.cep ?? '').toString().trim().replace(/\D/g, '')
    if (cep.length !== 8) {
      toast.error(`CEP inválido — ${cep.length} dígito${cep.length !== 1 ? 's' : ''} encontrado${cep.length !== 1 ? 's' : ''} (esperado: 8).`)
      return
    }
    setCepLoading(true)
    try {
      const { data } = await axios.get(`https://viacep.com.br/ws/${cep}/json/`)
      if (data.erro) { toast.error('CEP não encontrado.'); return }
      setForm((f) => ({
        ...f,
        street:       data.logradouro || f.street,
        neighborhood: data.bairro     || f.neighborhood,
        city:         data.localidade || f.city,
        state:        data.uf         || f.state,
        country:      'Brasil',
      }))
      toast.success('Endereço preenchido.')
    } catch { toast.error('Erro ao buscar CEP.') }
    finally  { setCepLoading(false) }
  }

  /* Save */
  const DATE_FIELDS = ['birth_date','rg_issue_date','passport_issue','passport_expiry','rne_expiry','rne_issue','parent1_birth_date','parent2_birth_date']

  const save = async () => {
    // Validação local — marca campos em vermelho
    const errs = {}
    const hasName = form.first_name?.trim() || form.last_name?.trim()
    if (!hasName) { errs.first_name = true; errs.last_name = true }
    if (!form.email?.trim()) errs.email = true
    if (!form.is_foreign && !form.cpf?.replace(/\D/g, '')) errs.cpf = true
    if (!form.gender)          errs.gender     = true
    if (!form.birth_date)      errs.birth_date = true
    if (!form.phone1?.trim())  errs.phone1     = true
    if (!form.street?.trim())        errs.street       = true
    if (!form.city?.trim())          errs.city         = true
    if (!form.cep?.replace(/\D/g,'')) errs.cep         = true
    if (!form.number?.trim())        errs.number       = true
    if (!form.neighborhood?.trim())  errs.neighborhood = true
    if (!form.country?.trim())       errs.country      = true
    if (Object.keys(errs).length) {
      setFieldErrors(errs)
      setTab('info')

      // Rótulos legíveis dos campos obrigatórios em falta
      const LABELS = {
        first_name:   'Primeiro nome',
        last_name:    'Sobrenome',
        email:        'E-mail',
        cpf:          'CPF',
        gender:       'Gênero',
        birth_date:   'Data de nascimento',
        phone1:       'Telefone',
        street:       'Endereço',
        city:         'Cidade',
        cep:          'CEP',
        number:       'Número',
        neighborhood: 'Bairro',
        country:      'País',
      }
      const missing = Object.keys(errs).map(k => LABELS[k] || k).join(', ')
      toast.error(`Campos obrigatórios em branco: ${missing}`, { duration: 5000 })

      // Rola até o primeiro campo com erro após a re-renderização
      setTimeout(() => {
        const first = document.querySelector('.fi[style*="dc2626"], [style*="2px solid #dc2626"], [style*="0 0 0 2px #dc2626"]')
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 150)

      return
    }
    setFieldErrors({})
    setSaving(true)
    try {
      const { gender_custom, full_name, ...rest } = form  // full_name calculado pelo backend
      const payload = { ...rest }
      // Datas vazias → null
      DATE_FIELDS.forEach(k => { if (payload[k] === '' || payload[k] === undefined) payload[k] = null })
      if (isNew) {
        const r = await passengersApi.create(payload)
        toast.success('Passageiro criado.')
        setIsDirty(false)
        navigate(`/passageiros/${r.data.id}`)
      } else {
        await passengersApi.update(id, payload)
        toast.success('Passageiro salvo.')
        setIsDirty(false)
      }
    } catch (e) {
      const data = e.response?.data
      // Marca campos com erro retornado pela API
      if (data && typeof data === 'object') {
        const apiErrs = {}
        Object.keys(data).forEach(k => { if (Array.isArray(data[k]) && data[k].length) apiErrs[k] = true })
        if (Object.keys(apiErrs).length) setFieldErrors(apiErrs)
      }
      const msg  = data?.email?.[0]
               ?? data?.non_field_errors?.[0]
               ?? (data && typeof data === 'object'
                   ? Object.values(data).flat().find(v => typeof v === 'string')
                   : null)
               ?? 'Erro ao salvar. Verifique os dados.'
      toast.error(msg)
    } finally { setSaving(false) }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
        Carregando…
      </div>
    )
  }

  const errStyle = { borderColor: '#dc2626', background: '#fef2f2' }

  const fi = (k, placeholder, type = 'text') => {
    if (type === 'date') {
      return (
        <DatePicker
          value={form[k] ?? ''}
          onChange={(v) => { set(k)({ target: { value: v } }) }}
          errStyle={fieldErrors[k] ? errStyle : undefined}
        />
      )
    }
    return (
      <input className="fi" type={type} value={form[k] ?? ''} onChange={set(k)}
        placeholder={placeholder || ''}
        style={fieldErrors[k] ? errStyle : {}} />
    )
  }

  const fs = (k, children) => (
    <select className="fs" value={form[k] ?? ''} onChange={set(k)}
      style={fieldErrors[k] ? errStyle : {}}>
      {children}
    </select>
  )

  return (
    <><div>
      {/* ── Header ── */}
      <div className="det-header">
        <div style={{ minWidth: 0, flex: 1, marginRight: 16 }}>
          <h1 className="det-title" title={`${form.first_name} ${form.last_name}`.trim() || form.full_name || ''}
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {`${form.first_name} ${form.last_name}`.trim() || (isNew ? 'Novo Passageiro' : form.full_name || 'Passageiro')}
          </h1>
          {!isNew && <p className="det-subtitle">editar</p>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {/* Status do cadastro no header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <label style={{ fontSize: 12, color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>Status:</label>
            <div style={{ width: 130 }}>
              <FormSelect
                value={form.status}
                onChange={v => set('status')({ target: { value: v } })}
                options={[
                  { value: 'active',   label: '● Ativo'    },
                  { value: 'inactive', label: '✕ Inativo'  },
                ]}
              />
            </div>
          </div>
          <div style={{ width: 1, height: 24, background: '#e2e8f0' }} />
          <button className="btn btn-outline" onClick={() => navigate('/passageiros')}>
            <Ic n="logout" s={13} />Voltar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <Ic n="check" s={13} />{saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="tabs">
        <button className={`tab-btn${tab === 'info' ? ' active' : ''}`}    onClick={() => setTab('info')}>Informações do cliente</button>
        <button className={`tab-btn${tab === 'docs' ? ' active' : ''}`}    onClick={() => setTab('docs')}>Documentos</button>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TAB: Informações do cliente
      ═══════════════════════════════════════════════════════════ */}
      {tab === 'info' && (
        <div className="det-card">

          {/* ── Dados do cliente ── */}
          <div className="section">
            <div className="section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Dados do cliente</span>
              <button
                type="button"
                onClick={() => setNotesOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '3px 10px', borderRadius: 6,
                  border: `1px solid ${form.notes?.trim() ? '#2e6db4' : '#e2e8f0'}`,
                  background: form.notes?.trim() ? '#eff6ff' : '#f8fafc',
                  color: form.notes?.trim() ? '#2e6db4' : '#94a3b8',
                  fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all .12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2e6db4'; e.currentTarget.style.color = '#2e6db4' }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = form.notes?.trim() ? '#2e6db4' : '#e2e8f0'
                  e.currentTarget.style.color = form.notes?.trim() ? '#2e6db4' : '#94a3b8'
                }}
              >
                <Ic n="edit" s={12} />
                {form.notes?.trim() ? 'Observações ●' : 'Observações'}
              </button>
            </div>

            {/* Linha 1: Agências (largura total) — picker com múltipla seleção */}
            <div style={{ marginBottom: 14 }}>
              <label className="fl">Agências</label>
              <AgencyPicker
                selectedIds={form.agencies ?? []}
                onChange={(ids) => { setForm((f) => ({ ...f, agencies: ids })); markDirty() }}
              />
            </div>

            {/* Linha 2: Toggles (esquerda) | CPF | Gênero */}
            <div className="grid3" style={{ marginBottom: 14 }}>

              {/* Toggles compactos lado a lado */}
              <div>
                <label className="fl">Opções</label>
                <div style={{ display: 'flex', gap: 18, paddingTop: 5 }}>
                  {[
                    { key: 'is_foreign',   label: 'Estrangeiro' },
                    { key: 'is_verified',  label: 'Verificado'  },
                    { key: 'is_guide',     label: 'Guia'        },
                    { key: 'receives_mail',label: 'Mala direta' },
                  ].map(({ key, label }) => (
                    <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{label}</span>
                      <Toggle checked={form[key]} onChange={setB(key)} />
                    </div>
                  ))}
                </div>
              </div>

              <F label="CPF">
                <div style={{ opacity: form.is_foreign ? 0.4 : 1, pointerEvents: form.is_foreign ? 'none' : 'auto', borderRadius: 8, boxShadow: fieldErrors.cpf && !form.is_foreign ? '0 0 0 2px #dc2626' : 'none' }}>
                  <CpfInput
                    value={form.cpf}
                    onChange={(v) => { set('cpf')({ target: { value: v } }) }}
                  />
                </div>
                {fieldErrors.cpf && !form.is_foreign && (
                  <p style={{ fontSize: 11, color: '#dc2626', margin: '3px 0 0', fontWeight: 500 }}>CPF obrigatório</p>
                )}
              </F>

              <F label="Gênero *">
                <div style={fieldErrors.gender ? { boxShadow:'0 0 0 2px #dc2626', borderRadius:8 } : {}}>
                  <GenderPicker
                    value={form.gender}
                    customValue={form.gender_custom}
                    onChange={(val, custom) => { setForm((f) => ({ ...f, gender: val, gender_custom: custom })); markDirty() }}
                  />
                </div>
                {fieldErrors.gender && <p style={{ fontSize:11, color:'#dc2626', margin:'3px 0 0', fontWeight:500 }}>Gênero obrigatório</p>}
              </F>
            </div>

            {/* Linha 3: Primeiro nome | Sobrenome | CPF não — nome, sobrenome e data */}
            <div className="grid3">
              <F label="Primeiro nome *">{fi('first_name', 'Primeiro nome')}</F>
              <F label="Sobrenome *">{fi('last_name', 'Sobrenome')}</F>
              <F label="Data de nascimento *">{fi('birth_date', '', 'date')}</F>
            </div>

            <div className="grid3">
              <F label="Idiomas falados">
                <LanguagePicker
                  nativeLang={form.native_language}
                  otherLangs={form.other_languages}
                  onChangeNative={(v) => { setForm((f) => ({ ...f, native_language: v })); markDirty() }}
                  onChangeOthers={(v) => { setForm((f) => ({ ...f, other_languages: v })); markDirty() }}
                />
              </F>
              <F label="Local de nascimento">
                <LocationPicker
                  value={form.birth_place}
                  onChange={setBirthPlace}
                />
              </F>
              <F label="Nacionalidade">
                <NationalityPicker
                  primary={form.nationality}
                  others={form.other_nationalities}
                  onChangePrimary={(v) => { setForm((f) => ({ ...f, nationality: v })); markDirty() }}
                  onChangeOthers={(v)  => { setForm((f) => ({ ...f, other_nationalities: v })); markDirty() }}
                />
              </F>
            </div>
          </div>

          {/* ── E-mail e Telefone ── */}
          <div className="section">
            <div className="section-title">E-mail e Telefone</div>
            <div className="grid3">
              <F label="E-mail *">{fi('email', 'email@exemplo.com', 'email')}</F>
              <F label="E-mail de emergência 1">{fi('email_emergency1', 'email@exemplo.com', 'email')}</F>
              <F label="E-mail de emergência 2">{fi('email_emergency2', 'email@exemplo.com', 'email')}</F>
            </div>
            <div className="grid3">
              <F label="Telefone *">
                <div style={fieldErrors.phone1 ? { boxShadow:'0 0 0 2px #dc2626', borderRadius:8 } : {}}>
                  <PhoneInput value={form.phone1} onChange={(v) => set('phone1')({ target: { value: v } })} />
                </div>
                {fieldErrors.phone1 && <p style={{ fontSize:11, color:'#dc2626', margin:'3px 0 0', fontWeight:500 }}>Telefone obrigatório</p>}
              </F>
              <F label="Contato de emergência 1">
                <PhoneInput value={form.phone2} onChange={(v) => set('phone2')({ target: { value: v } })} />
              </F>
              <F label="Contato de emergência 2">
                <PhoneInput value={form.mobile} onChange={(v) => set('mobile')({ target: { value: v } })} />
              </F>
            </div>
          </div>

          {/* ── Informações adicionais ── */}
          <div className="section">
            <div className="section-title">Informações adicionais</div>
            <div className="grid3">
              <F label="Profissão">
                <ProfessionPicker
                  value={form.profession}
                  onChange={(v) => { setForm((f) => ({ ...f, profession: v })); markDirty() }}
                />
              </F>
              <F label="Preferência de assento">
                <SeatPicker
                  seatType={form.seat_preference}
                  seatPos={form.seat_position}
                  flightClass={form.flight_class}
                  onChangeSeatType={(v)    => { setForm((f) => ({ ...f, seat_preference: v })); markDirty() }}
                  onChangeSeatPos={(v)     => { setForm((f) => ({ ...f, seat_position: v })); markDirty() }}
                  onChangeFlightClass={(v) => { setForm((f) => ({ ...f, flight_class: v })); markDirty() }}
                />
              </F>
              <F label="Tipo de alimentação">
                <DietPicker
                  value={form.diet_type}
                  notes={form.diet_notes}
                  onChange={(v)      => { setForm((f) => ({ ...f, diet_type: v })); markDirty() }}
                  onChangeNotes={(v) => { setForm((f) => ({ ...f, diet_notes: v })); markDirty() }}
                />
              </F>
            </div>
          </div>

          {/* ── Endereço ── */}
          <div className="section">
            <div className="section-title">Endereço</div>
            <div className="grid3">
              <F label="CEP *">
                <div className="cep-wrap">
                  <input
                    className="fi" value={form.cep ?? ''} onChange={set('cep')}
                    placeholder="00000-000"
                    style={fieldErrors.cep ? errStyle : {}}
                    onKeyDown={(e) => e.key === 'Enter' && lookupCep()}
                  />
                  <button className="cep-btn" onClick={lookupCep} disabled={cepLoading} title="Buscar CEP">
                    <Ic n="search" s={13}/>
                  </button>
                </div>
              </F>
              <F label="Endereço *">{fi('street', 'Rua, Av…')}</F>
              <F label="Número *">{fi('number', '0')}</F>
            </div>
            <div className="grid3">
              <F label="Complemento">{fi('complement', 'Apto, Sala…')}</F>
              <F label="Bairro *">{fi('neighborhood', '')}</F>
              <F label="Cidade *">{fi('city', '')}</F>
            </div>
            <div className="grid3">
              <F label="País / Estado *">
                <div style={fieldErrors.country ? { boxShadow:'0 0 0 2px #dc2626', borderRadius:8 } : {}}>
                  <CountryStatePicker
                    country={form.country}
                    state={form.state}
                    onChangeCountry={(v) => { setForm((f) => ({ ...f, country: v })); markDirty() }}
                    onChangeState={(v)   => { setForm((f) => ({ ...f, state: v })); markDirty() }}
                  />
                </div>
                {fieldErrors.country && <p style={{ fontSize:11, color:'#dc2626', margin:'3px 0 0', fontWeight:500 }}>País obrigatório</p>}
              </F>
            </div>
          </div>

        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TAB: Documentos
      ═══════════════════════════════════════════════════════════ */}
      {tab === 'docs' && (
        <DocumentsTab passengerId={id} isNew={isNew} />
      )}

      {/* ═══════════════════════════════════════════════════════════
          TAB: Listas de passageiros
      ═══════════════════════════════════════════════════════════ */}
    </div>

    {/* ── Popup de observações do passageiro ── */}

    {notesOpen && (
      <div
        onClick={(e) => { if (e.target === e.currentTarget) setNotesOpen(false) }}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(15,23,42,.45)',
          backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 400, padding: 20,
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: '#fff', borderRadius: 12, width: '100%', maxWidth: 500,
            boxShadow: '0 24px 64px rgba(0,0,0,.24)',
            animation: 'mIn .15s ease',
          }}
        >
          <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid #e2e8f0' }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>
              Observações do passageiro
            </p>
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
              Informações adicionais, preferências gerais ou anotações internas
            </p>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <textarea
              autoFocus
              value={form.notes ?? ''}
              onChange={set('notes')}
              rows={7}
              placeholder="Ex.: Cliente VIP. Prefere janelas à frente. Tem dificuldade de locomoção. Sempre viaja com a família..."
              style={{
                width: '100%', padding: '10px 12px',
                border: '1px solid #e2e8f0', borderRadius: 8,
                fontSize: 13, fontFamily: 'inherit', color: '#1e293b',
                outline: 'none', resize: 'vertical', lineHeight: 1.6,
                transition: 'border-color .12s',
              }}
              onFocus={(e) => e.target.style.borderColor = '#2e6db4'}
              onBlur={(e)  => e.target.style.borderColor = '#e2e8f0'}
            />
            <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 5, textAlign: 'right' }}>
              {(form.notes ?? '').length} caracteres
            </p>
          </div>
          <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between' }}>
            <button
              onClick={() => setForm((f) => ({ ...f, notes: '' }))}
              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Limpar
            </button>
            <button
              onClick={() => setNotesOpen(false)}
              style={{ padding: '7px 20px', borderRadius: 6, border: 'none', background: '#2e6db4', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#275fa0'}
              onMouseLeave={(e) => e.currentTarget.style.background = '#2e6db4'}
            >
              Confirmar
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
