import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import toast from 'react-hot-toast'
import { agenciesApi } from '../api'
import { Ic } from '../components/Icon'
import PhoneInput from '../components/PhoneInput'
import CnpjInput from '../components/CnpjInput'
import CpfInput from '../components/CpfInput'
import CountryStatePicker from '../components/CountryStatePicker'
import FormSelect from '../components/FormSelect'
import usePersistedTab from '../hooks/usePersistedTab'

const AGENCY_TYPE_OPTS = [
  { value: 'agencia',       label: 'Agência'        },
  { value: 'representante', label: 'Representante'  },
  { value: 'operadora',     label: 'Operadora'      },
  { value: 'parceiro',      label: 'Parceiro'       },
  { value: 'outro',         label: 'Outro'          },
]
const PERSON_TYPE_OPTS = [
  { value: 'juridica', label: 'Jurídica' },
  { value: 'fisica',   label: 'Física'   },
]
const STATUS_OPTS = [
  { value: 'active',   label: '● Ativa'    },
  { value: 'pending',  label: '○ Pendente' },
  { value: 'inactive', label: '✕ Inativa'  },
]
const PIX_TYPE_OPTS = [
  { value: '',          label: 'Selecione o tipo…' },
  { value: 'cpf',       label: 'CPF'               },
  { value: 'cnpj',      label: 'CNPJ'              },
  { value: 'email',     label: 'E-mail'            },
  { value: 'telefone',  label: 'Telefone'          },
  { value: 'aleatorio', label: 'Chave aleatória'   },
]

const EMPTY = {
  agency_type: 'agencia', person_type: 'juridica', status: 'active',
  cnpj: '', cpf: '', company_name: '', name: '', state_registration: '', municipal_registration: '',
  responsible: '', phone: '', mobile: '', email: '', website: '',
  commission_rate: '', cep: '', street: '', number: '', complement: '',
  neighborhood: '', city: '', state: '', country: 'Brasil',
  receives_mail: false, use_andes_banking: false,
  pix_key_type: '', pix_key: '', notes: '',
}

const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome'

/* ── Toggle ── */
function Toggle({ checked, onChange }) {
  return (
    <label className="toggle-wrap">
      <span className="toggle">
        <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
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

export default function AgencyDetail() {
  const { id }         = useParams()
  const navigate       = useNavigate()
  const [searchParams] = useSearchParams()
  const isNew          = id === 'nova'

  const [form,       setForm]       = useState(() => {
    if (isNew) {
      const cnpj = searchParams.get('cnpj') || ''
      return { ...EMPTY, cnpj }
    }
    return { ...EMPTY }
  })
  const [loading,    setLoading]    = useState(!isNew)
  const [saving,     setSaving]     = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const [cnpjLoading,setCnpjLoading]= useState(false)
  const [isDirty,     setIsDirty]    = useState(false)
  const [notesOpen,   setNotesOpen]  = useState(false)
  const [fieldErrors, setFieldErrors]= useState({})

  useEffect(() => {
    if (!isNew) {
      agenciesApi.get(id)
        .then(r => setForm({ ...EMPTY, ...r.data }))
        .catch(() => { toast.error('Agência não encontrada.'); navigate('/agencias') })
        .finally(() => setLoading(false))
    }
  }, [id])

  /* Auto-busca dados do CNPJ quando vem do popup de criação */
  useEffect(() => {
    const cnpjParam = searchParams.get('cnpj')
    if (isNew && cnpjParam && cnpjParam.replace(/\D/g,'').length === 14) {
      // lookupCnpj está definido abaixo mas só é chamado após a renderização
      // eslint-disable-next-line
      lookupCnpj(cnpjParam)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set   = (k) => (e) => { setForm(f => ({ ...f, [k]: e.target.value })); setIsDirty(true) }
  const setB  = (k) => (v)  => { setForm(f => ({ ...f, [k]: v })); setIsDirty(true) }
  const setV  = (k, v)      => { setForm(f => ({ ...f, [k]: v })); setIsDirty(true) }

  /* Avisa ao recarregar/fechar com alterações não salvas */
  useEffect(() => {
    const handler = (e) => {
      if (isDirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  /* Auto-limpa erros quando o campo é preenchido */
  useEffect(() => {
    if (!Object.keys(fieldErrors).length) return
    setFieldErrors(prev => {
      const next = { ...prev }
      let changed = false
      for (const k of Object.keys(next)) {
        const v = form[k]
        const filled = v !== null && v !== undefined &&
          (typeof v !== 'string' || v.replace(/\D/g,'').length > 0 || v.trim().length > 0)
        if (filled) { delete next[k]; changed = true }
      }
      return changed ? next : prev
    })
  }, [form])

  /* Busca CEP */
  const lookupCep = async () => {
    const cep = form.cep.replace(/\D/g, '')
    if (cep.length !== 8) return
    setCepLoading(true)
    try {
      const r = await axios.get(`https://viacep.com.br/ws/${cep}/json/`)
      if (!r.data.erro) {
        setForm(f => ({
          ...f,
          street:       r.data.logradouro || f.street,
          neighborhood: r.data.bairro     || f.neighborhood,
          city:         r.data.localidade || f.city,
          state:        r.data.uf         || f.state,
          country:      'Brasil',
        }))
        setIsDirty(true)
        toast.success('Endereço preenchido.')
      } else toast.error('CEP não encontrado.')
    } catch { toast.error('Erro ao buscar CEP.') }
    finally  { setCepLoading(false) }
  }

  /* Aplica máscara de telefone nos dígitos retornados pela API */
  const maskPhone = (digits) => {
    const d = (digits || '').replace(/\D/g, '')
    if (d.length === 8)  return `${d.slice(0,4)}-${d.slice(4)}`
    if (d.length === 9)  return `${d.slice(0,5)}-${d.slice(5)}`
    if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
    if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
    if (d.length === 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`
    if (d.length === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`
    return d
  }

  /* Busca CNPJ via BrasilAPI — aceita CNPJ por parâmetro ou usa form.cnpj */
  const lookupCnpj = async (cnpjOverride) => {
    const cnpj = (cnpjOverride ?? form.cnpj).replace(/\D/g, '')
    if (cnpj.length !== 14) {
      if (!cnpjOverride) toast.error('CNPJ incompleto (14 dígitos).')
      return
    }
    setCnpjLoading(true)
    try {
      const r = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`)
      const d = r.data
      // BrasilAPI retorna ddd_telefone_1 com os dígitos todos juntos (ex: "5133674033")
      const rawPhone = d.ddd_telefone_1 || d.telefone || ''
      setForm(f => ({
        ...f,
        company_name: d.razao_social           || f.company_name,
        name:         d.nome_fantasia           || f.name,
        email:        d.email                   || f.email,
        phone:        rawPhone ? maskPhone(rawPhone) : f.phone,
        cep:          d.cep?.replace(/\D/g,'')  || f.cep,
        street:       d.logradouro              || f.street,
        number:       d.numero                  || f.number,
        complement:   d.complemento             || f.complement,
        neighborhood: d.bairro                  || f.neighborhood,
        city:         d.municipio               || f.city,
        // CountryStatePicker armazena estado como código UF (ex: 'RS') e país por nome
        state:        d.uf                      || f.state,
        country:      d.uf ? 'Brasil'           : f.country,
      }))
      setIsDirty(true)
      toast.success('Dados preenchidos via CNPJ.')
    } catch { toast.error('CNPJ não encontrado ou inválido.') }
    finally  { setCnpjLoading(false) }
  }

  const isFisica = form.person_type === 'fisica'

  const REQUIRED_LABELS = {
    cnpj:            'CNPJ',
    cpf:             'CPF',
    company_name:    'Razão social',
    name:            'Nome',
    email:           'E-mail',
    phone:           'Telefone',
    commission_rate: 'Comissão',
  }

  const save = async () => {
    const errs = {}
    if (isFisica) {
      if (!form.cpf?.replace(/\D/g,''))    errs.cpf          = true
      if (!form.name?.trim())              errs.name         = true
    } else {
      if (!form.cnpj?.replace(/\D/g,''))   errs.cnpj         = true
      if (!form.company_name?.trim())      errs.company_name = true
    }
    if (!form.email?.trim())                 errs.email           = true
    if (!form.phone?.replace(/\D/g,''))      errs.phone           = true
    if (!form.commission_rate && form.commission_rate !== 0) errs.commission_rate = true

    if (Object.keys(errs).length) {
      setFieldErrors(errs)
      const missing = Object.keys(errs)
        .map(k => REQUIRED_LABELS[k] || k)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(', ')
      toast.error(`Campos obrigatórios em branco: ${missing}`, { duration: 5000 })
      setTimeout(() => {
        const first = document.querySelector('[data-err="true"] input, [data-err="true"] .fi, [data-err="true"]')
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
      return
    }
    setFieldErrors({})
    setSaving(true)
    try {
      // commission_rate vazio → null (evita erro no DecimalField do backend)
      const payload = {
        ...form,
        commission_rate: form.commission_rate !== '' ? form.commission_rate : null,
      }
      if (isNew) {
        const r = await agenciesApi.create(payload)
        toast.success('Agência criada com sucesso.')
        navigate(`/agencias/${r.data.id}`, { replace: true })
      } else {
        await agenciesApi.update(id, payload)
        toast.success('Agência salva.')
      }
      setIsDirty(false)
    } catch (err) {
      const errData = err.response?.data
      const msg = errData?.detail
        ?? (typeof errData === 'object' ? Object.entries(errData).map(([k,v]) => `${k}: ${Array.isArray(v)?v[0]:v}`).join(' | ') : null)
        ?? 'Erro ao salvar.'
      toast.error(msg, { duration: 6000 })
    } finally { setSaving(false) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Carregando…</div>

  const errStyle = { borderColor: '#dc2626', background: '#fef2f2' }

  const fi = (k, placeholder = '') => (
    <div data-err={fieldErrors[k] ? 'true' : undefined}>
      <input className="fi" value={form[k] ?? ''} onChange={set(k)}
        placeholder={placeholder} style={fieldErrors[k] ? errStyle : {}} />
      {fieldErrors[k] && <p style={{ fontSize:11, color:'#dc2626', margin:'3px 0 0', fontWeight:500 }}>Campo obrigatório</p>}
    </div>
  )
  const fs = (k, children) => (
    <select className="fs" value={form[k] ?? ''} onChange={set(k)}>{children}</select>
  )

  return (
    <>
      {/* ── Header ── */}
      <div className="ph">
        <div>
          <h1 className="ph-title" style={{ marginBottom: 2 }}>
            {(form.company_name || form.name)?.trim() || (isNew ? 'Nova agência' : 'Agência')}
          </h1>
          {!isNew && <button className="link-btn" onClick={() => navigate('/agencias')} style={{ fontSize: 12, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>editar</button>}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>Status:</span>
            <div style={{ width: 140 }}>
              <FormSelect
                value={form.status}
                onChange={v => { setForm(f => ({ ...f, status: v })); setIsDirty(true) }}
                options={STATUS_OPTS}
              />
            </div>
          </div>
          <button className="btn btn-outline" onClick={() => navigate('/agencias')}>
            <Ic n="logout" s={13} style={{ transform: 'rotate(180deg)' }} /> Voltar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <Ic n="check" s={13} /> {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>

      <div className="det-card">
      {/* ── Dados do agente ── */}
      <div className="section">
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Dados do agente</span>
          <button
            type="button"
            onClick={() => setNotesOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 6,
              border: `1px solid ${form.notes?.trim() ? '#2e6db4' : '#e2e8f0'}`,
              background: form.notes?.trim() ? '#eff6ff' : '#f8fafc',
              color: form.notes?.trim() ? '#2e6db4' : '#94a3b8',
              fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#2e6db4'; e.currentTarget.style.color = '#2e6db4' }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = form.notes?.trim() ? '#2e6db4' : '#e2e8f0'
              e.currentTarget.style.color = form.notes?.trim() ? '#2e6db4' : '#94a3b8'
            }}
          >
            <Ic n="edit" s={12} />
            {form.notes?.trim() ? 'Observações ●' : 'Observações'}
          </button>
        </div>
        {/* grid3 — alinha com todas as linhas abaixo */}
        <div className="grid3">
          {/* Col 1: dois toggles lado a lado */}
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end' }}>
            <div>
              <label className="fl">Mala direta impressa</label>
              <Toggle checked={form.receives_mail} onChange={setB('receives_mail')} />
            </div>
            <div>
              <label className="fl">Dados bancários Uneworld</label>
              <Toggle checked={form.use_andes_banking} onChange={setB('use_andes_banking')} />
            </div>
          </div>
          {/* Col 2 */}
          <F label="Tipo de cadastro">
            <FormSelect value={form.agency_type} onChange={v => { setForm(f => ({...f, agency_type: v})); setIsDirty(true) }} options={AGENCY_TYPE_OPTS} />
          </F>
          {/* Col 3 */}
          <F label="Tipo de pessoa">
            <FormSelect value={form.person_type} onChange={v => { setForm(f => ({...f, person_type: v})); setIsDirty(true) }} options={PERSON_TYPE_OPTS} />
          </F>
        </div>

        <div className="grid3">
          <F label="CNPJ *">
            <div data-err={fieldErrors.cnpj ? 'true' : undefined}>
            {isFisica ? (
              /* Pessoa Física: CPF */
              <div data-err={fieldErrors.cpf ? 'true' : undefined}
                style={fieldErrors.cpf ? { borderRadius: 8, boxShadow: '0 0 0 2px #dc2626' } : {}}>
                <CpfInput value={form.cpf}
                  onChange={v => { setForm(f => ({ ...f, cpf: v })); setIsDirty(true) }} />
                {fieldErrors.cpf && <p style={{ fontSize:11, color:'#dc2626', margin:'3px 0 0', fontWeight:500 }}>Campo obrigatório</p>}
              </div>
            ) : (
              /* Pessoa Jurídica: CNPJ com busca */
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ flex: 1, ...(fieldErrors.cnpj ? { outline: '2px solid #dc2626', borderRadius: 8 } : {}) }}>
                  <CnpjInput value={form.cnpj} onChange={v => { setForm(f => ({ ...f, cnpj: v })); setIsDirty(true) }} />
                </div>
                <button className="cep-btn" onClick={() => lookupCnpj()} disabled={cnpjLoading} title="Buscar dados pelo CNPJ" style={{ flexShrink: 0 }}>
                  <Ic n="search" s={13}/>
                </button>
              </div>
            )}
            {fieldErrors.cnpj && !isFisica && <p style={{ fontSize:11, color:'#dc2626', margin:'3px 0 0', fontWeight:500 }}>Campo obrigatório</p>}
            </div>
          </F>

          {/* Jurídica: Razão social + Nome fantasia | Física: só Nome */}
          {isFisica ? (
            <F label="Nome *" col={2}>{fi('name', 'Nome completo')}</F>
          ) : (
            <>
              <F label="Razão social *">{fi('company_name')}</F>
              <F label="Nome fantasia">{fi('name')}</F>
            </>
          )}
        </div>

        {/* Inscrições — apenas para Jurídica */}
        {!isFisica && (
        <div className="grid3">
          <F label="Inscrição estadual">{fi('state_registration')}</F>
          <F label="Inscrição municipal">{fi('municipal_registration')}</F>
          <F label="Responsável">{fi('responsible')}</F>
        </div>
        )}

        <div className="grid3">
          <F label="Telefone *">
            <div data-err={fieldErrors.phone ? 'true' : undefined}>
              <div style={fieldErrors.phone ? { borderRadius:8, boxShadow:'0 0 0 2px #dc2626' } : {}}>
                <PhoneInput value={form.phone} onChange={v => { setForm(f => ({ ...f, phone: v })); setIsDirty(true) }} />
              </div>
              {fieldErrors.phone && <p style={{ fontSize:11, color:'#dc2626', margin:'3px 0 0', fontWeight:500 }}>Campo obrigatório</p>}
            </div>
          </F>
          <F label="Celular">
            <PhoneInput value={form.mobile} onChange={v => { setForm(f => ({ ...f, mobile: v })); setIsDirty(true) }} />
          </F>
          <F label="E-mail *">{fi('email', 'email@exemplo.com')}</F>
        </div>

        <div className="grid3">
          <F label="Comissão *">
            <div style={{ position: 'relative' }} data-err={fieldErrors.commission_rate ? 'true' : undefined}>
              <input className="fi" type="number" min="0" max="100" step="0.01"
                value={form.commission_rate ?? ''} onChange={set('commission_rate')}
                placeholder="0,00"
                style={{ paddingRight: 28, ...(fieldErrors.commission_rate ? errStyle : {}) }} />
              <span style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                fontSize: 13, fontWeight: 600, color: form.commission_rate ? '#2e6db4' : '#94a3b8',
                pointerEvents: 'none', userSelect: 'none',
              }}>%</span>
            </div>
          </F>
          <F label="Website" col={2}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="fi" value={form.website ?? ''} onChange={set('website')}
                placeholder="https://www.exemplo.com.br" style={{ flex: 1 }} />
              {form.website?.trim() && (
                <a
                  href={form.website.startsWith('http') ? form.website : `https://${form.website}`}
                  target="_blank" rel="noopener noreferrer"
                  title="Abrir site"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                    border: '1.5px solid #2e6db4', background: '#eff6ff', color: '#2e6db4',
                    fontSize: 16, textDecoration: 'none', transition: 'all .12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#2e6db4'; e.currentTarget.style.color = '#fff' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.color = '#2e6db4' }}
                >
                  ↗
                </a>
              )}
            </div>
          </F>
        </div>
      </div>

      {/* ── Endereço ── */}
      <div className="section">
        <div className="section-title">Endereço</div>
        <div className="grid3">
          <F label="CEP">
            <div className="cep-wrap">
              <input className="fi" value={form.cep ?? ''} onChange={set('cep')} placeholder="00000-000"
                onKeyDown={e => e.key === 'Enter' && lookupCep()} />
              <button className="cep-btn" onClick={lookupCep} disabled={cepLoading} title="Buscar CEP">
                <Ic n="search" s={13}/>
              </button>
            </div>
          </F>
          <F label="Endereço">{fi('street', 'Rua, Av…')}</F>
          <F label="Número">{fi('number')}</F>
        </div>

        <div className="grid3">
          <F label="Complemento">{fi('complement', 'Apto, Sala…')}</F>
          <F label="Bairro">{fi('neighborhood')}</F>
          <F label="Cidade">{fi('city')}</F>
        </div>

        <div className="grid3">
          <F label="País / Estado">
            <CountryStatePicker
              country={form.country}
              state={form.state}
              onChangeCountry={v => { setForm(f => ({ ...f, country: v })); setIsDirty(true) }}
              onChangeState={v   => { setForm(f => ({ ...f, state: v }));   setIsDirty(true) }}
            />
          </F>
        </div>

      </div>

      {/* ── Dados PIX ── */}
      <div className="section">
        <div className="section-title">Dados PIX</div>
        <div className="grid3">
          <F label="Tipo de chave PIX">
            <FormSelect value={form.pix_key_type} onChange={v => { setForm(f => ({...f, pix_key_type: v})); setIsDirty(true) }} options={PIX_TYPE_OPTS} />
          </F>
          <F label="Chave PIX" col={2}>{fi('pix_key')}</F>
        </div>
      </div>
      </div>{/* fim det-card */}

    {/* ── Popup de Observações ── */}
      {notesOpen && (
        <div onClick={e => { if (e.target === e.currentTarget) setNotesOpen(false) }}
          style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:400, padding:20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:500, boxShadow:'0 24px 64px rgba(0,0,0,.24)', animation:'mIn .15s ease' }}>
            <div style={{ padding:'16px 20px 14px', borderBottom:'1px solid #e2e8f0' }}>
              <p style={{ fontSize:14, fontWeight:600, color:'#1e293b', margin:0 }}>Observações da agência</p>
              <p style={{ fontSize:12, color:'#94a3b8', marginTop:3 }}>Informações adicionais, preferências ou anotações internas</p>
            </div>
            <div style={{ padding:'16px 20px' }}>
              <textarea
                autoFocus
                value={form.notes ?? ''}
                onChange={set('notes')}
                rows={7}
                placeholder="Ex.: Agência preferencial para grupos. Condições especiais de comissão negociadas..."
                style={{ width:'100%', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, fontFamily:'inherit', color:'#1e293b', outline:'none', resize:'vertical', lineHeight:1.6, transition:'border-color .12s', boxSizing:'border-box' }}
                onFocus={e => e.target.style.borderColor = '#2e6db4'}
                onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
              />
              <p style={{ fontSize:11, color:'#94a3b8', marginTop:5, textAlign:'right' }}>
                {(form.notes ?? '').length} caracteres
              </p>
            </div>
            <div style={{ padding:'12px 20px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'flex-end', gap:10 }}>
              <button onClick={() => setNotesOpen(false)}
                style={{ padding:'7px 16px', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
                Fechar
              </button>
              <button onClick={() => setNotesOpen(false)}
                style={{ padding:'7px 18px', borderRadius:6, border:'none', background:'#2e6db4', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
