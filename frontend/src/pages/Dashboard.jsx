import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { dashboardApi } from '../api'
import { useAuth } from '../context/AuthContext'
import { Ic } from '../components/Icon'

const fmt = (d) => {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

const TYPE_LABEL = { aereo: 'Via Aéreo', terrestre: 'Via Terrestre' }

const STATS_CFG = [
  { key: 'total_passengers', label: 'Passageiros',   nav: '/passageiros', color: '#e8f0fb', ico: '#2e6db4', icon: 'users',    perm: 'dashboard_view_passengers'  },
  { key: 'open_lists',       label: 'Listas Abertas', nav: '/viagens',    color: '#dcfce7', ico: '#15803d', icon: 'plane',    perm: 'dashboard_view_lists'       },
  { key: 'upcoming_meetings',label: 'Reuniões',       nav: '/reunioes',   color: '#ede9fe', ico: '#7c3aed', icon: 'calendar', perm: 'dashboard_view_meetings'    },
  { key: 'total_enrollments',label: 'Inscrições',     nav: '/viagens',    color: '#dbeafe', ico: '#1d4ed8', icon: 'users',    perm: 'dashboard_view_enrollments' },
]

export default function Dashboard() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate              = useNavigate()
  const { user } = useAuth()
  const perms    = user?.permissions ?? {}
  const can = (key) => !!user?.is_superuser || !!perms[key]

  useEffect(() => {
    dashboardApi.getStats()
      .then((r) => setData(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
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

  const { stats, upcoming_meetings, recent_lists } = data

  return (
    <div>
      <div className="ph"><h1 className="ph-title">Visão Geral</h1></div>

      {/* ── Stats ── */}
      <div className="stats">
        {STATS_CFG.map((cfg) => (
          <div key={cfg.key} className="scard" onClick={() => navigate(cfg.nav)}>
            <div className="scard-ico" style={{ background: cfg.color }}>
              <span style={{ color: cfg.ico }}><Ic n={cfg.icon} s={18}/></span>
            </div>
            <div className="scard-label">{cfg.label}</div>
            <div className="scard-val">{can(cfg.perm) ? (stats[cfg.key] ?? 0) : '—'}</div>
          </div>
        ))}
      </div>

      {/* ── Recent passenger lists ── */}
      {can('dashboard_view_lists') && (
      <div className="tcard">
        <div className="tcard-head">
          <span>Listas de Passageiros recentes</span>
          <button className="btn btn-outline" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => navigate('/viagens')}>
            Ver todas
          </button>
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
            ) : recent_lists.map((l) => (
              <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/viagens/${l.id}`)}>
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
            ))}
          </tbody>
        </table>
      </div>
      )}

      {/* ── Upcoming meetings ── */}
      {can('dashboard_view_meetings') && upcoming_meetings.length > 0 && (
        <div className="tcard" style={{ marginTop: 16 }}>
          <div className="tcard-head">
            <span>Próximas reuniões</span>
            <button className="btn btn-outline" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => navigate('/reunioes')}>
              Ver todas
            </button>
          </div>
          <table className="dt">
            <thead>
              <tr>
                <th>Título</th>
                <th>Data</th>
                <th>Local</th>
                <th>Participantes</th>
              </tr>
            </thead>
            <tbody>
              {upcoming_meetings.slice(0, 4).map((m) => (
                <tr key={m.id}>
                  <td><span className="t-name">{m.title}</span></td>
                  <td>{new Date(m.scheduled_at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="t-muted">{m.location || '—'}</td>
                  <td>{m.participant_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
