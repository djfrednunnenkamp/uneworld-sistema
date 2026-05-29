import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { passengersApi } from '../api'
import DataTable, { StatusBadge } from '../components/DataTable'
import DelModal from '../components/DelModal'
import { Ic } from '../components/Icon'

/* ── Form modal ── */
const EMPTY = { full_name:'', email:'', phone:'', document_type:'cpf', document_number:'', status:'active' }

function PassengerModal({ item, onClose, onSaved }) {
  const [v, setV]       = useState(item ?? { ...EMPTY })
  const [saving, setSaving] = useState(false)
  const isEdit          = Boolean(item)
  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }))

  const save = async () => {
    if (!v.full_name?.trim() || !v.email?.trim()) { toast.error('Nome e e-mail são obrigatórios.'); return }
    setSaving(true)
    try {
      if (isEdit) await passengersApi.update(item.id, v)
      else        await passengersApi.create(v)
      toast.success(isEdit ? 'Passageiro atualizado.' : 'Passageiro adicionado.')
      onSaved()
    } catch { toast.error('Erro ao salvar.') }
    finally   { setSaving(false) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="mbox" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <span className="mtitle">{isEdit ? 'Editar Passageiro' : 'Adicionar Passageiro'}</span>
          <button className="mclose" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="mbody">
          <div className="ff fi-full">
            <label className="fl">Nome completo *</label>
            <input className="fi" value={v.full_name || ''} onChange={set('full_name')} placeholder="Nome completo" />
          </div>
          <div className="form-row">
            <div className="ff">
              <label className="fl">E-mail *</label>
              <input className="fi" type="email" value={v.email || ''} onChange={set('email')} placeholder="email@exemplo.com" />
            </div>
            <div className="ff">
              <label className="fl">Telefone</label>
              <input className="fi" value={v.phone || ''} onChange={set('phone')} placeholder="(00) 00000-0000" />
            </div>
          </div>
          <div className="form-row">
            <div className="ff">
              <label className="fl">Tipo de documento</label>
              <select className="fs" value={v.document_type || 'cpf'} onChange={set('document_type')}>
                <option value="cpf">CPF</option>
                <option value="passport">Passaporte</option>
                <option value="rg">RG</option>
              </select>
            </div>
            <div className="ff">
              <label className="fl">Número do documento</label>
              <input className="fi" value={v.document_number || ''} onChange={set('document_number')} placeholder="000.000.000-00" />
            </div>
          </div>
          <div className="ff fi-full">
            <label className="fl">Status</label>
            <select className="fs" value={v.status || 'active'} onChange={set('status')}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
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
  { key: 'full_name',       label: 'Nome',      render: (v) => <span className="t-name">{v}</span> },
  { key: 'email',           label: 'E-mail',    render: (v) => <span className="t-muted">{v}</span> },
  { key: 'phone',           label: 'Telefone' },
  { key: 'document_number', label: 'Documento' },
  { key: 'status',          label: 'Status',    render: (v) => <StatusBadge value={v} /> },
]

export default function Passengers() {
  const [rows, setRows]   = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)  // null | 'add' | row
  const [delRow, setDelRow] = useState(null)

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
        searchKeys={['full_name', 'email', 'phone', 'document_number']}
        filterKey="status"
        filterOpts={['active', 'inactive']}
        onAdd={() => setModal('add')}
        onEdit={(row) => setModal(row)}
        onDelete={(row) => setDelRow(row)}
        loading={loading}
      />

      {modal && (
        <PassengerModal
          item={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}

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
