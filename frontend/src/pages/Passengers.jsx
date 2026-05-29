import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { passengersApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'

const COLS = [
  { key: 'full_name', label: 'Nome',      render: (v) => <span className="t-name">{v}</span> },
  { key: 'email',     label: 'E-mail',    render: (v) => <span className="t-muted">{v}</span> },
  { key: 'mobile',    label: 'Celular' },
  { key: 'cpf',       label: 'CPF' },
  { key: 'status',    label: 'Status',    render: (v) => <StatusBadge value={v} /> },
]

export default function Passengers() {
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)
  const [delRow, setDelRow] = useState(null)
  const navigate            = useNavigate()

  const load = () => {
    setLoading(true)
    passengersApi.list()
      .then((r) => setRows(r.data.results ?? r.data))
      .catch(() => toast.error('Erro ao carregar passageiros.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleDelete = async () => {
    await passengersApi.remove(delRow.id).catch(() => toast.error('Erro ao excluir.'))
    toast.success('Passageiro excluído.')
    setDelRow(null)
    load()
  }

  return (
    <>
      <DataTable
        title="Passageiros"
        addLabel="Adicionar Passageiro"
        data={rows}
        cols={COLS}
        searchKeys={['full_name', 'email', 'cpf', 'mobile']}
        filterKey="status"
        filterOpts={['active', 'inactive']}
        onAdd={() => navigate('/passageiros/novo')}
        onEdit={(row) => navigate(`/passageiros/${row.id}`)}
        onDelete={(row) => setDelRow(row)}
        loading={loading}
      />

      {delRow && (
        <DelModal
          name={delRow.full_name}
          onOk={handleDelete}
          onCancel={() => setDelRow(null)}
        />
      )}
    </>
  )
}
