import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Plus, Map, Search, Edit2, Trash2 } from 'lucide-react'
import { tripsApi } from '../api'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'

export default function Destinations() {
  const [destinations, setDestinations] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')

  const load = (q = '') => {
    setLoading(true)
    tripsApi.destinations()
      .then((r) => {
        const all = r.data.results ?? r.data
        setDestinations(q
          ? all.filter((d) =>
              d.name.toLowerCase().includes(q.toLowerCase()) ||
              d.country.toLowerCase().includes(q.toLowerCase()))
          : all)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  return (
    <div className="space-y-5">

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900 leading-tight">Destinos</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {loading ? 'Carregando…' : `${destinations.length} destino${destinations.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Button variant="primary" icon={Plus}>Adicionar Destino</Button>
      </div>

      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 hover:border-slate-300 transition-colors w-72">
        <Search size={14} style={{ color: '#94A3B8' }} className="flex-shrink-0" />
        <input
          type="text"
          placeholder="Buscar por nome ou país…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); load(e.target.value) }}
          className="flex-1 text-sm text-slate-700 outline-none placeholder:text-slate-300 bg-transparent"
        />
      </div>

      {loading ? (
        <Spinner />
      ) : destinations.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl text-center py-20">
          <Map size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-semibold text-sm mb-1">Nenhum destino cadastrado</p>
          <p className="text-slate-400 text-xs">Adicione o primeiro destino para começar.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {destinations.map((d) => (
            <div key={d.id} className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                  <Map size={16} className="text-slate-500" />
                </div>
                <div className="flex gap-1">
                  {[
                    { icon: Edit2,  title: 'Editar',  danger: false },
                    { icon: Trash2, title: 'Remover', danger: true  },
                  ].map(({ icon: Icon, title, danger }) => (
                    <button key={title} title={title}
                      className={clsx(
                        'w-7 h-7 flex items-center justify-center rounded-md border transition-colors',
                        danger
                          ? 'border-slate-200 bg-white text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-500'
                          : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:text-slate-700',
                      )}>
                      <Icon size={13} />
                    </button>
                  ))}
                </div>
              </div>
              <p className="font-semibold text-slate-800 text-sm">{d.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{d.country}</p>
              {d.description && (
                <p className="text-xs text-slate-500 mt-2.5 leading-relaxed line-clamp-2">{d.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
