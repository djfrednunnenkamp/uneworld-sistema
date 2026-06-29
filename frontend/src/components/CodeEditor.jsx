import React from 'react'
import * as RSCE from 'react-simple-code-editor'
import Prism from 'prismjs'
import 'prismjs/components/prism-python'

// O pacote entrega o componente com default duplo ({default:{default: fwdRef}}).
// Desembrulha até achar algo renderável (função ou forwardRef com $$typeof).
function resolveComponent(m) {
  let c = m
  for (let i = 0; i < 5 && c && typeof c === 'object' && !c.$$typeof; i++) c = c.default
  return c
}
const Editor = resolveComponent(RSCE)

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Realce seguro: se a gramática não estiver disponível ou o Prism falhar, cai
// pro texto puro (escapado) em vez de quebrar a tela.
const hl = (code) => {
  const c = code || ''
  try {
    const g = Prism && Prism.languages && Prism.languages.python
    return g ? Prism.highlight(c, g, 'python') : escapeHtml(c)
  } catch {
    return escapeHtml(c)
  }
}

/* Se qualquer coisa no editor com realce der erro, mostra um textarea simples
 * (sem tela branca). */
class EditorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: false } }
  static getDerivedStateFromError() { return { err: true } }
  render() { return this.state.err ? this.props.fallback : this.props.children }
}

/* Editor de código leve com destaque de sintaxe Python (Prism), tema escuro
 * estilo VS Code. Sem Monaco/VS Code. */
export default function CodeEditor({ value, onChange, minHeight = 150, placeholder = '', autoFocus = false }) {
  const fill = minHeight === '100%'
  const taStyle = {
    width: '100%', boxSizing: 'border-box', height: fill ? '100%' : undefined, minHeight: fill ? 260 : minHeight,
    padding: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13, lineHeight: 1.6,
    background: '#0f172a', color: '#e2e8f0', border: 'none', outline: 'none', resize: 'vertical', borderRadius: 8,
  }
  const fallback = (
    <textarea value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      spellCheck={false} autoFocus={autoFocus} style={taStyle} />
  )
  return (
    <div className="pycode" style={{ borderRadius: 8, border: '1px solid #334155', background: '#0f172a', overflow: 'auto', height: fill ? '100%' : undefined, maxHeight: '100%' }}>
      <EditorBoundary fallback={fallback}>
        <Editor
          value={value || ''}
          onValueChange={onChange}
          highlight={hl}
          padding={12}
          placeholder={placeholder}
          autoFocus={autoFocus}
          textareaClassName="pycode-ta"
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13, lineHeight: 1.6, minHeight: fill ? '100%' : minHeight, color: '#e2e8f0', outline: 'none' }}
        />
      </EditorBoundary>
      <style>{`
        .pycode .pycode-ta, .pycode pre { outline: none !important; }
        .pycode textarea { caret-color: #e2e8f0; }
        .pycode textarea::placeholder { color: #64748b; }
        .pycode .token.comment, .pycode .token.prolog, .pycode .token.doctype { color: #6a9955; }
        .pycode .token.string, .pycode .token.triple-quoted-string, .pycode .token.char { color: #ce9178; }
        .pycode .token.keyword { color: #569cd6; }
        .pycode .token.boolean, .pycode .token.constant, .pycode .token.none { color: #569cd6; }
        .pycode .token.builtin, .pycode .token.class-name { color: #4ec9b0; }
        .pycode .token.function, .pycode .token.decorator { color: #dcdcaa; }
        .pycode .token.number { color: #b5cea8; }
        .pycode .token.operator, .pycode .token.punctuation { color: #d4d4d4; }
      `}</style>
    </div>
  )
}
