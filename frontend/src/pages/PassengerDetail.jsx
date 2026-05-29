import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import axios from 'axios'
import { passengersApi, agenciesApi } from '../api'
import { Ic } from '../components/Icon'

/* ── helpers ── */
const EMPTY = {
  first_name:'', last_name:'', full_name:'',
  email:'', birth_date:'', birth_place:'', nationality:'BRASILEIRA',
  gender:'', gender_custom:'', profession:'', is_foreign:false, is_verified:false, is_guide:false,
  agency:null,
  cpf:'',
  phone1:'', phone2:'', mobile:'',
  seat_preference:'', diet_type:'', receives_mail:false,
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

/* ── Main component ── */
export default function PassengerDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const isNew    = id === 'novo'

  const [form,     setForm]     = useState({ ...EMPTY })
  const [agencies, setAgencies] = useState([])
  const [loading,  setLoading]  = useState(!isNew)
  const [saving,   setSaving]   = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const [tab, setTab] = useState('info')

  /* load passenger data */
  useEffect(() => {
    agenciesApi.list().then((r) => setAgencies(r.data.results ?? r.data)).catch(() => {})

    if (!isNew) {
      passengersApi.get(id)
        .then((r) => setForm({ ...EMPTY, ...r.data }))
        .catch(() => { toast.error('Passageiro não encontrado.'); navigate('/passageiros') })
        .finally(() => setLoading(false))
    }
  }, [id])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setB = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))

  /* CEP lookup via ViaCEP */
  const lookupCep = async () => {
    const cep = form.cep.replace(/\D/g, '')
    if (cep.length !== 8) { toast.error('CEP inválido.'); return }
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
  const save = async () => {
    if (!form.full_name?.trim()) { toast.error('Nome é obrigatório.'); return }
    if (!form.email?.trim())     { toast.error('E-mail é obrigatório.'); return }
    setSaving(true)
    try {
      const genderValue = form.gender === 'O' ? (form.gender_custom?.trim() || 'O') : form.gender
      const { gender_custom, ...rest } = form
      const payload = { ...rest, gender: genderValue, agency: form.agency || null }
      if (isNew) {
        const r = await passengersApi.create(payload)
        toast.success('Passageiro criado.')
        navigate(`/passageiros/${r.data.id}`)
      } else {
        await passengersApi.update(id, payload)
        toast.success('Passageiro salvo.')
      }
    } catch (e) {
      const msg = e.response?.data?.email?.[0] ?? 'Erro ao salvar.'
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

  const fi = (k, placeholder, type = 'text') => (
    <input className="fi" type={type} value={form[k] ?? ''} onChange={set(k)} placeholder={placeholder || ''} />
  )

  const fs = (k, children) => (
    <select className="fs" value={form[k] ?? ''} onChange={set(k)}>{children}</select>
  )

  return (
    <div>
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
            <div className="section-title">Dados do cliente</div>

            {/* Agências (esquerda) + Toggles compactos (direita) */}
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <label className="fl">Agências</label>
                <select className="fs" value={form.agency ?? ''} onChange={(e) => setForm((f) => ({ ...f, agency: e.target.value || null }))}>
                  <option value="">— Nenhuma —</option>
                  {agencies.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 22, flexShrink: 0, paddingBottom: 6 }}>
                {[
                  { key: 'is_foreign',  label: 'Estrangeiro'        },
                  { key: 'is_verified', label: 'Cad. verificado'    },
                  { key: 'is_guide',    label: 'Guia acomp.'        },
                ].map(({ key, label }) => (
                  <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: '#64748b', whiteSpace: 'nowrap' }}>{label}</span>
                    <Toggle checked={form[key]} onChange={setB(key)} />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid3">
              <F label="CPF">{fi('cpf', '000.000.000-00')}</F>
              <F label="Primeiro nome *">{fi('first_name', 'Primeiro nome')}</F>
              <F label="Sobrenome *">{fi('last_name', 'Sobrenome')}</F>
            </div>

            <div className="grid3">
              <F label="Data de nascimento">{fi('birth_date', '', 'date')}</F>
            </div>

            {/* Gênero — seletor de botões */}
            <div style={{ marginBottom: 14 }}>
              <label className="fl">Gênero</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                {[
                  { val: 'F', label: 'Feminino' },
                  { val: 'M', label: 'Masculino' },
                  { val: 'O', label: 'Outro' },
                ].map(({ val, label }) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, gender: val, gender_custom: val !== 'O' ? '' : f.gender_custom }))}
                    style={{
                      padding: '6px 18px',
                      borderRadius: 999,
                      border: `1px solid ${form.gender === val ? '#2e6db4' : '#e2e8f0'}`,
                      background: form.gender === val ? '#2e6db4' : '#fff',
                      color: form.gender === val ? '#fff' : '#475569',
                      fontSize: 13,
                      fontWeight: form.gender === val ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all .12s',
                      fontFamily: 'inherit',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {form.gender === 'O' && (
                <input
                  className="fi"
                  style={{ marginTop: 8, maxWidth: 280 }}
                  value={form.gender_custom ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, gender_custom: e.target.value }))}
                  placeholder="Digite o gênero…"
                  autoFocus
                />
              )}
            </div>

            <div className="grid3">
              <F label="E-mail *">{fi('email', 'email@exemplo.com', 'email')}</F>
              <F label="Local de nascimento">{fi('birth_place', 'Cidade')}</F>
              <F label="Nacionalidade">{fi('nationality', 'BRASILEIRA')}</F>
            </div>
          </div>

          {/* ── Telefones ── */}
          <div className="section">
            <div className="section-title">Telefones</div>
            <div className="grid3">
              <F label="Telefone">{fi('phone1', '+55 (00) 0000-0000')}</F>
              <F label="Telefone">{fi('phone2', '+55 (00) 0000-0000')}</F>
              <F label="Celular">{fi('mobile', '+55 (00) 00000-0000')}</F>
            </div>
          </div>

          {/* ── Informações adicionais ── */}
          <div className="section">
            <div className="section-title">Informações adicionais</div>
            <div className="grid3">
              <F label="Profissão">{fi('profession', 'Ex.: Médico')}</F>
              <F label="Preferência de assento">
                {fs('seat_preference',
                  <>
                    <option value="">Nada selecionado</option>
                    <option value="corredor">Corredor</option>
                    <option value="janela">Janela</option>
                    <option value="meio">Meio</option>
                  </>
                )}
              </F>
              <F label="Tipo de alimentação">
                {fs('diet_type',
                  <>
                    <option value="">Nada selecionado</option>
                    <option value="standard">Padrão</option>
                    <option value="vegetarian">Vegetariano</option>
                    <option value="vegan">Vegano</option>
                    <option value="gluten_free">Sem glúten</option>
                    <option value="lactose_free">Sem lactose</option>
                    <option value="kosher">Kosher</option>
                    <option value="halal">Halal</option>
                  </>
                )}
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
                    placeholder="00000-000" maxLength={9}
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
              <F label="Estado">
                {fs('state',
                  <>
                    <option value="">— UF —</option>
                    {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </>
                )}
              </F>
              <F label="País">{fi('country', 'Brasil')}</F>
              <F label="Receber mala direta impressa?">
                <div style={{ marginTop: 6 }}>
                  <Toggle checked={form.receives_mail} onChange={setB('receives_mail')} />
                </div>
              </F>
            </div>
          </div>

          {/* ── Observações ── */}
          <div className="section">
            <div className="section-title">Observações</div>
            <textarea
              className="fi" rows={3}
              style={{ resize: 'vertical', width: '100%' }}
              value={form.notes ?? ''} onChange={set('notes')}
              placeholder="Informações adicionais sobre o passageiro…"
            />
          </div>

        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TAB: Documentos
      ═══════════════════════════════════════════════════════════ */}
      {tab === 'docs' && (
        <div className="det-card">
          <div className="section">
            <div className="section-title">Documentos</div>
            <p style={{ color: '#94a3b8', fontSize: 14 }}>Upload de documentos em breve.</p>
          </div>
        </div>
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
  )
}
