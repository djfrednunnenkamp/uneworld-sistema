import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { itinerariesApi, configApi } from '../api'
import { Ic } from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import { useNavGuard } from '../context/NavGuardContext'
import LeaveGuardModal from '../components/LeaveGuardModal'
import usePersistedTab from '../hooks/usePersistedTab'
import { TabBar, Chip } from '../components/itinerary/ui'
import { TYPE_OPTS, fmtDateBR } from '../components/itinerary/constants'
import { normalizeItinerary } from '../components/itinerary/paymentPlan'

/* Abas carregadas sob demanda (code-splitting): o JS de cada aba só é baixado
   quando ela é aberta pela primeira vez, e só a aba ativa fica montada. */
const BasicInfoTab     = lazy(() => import('../components/itinerary/BasicInfoTab'))
const DestinosTab      = lazy(() => import('../components/itinerary/DestinosTab'))
const AccommodationTab = lazy(() => import('../components/itinerary/AccommodationTab'))
const PaymentsTab      = lazy(() => import('../components/itinerary/PaymentsTab'))
const ClausesTab       = lazy(() => import('../components/itinerary/ClausesTab'))
const ImagensTab       = lazy(() => import('../components/itinerary/ImagensTab'))
const DiaADiaTab       = lazy(() => import('../components/itinerary/DiaADiaTab'))
const PlaceholderTab   = lazy(() => import('../components/itinerary/PlaceholderTab'))

/* Registro das abas (nova IA). Campos existentes: basic, destinos, datas, valores,
   pagamentos, regras. As demais são placeholders até receberem seus campos. */
const TABS = [
  { key: 'basic',       label: 'Informações Básicas' },
  { key: 'destinos',    label: 'Destinos' },
  { key: 'valores',     label: 'Valores' },
  { key: 'pagamentos',  label: 'Pagamentos' },
  { key: 'imagens',     label: 'Imagens' },
  { key: 'destaques',   label: 'Destaques' },
  { key: 'diaadia',     label: 'Roteiro Dia a Dia' },
  { key: 'naoinclusos', label: 'Não Inclusos' },
  { key: 'opcionais',   label: 'Opcionais' },
  { key: 'dicas',       label: 'Dicas' },
  { key: 'documentos',  label: 'Documentos' },
  { key: 'regras',      label: 'Regras' },
  { key: 'cruzeiro',    label: 'Cruzeiro' },
]

function TabLoading() {
  return <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '40px 24px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Carregando…</div>
}

export default function ItineraryDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const perms   = user?.permissions ?? {}
  const canEdit = !!user?.is_superuser || perms.roteiros_edit
  const [tab, setTab] = usePersistedTab('tab_itinerary_detail', 'basic')

  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [data,    setData]    = useState(null)
  const [categories, setCategories] = useState([])
  const [continents, setContinents] = useState([])
  const [accommodationOpts, setAccommodationOpts] = useState([])
  const [paymentPlanOpts, setPaymentPlanOpts]     = useState([])   // modelos das Configurações
  const [paymentMethodOpts, setPaymentMethodOpts] = useState([])   // nomes de formas de pagamento
  const [clauseList, setClauseList] = useState([])                 // cláusulas cadastradas em Config

  const load = useCallback(() => {
    setLoading(true)
    itinerariesApi.get(id)
      .then(r => setData(normalizeItinerary(r.data)))
      .catch(() => toast.error('Erro ao carregar roteiro.'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { load() }, [load])

  const reloadPaymentPlans = useCallback(() => {
    configApi.paymentPlans().then(r => setPaymentPlanOpts(r.data.results ?? r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    configApi.listCategories().then(r => setCategories(r.data.results ?? r.data)).catch(() => {})
    configApi.continents().then(r => setContinents(r.data)).catch(() => {})
    configApi.accommodations().then(r => setAccommodationOpts(r.data.results ?? r.data)).catch(() => {})
    configApi.contractClauses().then(r => setClauseList(r.data.results ?? r.data)).catch(() => {})
    reloadPaymentPlans()
    configApi.paymentMethods().then(r => setPaymentMethodOpts((r.data.results ?? r.data).map(m => m.name))).catch(() => {})
  }, [reloadPaymentPlans])

  // setTab já tem identidade estável (usePersistedTab usa useCallback) → a TabBar
  // (memo) não re-renderiza a cada tecla digitada nos campos.
  const onSelect = setTab

  // Options derivadas memoizadas (identidade estável entre digitações).
  const categoryOptions     = useMemo(() => categories.map(c => ({ value: c.id, label: c.name })), [categories])
  const continentOptions    = useMemo(() => continents.map(c => ({ value: c.id, label: c.name })), [continents])
  const accommodationOptions = useMemo(() => accommodationOpts.map(a => ({ value: a.id, label: a.name })), [accommodationOpts])

  // ── Rascunho + confirmação ao sair (mesmo padrão de PassengerDetail/AgencyDetail) ──
  // O app usa <BrowserRouter> clássico (sem data-router), então NÃO dá useBlocker.
  // Usamos o NavGuardContext: a sidebar e os botões navegam por guardedNavigate; se
  // houver pendência, o guard chama attempt(proceed) e a gente mostra o modal.
  const { setGuard, clearGuard, guardedNavigate } = useNavGuard()
  const [dirty, setDirty] = useState(false)
  const [leavePrompt, setLeavePrompt] = useState(null)   // { proceed } | null
  // setData "de edição": marca dirty (a carga inicial usa setData puro, não marca).
  const editData = useCallback((updater) => { setDirty(true); setData(updater) }, [])
  const isRascunho = data?.status === 'rascunho'
  const hasPending = dirty || isRascunho   // rascunho ou edição não salva
  const hasPendingRef = useRef(hasPending)
  useEffect(() => { hasPendingRef.current = hasPending }, [hasPending])
  // Registra o guard de saída (a sidebar consulta via guardedNavigate).
  useEffect(() => {
    setGuard({ when: () => hasPendingRef.current, attempt: (proceed) => setLeavePrompt({ proceed }) })
    return () => clearGuard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Fechar/atualizar o navegador com pendência → aviso nativo.
  useEffect(() => {
    if (!hasPending) return
    const h = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [hasPending])
  const go = (to) => (guardedNavigate || navigate)(to)

  const buildPayload = (status) => {
      const payload = {
        status,
        name: data.name, slug: data.slug, start_date: data.start_date || null, end_date: data.end_date || null,
        trip_type: data.trip_type, is_own_product: data.is_own_product !== false,
        category: data.category, continent: data.continent,
        base_currency: data.base_currency,
        accommodation_lines: (data.accommodation_lines || []).map(l => ({
          accommodation_type: l.accommodation_type, value_per_person: l.value_per_person || 0, taxes: l.taxes || 0,
        })),
        clauses: data.clauses || [], custom_clauses: (data.custom_clauses || []).filter(c => (c.name || '').trim() || (c.content || '').trim()),
        payment_plans: data.payment_plans || [],
        // Compat com o contrato (que hoje lê UM só): 1º modelo da lista.
        payment_plan: (data.payment_plans || [])[0] ?? null,
        // Override das opções à vista deste roteiro (vazio → null = usa o padrão do sistema).
        a_vista_discount_mode: data.a_vista_discount_mode || 'percent',
        a_vista_discount_value: (data.a_vista_discount_value === '' || data.a_vista_discount_value == null) ? null : Number(data.a_vista_discount_value),
        a_vista_payment_method: data.a_vista_payment_method || '',
        // Novos M2M (arrays de ids) e dia-a-dia. Imagens/documentos NÃO vão aqui —
        // são gerenciados via actions de upload/exclusão, imediatas.
        cities: data.cities || [], countries: data.countries || [], airports: data.airports || [], keywords: data.keywords || [], inclusions: data.inclusions || [],
        days: (data.days || []).map((d, i) => ({
          id: d.id, day_number: i + 1, title: d.title || '', description: d.description || '',
          city: d.city ?? null, order: i,
        })),
      }
      return payload
  }

  // Salva com o status pedido ('ativo' finaliza; 'rascunho' mantém como rascunho).
  const persist = async (status) => {
    setSaving(true)
    try {
      const r = await itinerariesApi.update(id, buildPayload(status))
      setData(normalizeItinerary(r.data))
      setDirty(false)
      return true
    } catch {
      toast.error('Erro ao salvar roteiro.')
      return false
    } finally {
      setSaving(false)
    }
  }
  // Botão "Salvar" do topo: finaliza o roteiro (vira ativo).
  const save = async () => { if (await persist('ativo')) toast.success('Roteiro salvo.') }
  // Botão "Salvar rascunho": salva mantendo como rascunho (não finaliza).
  const saveDraft = async () => { if (await persist('rascunho')) toast.success('Salvo nos rascunhos.') }

  // Ações do modal de confirmação ao sair (proceed vem do guard → navega ao destino).
  const doLeave = () => { const p = leavePrompt; setLeavePrompt(null); p?.proceed?.() }
  const leaveSaving = async (status) => { if (await persist(status)) doLeave() }
  const leaveDiscard = () => doLeave()
  const leaveDelete = async () => {
    try { await itinerariesApi.remove(id) } catch { toast.error('Erro ao apagar.'); return }
    doLeave()
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#94a3b8' }}>Carregando…</div>
  )
  if (!data) return null

  const categoryLabel  = categories.find(c => c.id === data.category)?.name
  const continentLabel = continents.find(c => c.id === data.continent)?.name
  const activeKey = TABS.some(t => t.key === tab) ? tab : 'basic'

  const renderTab = () => {
    switch (activeKey) {
      case 'basic':      return <BasicInfoTab     data={data} setData={editData} canEdit={canEdit} categoryOptions={categoryOptions} />
      case 'destinos':   return <DestinosTab      data={data} setData={editData} canEdit={canEdit} continentOptions={continentOptions} />
      case 'valores':    return <AccommodationTab data={data} setData={editData} canEdit={canEdit} accommodationOptions={accommodationOptions} />
      case 'pagamentos': return <PaymentsTab      data={data} setData={editData} canEdit={canEdit} paymentPlanOpts={paymentPlanOpts} paymentMethodOpts={paymentMethodOpts} reloadPaymentPlans={reloadPaymentPlans} />
      case 'imagens':    return <ImagensTab       data={data} setData={editData} canEdit={canEdit} />
      case 'diaadia':    return <DiaADiaTab       data={data} setData={editData} canEdit={canEdit} />
      case 'regras':     return <ClausesTab       data={data} setData={editData} canEdit={canEdit} clauseList={clauseList} />
      default:           return <PlaceholderTab   title={TABS.find(t => t.key === activeKey)?.label || ''} />
    }
  }

  return (
    <div>
      {/* Cabeçalho */}
      <div className="ph" style={{ alignItems: 'flex-start' }}>
        <div>
          <button onClick={() => go('/roteiros')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 12, fontFamily: 'inherit', padding: 0, marginBottom: 6 }}
            onMouseEnter={e => e.currentTarget.style.color = '#1a2d4f'}
            onMouseLeave={e => e.currentTarget.style.color = '#64748b'}>
            ← Roteiros
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 className="ph-title" style={{ margin: 0 }}>{data.name || 'Roteiro'}</h1>
            {isRascunho && <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: '#fef3c7', color: '#b45309', textTransform: 'uppercase', letterSpacing: '.04em' }}>Rascunho</span>}
          </div>
        </div>
        <div className="ph-actions" style={{ alignItems: 'center', gap: 8 }}>
          {canEdit && isRascunho && (
            <button type="button" onClick={saveDraft} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Ic n="feather" s={13} />{saving ? 'Salvando…' : 'Salvar rascunho'}
            </button>
          )}
          {canEdit && (
            <button type="button" onClick={save} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Ic n="check" s={13} />{saving ? 'Salvando…' : (isRascunho ? 'Salvar e finalizar' : 'Salvar')}
            </button>
          )}
        </div>
      </div>

      {/* Resumo */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 20px', boxShadow: '0 1px 4px rgba(0,0,0,.04)', marginBottom: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 40px', alignItems: 'flex-start' }}>
          <Chip label="Tipo"       value={TYPE_OPTS.find(t => t.value === data.trip_type)?.label} />
          <Chip label="Categoria"  value={categoryLabel} />
          <Chip label="Continente" value={continentLabel} />
          <Chip label="Início"     value={fmtDateBR(data.start_date) || '—'} />
          <Chip label="Término"    value={fmtDateBR(data.end_date) || '—'} />
        </div>
      </div>

      {/* Abas (memoizada) */}
      <TabBar tabs={TABS} active={activeKey} onSelect={onSelect} />

      {/* Conteúdo da aba ativa — lazy + só a ativa é montada */}
      <Suspense fallback={<TabLoading />}>
        {renderTab()}
      </Suspense>

      {/* Confirmação ao sair — MESMO modal dos contratos (LeaveGuardModal) */}
      {leavePrompt && (
        <LeaveGuardModal
          entity="roteiro"
          saving={saving}
          onStay={() => setLeavePrompt(null)}
          onDiscard={isRascunho ? leaveDelete : leaveDiscard}
          onSaveDraft={isRascunho ? () => leaveSaving('rascunho') : undefined}
          onSave={() => leaveSaving('ativo')}
        />
      )}
    </div>
  )
}
