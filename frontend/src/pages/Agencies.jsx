import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { agenciesApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'

const COLS = [
  { key: 'company_name', label: 'Razão Social',  render: (v, row) => v || row.name || '—' },
  { key: 'name',         label: 'Nome Fantasia'  },
  { key: 'cnpj',         label: 'CNPJ'           },
  { key: 'phone',        label: 'Telefone'        },
  { key: 'email',        label: 'E-mail'          },
  { key: 'city',         label: 'Cidade'          },
  { key: 'status',       label: 'Status', render: (v) => <StatusBadge value={v} /> },
]

export default function Agencies() {
  const navigate = useNavigate()
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [delRow,  setDelRow]  = useState(null)

  const load = () => {
    setLoading(true)
    agenciesApi.list()
      .then(r => setRows(r.data.results ?? r.data))
      .catch(() => toast.error('Erro ao carregar agências.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleDelete = async () => {
    await agenciesApi.remove(delRow.id).catch(() => toast.error('Erro ao excluir.'))
    toast.success('Agência excluída.')
    setDelRow(null)
    load()
  }

  return (
    <>
      <DataTable
        title="Agências"
        addLabel="Adicionar Agência"
        data={rows}
        cols={COLS}
        searchKeys={['name', 'company_name', 'email', 'cnpj', 'city']}
        filterKey="status"
        filterOpts={['active', 'pending', 'inactive']}
        onAdd={() => navigate('/agencias/nova')}
        onEdit={(row) => navigate(`/agencias/${row.id}`)}
        onDelete={(row) => setDelRow(row)}
        loading={loading}
      />

      {delRow && (
        <DelModal
          name={delRow.company_name || delRow.name}
          onOk={handleDelete}
          onCancel={() => setDelRow(null)}
        />
      )}
    </>
  )
}
