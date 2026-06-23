import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Ic } from './Icon'

/**
 * Aba "Excluídos" reutilizável — lista itens em soft-delete de qualquer
 * área (Passageiros, Agências, Listas, Usuários, Perfis de Permissão).
 * Restaurar e excluir definitivamente são exclusivos de superusuário.
 *
 * Props:
 *   fetchDeleted()        – () => Promise<array> busca os itens excluídos
 *   onRestore(id)         – () => Promise restaura um item
 *   onPurge(id)           – () => Promise remove definitivamente
 *   getLabel(row)         – nome principal exibido
 *   getSubtitle(row)      – (opcional) linha secundária (ex: e-mail)
 *   isSuperuser           – bool — controla quem vê os botões de ação
 *   emptyText             – texto quando não há nada excluído
 *   onCountChange(n)      – (opcional) chamado com o total sempre que a lista recarrega
 */
export default function TrashTab({ fetchDeleted, onRestore, onPurge, getLabel, getSubtitle, isSuperuser, emptyText = 'Nenhum item excluído.', onCountChange }) {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [purgeRow, setPurgeRow] = useState(null)
  const [busyId,  setBusyId]  = useState(null)

  const load = () => {
    setLoading(true)
    fetchDeleted()
      .then(data => { setRows(data); onCountChange?.(data.length) })
      .catch(() => toast.error('Erro ao carregar excluídos.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRestore = async (row) => {
    setBusyId(row.id)
    try {
      await onRestore(row.id)
      toast.success('Restaurado com sucesso.')
      load()
    } catch {
      toast.error('Erro ao restaurar.')
    } finally {
      setBusyId(null)
    }
  }

  const handlePurge = async () => {
    setBusyId(purgeRow.id)
    try {
      await onPurge(purgeRow.id)
      toast.success('Removido definitivamente.')
      setPurgeRow(null)
      load()
    } catch {
      toast.error('Erro ao remover definitivamente.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '40px 0' }}>Carregando…</p>
  }

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <div style={{ color: '#cbd5e1' }}><Ic n="trash" s={28} /></div>
        <p>{emptyText}</p>
      </div>
    )
  }

  return (
    <>
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {rows.map((row, i) => (
          <div key={row.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '12px 16px', borderBottom: i === rows.length - 1 ? 'none' : '1px solid #f1f5f9',
          }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {getLabel(row)}
              </p>
              {getSubtitle && (
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94a3b8' }}>{getSubtitle(row)}</p>
              )}
              {row.deleted_at && (
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#cbd5e1' }}>
                  Excluído em {new Date(row.deleted_at).toLocaleString('pt-BR')}
                </p>
              )}
            </div>
            {isSuperuser ? (
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button type="button" disabled={busyId === row.id} onClick={() => handleRestore(row)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: '1.5px solid #bbf7d0', background: '#f0fdf4', color: '#16a34a', fontSize: 12.5, fontWeight: 600, cursor: busyId === row.id ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busyId === row.id ? .6 : 1 }}>
                  <Ic n="rotate" s={12} /> Restaurar
                </button>
                <button type="button" disabled={busyId === row.id} onClick={() => setPurgeRow(row)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: '1.5px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontSize: 12.5, fontWeight: 600, cursor: busyId === row.id ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busyId === row.id ? .6 : 1 }}>
                  <Ic n="trash" s={12} /> Excluir de vez
                </button>
              </div>
            ) : (
              <span style={{ fontSize: 11.5, color: '#cbd5e1', flexShrink: 0 }}>Só superusuário pode restaurar</span>
            )}
          </div>
        ))}
      </div>

      {purgeRow && (
        <div className="overlay" onClick={() => setPurgeRow(null)}>
          <div className="mbox" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="mhead">
              <span className="mtitle">Excluir definitivamente</span>
              <button className="mclose" onClick={() => setPurgeRow(null)}><Ic n="x" s={15} /></button>
            </div>
            <div className="mbody">
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ color: '#dc2626', flexShrink: 0, marginTop: 2 }}><Ic n="warn" s={20} /></div>
                <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.7 }}>
                  Tem certeza que deseja remover <strong style={{ color: '#1e293b' }}>{getLabel(purgeRow)}</strong> definitivamente?<br />
                  Isso remove o registro do banco de dados — não tem mais como recuperar depois disso.
                </p>
              </div>
            </div>
            <div className="mfoot">
              <button className="btn btn-outline" onClick={() => setPurgeRow(null)}>Cancelar</button>
              <button className="btn btn-danger" onClick={handlePurge} disabled={busyId === purgeRow.id}>
                {busyId === purgeRow.id ? 'Removendo…' : 'Excluir definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
