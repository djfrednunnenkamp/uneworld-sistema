// Posiciona um painel flutuante (dropdown / autocomplete) ancorado a um campo,
// mantendo-o SEMPRE dentro da área visível: ele nunca ultrapassa o fim do modal
// mais próximo (ou, fora de modal, a borda da viewport) e vira pra cima quando
// não há espaço suficiente embaixo. A altura é limitada ao espaço disponível,
// então o painel rola por dentro em vez de "vazar" por baixo do pop-up.
//
// Use junto com `position: fixed` e recalcule no scroll/resize (igual ao
// DatePicker) — o objeto retornado já traz top/bottom/left/width/maxHeight.
//
//   triggerEl    — elemento de referência (o input/botão que abre o painel)
//   opts.gap     — distância entre o campo e o painel (px)
//   opts.cap     — altura máxima desejada do painel (px)
//   opts.width   — largura forçada (px); padrão = largura do campo
//   opts.minWidth— largura mínima (px)
export function computeAnchor(triggerEl, { gap = 4, cap = 320, width, minWidth } = {}) {
  const r = triggerEl.getBoundingClientRect()
  const margin = 8
  const modalBottom = nearestModalBottom(triggerEl)
  const lowerBound = Math.min(window.innerHeight - margin, modalBottom ?? Infinity)
  const spaceBelow = lowerBound - r.bottom - gap
  const spaceAbove = r.top - margin - gap
  // Vira pra cima só se embaixo for apertado E em cima couber mais.
  const flipUp = spaceBelow < Math.min(cap, 160) && spaceAbove > spaceBelow
  const avail = flipUp ? spaceAbove : spaceBelow
  const maxHeight = Math.max(96, Math.min(cap, Math.floor(avail)))

  let w = width ?? r.width
  if (minWidth) w = Math.max(w, minWidth)

  const base = { position: 'fixed', left: Math.round(r.left), width: w, maxHeight }
  return flipUp
    ? { ...base, top: 'auto', bottom: Math.round(window.innerHeight - r.top + gap) }
    : { ...base, top: Math.round(r.bottom + gap), bottom: 'auto' }
}

// Sobe na árvore até achar o "card" do modal (o elemento cujo pai é
// position:fixed — o backdrop). Devolve a borda inferior visível desse card,
// para o painel não passar dela. Fora de um modal, devolve null (usa a viewport).
function nearestModalBottom(el) {
  let node = el?.parentElement
  while (node && node !== document.body && node !== document.documentElement) {
    const parent = node.parentElement
    if (parent) {
      const pos = getComputedStyle(parent).position
      if (pos === 'fixed') return node.getBoundingClientRect().bottom - 8
    }
    node = parent
  }
  return null
}
