import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { auditApi, usersApi, listsApi, passengersApi, agenciesApi, contractsApi } from '../api'
import DateRangeDrop from '../components/DateRangeDrop'
import LocationMap from '../components/LocationMap'
import { Ic } from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import { useWebSocket } from '../hooks/useWebSocket'
import { dashboardWsUrl } from '../utils/ws'

/* ── Estilos de ação ── */
const ACTION_STYLE = {
  create:   { label: 'Criado',     icon: 'plus',   bg: '#dcfce7', color: '#16a34a', border: '#bbf7d0' },
  update:   { label: 'Atualizado', icon: 'edit',   bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  delete:   { label: 'Apagado',    icon: 'trash',  bg: '#fee2e2', color: '#dc2626', border: '#fecaca' },
  restore:  { label: 'Restaurado', icon: 'rotate', bg: '#dcfce7', color: '#16a34a', border: '#bbf7d0' },
  purge:    { label: 'Removido definitivamente', icon: 'trash', bg: '#450a0a', color: '#fca5a5', border: '#7f1d1d' },
  download: { label: 'Baixado',    icon: 'dl',     bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' },
  upload:   { label: 'Enviado',    icon: 'ul',     bg: '#fef3c7', color: '#b45309', border: '#fde68a' },
  send:     { label: 'Enviado p/ assinatura', icon: 'mail', bg: '#fef3c7', color: '#d97706', border: '#fde68a' },
  sign:     { label: 'Assinado',   icon: 'check',  bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' },
  reopen:   { label: 'Voltou p/ edição', icon: 'rotate', bg: '#ffedd5', color: '#ea580c', border: '#fed7aa' },
  login:    { label: 'Login',      icon: 'key',    bg: '#ede9fe', color: '#7c3aed', border: '#ddd6fe' },
  logout:   { label: 'Logout',     icon: 'key',    bg: '#f1f5f9', color: '#64748b', border: '#e2e8f0' },
  view:     { label: 'Visitou',    icon: 'eye',    bg: '#f0fdfa', color: '#0d9488', border: '#99f6e4' },
}

/* ── Tipo: dropdown de duas camadas — área (grande) → sub-tipo (modelo) ──
   Antes era uma lista plana de 28 modelos; agora agrupa por área (igual ao
   "scope" do backend) e, ao escolher uma área com mais de um modelo, abre um
   segundo dropdown pra escolher o sub-tipo específico (ex: dentro de
   Configurações, só Mapas de Ônibus, só Países…). */
const AREA_OPTS = [
  { value: '',           label: 'Todos os tipos',          icon: 'grid',     color: '#64748b' },
  { value: 'nav',         label: 'Navegação (páginas)',     icon: 'eye',      color: '#0d9488' },
  { value: 'passengers', label: 'Passageiros',              icon: 'users',    color: '#2563eb' },
  { value: 'lists',      label: 'Listas de Passageiros',    icon: 'plane',    color: '#16a34a' },
  { value: 'agencies',   label: 'Agências',                icon: 'building', color: '#7c3aed' },
  { value: 'contracts',  label: 'Contratos',                icon: 'docs',     color: '#0891b2' },
  { value: 'users',      label: 'Usuários',                 icon: 'shield',   color: '#4f46e5' },
  { value: 'settings',   label: 'Configurações',            icon: 'settings', color: '#b45309' },
]

const SUB_OPTS_BY_AREA = {
  passengers: [
    { value: '',                  label: 'Todos',                   icon: 'users', color: '#2563eb' },
    { value: 'Passenger',         label: 'Passageiro',               icon: 'users', color: '#2563eb' },
    { value: 'PassengerDocument', label: 'Documento de passageiro',  icon: 'docs',  color: '#0891b2' },
  ],
  lists: [
    { value: '',               label: 'Todos',                icon: 'plane',    color: '#16a34a' },
    { value: 'PassengerList',  label: 'Lista de passageiros',  icon: 'plane',    color: '#16a34a' },
    { value: 'ListEnrollment', label: 'Inscrição na lista',    icon: 'listplus', color: '#0d9488' },
  ],
  contracts: [
    { value: '',                          label: 'Todos',                  icon: 'docs',     color: '#0891b2' },
    { value: 'Contract',                  label: 'Contrato',                icon: 'docs',     color: '#0891b2' },
    { value: 'ContractAccommodationLine', label: 'Acomodação do contrato',  icon: 'bed',      color: '#b45309' },
    { value: 'ContractGuest',             label: 'Hóspede do contrato',     icon: 'users',    color: '#2563eb' },
    { value: 'ContractInstallment',       label: 'Parcela do contrato',     icon: 'card',     color: '#16a34a' },
    { value: 'ContractAdjustment',        label: 'Ajuste do contrato',      icon: 'listplus', color: '#7c3aed' },
  ],
  settings: [
    { value: '',                    label: 'Todos',                     icon: 'settings', color: '#b45309' },
    { value: 'ConfigProfession',    label: 'Profissão',                 icon: 'briefcase', color: '#7c3aed' },
    { value: 'ConfigLanguage',      label: 'Idioma',                    icon: 'globe',     color: '#0891b2' },
    { value: 'ConfigCountry',       label: 'País',                      icon: 'globe',     color: '#2563eb' },
    { value: 'ConfigState',         label: 'Estado',                    icon: 'mapicon',   color: '#0d9488' },
    { value: 'ConfigCity',          label: 'Cidade',                    icon: 'pin',       color: '#dc2626' },
    { value: 'ConfigGender',        label: 'Gênero',                    icon: 'gender',    color: '#db2777' },
    { value: 'ConfigVaccine',       label: 'Vacina',                    icon: 'syringe',   color: '#16a34a' },
    { value: 'ConfigProfCard',      label: 'Carteira profissional',     icon: 'card',      color: '#7c3aed' },
    { value: 'CustomDocType',       label: 'Tipo de documento',         icon: 'docs',      color: '#0891b2' },
    { value: 'CustomDocField',      label: 'Campo de documento',        icon: 'docs',      color: '#64748b' },
    { value: 'ConfigAccommodation', label: 'Tipo de acomodação',        icon: 'bed',       color: '#b45309' },
    { value: 'ConfigListCategory',  label: 'Categoria de acomodação',   icon: 'listplus',  color: '#0d9488' },
    { value: 'ListAdditional',      label: 'Adicional de lista',        icon: 'listplus',  color: '#2563eb' },
    { value: 'CrewRole',            label: 'Equipe técnica',            icon: 'shield',    color: '#4f46e5' },
    { value: 'Destination',         label: 'Destino',                   icon: 'pin',       color: '#dc2626' },
    { value: 'Airport',             label: 'Aeroporto',                 icon: 'plane',     color: '#16a34a' },
    { value: 'Airline',             label: 'Companhia aérea',           icon: 'plane',     color: '#0d9488' },
    { value: 'BusMap',              label: 'Mapa de ônibus',            icon: 'mapicon',   color: '#b45309' },
    { value: 'PermissionProfile',   label: 'Perfil de permissão',       icon: 'key',       color: '#7c3aed' },
  ],
}

// Modelos que pertencem a cada área — usado pra resolver a área quando se
// chega direto com um model= específico (ex: link antigo) sem scope=.
const SCOPE_MODELS_FE = {
  passengers: ['Passenger', 'PassengerDocument'],
  lists:      ['PassengerList', 'ListEnrollment'],
  agencies:   ['Agency'],
  contracts:  SUB_OPTS_BY_AREA.contracts.map(o => o.value).filter(Boolean),
  users:      ['User'],
  settings:   SUB_OPTS_BY_AREA.settings.map(o => o.value).filter(Boolean),
}
const MODEL_TO_AREA = Object.fromEntries(
  Object.entries(SCOPE_MODELS_FE).flatMap(([area, models]) => models.map(m => [m, area]))
)

const ACTION_OPTS = [
  { value: '',         label: 'Todas as ações', icon: 'grid',  color: '#64748b' },
  { value: 'create',   label: 'Criado',         icon: 'plus',  color: '#16a34a' },
  { value: 'update',   label: 'Atualizado',     icon: 'edit',  color: '#2563eb' },
  { value: 'delete',   label: 'Apagado',        icon: 'trash', color: '#dc2626' },
  { value: 'restore',  label: 'Restaurado',     icon: 'rotate', color: '#16a34a' },
  { value: 'purge',    label: 'Removido definitivamente', icon: 'trash', color: '#7f1d1d' },
  { value: 'download', label: 'Baixado',        icon: 'dl',    color: '#475569' },
  { value: 'upload',   label: 'Enviado',        icon: 'ul',    color: '#b45309' },
  { value: 'send',     label: 'Enviado p/ assinatura', icon: 'mail', color: '#d97706' },
  { value: 'sign',     label: 'Assinado',       icon: 'check', color: '#15803d' },
  { value: 'reopen',   label: 'Voltou p/ edição', icon: 'rotate', color: '#ea580c' },
  { value: 'login',    label: 'Login',          icon: 'key',   color: '#7c3aed' },
  { value: 'logout',   label: 'Logout',         icon: 'key',   color: '#64748b' },
  { value: 'view',     label: 'Visitou',        icon: 'eye',   color: '#0d9488' },
]

/* Iniciais para o avatar redondo (igual ao topbar) */
function initialsOf(name) {
  if (!name || name === 'Sistema') return '⚙'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase()
}

function Avatar({ name, size = 26 }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: name === 'Sistema' || !name ? '#94a3b8' : '#2e6db4',
      color: '#fff', fontSize: size * 0.4, fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '.02em',
    }}>
      {initialsOf(name)}
    </span>
  )
}

/* ── Dropdown de filtro elegante — com busca quando há muitas opções ── */
function NavToggle({ checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', cursor: 'pointer', userSelect: 'none' }}
      title="Mistura, com os filtros atuais, as páginas que os usuários visitaram e os logins/logouts">
      <span style={{ fontSize: 12.5, fontWeight: 600, color: checked ? '#1a2d4f' : '#64748b', whiteSpace: 'nowrap' }}>
        Ver navegação dos usuários
      </span>
      <span style={{ position: 'relative', display: 'inline-block', width: 38, height: 22, flexShrink: 0 }}>
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
          style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} />
        <span style={{
          position: 'absolute', inset: 0, borderRadius: 22, transition: 'background .2s',
          background: checked ? '#1a2d4f' : '#cbd5e1',
        }} />
        <span style={{
          position: 'absolute', top: 4, left: checked ? 20 : 4, width: 14, height: 14,
          borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)',
        }} />
      </span>
    </label>
  )
}

function FDrop({ label, icon, value, onChange, options, iconFor, forceActive, forceLabel, forceIcon, forceColor, forceValue }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef(null)
  const active = forceActive || value !== options[0].value
  const selected = options.find(o => o.value === value)
  const searchable = options.length > 8

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => { if (!open) setQ('') }, [open])

  const filtered = q
    ? options.filter(o => o.value === '' || o.label.toLowerCase().includes(q.toLowerCase()))
    : options

  // selected só representa uma escolha real quando tem value — com value=''
  // ele sempre casa com a opção "Todos" (sempre a primeira), então nesse caso
  // o ícone/cor de exibição vêm do forceIcon/forceColor (ex: área herdada do
  // scope= da URL), não da opção vazia.
  const hasRealSelection = !!selected?.value
  const btnIcon  = hasRealSelection ? selected.icon : (forceIcon || icon)
  const btnColor = active ? (hasRealSelection ? selected.color : (forceColor || '#2e6db4')) : '#475569'

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 8,
          border: `1.5px solid ${active ? btnColor : '#e2e8f0'}`,
          background: active ? `${btnColor}14` : '#fff',
          color: btnColor,
          fontSize: 13, fontWeight: active ? 600 : 500, cursor: 'pointer', fontFamily: 'inherit',
          whiteSpace: 'nowrap', transition: 'all .12s',
        }}>
        {btnIcon && <Ic n={btnIcon} s={13} />}
        {hasRealSelection ? selected.label : (active && forceLabel) ? forceLabel : label}
        <span style={{ fontSize: 9, opacity: .6, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 300,
          background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
          boxShadow: '0 12px 28px rgba(15,23,42,.12)', minWidth: 220, overflow: 'hidden',
        }}>
          {searchable && (
            <div style={{ padding: 8, borderBottom: '1px solid #f1f5f9' }}>
              <input autoFocus value={q} onChange={e => setQ(e.target.value)}
                placeholder="Buscar…"
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12.5, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            </div>
          )}
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <p style={{ padding: '14px', margin: 0, fontSize: 12.5, color: '#94a3b8', textAlign: 'center' }}>Nada encontrado.</p>
            ) : filtered.map(opt => {
              const sel = (forceActive && !hasRealSelection) ? forceValue === opt.value : value === opt.value
              const ic = opt.icon || iconFor?.(opt.value)
              const oc = opt.color || '#94a3b8'
              return (
                <button key={opt.value} type="button"
                  onClick={() => { onChange(opt.value); setOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '8px 14px', gap: 10,
                    background: sel ? `${oc}14` : 'transparent', border: 'none',
                    color: sel ? oc : '#1e293b',
                    fontSize: 13, fontWeight: sel ? 600 : 400, cursor: 'pointer',
                    fontFamily: 'inherit', textAlign: 'left',
                  }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f8fafc' }}
                  onMouseLeave={e => { if (!sel) e.currentTarget.style.background = sel ? `${oc}14` : 'transparent' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {ic && <span style={{ color: oc, display: 'flex' }}><Ic n={ic} s={13} /></span>}
                    {opt.label}
                  </span>
                  {sel && <Ic n="check" s={13} />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Dropdown de filtro por usuário — busca em /users/, mostra avatar ── */
function UserFilterDrop({ value, onChange }) {
  const [open, setOpen]   = useState(false)
  const [q, setQ]         = useState('')
  const [users, setUsers] = useState(null) // null = ainda não carregou
  const ref = useRef(null)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    if (open && users === null) {
      usersApi.list().then(r => setUsers(r.data)).catch(() => setUsers([]))
    }
  }, [open, users])

  const selectedUser = (users ?? []).find(u => String(u.id) === String(value))
  const active = !!value
  const filtered = (users ?? []).filter(u =>
    !q || (u.full_name || u.username).toLowerCase().includes(q.toLowerCase()) || u.email?.toLowerCase().includes(q.toLowerCase())
  )

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 8,
          border: `1.5px solid ${active ? '#2e6db4' : '#e2e8f0'}`,
          background: active ? '#eff6ff' : '#fff',
          color: active ? '#2e6db4' : '#475569',
          fontSize: 13, fontWeight: active ? 600 : 500, cursor: 'pointer', fontFamily: 'inherit',
          whiteSpace: 'nowrap', transition: 'all .12s', maxWidth: 200,
        }}>
        {active && selectedUser ? <Avatar name={selectedUser.full_name || selectedUser.username} size={18} /> : <Ic n="users" s={13} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {active ? (selectedUser?.full_name || selectedUser?.username || '…') : 'Usuário'}
        </span>
        <span style={{ fontSize: 9, opacity: .6, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 300,
          background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
          boxShadow: '0 12px 28px rgba(15,23,42,.12)', minWidth: 240, overflow: 'hidden',
        }}>
          <div style={{ padding: 8, borderBottom: '1px solid #f1f5f9' }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Buscar pessoa…"
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12.5, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            <button type="button" onClick={() => { onChange(''); setOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px', background: !value ? '#eff6ff' : 'transparent', border: 'none', color: !value ? '#2e6db4' : '#1e293b', fontSize: 13, fontWeight: !value ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
              onMouseEnter={e => { if (value) e.currentTarget.style.background = '#f8fafc' }}
              onMouseLeave={e => { if (value) e.currentTarget.style.background = 'transparent' }}>
              <Ic n="users" s={13} /> Todos os usuários
            </button>
            {users === null ? (
              <p style={{ padding: '14px', margin: 0, fontSize: 12.5, color: '#94a3b8', textAlign: 'center' }}>Carregando…</p>
            ) : filtered.length === 0 ? (
              <p style={{ padding: '14px', margin: 0, fontSize: 12.5, color: '#94a3b8', textAlign: 'center' }}>Nenhuma pessoa encontrada.</p>
            ) : filtered.map(u => {
              const sel = String(value) === String(u.id)
              const name = u.full_name || u.username
              return (
                <button key={u.id} type="button"
                  onClick={() => { onChange(String(u.id)); setOpen(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 14px', background: sel ? '#eff6ff' : 'transparent', border: 'none', color: sel ? '#2e6db4' : '#1e293b', fontSize: 13, fontWeight: sel ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f8fafc' }}
                  onMouseLeave={e => { if (!sel) e.currentTarget.style.background = sel ? '#eff6ff' : 'transparent' }}>
                  <Avatar name={name} size={22} />
                  <span style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                    {u.email && <span style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</span>}
                  </span>
                  {sel && <Ic n="check" s={13} />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* Config de "entrar em um registro específico" — mostrado ao lado do Tipo
   quando a área selecionada (Tipo ou botão "Log" de uma página) é uma dessas. */
const DRILL_CONFIG = {
  lists: {
    icon: 'plane', param: 'list_id', singular: 'lista', plural: 'Todas as listas',
    fetch: () => listsApi.list().then(r => r.data.results ?? r.data),
    nameOf: i => i.name,
  },
  passengers: {
    icon: 'users', param: 'passenger_id', singular: 'passageiro', plural: 'Todos os passageiros',
    fetch: () => passengersApi.list().then(r => r.data.results ?? r.data),
    nameOf: i => i.full_name,
  },
  agencies: {
    icon: 'building', param: 'agency_id', singular: 'agência', plural: 'Todas as agências',
    fetch: () => agenciesApi.list().then(r => r.data.results ?? r.data),
    nameOf: i => i.name || i.company_name,
  },
  contracts: {
    icon: 'docs', param: 'contract_id', singular: 'contrato', plural: 'Todos os contratos',
    fetch: () => contractsApi.list().then(r => r.data.results ?? r.data),
    nameOf: i => i.reservation_number ? `Contrato ${i.reservation_number}` : `Contrato #${i.id}`,
  },
}

/* Dropdown de busca pra entrar no log de UM registro específico (lista,
   passageiro ou agência) sem sair da tela de Log — mesmo padrão do filtro
   de usuário, com busca, e troca o filtro de id correspondente. */
function RecordDrillDrop({ drillKey, value, onChange }) {
  const cfg = DRILL_CONFIG[drillKey]
  const [open, setOpen]   = useState(false)
  const [q, setQ]         = useState('')
  const [items, setItems] = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    setItems(null)
    setQ('')
  }, [drillKey])

  useEffect(() => {
    // Carrega também sem abrir o dropdown quando já chega com um valor
    // selecionado (ex: veio do botão "Log" de uma lista específica) — pra
    // mostrar o nome do registro de cara, em vez de só "…".
    if ((open || value) && items === null) {
      cfg.fetch().then(setItems).catch(() => setItems([]))
    }
  }, [open, value, items, cfg])

  const selected = (items ?? []).find(i => String(i.id) === String(value))
  const active = !!value
  const filtered = (items ?? []).filter(i => !q || cfg.nameOf(i)?.toLowerCase().includes(q.toLowerCase()))

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 8,
          border: `1.5px solid ${active ? '#2e6db4' : '#bfdbfe'}`,
          background: active ? '#eff6ff' : '#fff',
          color: active ? '#2e6db4' : '#1d4ed8',
          fontSize: 13, fontWeight: active ? 600 : 500, cursor: 'pointer', fontFamily: 'inherit',
          whiteSpace: 'nowrap', transition: 'all .12s', maxWidth: 220,
        }}>
        <Ic n={cfg.icon} s={13} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {active ? (selected ? cfg.nameOf(selected) : '…') : cfg.plural}
        </span>
        <span style={{ fontSize: 9, opacity: .6, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 300,
          background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
          boxShadow: '0 12px 28px rgba(15,23,42,.12)', minWidth: 260, overflow: 'hidden',
        }}>
          <div style={{ padding: 8, borderBottom: '1px solid #f1f5f9' }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder={`Buscar ${cfg.singular}…`}
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12.5, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            <button type="button" onClick={() => { onChange(''); setOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px', background: !value ? '#eff6ff' : 'transparent', border: 'none', color: !value ? '#2e6db4' : '#1e293b', fontSize: 13, fontWeight: !value ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
              onMouseEnter={e => { if (value) e.currentTarget.style.background = '#f8fafc' }}
              onMouseLeave={e => { if (value) e.currentTarget.style.background = 'transparent' }}>
              <Ic n={cfg.icon} s={13} /> {cfg.plural}
            </button>
            {items === null ? (
              <p style={{ padding: '14px', margin: 0, fontSize: 12.5, color: '#94a3b8', textAlign: 'center' }}>Carregando…</p>
            ) : filtered.length === 0 ? (
              <p style={{ padding: '14px', margin: 0, fontSize: 12.5, color: '#94a3b8', textAlign: 'center' }}>Nada encontrado.</p>
            ) : filtered.map(i => {
              const sel = String(value) === String(i.id)
              return (
                <button key={i.id} type="button"
                  onClick={() => { onChange(String(i.id)); setOpen(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 14px', background: sel ? '#eff6ff' : 'transparent', border: 'none', color: sel ? '#2e6db4' : '#1e293b', fontSize: 13, fontWeight: sel ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f8fafc' }}
                  onMouseLeave={e => { if (!sel) e.currentTarget.style.background = sel ? '#eff6ff' : 'transparent' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{cfg.nameOf(i)}</span>
                  {sel && <Ic n="check" s={13} />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* Formata valores ISO de data/hora para formato legível */
function fmtVal(val) {
  if (val === null || val === undefined) return '—'
  const s = String(val)
  // Detecta ISO datetime: 2026-06-02T02:00:33... ou 2026-06-02T...+00:00
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    try {
      const d = new Date(s)
      return d.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    } catch { return s }
  }
  // Detecta ISO date: 2026-06-02
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-')
    return `${d}/${m}/${y}`
  }
  return s
}

/* Modelos com tela de detalhe e/ou log próprio navegável a partir do popup */
const RECORD_LINKS = {
  Passenger:     { open: id => `/passageiros/${id}`, log: id => `/log?passenger_id=${id}`, label: 'passageiro', of: 'do' },
  PassengerList: { open: id => `/viagens/${id}`,     log: id => `/log?list_id=${id}`,      label: 'lista',      of: 'da' },
  Agency:        { open: id => `/agencias/${id}`,    log: id => `/log?agency_id=${id}`,    label: 'agência',    of: 'da' },
  Contract:      { open: id => `/contratos`,         log: id => `/log?contract_id=${id}`,  label: 'contrato',   of: 'do' },
}

/* ── Popup de detalhe de um evento ── */
function LogDetailPopup({ entry, onClose, navigate }) {
  const style = ACTION_STYLE[entry.action] ?? ACTION_STYLE.update
  const changes = entry.changes ?? {}
  const hasChanges = Object.keys(changes).length > 0
  const isUpdate = entry.action === 'update'
  const link = RECORD_LINKS[entry.model_name]
  const hasLink = link && entry.object_id
  const [addressCopied, setAddressCopied] = useState(false)

  const copyAddress = async () => {
    if (!entry.geo_address) return
    try {
      await navigator.clipboard.writeText(entry.geo_address)
      setAddressCopied(true)
      setTimeout(() => setAddressCopied(false), 1800)
    } catch {}
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 20,
    }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: '#fff', borderRadius: 14, width: '100%', maxWidth: 680,
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 32px 80px rgba(0,0,0,.25)',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: style.bg, color: style.color, border: `1px solid ${style.border}` }}>
                  <Ic n={style.icon} s={11} /> {style.label}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{entry.model_label}</span>
              </div>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>{entry.object_repr}</p>
              <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#64748b', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Ic n="clock" s={12} /> {entry.timestamp_br}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Avatar name={entry.user_display || 'Sistema'} size={18} /> {entry.user_display || 'Sistema'}</span>
                {entry.ip_address && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Ic n="globe" s={12} /> {entry.ip_address}</span>}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 22, lineHeight: 1, padding: 2, flexShrink: 0 }}>×</button>
          </div>
        </div>

        {/* Conteúdo */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {!hasChanges && entry.latitude == null ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Sem detalhes registrados.</p>
          ) : hasChanges ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {Object.entries(changes).map(([field, val]) => {
                const isUpdateField = val && typeof val === 'object' && 'antes' in val
                return (
                  <div key={field} style={{
                    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px',
                  }}>
                    <p style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 8px' }}>
                      {field}
                    </p>
                    {isUpdateField ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {val.antes !== null && val.antes !== '' && val.antes !== undefined && (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', background: '#fee2e2', padding: '2px 6px', borderRadius: 4, flexShrink: 0, marginTop: 1 }}>antes</span>
                            <span style={{ fontSize: 13, color: '#dc2626', textDecoration: 'line-through', wordBreak: 'break-word', opacity: .8 }}>{fmtVal(val.antes)}</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '2px 6px', borderRadius: 4, flexShrink: 0, marginTop: 1 }}>depois</span>
                          <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600, wordBreak: 'break-word' }}>{fmtVal(val.depois)}</span>
                        </div>
                      </div>
                    ) : (
                      <span style={{ fontSize: 13, color: '#1e293b', wordBreak: 'break-word' }}>{fmtVal(val)}</span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : null}

          {entry.latitude != null && entry.longitude != null && (
            <div style={{ marginTop: hasChanges ? 16 : 0 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Ic n="pin" s={11} /> {[entry.geo_city, entry.geo_country].filter(Boolean).join(', ') || (entry.geo_precise ? 'Localização do navegador' : 'Localização aproximada')}
                {entry.geo_precise && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '1px 6px', borderRadius: 20, textTransform: 'none', letterSpacing: 0 }}>
                    precisa (navegador)
                  </span>
                )}
              </p>
              <LocationMap lat={entry.latitude} lng={entry.longitude} />
              {entry.geo_address && (
                <div onClick={copyAddress} title="Clique para copiar"
                  style={{
                    position: 'relative', marginTop: 8, padding: '8px 12px', borderRadius: 8,
                    background: '#f8fafc', border: '1px solid #e2e8f0', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#2e6db4'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = '#e2e8f0'}>
                  <Ic n="docs" s={13} />
                  <span style={{ fontSize: 12.5, color: '#475569', flex: 1 }}>{entry.geo_address}</span>
                  {addressCopied && (
                    <span style={{ position: 'absolute', top: -16, right: 8, background: '#059669', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                      ✓ Copiado
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {hasLink && (
              <>
                <button onClick={() => { onClose(); navigate(link.open(entry.object_id)) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: '1.5px solid #2e6db4', background: '#eff6ff', color: '#2e6db4', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Ic n="eye" s={13} /> Abrir {link.label}
                </button>
                <button onClick={() => { onClose(); navigate(link.log(entry.object_id)) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Ic n="list" s={13} /> Log {link.of} {link.label}
                </button>
              </>
            )}
          </div>
          <button onClick={onClose}
            style={{ padding: '8px 20px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Linha da tabela ── */
function LogRow({ entry, onClick, even }) {
  const style = ACTION_STYLE[entry.action] ?? ACTION_STYLE.update
  const changesCount = Object.keys(entry.changes ?? {}).length

  return (
    <tr onClick={onClick} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', transition: 'background .1s', background: even ? '#fafbfc' : '#fff' }}
      onMouseEnter={e => e.currentTarget.style.background = '#eff6ff'}
      onMouseLeave={e => e.currentTarget.style.background = even ? '#fafbfc' : '#fff'}
    >
      <td style={{ padding: '11px 16px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', textAlign: 'center' }}>
        {entry.timestamp_br}
      </td>
      <td style={{ padding: '11px 16px', overflow: 'hidden', textAlign: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: '#1e293b', width: 180, maxWidth: '100%' }}>
          <Avatar name={entry.user_display || 'Sistema'} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{entry.user_display || 'Sistema'}</span>
        </span>
      </td>
      <td style={{ padding: '11px 16px', overflow: 'hidden', textAlign: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: style.bg, color: style.color, border: `1px solid ${style.border}`, whiteSpace: 'nowrap' }}>
          <Ic n={style.icon} s={10} /> {style.label}
        </span>
      </td>
      <td style={{ padding: '11px 16px', fontSize: 13, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
        {entry.model_label}
      </td>
      <td style={{ padding: '11px 16px', fontSize: 13, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
        {entry.object_repr}
      </td>
      <td style={{ padding: '11px 16px', textAlign: 'center' }}>
        {changesCount > 0
          ? <span style={{ fontSize: 12, color: '#2e6db4', background: '#eff6ff', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
              {changesCount} campo{changesCount !== 1 ? 's' : ''}
            </span>
          : <span style={{ fontSize: 12, color: '#cbd5e1' }}>—</span>}
      </td>
      <td style={{ padding: '11px 16px', fontSize: 11, color: '#cbd5e1', whiteSpace: 'nowrap', textAlign: 'center' }}>
        {entry.ip_address ?? '—'}
      </td>
    </tr>
  )
}

const TH = ({ children, align = 'center', width }) => (
  <th style={{ padding: '11px 16px', textAlign: align, fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap', background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', width }}>
    {children}
  </th>
)

// Mapeia model_name → rótulo e rota de volta
// Contexto (rótulo + rota de voltar) de cada área — chave igual ao value de
// AREA_OPTS, usado tanto pro cabeçalho (título/botão voltar) quanto pra
// marcar o Tipo como ativo quando a área vem do scope=/list_id da URL.
const AREA_CONTEXT = {
  passengers: { label: 'Passageiros',           back: '/passageiros'   },
  lists:      { label: 'Listas de Passageiros', back: '/viagens'       },
  agencies:   { label: 'Agências',              back: '/agencias'      },
  contracts:  { label: 'Contratos',             back: '/contratos'     },
  users:      { label: 'Usuários',              back: '/usuarios'      },
  settings:   { label: 'Configurações',         back: '/configuracoes' },
}

/* ── Página principal ── */
export default function AuditLog() {
  const navigate       = useNavigate()
  const [searchParams] = useSearchParams()
  const initModel      = searchParams.get('model') || ''
  const listId         = searchParams.get('list_id') || ''
  const passengerId    = searchParams.get('passenger_id') || ''
  const agencyId       = searchParams.get('agency_id') || ''
  const contractId     = searchParams.get('contract_id') || ''
  const auditScope     = searchParams.get('scope') || ''
  const { user } = useAuth()
  const myP = user?.permissions ?? {}
  // Espelha a lógica de permissões do backend (audit/views.py) pra mostrar só
  // os filtros que fazem sentido pra essa pessoa — sem isso, o dropdown de
  // Tipo oferece áreas que sempre voltam vazias, e o de Usuário aparece pra
  // quem só pode ver as próprias ações (filtrar por outro usuário não faz
  // diferença nenhuma nesse caso).
  // Ver TODOS os logs é só do superusuário — as chaves legadas
  // view_audit_log/log_view não valem mais como acesso amplo (ver backend
  // audit/views.py). Quem não é superusuário vê só as próprias ações + as
  // áreas de log concedidas individualmente.
  const hasGlobalLog     = !!user?.is_superuser
  const hasPassengersLog = hasGlobalLog || !!myP.passengers_view_logs
  const hasListsLog      = hasGlobalLog || !!myP.lists_view_logs
  const hasAgenciesLog   = hasGlobalLog || !!myP.agencies_view_logs
  const hasContractsLog  = hasGlobalLog || !!myP.contracts_view_logs
  const hasUsersLog      = hasGlobalLog || !!myP.users_view_logs
  const hasSettingsLog   = hasGlobalLog || !!myP.settings_view_logs
  const canViewPageViews = hasGlobalLog || !!myP.log_page_views
  const hasAnyAreaLog    = hasPassengersLog || hasListsLog || hasAgenciesLog || hasContractsLog || hasUsersLog || hasSettingsLog
  const AREA_PERM = {
    nav: canViewPageViews, passengers: hasPassengersLog, lists: hasListsLog,
    agencies: hasAgenciesLog, contracts: hasContractsLog, users: hasUsersLog, settings: hasSettingsLog,
  }
  const allowedAreaOpts = AREA_OPTS.filter(o => o.value === '' || AREA_PERM[o.value])
  // Auto-visão (sem nenhuma permissão de área e sem acesso global): o
  // backend só devolve as próprias ações, ignorando qualquer user_id= —
  // então o filtro de Usuário não tem nenhuma utilidade nesse caso.
  const showUserFilter = hasGlobalLog || hasAnyAreaLog

  const [logs,     setLogs]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [count,    setCount]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [selected, setSelected] = useState(null)
  const [filters,  setFilters]  = useState({ action: '', area: '', model: initModel, search: '', date_from: '', date_to: '', user_id: '' })
  const [showNav,  setShowNav]  = useState(false)

  const pageRef    = useRef(1)
  const filtersRef = useRef(filters)
  const showNavRef = useRef(showNav)

  // Resolve a área efetiva a partir, em ordem: do Tipo escolhido na própria
  // tela, do scope= que veio da URL (botão "Log" de outra página), do model=
  // (link direto a um sub-tipo específico) ou do list_id/passenger_id/
  // agency_id (botão "Log" de um registro específico).
  const resolveArea = (f) => f.area || auditScope || MODEL_TO_AREA[f.model]
    || (f.model === 'PageView' ? 'nav' : '')
    || (listId ? 'lists' : passengerId ? 'passengers' : agencyId ? 'agencies' : contractId ? 'contracts' : '')

  const buildParams = (f, nav) => {
    const params = {}
    if (f.action)    params.action    = f.action
    if (f.search)    params.search    = f.search
    if (f.date_from) params.date_from = f.date_from
    if (f.date_to)   params.date_to   = f.date_to
    if (f.user_id)   params.user_id   = f.user_id
    if (nav)         params.show_nav  = 1
    const area = resolveArea(f)
    if (area === 'nav') {
      params.model = 'PageView'
    } else {
      if (area)    params.scope = area
      if (f.model) params.model = f.model
    }
    if (listId)      params.list_id      = listId
    if (passengerId) params.passenger_id = passengerId
    if (agencyId)    params.agency_id    = agencyId
    if (contractId)  params.contract_id  = contractId
    return params
  }

  const load = useCallback(async (p = 1, f = filters, nav = showNav) => {
    setLoading(true)
    try {
      const params = { page: p, page_size: 50, ...buildParams(f, nav) }
      const r = await auditApi.list(params)
      setLogs(r.data.results ?? r.data)
      setCount(r.data.count ?? (r.data.results ?? r.data).length)
      setPage(p)
      pageRef.current = p
    } catch {}
    finally { setLoading(false) }
  }, [filters, showNav, listId, passengerId, agencyId, contractId, auditScope])

  // O componente não remonta ao navegar de uma página pra outra (mesma rota
  // /log) — então, sem isso, o filtro Tipo (e os demais) de uma área antiga
  // "vazava" pra área nova (ex: ir do Log de Calendário pro Log de Agências
  // mantinha o Tipo = Inscrição na lista, misturando com scope=agencies e
  // não retornando nada). Sempre que a combinação de contexto da URL muda,
  // os filtros são reconstruídos do zero a partir da nova URL.
  const areaKey = `${auditScope}|${initModel}`
  const prevAreaKey = useRef(areaKey)
  useEffect(() => {
    if (prevAreaKey.current !== areaKey) {
      // Área diferente da anterior (ex: veio de outro botão "Log" de outra
      // página) — reconstrói os filtros do zero a partir da nova URL, em vez
      // de manter o Tipo/Ação/Usuário que estavam selecionados na área antiga.
      prevAreaKey.current = areaKey
      const next = { action: '', area: '', model: initModel, search: '', date_from: '', date_to: '', user_id: '' }
      setFilters(next)
      filtersRef.current = next
      load(1, next, showNavRef.current)
    } else {
      // Mesma área, só o registro específico mudou (drill-down de lista/
      // passageiro/agência) — recarrega mantendo os filtros atuais.
      load(1, filtersRef.current, showNavRef.current)
    }
  }, [areaKey, listId, passengerId, agencyId, contractId])

  const setFilter = (key, val) => {
    const next = { ...filters, [key]: val }
    setFilters(next)
    filtersRef.current = next
    load(1, next, showNavRef.current)
  }

  // Trocar a área (Tipo) descarta o sub-tipo e o registro específico que
  // estavam selecionados na área anterior — não fazem mais sentido juntos.
  const setArea = (area) => {
    const next = { ...filters, area, model: '' }
    setFilters(next)
    filtersRef.current = next
    if (listId || passengerId || agencyId || contractId) {
      const sp = new URLSearchParams(searchParams)
      sp.delete('list_id'); sp.delete('passenger_id'); sp.delete('agency_id'); sp.delete('contract_id')
      navigate(`/log?${sp.toString()}`)
    } else {
      load(1, next, showNavRef.current)
    }
  }

  const toggleNav = (on) => {
    setShowNav(on)
    showNavRef.current = on
    load(1, filtersRef.current, on)
  }

  const silentReload = useCallback(async () => {
    try {
      const f = filtersRef.current
      const nav = showNavRef.current
      const p = pageRef.current
      const params = { page: p, page_size: 50, ...buildParams(f, nav) }
      const r = await auditApi.list(params)
      setLogs(r.data.results ?? r.data)
      setCount(r.data.count ?? (r.data.results ?? r.data).length)
    } catch {}
  }, [listId, passengerId, agencyId, contractId, auditScope])

  const wsUrl = user ? dashboardWsUrl() : null
  useWebSocket(wsUrl, useCallback(({ scope }) => {
    if (scope === 'audit' || scope === 'all') silentReload()
  }, [silentReload]))

  const hasFilter = filters.action || filters.area || filters.model || filters.search || filters.date_from || filters.date_to || filters.user_id
  const totalPages = Math.ceil(count / 50)

  const effectiveArea = resolveArea(filters)
  const ctx = AREA_CONTEXT[effectiveArea] || null

  // Rótulo da área atual mesmo quando ela não vem do dropdown de Tipo —
  // porque o filtro real está no scope= ou no list_id/passenger_id/agency_id
  // da URL. Usado pra marcar o Tipo como ativo e mostrar visualmente que a
  // área está, sim, sendo filtrada.
  const areaLabel = listId ? 'Lista de Passageiros'
    : passengerId ? 'Passageiro'
    : agencyId ? 'Agência'
    : contractId ? 'Contrato'
    : effectiveArea === 'nav' ? 'Navegação (páginas)'
    : ctx?.label || null

  // Sub-filtro "entrar num registro específico" — aparece quando a área atual
  // é uma das que tem busca por registro (lista/passageiro/agência).
  const drillScope = DRILL_CONFIG[effectiveArea] ? effectiveArea : undefined
  const drillValue = drillScope === 'lists' ? listId : drillScope === 'passengers' ? passengerId : drillScope === 'agencies' ? agencyId : drillScope === 'contracts' ? contractId : ''
  const setDrillValue = (val) => {
    const cfg = DRILL_CONFIG[drillScope]
    const next = new URLSearchParams(searchParams)
    if (val) next.set(cfg.param, val); else next.delete(cfg.param)
    navigate(`/log?${next.toString()}`)
  }

  // Sub-tipo dentro da área (ex: dentro de Configurações, só Mapas de Ônibus)
  const subOpts = SUB_OPTS_BY_AREA[effectiveArea]

  return (
    <div>
      {/* Header */}
      <div className="ph" style={{ marginBottom: 20 }}>
        <div>
          {listId && (
            <button onClick={() => navigate(`/viagens/${listId}`)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 12, fontFamily: 'inherit', padding: 0 }}
              onMouseEnter={e => e.currentTarget.style.color = '#1a2d4f'}
              onMouseLeave={e => e.currentTarget.style.color = '#64748b'}>
              ← Voltar para a lista de passageiros
            </button>
          )}
          {passengerId && (
            <button onClick={() => navigate(`/passageiros/${passengerId}`)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 12, fontFamily: 'inherit', padding: 0 }}
              onMouseEnter={e => e.currentTarget.style.color = '#1a2d4f'}
              onMouseLeave={e => e.currentTarget.style.color = '#64748b'}>
              ← Voltar para o passageiro
            </button>
          )}
          {agencyId && (
            <button onClick={() => navigate(`/agencias/${agencyId}`)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 12, fontFamily: 'inherit', padding: 0 }}
              onMouseEnter={e => e.currentTarget.style.color = '#1a2d4f'}
              onMouseLeave={e => e.currentTarget.style.color = '#64748b'}>
              ← Voltar para a agência
            </button>
          )}
          {contractId && (
            <button onClick={() => navigate('/contratos')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 12, fontFamily: 'inherit', padding: 0 }}
              onMouseEnter={e => e.currentTarget.style.color = '#1a2d4f'}
              onMouseLeave={e => e.currentTarget.style.color = '#64748b'}>
              ← Voltar para os contratos
            </button>
          )}
          {!listId && !passengerId && !agencyId && !contractId && ctx && (
            <button onClick={() => navigate(ctx.back)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 12, fontFamily: 'inherit', padding: 0 }}
              onMouseEnter={e => e.currentTarget.style.color = '#1a2d4f'}
              onMouseLeave={e => e.currentTarget.style.color = '#64748b'}>
              ← Voltar para {ctx.label}
            </button>
          )}
          <h1 className="ph-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, background: '#eef2ff', color: '#4f46e5' }}>
              <Ic n="list" s={16} />
            </span>
            {listId ? 'Log da Lista de Passageiros'
              : passengerId ? 'Log do Passageiro'
              : agencyId ? 'Log da Agência'
              : contractId ? 'Log do Contrato'
              : ctx ? `Log de ${ctx.label}` : 'Log do Sistema'}
          </h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
            {count.toLocaleString('pt-BR')} evento{count !== 1 ? 's' : ''} registrado{count !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Filtros — barra em card */}
      <div style={{ display: 'flex', gap: 9, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, boxShadow: '0 1px 3px rgba(0,0,0,.03)' }}>
        {/* Busca */}
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none', display: 'flex' }}><Ic n="search" s={14} /></span>
          <input
            value={filters.search}
            onChange={e => setFilter('search', e.target.value)}
            placeholder="Buscar por descrição…"
            style={{ paddingLeft: 32, paddingRight: 12, paddingTop: 8, paddingBottom: 8, border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b', background: '#fff', width: 230, boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = '#2e6db4'}
            onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
          />
        </div>

        {showUserFilter && <UserFilterDrop value={filters.user_id} onChange={v => setFilter('user_id', v)} />}
        <FDrop label="Ação" icon="check" value={filters.action} onChange={v => setFilter('action', v)} options={ACTION_OPTS} />
        <FDrop label="Tipo" icon="grid" value={filters.area} onChange={setArea} options={allowedAreaOpts}
          forceActive={!!areaLabel} forceLabel={areaLabel} forceValue={effectiveArea}
          forceIcon={AREA_OPTS.find(a => a.value === effectiveArea)?.icon}
          forceColor={AREA_OPTS.find(a => a.value === effectiveArea)?.color} />
        {subOpts && (
          <FDrop label="Sub-tipo" icon={AREA_OPTS.find(a => a.value === effectiveArea)?.icon} value={filters.model}
            onChange={v => setFilter('model', v)} options={subOpts} />
        )}
        {drillScope && <RecordDrillDrop drillKey={drillScope} value={drillValue} onChange={setDrillValue} />}

        <DateRangeDrop
          label="Período"
          from={filters.date_from}
          to={filters.date_to}
          onFrom={v => setFilter('date_from', v)}
          onTo={v => setFilter('date_to', v)}
        />

        {hasFilter && (
          <button onClick={() => { const c = { action:'',area:'',model:'',search:'',date_from:'',date_to:'',user_id:'' }; setFilters(c); filtersRef.current = c; load(1,c) }}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 13px', borderRadius: 8, border: '1.5px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Ic n="x" s={12} /> Limpar filtros
          </button>
        )}

        {canViewPageViews && (
          <NavToggle checked={showNav} onChange={toggleNav} />
        )}
      </div>

      {/* Tabela */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <TH width="13%">Data / Hora</TH>
                <TH width="17%">Usuário</TH>
                <TH width="11%">Ação</TH>
                <TH width="13%">Tipo</TH>
                <TH width="29%">Descrição</TH>
                <TH width="9%">Campos</TH>
                <TH width="8%">IP</TH>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '56px 0', color: '#94a3b8', fontSize: 13 }}>
                  Carregando…
                </td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '56px 0' }}>
                  <p style={{ display: 'flex', justifyContent: 'center', color: '#cbd5e1', marginBottom: 10 }}><Ic n="list" s={36} /></p>
                  <p style={{ color: '#94a3b8', fontSize: 14, fontWeight: 500 }}>Nenhum evento encontrado.</p>
                  {hasFilter && <p style={{ color: '#cbd5e1', fontSize: 12, marginTop: 4 }}>Tente ajustar os filtros.</p>}
                </td></tr>
              ) : logs.map((entry, i) => (
                <LogRow key={entry.id} entry={entry} even={i % 2 === 1} onClick={() => setSelected(entry)} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {totalPages > 1 && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>
              Página {page} de {totalPages} · {count.toLocaleString('pt-BR')} registros
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button disabled={page <= 1} onClick={() => load(page - 1)}
                style={{ padding: '5px 12px', borderRadius: 7, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? .4 : 1, fontFamily: 'inherit' }}>
                ← Anterior
              </button>
              <button disabled={page >= totalPages} onClick={() => load(page + 1)}
                style={{ padding: '5px 12px', borderRadius: 7, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? .4 : 1, fontFamily: 'inherit' }}>
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Popup de detalhe */}
      {selected && <LogDetailPopup entry={selected} onClose={() => setSelected(null)} navigate={navigate} />}
    </div>
  )
}
