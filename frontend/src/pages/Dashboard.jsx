import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { dashboardApi } from '../api'
import { useAuth } from '../context/AuthContext'
import { canAccess } from '../utils/permissions'
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

  const { stats, recent_lists } = data

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

      {/* ── Recent passenger lists ── */}
      {can('dashboard_view_lists') && (
      <div className="tcard">
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
    </div>
  )
}
