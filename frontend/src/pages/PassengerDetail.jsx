import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import axios from 'axios'
import { passengersApi, documentsApi } from '../api'
import { Ic } from '../components/Icon'
import AgencyPicker from '../components/AgencyPicker'
import LocationPicker from '../components/LocationPicker'
import NationalityPicker from '../components/NationalityPicker'
import GenderPicker from '../components/GenderPicker'
import ProfessionPicker from '../components/ProfessionPicker'
import SeatPicker from '../components/SeatPicker'
import CountryStatePicker from '../components/CountryStatePicker'
import LanguagePicker from '../components/LanguagePicker'
import DietPicker from '../components/DietPicker'
import DocTypePicker, { DOC_TYPES } from '../components/DocTypePicker'

/* ── helpers ── */
const EMPTY = {
  first_name:'', last_name:'', full_name:'',
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

/* ── Documents tab ── */
function DocumentsTab({ passengerId, isNew }) {
  const [docs,       setDocs]       = useState([])
  const [loading,    setLoading]    = useState(false)
  const [deleting,   setDeleting]   = useState(null)
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

  const handleDelete = async (doc) => {
    if (!window.confirm(`Remover "${doc.display_name}"?`)) return
    setDeleting(doc.id)
    await documentsApi.remove(doc.id).catch(() => toast.error('Erro ao remover.'))
    toast.success('Documento removido.')
    setDeleting(null)
    load()
  }

  const handleDownload = async (doc) => {
    try {
      const r = await documentsApi.download(doc.id)
      const url = URL.createObjectURL(r.data)
      const a   = document.createElement('a')
      a.href = url; a.download = doc.original_name; a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Erro ao baixar documento.') }
  }

  const fmt = (d) => d
    ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'

  /* Calcula status de validade */
  const expiryStatus = (expiryDate) => {
    if (!expiryDate) return null
    const today = new Date(); today.setHours(0,0,0,0)
    const exp   = new Date(expiryDate + 'T00:00:00')
    const days  = Math.round((exp - today) / 86400000)
    if (days < 0)   return { label: 'Vencido',           color: '#dc2626', bg: '#fee2e2' }
    if (days <= 30) return { label: `Vence em ${days}d`, color: '#d97706', bg: '#fef3c7' }
    if (days <= 90) return { label: `Vence em ${days}d`, color: '#2563eb', bg: '#dbeafe' }
    return { label: fmt(expiryDate), color: '#64748b', bg: '#f1f5f9' }
  }

  /* Filtros */
  const filtered = docs.filter(doc => {
    const matchSearch = !search ||
      doc.display_name?.toLowerCase().includes(search.toLowerCase()) ||
      doc.doc_type_label?.toLowerCase().includes(search.toLowerCase())
    const matchType = typeFilter === 'all' || doc.doc_type === typeFilter
    const status    = expiryStatus(doc.expiry_date)
    const matchExpiry = expiryFilter === 'all'
      || (expiryFilter === 'expired'  && status?.label === 'Vencido')
      || (expiryFilter === 'soon'     && status && status.label !== 'Vencido' && doc.expiry_date && Math.round((new Date(doc.expiry_date + 'T00:00:00') - new Date()) / 86400000) <= 90)
      || (expiryFilter === 'none'     && !doc.expiry_date)
    return matchSearch && matchType && matchExpiry
  })

  /* Tipos únicos presentes nos documentos */
  const presentTypes = [...new Set(docs.map(d => d.doc_type))]

  const typeLabel = { passport:'Passaporte', rg:'Identidade', cnh:'CNH', visa:'Visto', birth_cert:'Certidão', residence:'Residência', other:'Outro' }

  return (
    <div className="det-card">
      <div className="section">

        {/* Header */}
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span>Documentos {docs.length > 0 && <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400 }}>({docs.length})</span>}</span>
          {!isNew && <DocTypePicker passengerId={passengerId} onUploaded={load} />}
          {isNew && (
            <span style={{ fontSize: 12, color: '#94a3b8', padding: '4px 10px', borderRadius: 6, border: '1px dashed #e2e8f0', background: '#fafafa' }}>
              Salve o passageiro para habilitar uploads
            </span>
          )}
        </div>

        {/* Busca + filtros */}
        {!isNew && docs.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Busca */}
            <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
              <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', display: 'flex' }}>
                <Ic n="search" s={13} />
              </span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar documento…"
                style={{ width: '100%', padding: '6px 10px 6px 29px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b' }}
                onFocus={e => e.target.style.borderColor = '#2e6db4'}
                onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>

            {/* Filtro por tipo */}
            {presentTypes.length > 1 && (
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#475569', background: '#fff', cursor: 'pointer' }}
              >
                <option value="all">Todos os tipos</option>
                {presentTypes.map(t => (
                  <option key={t} value={t}>{typeLabel[t] ?? t}</option>
                ))}
              </select>
            )}

            {/* Filtro por validade */}
            <select
              value={expiryFilter}
              onChange={e => setExpiryFilter(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#475569', background: '#fff', cursor: 'pointer' }}
            >
              <option value="all">Todas as validades</option>
              <option value="expired">Vencidos</option>
              <option value="soon">Vence em até 90 dias</option>
              <option value="none">Sem data de validade</option>
            </select>
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
              const typeInfo = DOC_TYPES.find(t => t.id === doc.doc_type) ?? DOC_TYPES[DOC_TYPES.length - 1]
              const expSt    = expiryStatus(doc.expiry_date)
              return (
                <div key={doc.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fafafa', transition: 'background .1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f6ff'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fafafa'}
                >
                  {/* Ícone */}
                  <span style={{ fontSize: 22, flexShrink: 0 }}>{typeInfo.icon}</span>

                  {/* Nome + tipo */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', margin: 0 }}>{doc.display_name}</p>
                    <p style={{ fontSize: 11.5, color: '#94a3b8', margin: 0, marginTop: 1 }}>
                      {doc.doc_number ? `Nº ${doc.doc_number} · ` : ''}{fmt(doc.uploaded_at)}
                    </p>
                    {doc.notes && <p style={{ fontSize: 11.5, color: '#64748b', margin: 0, marginTop: 1, fontStyle: 'italic' }}>{doc.notes}</p>}
                  </div>

                  {/* Validade */}
                  {expSt ? (
                    <span style={{ padding: '3px 9px', borderRadius: 10, fontSize: 11.5, fontWeight: 600, background: expSt.bg, color: expSt.color, flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {expSt.label}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11.5, color: '#cbd5e1', flexShrink: 0 }}>Sem validade</span>
                  )}

                  {/* Badge tipo */}
                  <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: `${typeInfo.color}15`, color: typeInfo.color, flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {doc.doc_type_label}
                  </span>

                  {/* Ações */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button onClick={() => handleDownload(doc)} title="Baixar"
                      style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer', transition: 'all .12s' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#2e6db4'; e.currentTarget.style.color = '#2e6db4' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#64748b' }}>
                      <Ic n="dl" s={13} />
                    </button>
                    <button onClick={() => handleDelete(doc)} disabled={deleting === doc.id} title="Remover"
                      style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', cursor: 'pointer', transition: 'all .12s', opacity: deleting === doc.id ? .5 : 1 }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#dc2626'; e.currentTarget.style.color = '#dc2626'; e.currentTarget.style.background = '#fee2e2' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = '#fff' }}>
                      <Ic n="trash" s={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Main component ── */
export default function PassengerDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const isNew    = id === 'novo'

  const [form,       setForm]       = useState({ ...EMPTY })
  const [loading,    setLoading]    = useState(!isNew)
  const [notesOpen,  setNotesOpen]  = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const [tab,        setTab]        = useState('info')
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
  const DATE_FIELDS = ['birth_date','rg_issue_date','passport_issue','passport_expiry','rne_expiry','rne_issue']

  const save = async () => {
    // Validação local — marca campos em vermelho
    const errs = {}
    const hasName = form.first_name?.trim() || form.last_name?.trim()
    if (!hasName) { errs.first_name = true; errs.last_name = true }
    if (!form.email?.trim()) errs.email = true
    if (Object.keys(errs).length) {
      setFieldErrors(errs)
      // Navega para a aba de informações se não estiver nela
      setTab('info')
      toast.error('Preencha os campos obrigatórios marcados em vermelho.')
      return
    }
    setFieldErrors({})
    setSaving(true)
    try {
      const genderValue = form.gender === 'O' ? (form.gender_custom?.trim() || 'O') : form.gender
      const { gender_custom, full_name, ...rest } = form  // full_name calculado pelo backend
      const payload = { ...rest, gender: genderValue }
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

  const fi = (k, placeholder, type = 'text') => (
    <input className="fi" type={type} value={form[k] ?? ''} onChange={set(k)}
      placeholder={placeholder || ''}
      style={fieldErrors[k] ? errStyle : {}} />
  )

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
        <div>
          <h1 className="det-title">
            {isNew ? 'Novo Passageiro' : (form.first_name || form.last_name ? `${form.first_name} ${form.last_name}`.trim() : form.full_name || 'Passageiro')}
          </h1>
          {!isNew && <p className="det-subtitle">editar</p>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Status do cadastro no header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <label style={{ fontSize: 12, color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>Status:</label>
            <select
              className="fs"
              style={{ width: 'auto', padding: '5px 10px', fontSize: 13 }}
              value={form.status}
              onChange={set('status')}
            >
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
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
        <button className={`tab-btn${tab === 'trips' ? ' active' : ''}`}   onClick={() => setTab('trips')}>Listas de passageiros</button>
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

              <F label="CPF">{fi('cpf', '000.000.000-00')}</F>

              <F label="Gênero">
                <GenderPicker
                  value={form.gender}
                  customValue={form.gender_custom}
                  onChange={(val, custom) => { setForm((f) => ({ ...f, gender: val, gender_custom: custom })); markDirty() }}
                />
              </F>
            </div>

            {/* Linha 3: Primeiro nome | Sobrenome | CPF não — nome, sobrenome e data */}
            <div className="grid3">
              <F label="Primeiro nome *">{fi('first_name', 'Primeiro nome')}</F>
              <F label="Sobrenome *">{fi('last_name', 'Sobrenome')}</F>
              <F label="Data de nascimento">{fi('birth_date', '', 'date')}</F>
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
              <F label="Telefone">{fi('phone1', '+55 (00) 00000-0000')}</F>
              <F label="Contato de emergência 1">{fi('phone2', '+55 (00) 00000-0000')}</F>
              <F label="Contato de emergência 2">{fi('mobile', '+55 (00) 00000-0000')}</F>
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
              <F label="CEP">
                <div className="cep-wrap">
                  <input
                    className="fi" value={form.cep ?? ''} onChange={set('cep')}
                    placeholder="00000-000"
                    onKeyDown={(e) => e.key === 'Enter' && lookupCep()}
                  />
                  <button className="cep-btn" onClick={lookupCep} disabled={cepLoading} title="Buscar CEP">
                    <Ic n="search" s={13}/>
                  </button>
                </div>
              </F>
              <F label="Endereço">{fi('street', 'Rua, Av…')}</F>
              <F label="Número">{fi('number', '0')}</F>
            </div>
            <div className="grid3">
              <F label="Complemento">{fi('complement', 'Apto, Sala…')}</F>
              <F label="Bairro">{fi('neighborhood', '')}</F>
              <F label="Cidade">{fi('city', '')}</F>
            </div>
            <div className="grid3">
              <F label="País / Estado">
                <CountryStatePicker
                  country={form.country}
                  state={form.state}
                  onChangeCountry={(v) => { setForm((f) => ({ ...f, country: v })); markDirty() }}
                  onChangeState={(v)   => { setForm((f) => ({ ...f, state: v })); markDirty() }}
                />
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
      {tab === 'trips' && (
        <div className="det-card">
          <div className="section">
            <div className="section-title">Viagens / listas</div>
            {isNew ? (
              <p style={{ color: '#94a3b8', fontSize: 14 }}>Salve o passageiro primeiro para ver as viagens vinculadas.</p>
            ) : (
              <p style={{ color: '#94a3b8', fontSize: 14 }}>Histórico de viagens em breve.</p>
            )}
          </div>
        </div>
      )}
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
