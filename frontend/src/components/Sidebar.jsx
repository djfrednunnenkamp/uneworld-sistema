import { useState, useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Ic } from './Icon'
import { useAuth } from '../context/AuthContext'
import { useWebSocket } from '../hooks/useWebSocket'

const NAV_BASE = [
  { id: '/',           icon: 'grid',     label: 'Visão Geral', group: null,     perms: null },
  { id: '/passageiros',icon: 'users',    label: 'Passageiros', group: 'GESTÃO', perms: ['passengers_view_basic', 'passengers_view_full'] },
  { id: '/agencias',   icon: 'building', label: 'Agências',    group: 'GESTÃO', perms: ['agencies_view'] },
  { id: '/viagens',    icon: 'plane',    label: 'Listas de Passageiros',      group: 'GESTÃO', perms: ['lists_view'] },
  { id: '/calendario', icon: 'calendar', label: 'Calendário',  group: 'GESTÃO', perms: ['calendar_view'] },
  { id: '/usuarios',      icon: 'users',    label: 'Usuários',      group: 'SISTEMA', perms: ['manage_users', 'users_view', 'users_edit', 'users_delete', 'users_manage_permissions'] },
  { id: '/configuracoes', icon: 'settings', label: 'Configurações',  group: 'SISTEMA', perms: ['manage_settings', 'settings_view', 'settings_professions', 'settings_languages', 'settings_countries', 'settings_genders', 'settings_vaccines', 'settings_doc_types', 'settings_prof_cards', 'settings_user_profiles', 'settings_destinations', 'settings_list_additionals', 'settings_crew_roles'] },
  { id: '/log',           icon: 'list',    label: 'Log do Sistema',  group: 'SISTEMA', perms: ['view_audit_log', 'log_view', 'log_passengers', 'log_lists', 'log_agencies', 'log_users', 'log_settings'] },
]

export default function Sidebar() {
  const { pathname } = useLocation()
  const navigate     = useNavigate()
  const { user } = useAuth()
  let lastGroup      = null

  const hasAccess = (perms) =>
    !perms || user?.is_superuser || perms.some(p => user?.permissions?.[p])

  const NAV = NAV_BASE.filter(item => hasAccess(item.perms))

  /* Jobs de importação em background (vacinas, países, aeroportos…) — barra de
     progresso ao vivo recebida via WebSocket, visível em qualquer tela. */
  const [jobs, setJobs] = useState({}) // job_id -> { kind, label, done, total, status, _seenAt }
  const wsUrl = user ? `ws://${window.location.hostname}:8000/ws/dashboard/` : null
  useWebSocket(wsUrl, useCallback((msg) => {
    if (msg.type !== 'job') return
    setJobs(prev => {
      const next = { ...prev, [msg.job_id]: { ...msg, _seenAt: Date.now() } }
      if (msg.status === 'done' || msg.status === 'error') {
        setTimeout(() => setJobs(p => { const n = { ...p }; delete n[msg.job_id]; return n }), msg.status === 'error' ? 15000 : 2500)
      }
      return next
    })
  }, []))

  // Watchdog: se uma conexão WS cair no meio de um job e perdermos o evento
  // final, a barra não pode ficar travada para sempre — some sozinha depois
  // de 20s sem nenhuma atualização nova.
  useEffect(() => {
    const t = setInterval(() => {
      setJobs(prev => {
        const cutoff = Date.now() - 20000
        const next = Object.fromEntries(Object.entries(prev).filter(([, j]) => j._seenAt > cutoff))
        return Object.keys(next).length === Object.keys(prev).length ? prev : next
      })
    }, 5000)
    return () => clearInterval(t)
  }, [])

  const activeJobs = Object.values(jobs)

  return (
    <div className="sidebar">
      {/* Logo */}
      <div className="sb-logo" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <img src="/logo.png" alt="UneWorld Turismo" style={{ height: 48, width: 'auto', display: 'block' }} />
      </div>

      {/* Nav */}
      <nav className="sb-nav">
        {NAV.map((item) => {
          const showGroup = item.group && item.group !== lastGroup
          if (item.group) lastGroup = item.group
          const isActive  = item.id === '/'
            ? pathname === '/'
            : pathname.startsWith(item.id)

          return (
            <div key={item.id}>
              {showGroup && <div className="sb-group">{item.group}</div>}
              <button
                className={`sb-item${isActive ? ' active' : ''}`}
                onClick={() => navigate(item.id)}
              >
                <Ic n={item.icon} s={16} />
                {item.label}
              </button>
            </div>
          )
        })}
      </nav>

      {/* Progresso de importações em background (vacinas, países, aeroportos…) */}
      {activeJobs.length > 0 && (
        <div className="sb-foot" style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {activeJobs.map(job => {
            const pct = job.status === 'done' ? 100 : Math.min(99, Math.round((job.done / (job.total || 1)) * 100))
            const isError = job.status === 'error'
            return (
              <div key={job.job_id}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:4 }}
                  title={isError ? (job.error || 'Erro desconhecido') : undefined}>
                  <span style={{ fontSize:11.5, color: isError ? '#fca5a5' : 'rgba(255,255,255,.75)', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:130 }}>
                    {isError ? `Erro: ${job.label}` : job.label}
                  </span>
                  <span style={{ fontSize:11, color:'rgba(255,255,255,.45)', flexShrink:0, marginLeft:6 }}>
                    {isError ? '' : `${pct}%`}
                  </span>
                </div>
                <div style={{ height:5, borderRadius:99, background:'rgba(255,255,255,.12)', overflow:'hidden' }}>
                  <div style={{
                    height:'100%', borderRadius:99, transition:'width .25s ease',
                    width: isError ? '100%' : `${pct}%`,
                    background: isError ? '#dc2626' : (job.status === 'done' ? '#22c55e' : '#2e6db4'),
                  }} />
                </div>
                {isError && job.error && (
                  <p style={{ fontSize:10.5, color:'#fca5a5', margin:'3px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                    title={job.error}>
                    {job.error}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
