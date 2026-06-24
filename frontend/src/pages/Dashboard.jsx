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

  const { stats, recent_lists } = data
  const showEmailLog = emailCfg?.can_view

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
                </tr>
              </thead>
              <tbody>
                {recent_lists.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
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
