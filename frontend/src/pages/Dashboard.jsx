import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { dashboardApi, agendaApi } from '../api'
import { useAuth } from '../context/AuthContext'
import { usePrefs } from '../context/PrefsContext'
import { canAccess } from '../utils/permissions'
import { Ic } from '../components/Icon'
import { fmtDateTime } from '../utils/timeFormat'
import { useWebSocket } from '../hooks/useWebSocket'
import { dashboardWsUrl } from '../utils/ws'

const fmt = (d) => {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

const TYPE_LABEL = { aereo: 'Via Aéreo', terrestre: 'Via Terrestre' }

// Indicador de entrega — confirmado pela Resend via webhook (confiável).
function deliveryBadge(log) {
  if (!log.success || log.status === 'failed') return { icon: 'x', color: '#dc2626', title: 'Falhou ao enviar' }
  if (log.status === 'bounced')   return { icon: 'x',     color: '#dc2626', title: 'Não entregue (rejeitado pelo servidor de destino)' }
  if (log.status === 'delivered') return { icon: 'check', color: '#15803d', title: 'Entregue' }
  return { icon: 'clock', color: '#94a3b8', title: 'Enviado — aguardando confirmação de entrega' }
}

// Indicador de leitura — baseado em pixel de rastreamento da Resend. Um "lido"
// é confiável, mas a ausência não garante que não foi lido: alguns provedores
// (Gmail, Apple Mail) bloqueiam ou pré-carregam imagens, então o evento de
// abertura pode nunca chegar mesmo com o e-mail tendo sido aberto.
function openBadge(log) {
  if (log.opened_at) return { icon: 'check', color: '#15803d', title: 'Lido' }
  return { icon: 'x', color: '#cbd5e1', title: 'Ainda sem confirmação de leitura (pode ter sido lido mesmo assim)' }
}

const EMAIL_TYPE_CFG = {
  daily_digest:   { label: 'Digest diário',          color: '#dbeafe', fg: '#1d4ed8' },
  digest:         { label: 'Resumo do calendário',   color: '#e0f2fe', fg: '#0369a1' },
  deadline:       { label: 'Prazo de confirmação',   color: '#fef3c7', fg: '#b45309' },
  task:           { label: 'Pendência',              color: '#dcfce7', fg: '#15803d' },
  birthday:       { label: 'Aniversário',            color: '#ede9fe', fg: '#7c3aed' },
  reset_password: { label: 'Redefinição de senha',   color: '#fee2e2', fg: '#dc2626' },
  invite:         { label: 'Convite',                color: '#d1fae5', fg: '#059669' },
  other:          { label: 'Outro',                  color: '#f1f5f9', fg: '#64748b' },
}

const STATS_CFG = [
  { key: 'total_passengers', label: 'Passageiros',   nav: '/passageiros', color: '#e8f0fb', ico: '#2e6db4', icon: 'users',    perm: 'dashboard_view_passengers'  },
  { key: 'open_lists',       label: 'Listas Abertas', nav: '/viagens',    color: '#dcfce7', ico: '#15803d', icon: 'plane',    perm: 'dashboard_view_lists'       },
  { key: 'total_enrollments',label: 'Inscrições',     nav: '/viagens',    color: '#dbeafe', ico: '#1d4ed8', icon: 'users',    perm: 'dashboard_view_enrollments' },
]

/* Mini-gráfico da última semana — desenhado atrás da linha do câmbio, só pra
 * dar um toque visual. Precisa de pelo menos 2 pontos pra virar uma linha. */
function Sparkline({ data, color = '#b45309' }) {
  if (!data || data.length < 2) return null
  const w = 100, h = 28
  const min = Math.min(...data), max = Math.max(...data)
  const span = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / span) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const line = pts.join(' ')
  const area = `0,${h} ${line} ${w},${h}`
  const up = data[data.length - 1] >= data[0]
  const stroke = up ? '#16a34a' : '#dc2626'
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', display: 'block' }}>
      <polygon points={area} fill={stroke} opacity="0.1" />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// Variação % entre o 1º e o último ponto do histórico (null se < 2 pontos).
function pctChange(h) {
  if (!h || h.length < 2) return null
  const first = h[0], last = h[h.length - 1]
  if (!first) return null
  return ((last - first) / first) * 100
}

function TrendCaret({ up }) {
  return (
    <svg width="8" height="8" viewBox="0 0 10 10" style={{ display: 'block' }}>
      <path d={up ? 'M5 2.5l3.5 5h-7z' : 'M5 7.5l-3.5-5h7z'} fill="currentColor" />
    </svg>
  )
}

// Faixa horizontal de câmbio (full-width) — uma coluna por moeda favorita,
// com código + variação %, taxa e mini-gráfico da semana.
function ExchangeStrip({ rates, timeFormat, clickable, onClick }) {
  const fmtRate = (r) => {
    if (r?.rate == null) return '—'
    const n = Number(r.rate).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    return r.to_currency === 'BRL' ? `R$ ${n}` : n
  }
  const target = rates.length && rates.every((r) => r.to_currency === rates[0].to_currency) ? rates[0].to_currency : null
  const lastUpd = rates.reduce((acc, r) => (r.updated_at && (!acc || r.updated_at > acc) ? r.updated_at : acc), null)
  return (
    <div className="tcard" onClick={clickable ? onClick : undefined}
      style={{ padding: 0, overflow: 'hidden', marginBottom: 22, cursor: clickable ? 'pointer' : 'default' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 14px', borderBottom: '1px solid #eef2f7', background: '#fbfcfe' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: '#94a3b8' }}>
          <span style={{ color: '#b45309', display: 'flex' }}><Ic n="rotate" s={13} /></span>
          CÂMBIO{target ? ` · ${target}` : ''}
        </div>
        <div style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 600, whiteSpace: 'nowrap' }}>
          7 dias{lastUpd ? ` · ${fmtDateTime(lastUpd, timeFormat)}` : ''}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {rates.map((r, i) => {
          const pct = pctChange(r.history)
          const up = pct == null ? null : pct >= 0
          const col = up == null ? '#94a3b8' : (up ? '#16a34a' : '#dc2626')
          return (
            <div key={r.id} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 14px', borderLeft: i === 0 ? 'none' : '1px solid #f1f5f9' }}>
              <div style={{ minWidth: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                  <span>{target ? r.from_currency : `${r.from_currency} → ${r.to_currency}`}</span>
                  {pct != null && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 2, color: col, fontWeight: 700 }}>
                      <TrendCaret up={up} />{Math.abs(pct).toFixed(2)}%
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', letterSpacing: '-.02em', whiteSpace: 'nowrap', marginTop: 2 }}>{fmtRate(r)}</div>
              </div>
              <div style={{ width: 62, height: 30, flexShrink: 0 }}>
                <Sparkline data={r.history} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EmailPreviewModal({ log, onClose }) {
  const iframeRef = useRef(null)
  const { timeFormat } = usePrefs()
  const fmtDt = (iso) => fmtDateTime(iso, timeFormat)

  // Processa o HTML do e-mail:
  // - Links de fluxo de autenticação (reset/invite) → _blank (nova aba, isolada)
  // - Outros links internos da app → _top (navega na mesma aba do app)
  // - Links externos → _blank (via base tag)
  const AUTH_PATHS = /\/(redefinir-senha|aceitar-convite)/
  const srcDoc = (() => {
    if (!log.html_body) return ''
    try {
      const doc = new DOMParser().parseFromString(log.html_body, 'text/html')
      const base = doc.createElement('base')
      base.target = '_blank'
      base.rel = 'noreferrer'
      doc.head.insertBefore(base, doc.head.firstChild)
      const appOrigin = window.location.origin
      doc.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || ''
        const isInternal = href.startsWith(appOrigin) || href.startsWith('/')
        const isAuthFlow = AUTH_PATHS.test(href)
        if (isInternal && !isAuthFlow) {
          // Link para página interna normal: abre na aba atual do app
          a.target = '_top'
          a.removeAttribute('rel')
        } else if (isAuthFlow) {
          // Nova aba com opener acessível para window.opener funcionar
          a.target = '_blank'
          a.setAttribute('rel', 'opener')
        }
      })
      return doc.documentElement.outerHTML
    } catch {
      return log.html_body
    }
  })()

  const handleLoad = () => {
    const iframe = iframeRef.current
    if (!iframe) return
    try {
      const h = iframe.contentDocument.body.scrollHeight
      iframe.style.height = h + 'px'
    } catch {}
  }

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:500, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:620, maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 64px rgba(0,0,0,.3)' }}>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div>
            <p style={{ margin:'0 0 2px', fontSize:13, fontWeight:700, color:'#0f172a' }}>{log.subject}</p>
            <p style={{ margin:0, fontSize:11.5, color:'#94a3b8' }}>Para: {log.to} &nbsp;·&nbsp; {fmtDt(log.sent_at)}</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:20, padding:4 }}>×</button>
        </div>
        <div style={{ overflowY:'auto', borderRadius:'0 0 12px 12px' }}>
          <iframe
            ref={iframeRef}
            srcDoc={srcDoc}
            title="preview"
            onLoad={handleLoad}
            style={{ width:'100%', border:'none', display:'block' }}
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
          />
        </div>
      </div>
    </div>
  )
}

function EmailLogWidget({ canView, canPreview, canResend, timeFormat, refreshKey }) {
  const [logs, setLogs]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [preview, setPreview]   = useState(null)
  const [loadingId, setLoadingId]     = useState(null)
  const [resendingId, setResendingId] = useState(null)
  const fmtDt = (iso) => fmtDateTime(iso, timeFormat)

  useEffect(() => {
    if (!canView) return
    agendaApi.emailLog()
      .then(r => setLogs(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [canView, refreshKey])

  const openPreview = useCallback(async (id) => {
    if (!canPreview) return
    setLoadingId(id)
    try {
      const r = await agendaApi.emailLogDetail(id)
      setPreview(r.data)
    } catch {}
    finally { setLoadingId(null) }
  }, [canPreview])

  const handleResend = useCallback(async (e, id) => {
    e.stopPropagation()
    if (resendingId) return
    setResendingId(id)
    try {
      const r = await agendaApi.emailLogResend(id)
      toast.success(r.data.message ?? 'E-mail reenviado com sucesso.')
    } catch (err) {
      const msg = err?.response?.data?.detail ?? 'Erro ao reenviar o e-mail.'
      toast.error(msg)
    } finally {
      setResendingId(null)
    }
  }, [resendingId])

  return (
    <div className="tcard" style={{ flex:'0 0 480px', minWidth:0, display:'flex', flexDirection:'column' }}>
      <div className="tcard-head">
        <span style={{ display:'flex', alignItems:'center', gap:6 }}>
          <Ic n="mail" s={14}/> E-mails enviados
        </span>
      </div>
      <div style={{ overflowY:'auto', flex:1 }}>
        {loading ? (
          <p style={{ padding:'16px', fontSize:13, color:'#94a3b8', margin:0 }}>Carregando…</p>
        ) : logs.length === 0 ? (
          <div className="empty-state" style={{ padding:24 }}><p>Nenhum e-mail enviado ainda</p></div>
        ) : logs.map(log => {
          const cfg = EMAIL_TYPE_CFG[log.email_type] ?? EMAIL_TYPE_CFG.other
          const clickable = canPreview && loadingId !== log.id
          return (
            <div key={log.id}
              onClick={clickable ? () => openPreview(log.id) : undefined}
              style={{
                padding:'10px 14px', borderBottom:'1px solid #f1f5f9', cursor: clickable ? 'pointer' : 'default',
                transition:'background .1s',
              }}
              onMouseEnter={e => { if (clickable) e.currentTarget.style.background = '#f8fafc' }}
              onMouseLeave={e => { e.currentTarget.style.background = '' }}>
              {/* top row: badge + time + eye */}
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:999, background:cfg.color, color:cfg.fg, whiteSpace:'nowrap' }}>
                  {cfg.label}
                </span>
                {!log.success && (
                  <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:999, background:'#fee2e2', color:'#dc2626' }}>Falhou</span>
                )}
                {(() => { const b = deliveryBadge(log); return (
                  <span title={`Entrega: ${b.title}`} style={{ display:'flex', color:b.color }}><Ic n={b.icon} s={12}/></span>
                ) })()}
                {(() => { const b = openBadge(log); return (
                  <span title={`Leitura: ${b.title}`} style={{ display:'flex', color:b.color }}><Ic n={b.icon} s={12}/></span>
                ) })()}
                <span style={{ flex:1 }}/>
                <span style={{ fontSize:11, color:'#94a3b8', whiteSpace:'nowrap' }}>{fmtDt(log.sent_at)}</span>
                {canResend && (log.email_type === 'reset_password' || log.email_type === 'invite') && (
                  <button
                    onClick={e => handleResend(e, log.id)}
                    disabled={!!resendingId}
                    title="Reenviar e-mail"
                    style={{ background:'none', border:'none', padding:'2px 4px', cursor: resendingId ? 'wait' : 'pointer', color: resendingId === log.id ? '#2563eb' : '#94a3b8', display:'flex', borderRadius:4, transition:'color .1s' }}
                    onMouseEnter={e => { if (!resendingId) e.currentTarget.style.color = '#2563eb' }}
                    onMouseLeave={e => { if (resendingId !== log.id) e.currentTarget.style.color = '#94a3b8' }}
                  >
                    <Ic n={resendingId === log.id ? 'clock' : 'rotate'} s={13}/>
                  </button>
                )}
                {canPreview && (
                  loadingId === log.id
                    ? <span style={{ fontSize:10, color:'#94a3b8' }}>…</span>
                    : <span style={{ color:'#94a3b8', display:'flex' }}><Ic n="eye" s={13}/></span>
                )}
              </div>
              {/* bottom row: subject + recipient */}
              <p style={{ margin:'0 0 2px', fontSize:12.5, fontWeight:500, color:'#1e293b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {log.subject}
              </p>
              <p style={{ margin:0, fontSize:11.5, color:'#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {log.to}
              </p>
            </div>
          )
        })}
      </div>
      {preview && <EmailPreviewModal log={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

export default function Dashboard() {
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [emailCfg, setEmailCfg]   = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const navigate                   = useNavigate()
  const { user } = useAuth()
  const { timeFormat } = usePrefs()
  const perms    = user?.permissions ?? {}
  const can = (key) => !!user?.is_superuser || !!perms[key]

  // Fetch inicial
  useEffect(() => {
    dashboardApi.getStats()
      .then((r) => setData(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
    agendaApi.emailLogSettings()
      .then(r => setEmailCfg(r.data))
      .catch(() => {})
  }, [])

  // Refetch silencioso quando WebSocket sinaliza mudança
  const reloadStats = useCallback(() => {
    dashboardApi.getStats()
      .then((r) => setData(r.data))
      .catch(() => {})
  }, [])

  const wsUrl = user ? dashboardWsUrl() : null

  useWebSocket(wsUrl, useCallback((msg) => {
    if (msg.type !== 'refresh') return
    const scope = msg.scope ?? 'all'
    if (scope === 'emails') {
      // só o widget de e-mails precisa atualizar
      setRefreshKey(k => k + 1)
    } else {
      // stats, lists ou all — atualiza tudo
      reloadStats()
      setRefreshKey(k => k + 1)
    }
  }, [reloadStats]), { enabled: !!user })

  if (loading) {
    return (
      <div>
        <div className="ph"><h1 className="ph-title">Visão Geral</h1></div>
        <p style={{ color: '#94a3b8', fontSize: 14 }}>Carregando…</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div>
        <div className="ph"><h1 className="ph-title">Visão Geral</h1></div>
        <p style={{ color: '#dc2626', fontSize: 14 }}>Erro ao carregar dados. Verifique se o backend está rodando.</p>
      </div>
    )
  }

  const { stats, recent_lists, exchange_rates } = data
  const showEmailLog = emailCfg?.can_view
  const showExchangeRate = can('settings_exchange_rates_view')

  return (
    <div>
      <div className="ph"><h1 className="ph-title">Visão Geral</h1></div>

      {/* ── Stats ── */}
      <div className="stats">
        {STATS_CFG.map((cfg) => {
          const navAllowed = canAccess(user, cfg.nav)
          return (
            <div key={cfg.key} className="scard"
              onClick={navAllowed ? () => navigate(cfg.nav) : undefined}
              style={{ cursor: navAllowed ? 'pointer' : 'default' }}>
              <div className="scard-ico" style={{ background: cfg.color }}>
                <span style={{ color: cfg.ico }}><Ic n={cfg.icon} s={18}/></span>
              </div>
              <div className="scard-label">{cfg.label}</div>
              <div className="scard-val">{can(cfg.perm) ? (stats[cfg.key] ?? 0) : '—'}</div>
            </div>
          )
        })}

      </div>

      {/* ── Câmbio (faixa horizontal) ── */}
      {showExchangeRate && (exchange_rates?.length ? (
        <ExchangeStrip
          rates={exchange_rates}
          timeFormat={timeFormat}
          clickable={canAccess(user, '/configuracoes')}
          onClick={() => navigate('/configuracoes')}
        />
      ) : (
        <div className="tcard" style={{ padding: '12px 16px', marginBottom: 22, fontSize: 13, color: '#94a3b8' }}>
          Marque moedas favoritas (★) em Configurações para acompanhar o câmbio aqui.
        </div>
      ))}

      {/* ── Bottom row: listas + email log ── */}
      <div style={{ display:'flex', gap:16, alignItems:'stretch', maxHeight:480 }}>

        {/* Listas de passageiros recentes */}
        {can('dashboard_view_lists') && (
        <div className="tcard" style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column' }}>
          <div className="tcard-head">
            <span>Listas de Passageiros recentes</span>
            {canAccess(user, '/viagens') && (
              <button className="btn btn-outline" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => navigate('/viagens')}>
                Ver todas
              </button>
            )}
          </div>
          <div style={{ flex:1, overflowY:'auto' }}>
            <table className="dt">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Tipo</th>
                  <th>Início</th>
                  <th>Término</th>
                  <th>Passageiros</th>
                  <th>Status</th>
                  <th>Última atualização</th>
                </tr>
              </thead>
              <tbody>
                {recent_lists.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-state"><p>Nenhuma lista de passageiros criada</p></div>
                    </td>
                  </tr>
                ) : recent_lists.map((l) => {
                  const rowNav = canAccess(user, `/viagens/${l.id}`)
                  return (
                  <tr key={l.id} style={{ cursor: rowNav ? 'pointer' : 'default' }} onClick={rowNav ? () => navigate(`/viagens/${l.id}`) : undefined}>
                    <td><span className="t-name">{l.name}</span><br/><span className="t-muted">{l.category}</span></td>
                    <td>{TYPE_LABEL[l.list_type] || l.list_type}</td>
                    <td>{fmt(l.start_date) || '—'}</td>
                    <td>{fmt(l.end_date) || '—'}</td>
                    <td>{l.enrolled_count} / {l.block_capacity}</td>
                    <td>
                      {l.is_ongoing ? (
                        <span style={{ fontSize:11, fontWeight:700, padding:'2px 10px', borderRadius:20, background:'#dbeafe', color:'#1d4ed8' }}>
                          Em andamento
                        </span>
                      ) : (
                        <span style={{
                          fontSize:11, fontWeight:700, padding:'2px 10px', borderRadius:20,
                          background: l.status === 'aberta' ? '#dcfce7' : '#f1f5f9',
                          color:      l.status === 'aberta' ? '#16a34a' : '#64748b',
                        }}>
                          {l.status === 'aberta' ? 'Aberta' : 'Fechada'}
                        </span>
                      )}
                    </td>
                    <td style={{ color: '#64748b', fontSize: 12.5 }}>{fmtDateTime(l.updated_at, timeFormat) || '—'}</td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* Widget de e-mails enviados */}
        {showEmailLog && (
          <EmailLogWidget
            canView={emailCfg.can_view}
            canPreview={emailCfg.can_preview}
            canResend={emailCfg.can_resend}
            timeFormat={timeFormat}
            refreshKey={refreshKey}
          />
        )}
      </div>
    </div>
  )
}
