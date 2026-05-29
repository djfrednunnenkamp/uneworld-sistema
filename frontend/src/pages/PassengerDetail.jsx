import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import axios from 'axios'
import { passengersApi } from '../api'
import { Ic } from '../components/Icon'
import AgencyPicker from '../components/AgencyPicker'
import LocationPicker from '../components/LocationPicker'
import CountryPicker from '../components/CountryPicker'
import GenderPicker from '../components/GenderPicker'
import ProfessionPicker from '../components/ProfessionPicker'
import SeatPicker from '../components/SeatPicker'
import DietPicker from '../components/DietPicker'

/* ── helpers ── */
const EMPTY = {
  first_name:'', last_name:'', full_name:'',
  email:'', birth_date:'', birth_place:'', nationality:'BRASILEIRA',
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

/* ── Main component ── */
export default function PassengerDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const isNew    = id === 'novo'

  const [form,    setForm]    = useState({ ...EMPTY })
  const [loading, setLoading] = useState(!isNew)
  const [saving,   setSaving]   = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const [tab, setTab] = useState('info')

  /* load passenger data */
  useEffect(() => {
    if (!isNew) {
      passengersApi.get(id)
        .then((r) => setForm({ ...EMPTY, ...r.data, agencies: r.data.agencies ?? [] }))
        .catch(() => { toast.error('Passageiro não encontrado.'); navigate('/passageiros') })
        .finally(() => setLoading(false))
    }
  }, [id])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setB = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))

  /* Auto-preenche nacionalidade a partir do local de nascimento */
  const setBirthPlace = (v) => {
    const country = v ? v.split(', ').pop() : ''
    setForm((f) => ({
      ...f,
      birth_place: v,
      ...(country ? { nationality: country } : {}),
    }))
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
  const save = async () => {
    if (!form.full_name?.trim()) { toast.error('Nome é obrigatório.'); return }
    if (!form.email?.trim())     { toast.error('E-mail é obrigatório.'); return }
    setSaving(true)
    try {
      const genderValue = form.gender === 'O' ? (form.gender_custom?.trim() || 'O') : form.gender
      const { gender_custom, ...rest } = form
      const payload = { ...rest, gender: genderValue }
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

            {/* Linha 1: Agências (largura total) — picker com múltipla seleção */}
            <div style={{ marginBottom: 14 }}>
              <label className="fl">Agências</label>
              <AgencyPicker
                selectedIds={form.agencies ?? []}
                onChange={(ids) => setForm((f) => ({ ...f, agencies: ids }))}
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
                  onChange={(val, custom) => setForm((f) => ({ ...f, gender: val, gender_custom: custom }))}
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
              <F label="E-mail *">{fi('email', 'email@exemplo.com', 'email')}</F>
              <F label="Local de nascimento">
                <LocationPicker
                  value={form.birth_place}
                  onChange={setBirthPlace}
                />
              </F>
              <F label="Nacionalidade">
                <CountryPicker
                  value={form.nationality}
                  onChange={(v) => setForm((f) => ({ ...f, nationality: v, _autoNationality: '' }))}
                />
              </F>
            </div>
          </div>

          {/* ── Telefones ── */}
          <div className="section">
            <div className="section-title">Telefones</div>
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
                  onChange={(v) => setForm((f) => ({ ...f, profession: v }))}
                />
              </F>
              <F label="Preferência de assento">
                <SeatPicker
                  seatType={form.seat_preference}
                  seatPos={form.seat_position}
                  flightClass={form.flight_class}
                  onChangeSeatType={(v)    => setForm((f) => ({ ...f, seat_preference: v }))}
                  onChangeSeatPos={(v)     => setForm((f) => ({ ...f, seat_position: v }))}
                  onChangeFlightClass={(v) => setForm((f) => ({ ...f, flight_class: v }))}
                />
              </F>
              <F label="Tipo de alimentação">
                <DietPicker
                  value={form.diet_type}
                  notes={form.diet_notes}
                  onChange={(v)      => setForm((f) => ({ ...f, diet_type: v }))}
                  onChangeNotes={(v) => setForm((f) => ({ ...f, diet_notes: v }))}
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
