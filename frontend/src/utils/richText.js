/* O editor rico (Jodit) salva algo como "<p><br></p>" quando está
 * visualmente vazio — uma checagem ingênua de string (.trim()) trataria
 * isso como "tem conteúdo". Esta função tira as tags e confere se sobra
 * algum texto visível. */
export function hasVisibleText(html) {
  return !!(html || '').replace(/<[^>]*>/g, '').trim()
}
