/**
 * Jobs de progresso "locais" — mesma barra da sidebar usada pra importações
 * da internet (que vêm via WebSocket), só que publicados direto pelo
 * navegador para operações que rodam no próprio frontend (ex: importação de
 * CSV em Configurações). Permite fechar a tela atual e acompanhar o
 * andamento em qualquer lugar do sistema, igual ao job via WS.
 */
let jobs = {}
const listeners = new Set()

export function setLocalJob(id, patch) {
  jobs = { ...jobs, [id]: { ...jobs[id], ...patch, job_id: id, _local: true, _seenAt: Date.now() } }
  listeners.forEach(l => l())
}

export function removeLocalJob(id) {
  if (!(id in jobs)) return
  const next = { ...jobs }
  delete next[id]
  jobs = next
  listeners.forEach(l => l())
}

export function getLocalJobs() {
  return jobs
}

export function subscribeLocalJobs(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Marca como concluído (ou com erro) e remove a barra pouco depois — mesmo timing do job via WS. */
export function finishLocalJob(id, { error } = {}) {
  setLocalJob(id, error ? { status:'error', error } : { status:'done' })
  setTimeout(() => removeLocalJob(id), error ? 15000 : 2500)
}
