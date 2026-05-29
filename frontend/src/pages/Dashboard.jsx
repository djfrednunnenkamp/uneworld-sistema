import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { dashboardApi } from '../api'
import { StatusBadge } from '../components/DataTable'

const fmt = (d) => {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

const STATS_CFG = [
  { key: 'total_passengers', label: 'Passageiros', subKey: null,          nav: '/passageiros', color: '#e8f0fb', ico: '#2e6db4', icon: 'users'    },
  { key: 'active_trips',     label: 'Viagens',     subKey: null,          nav: '/viagens',     color: '#dcfce7', ico: '#15803d', icon: 'plane'    },
  { key: 'upcoming_meetings',label: 'Reuniões',    subKey: null,          nav: '/reunioes',    color: '#ede9fe', ico: '#7c3aed', icon: 'calendar' },
  { key: 'total_enrollments',label: 'Inscrições',  subKey: null,          nav: '/viagens',     color: '#dbeafe', ico: '#1d4ed8', icon: 'users'    },
]

const Ic = ({ n, s = 18 }) => {
  const PATHS = {
    users:    ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
    plane:    ['M22 2L11 13','M22 2L15 22l-4-9-9-4 19-7z'],
    calendar: ['M3 4h18v18H3z','M16 2v4','M8 2v4','M3 10h18'],
    globe:    ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z','M2 12h20'],
  }
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      {(PATHS[n] || []).map((d, i) => <path key={i} d={d}/>)}
    </svg>
  )
}

export default function Dashboard() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate              = useNavigate()

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

  const { stats, upcoming_meetings, active_trips } = data

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
            <div className="scard-val">{stats[cfg.key] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* ── Recent trips ── */}
      <div className="tcard">
        <div className="tcard-head">
          <span>Viagens recentes</span>
          <button className="btn btn-outline" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => navigate('/viagens')}>
            Ver todas
          </button>
        </div>
        <table className="dt">
          <thead>
            <tr>
              <th>Destino</th>
              <th>Partida</th>
              <th>Retorno</th>
              <th>Passageiros</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {active_trips.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="empty-state"><p>Nenhuma viagem ativa</p></div>
                </td>
              </tr>
            ) : active_trips.slice(0, 5).map((t) => (
              <tr key={t.id}>
                <td><span className="t-name">{t.title}</span><br/><span className="t-muted">{t.destination}</span></td>
                <td>{fmt(t.departure_date)}</td>
                <td>{fmt(t.return_date)}</td>
                <td>{t.enrolled_count} / {(t.enrolled_count ?? 0) + (t.available_spots ?? 0)}</td>
                <td><StatusBadge value={t.status.toLowerCase().replace(' ', '_').replace('ç','c').replace('í','i').replace('â','a').replace('ã','a') || t.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Upcoming meetings ── */}
      {upcoming_meetings.length > 0 && (
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
