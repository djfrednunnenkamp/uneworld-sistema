import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import toast from 'react-hot-toast'
import { agenciesApi } from '../api'
import { Ic } from '../components/Icon'
import usePersistedTab from '../hooks/usePersistedTab'

const EMPTY = {
  agency_type: 'agencia', person_type: 'juridica', status: 'active',
  cnpj: '', company_name: '', name: '', state_registration: '', municipal_registration: '',
  responsible: '', phone: '', mobile: '', email: '', website: '',
  commission_rate: '', cep: '', street: '', number: '', complement: '',
  neighborhood: '', city: '', state: '', country: 'Brasil',
  receives_mail: false, use_andes_banking: false,
  pix_key_type: '', pix_key: '', notes: '',
}

const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome'
const STATES_BR = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
]

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
  const { id }    = useParams()
  const navigate  = useNavigate()
  const isNew     = id === 'nova'

  const [form,    setForm]    = useState({ ...EMPTY })
  const [loading, setLoading] = useState(!isNew)
  const [saving,  setSaving]  = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const [cnpjLoading, setCnpjLoading] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    if (!isNew) {
      agenciesApi.get(id)
        .then(r => setForm({ ...EMPTY, ...r.data }))
        .catch(() => { toast.error('Agência não encontrada.'); navigate('/agencias') })
        .finally(() => setLoading(false))
    }
  }, [id])

  const set   = (k) => (e) => { setForm(f => ({ ...f, [k]: e.target.value })); setIsDirty(true) }
  const setB  = (k) => (v)  => { setForm(f => ({ ...f, [k]: v })); setIsDirty(true) }
  const setV  = (k, v)      => { setForm(f => ({ ...f, [k]: v })); setIsDirty(true) }

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

  /* Busca CNPJ via BrasilAPI */
  const lookupCnpj = async () => {
    const cnpj = form.cnpj.replace(/\D/g, '')
    if (cnpj.length !== 14) { toast.error('CNPJ incompleto (14 dígitos).'); return }
    setCnpjLoading(true)
    try {
      const r = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`)
      const d = r.data
      setForm(f => ({
        ...f,
        company_name: d.razao_social     || f.company_name,
        name:         d.nome_fantasia    || f.name,
        email:        d.email            || f.email,
        phone:        d.ddd_telefone_1   ? `(${d.ddd_telefone_1}) ${d.telefone_1}` : f.phone,
        cep:          d.cep?.replace(/\D/g,'') || f.cep,
        street:       d.logradouro       || f.street,
        number:       d.numero           || f.number,
        complement:   d.complemento      || f.complement,
        neighborhood: d.bairro           || f.neighborhood,
        city:         d.municipio        || f.city,
        state:        d.uf               || f.state,
        country:      'Brasil',
      }))
      setIsDirty(true)
      toast.success('Dados preenchidos via CNPJ.')
    } catch { toast.error('CNPJ não encontrado ou inválido.') }
    finally  { setCnpjLoading(false) }
  }

  const save = async () => {
    if (!form.name && !form.company_name) {
      toast.error('Informe o nome fantasia ou a razão social.')
      return
    }
    setSaving(true)
    try {
      if (isNew) {
        const r = await agenciesApi.create(form)
        toast.success('Agência criada com sucesso.')
        navigate(`/agencias/${r.data.id}`, { replace: true })
      } else {
        await agenciesApi.update(id, form)
        toast.success('Agência salva.')
      }
      setIsDirty(false)
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Erro ao salvar.')
    } finally { setSaving(false) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Carregando…</div>

  const fi = (k, placeholder = '') => (
    <input className="fi" value={form[k] ?? ''} onChange={set(k)} placeholder={placeholder} />
  )
  const fs = (k, children) => (
    <select className="fs" value={form[k] ?? ''} onChange={set(k)}>{children}</select>
  )

  return (
    <div>
      {/* ── Header ── */}
      <div className="ph">
        <div>
          <h1 className="ph-title" style={{ marginBottom: 2 }}>
            {isNew ? 'Nova agência' : (form.company_name || form.name || 'Agência')}
          </h1>
          {!isNew && <button className="link-btn" onClick={() => navigate('/agencias')} style={{ fontSize: 12, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>editar</button>}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>Status:</span>
            <select className="fs" value={form.status} onChange={set('status')} style={{ width: 120 }}>
              <option value="active">Ativa</option>
              <option value="pending">Pendente</option>
              <option value="inactive">Inativa</option>
            </select>
          </div>
          <button className="btn btn-outline" onClick={() => navigate('/agencias')}>
            <Ic n="logout" s={13} style={{ transform: 'rotate(180deg)' }} /> Voltar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <Ic n="check" s={13} /> {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* ── Dados do agente ── */}
      <div className="section">
        <div className="section-title">Dados do agente</div>
        {/* Linha: toggles à esquerda lado a lado + tipos à direita */}
        <div style={{ display: 'flex', gap: 28, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <label className="fl">Mala direta impressa</label>
            <Toggle checked={form.receives_mail} onChange={setB('receives_mail')} />
          </div>
          <div>
            <label className="fl">Dados bancários Andes</label>
            <Toggle checked={form.use_andes_banking} onChange={setB('use_andes_banking')} />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label className="fl">Tipo de cadastro</label>
            {fs('agency_type',
              <>
                <option value="agencia">Agência</option>
                <option value="representante">Representante</option>
                <option value="operadora">Operadora</option>
                <option value="parceiro">Parceiro</option>
                <option value="outro">Outro</option>
              </>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label className="fl">Tipo de pessoa</label>
            {fs('person_type',
              <>
                <option value="juridica">Jurídica</option>
                <option value="fisica">Física</option>
              </>
            )}
          </div>
        </div>

        <div className="grid3">
          <F label="CNPJ">
            <div className="cep-wrap">
              <input className="fi" value={form.cnpj} onChange={set('cnpj')} placeholder="00.000.000/0000-00" />
              <button className="cep-btn" onClick={lookupCnpj} disabled={cnpjLoading} title="Buscar dados pelo CNPJ">
                <Ic n="search" s={13}/>
              </button>
            </div>
          </F>
          <F label="Razão social">{fi('company_name')}</F>
          <F label="Nome fantasia">{fi('name')}</F>
        </div>

        <div className="grid3">
          <F label="Inscrição estadual">{fi('state_registration')}</F>
          <F label="Inscrição municipal">{fi('municipal_registration')}</F>
          <F label="Responsável">{fi('responsible')}</F>
        </div>

        <div className="grid3">
          <F label="Telefone">{fi('phone', '(00) 0000-0000')}</F>
          <F label="Celular">{fi('mobile', '(00) 00000-0000')}</F>
          <F label="E-mail">{fi('email', 'email@exemplo.com')}</F>
        </div>

        <div className="grid3">
          <F label="Comissão %">
            <input className="fi" type="number" min="0" max="100" step="0.01"
              value={form.commission_rate ?? ''} onChange={set('commission_rate')} placeholder="0,00" />
          </F>
          <F label="Website" col={2}>{fi('website', 'https://www.exemplo.com.br')}</F>
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
          <F label="Estado">
            {fs('state',
              <><option value="">Selecione…</option>
              {STATES_BR.map(s => <option key={s} value={s}>{s}</option>)}</>
            )}
          </F>
          <F label="País">{fi('country')}</F>
        </div>

      </div>

      {/* ── Dados PIX ── */}
      <div className="section">
        <div className="section-title">Dados PIX</div>
        <div className="grid3">
          <F label="Tipo de chave">
            {fs('pix_key_type',
              <>
                <option value="">Selecione…</option>
                <option value="cpf">CPF</option>
                <option value="cnpj">CNPJ</option>
                <option value="email">E-mail</option>
                <option value="telefone">Telefone</option>
                <option value="aleatorio">Chave aleatória</option>
              </>
            )}
          </F>
          <F label="Chave PIX" col={2}>{fi('pix_key')}</F>
        </div>
      </div>

      {/* ── Observações ── */}
      <div className="section">
        <div className="section-title">Observações</div>
        <textarea className="fi" rows={4} style={{ resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
          value={form.notes} onChange={set('notes')} placeholder="Notas internas…" />
      </div>
    </div>
  )
}
