import Editor from 'react-simple-code-editor'
import Prism from 'prismjs'
import 'prismjs/components/prism-python'

const hl = (code) => Prism.highlight(code || '', Prism.languages.python, 'python')

/* Editor de código leve com destaque de sintaxe Python (Prism), tema escuro
 * estilo VS Code. Sem Monaco/VS Code — só realce + edição. */
export default function CodeEditor({ value, onChange, minHeight = 150, placeholder = '', autoFocus = false }) {
  const fill = minHeight === '100%'
  return (
    <div className="pycode" style={{ borderRadius: 8, border: '1px solid #334155', background: '#0f172a', overflow: 'auto', height: fill ? '100%' : undefined, maxHeight: '100%' }}>
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
