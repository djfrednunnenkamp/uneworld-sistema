import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { dashboardApi, agendaApi } from '../api'
import { useAuth } from '../context/AuthContext'
import { canAccess } from '../utils/permissions'
import { Ic } from '../components/Icon'

const fmt = (d) => {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

const fmtDt = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
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
  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:500, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:960, height:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 64px rgba(0,0,0,.3)' }}>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div>
            <p style={{ margin:'0 0 2px', fontSize:13, fontWeight:700, color:'#0f172a' }}>{log.subject}</p>
            <p style={{ margin:0, fontSize:11.5, color:'#94a3b8' }}>Para: {log.to} &nbsp;·&nbsp; {fmtDt(log.sent_at)}</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:20, padding:4 }}>×</button>
        </div>
        <div style={{ flex:1, overflow:'hidden', borderRadius:'0 0 12px 12px' }}>
          <iframe
            srcDoc={log.html_body}
            title="preview"
            style={{ width:'100%', height:'100%', border:'none' }}
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  )
}

function EmailLogWidget({ canView, canPreview }) {
  const [logs, setLogs]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [preview, setPreview]   = useState(null)
  const [loadingId, setLoadingId] = useState(null)

  useEffect(() => {
    if (!canView) return
    agendaApi.emailLog()
      .then(r => setLogs(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [canView])

  const openPreview = useCallback(async (id) => {
    if (!canPreview) return
    setLoadingId(id)
    try {
      const r = await agendaApi.emailLogDetail(id)
      setPreview(r.data)
    } catch {}
    finally { setLoadingId(null) }
  }, [canPreview])

  return (
    <div className="tcard" style={{ flex:'0 0 480px', minWidth:0, display:'flex', flexDirection:'column' }}>
      <div className="tcard-head">
        <span style={{ display:'flex', alignItems:'center', gap:6 }}>
          <Ic n="ul" s={14}/> E-mails enviados
        </span>
      </div>
      <div style={{ overflowY:'auto', flex:1, maxHeight:400 }}>
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
  const navigate                   = useNavigate()
  const { user } = useAuth()
  const perms    = user?.permissions ?? {}
  const can = (key) => !!user?.is_superuser || !!perms[key]

  useEffect(() => {
    dashboardApi.getStats()
      .then((r) => setData(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
    agendaApi.emailLogSettings()
      .then(r => setEmailCfg(r.data))
      .catch(() => {})
  }, [])

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
      <div style={{ display:'flex', gap:16, alignItems:'flex-start' }}>

        {/* Listas de passageiros recentes */}
        {can('dashboard_view_lists') && (
        <div className="tcard" style={{ flex:1, minWidth:0 }}>
          <div className="tcard-head">
            <span>Listas de Passageiros recentes</span>
            {canAccess(user, '/viagens') && (
              <button className="btn btn-outline" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => navigate('/viagens')}>
                Ver todas
              </button>
            )}
          </div>
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
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                      background: l.status === 'aberta' ? '#dcfce7' : '#f1f5f9',
                      color:      l.status === 'aberta' ? '#16a34a' : '#64748b',
                    }}>
                      {l.status === 'aberta' ? 'Aberta' : 'Fechada'}
                    </span>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        )}

        {/* Widget de e-mails enviados */}
        {showEmailLog && (
          <EmailLogWidget
            canView={emailCfg.can_view}
            canPreview={emailCfg.can_preview}
          />
        )}
      </div>
    </div>
  )
}
