import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { meetingsApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'

const fmtDT = (dt) => {
  const d = new Date(dt)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

const TYPE_PT = {
  presentation:'Apresentação', consultation:'Consulta',
  followup:'Acompanhamento', other:'Outro',
}

const COLS = [
  { key: 'title',        label: 'Reunião',    render: (v) => <span className="t-name">{v}</span> },
  { key: 'meeting_type', label: 'Tipo',       render: (v) => TYPE_PT[v] ?? v },
  { key: 'scheduled_at', label: 'Data / Hora',render: (v) => fmtDT(v) },
  { key: 'location',     label: 'Local',      render: (v) => <span className="t-muted">{v || '—'}</span> },
  { key: 'participant_count', label: 'Participantes' },
  { key: 'status',       label: 'Status',     render: (v) => <StatusBadge value={v} /> },
]

export default function Meetings() {
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)
  const [delRow, setDelRow] = useState(null)

  const load = () => {
    setLoading(true)
    meetingsApi.list()
      .then((r) => setRows(r.data.results ?? r.data))
      .catch(() => toast.error('Erro ao carregar reuniões.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleDelete = async () => {
    await meetingsApi.remove(delRow.id).catch(() => toast.error('Erro ao excluir.'))
    toast.success('Reunião excluída.')
    setDelRow(null)
    load()
  }

  return (
    <>
      <DataTable
        title="Reuniões"
        addLabel="Adicionar Reunião"
        data={rows}
        cols={COLS}
        searchKeys={['title', 'location']}
        filterKey="status"
        filterOpts={['scheduled', 'completed', 'cancelled', 'no_show']}
        onAdd={() => toast('Formulário de reunião em breve.')}
        onEdit={() => toast('Edição de reunião em breve.')}
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
