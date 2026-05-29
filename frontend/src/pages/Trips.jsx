import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { tripsApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'

const fmt = (d) => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}` }

const COLS = [
  { key: 'title',            label: 'Viagem',      render: (v) => <span className="t-name">{v}</span> },
  { key: 'destination_name', label: 'Destino',     render: (v, r) => <span className="t-muted">{v}{r.destination_country ? `, ${r.destination_country}` : ''}</span> },
  { key: 'departure_date',   label: 'Partida',     render: (v) => fmt(v) },
  { key: 'return_date',      label: 'Retorno',     render: (v) => fmt(v) },
  { key: 'enrolled_count',   label: 'Passageiros' },
  { key: 'status',           label: 'Status',      render: (v) => <StatusBadge value={v} /> },
]

export default function Trips() {
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)
  const [delRow, setDelRow] = useState(null)

  const load = () => {
    setLoading(true)
    tripsApi.list()
      .then((r) => setRows(r.data.results ?? r.data))
      .catch(() => toast.error('Erro ao carregar viagens.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleDelete = async () => {
    await tripsApi.remove(delRow.id).catch(() => toast.error('Erro ao excluir.'))
    toast.success('Viagem excluída.')
    setDelRow(null)
    load()
  }

  return (
    <>
      <DataTable
        title="Viagens"
        addLabel="Adicionar Viagem"
        data={rows}
        cols={COLS}
        searchKeys={['title', 'destination_name']}
        filterKey="status"
        filterOpts={['open', 'ongoing', 'planning', 'full', 'completed', 'cancelled']}
        onAdd={() => toast('Formulário de viagem em breve.')}
        onEdit={() => toast('Edição de viagem em breve.')}
        onDelete={(row) => setDelRow(row)}
        loading={loading}
      />

      {delRow && (
        <DelModal
          name={delRow.title}
          onOk={handleDelete}
          onCancel={() => setDelRow(null)}
        />
      )}
    </>
  )
}
