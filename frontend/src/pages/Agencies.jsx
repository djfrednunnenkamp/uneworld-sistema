import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { agenciesApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'
import { Ic } from '../components/Icon'

/* ── Form modal ── */
const EMPTY = { name:'', email:'', cnpj:'', phone:'', responsible:'', status:'active' }

function AgencyModal({ item, onClose, onSaved }) {
  const [v, setV]       = useState(item ?? { ...EMPTY })
  const [saving, setSaving] = useState(false)
  const isEdit          = Boolean(item)
  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }))

  const save = async () => {
    if (!v.name?.trim() || !v.email?.trim()) { toast.error('Nome e e-mail são obrigatórios.'); return }
    setSaving(true)
    try {
      if (isEdit) await agenciesApi.update(item.id, v)
      else        await agenciesApi.create(v)
      toast.success(isEdit ? 'Agência atualizada.' : 'Agência adicionada.')
      onSaved()
    } catch { toast.error('Erro ao salvar.') }
    finally   { setSaving(false) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="mbox" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">{isEdit ? 'Editar Agência' : 'Adicionar Agência'}</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="mbody">
          <div className="ff" style={{ gridColumn: '1/-1' }}>
            <label className="fl">Nome da agência *</label>
            <input className="fi" value={v.name || ''} onChange={set('name')} placeholder="Nome da agência" />
          </div>
          <div className="form-row">
            <div className="ff">
              <label className="fl">CNPJ</label>
              <input className="fi" value={v.cnpj || ''} onChange={set('cnpj')} placeholder="00.000.000/0000-00" />
            </div>
            <div className="ff">
              <label className="fl">E-mail *</label>
              <input className="fi" type="email" value={v.email || ''} onChange={set('email')} placeholder="email@agencia.com" />
            </div>
          </div>
          <div className="form-row">
            <div className="ff">
              <label className="fl">Telefone</label>
              <input className="fi" value={v.phone || ''} onChange={set('phone')} placeholder="(00) 0000-0000" />
            </div>
            <div className="ff">
              <label className="fl">Responsável</label>
              <input className="fi" value={v.responsible || ''} onChange={set('responsible')} placeholder="Nome do responsável" />
            </div>
          </div>
          <div className="ff">
            <label className="fl">Status</label>
            <select className="fs" value={v.status || 'active'} onChange={set('status')}>
              <option value="active">Ativa</option>
              <option value="pending">Pendente</option>
              <option value="inactive">Inativa</option>
            </select>
          </div>
        </div>
        <div className="mfoot">
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <Ic n="check" s={13}/>{saving ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  )
}

const COLS = [
  { key: 'name',        label: 'Agência',     render: (v) => <span className="t-name">{v}</span> },
  { key: 'email',       label: 'E-mail',      render: (v) => <span className="t-muted">{v}</span> },
  { key: 'cnpj',        label: 'CNPJ' },
  { key: 'responsible', label: 'Responsável' },
  { key: 'status',      label: 'Status',      render: (v) => <StatusBadge value={v} /> },
]

export default function Agencies() {
  const [rows, setRows]   = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [delRow, setDelRow] = useState(null)

  const load = () => {
    setLoading(true)
    agenciesApi.list()
      .then((r) => setRows(r.data.results ?? r.data))
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
        searchKeys={['name', 'email', 'cnpj', 'responsible']}
        filterKey="status"
        filterOpts={['active', 'pending', 'inactive']}
        onAdd={() => setModal('add')}
        onEdit={(row) => setModal(row)}
        onDelete={(row) => setDelRow(row)}
        loading={loading}
      />

      {modal && (
        <AgencyModal
          item={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}

      {delRow && (
        <DelModal
          name={delRow.name}
          onOk={handleDelete}
          onCancel={() => setDelRow(null)}
        />
      )}
    </>
  )
}
