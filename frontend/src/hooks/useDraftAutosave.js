import { useEffect, useRef, useState } from 'react'

/**
 * Autosave de RASCUNHO reutilizável (mesma ideia do formulário de contrato):
 * salva silenciosamente (debounce) enquanto o usuário preenche, criando o
 * registro como rascunho e depois atualizando o mesmo id. Não valida nada.
 *
 * Params:
 *   enabled     – só roda quando true (ex.: cadastro novo ou rascunho existente)
 *   buildPayload– () => objeto do payload atual
 *   hasContent  – (payload) => bool: só cria rascunho quando há conteúdo do usuário
 *   createDraft – (payload) => Promise<{data:{id}}>  (deve gravar status='rascunho')
 *   updateDraft – (id, payload) => Promise
 *   initialId   – id já existente (rascunho aberto p/ continuar) ou null
 *   onCreated   – (id, data?) => void  (opcional, ao criar o rascunho)
 *   debounce    – ms (default 1200)
 *
 * Retorna { savingState:'idle'|'saving'|'saved', draftRef } onde
 * draftRef.current = { id, saving, dirty, discarded }.
 */
export function useDraftAutosave({ enabled, buildPayload, hasContent, createDraft, updateDraft, initialId = null, onCreated, debounce = 1200 }) {
  const draftRef = useRef({ id: initialId, saving: false, dirty: null, discarded: false })
  const timerRef = useRef(null)
  const lastSavedRef = useRef(null)
  const baselineRef = useRef(false)
  const [savingState, setSavingState] = useState('idle')

  const run = async (snap) => {
    const st = draftRef.current
    if (st.discarded) return
    if (st.saving) { st.dirty = snap; return }
    if (snap === lastSavedRef.current) return
    const p = JSON.parse(snap)
    if (!st.id && !hasContent(p)) return   // não cria rascunho vazio
    st.saving = true; setSavingState('saving')
    try {
      if (!st.id) {
        const r = await createDraft(p)
        st.id = r?.data?.id ?? null
        if (st.id) onCreated?.(st.id, r?.data)
      } else {
        await updateDraft(st.id, p)
      }
      lastSavedRef.current = snap
      setSavingState('saved')
    } catch {
      setSavingState('idle')   // falhou: tenta de novo na próxima mudança
    } finally {
      st.saving = false
      if (st.dirty && st.dirty !== lastSavedRef.current) { const d = st.dirty; st.dirty = null; run(d) }
      else st.dirty = null
    }
  }

  const snapshot = enabled ? JSON.stringify(buildPayload()) : ''
  useEffect(() => {
    if (!enabled || draftRef.current.discarded) return
    if (!baselineRef.current) {           // 1ª vez pronto: fixa a baseline, não salva
      baselineRef.current = true
      lastSavedRef.current = snapshot
      return
    }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => run(snapshot), debounce)
    return () => clearTimeout(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, enabled])

  return { savingState, draftRef, cancelTimer: () => clearTimeout(timerRef.current) }
}
