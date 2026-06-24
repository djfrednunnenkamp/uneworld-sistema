import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import JoditEditor from 'jodit-react'
import { toast } from 'sonner'
import { Ic } from './Icon'

const TOOLBAR_BUTTONS = [
  'paragraph', '|',
  'bold', 'italic', 'strikethrough', '|',
  'fontsize', '|',
  'brush', '|',
  'link', '|',
  'align', '|',
  'ul', 'ol', '|',
  'outdent', 'indent', '|',
  'eraser', '|',
  'source',
]

function buildConfig(height, placeholder) {
  return {
    language: 'en',
    height,
    placeholder: placeholder || 'Digite aqui…',
    toolbarAdaptive: false,
    toolbarSticky: false,
    statusbar: false,
    allowResizeY: false,
    showCharsCounter: false,
    showWordsCounter: false,
    showXPathInStatusbar: false,
    askBeforePasteFromWord: true,
    buttons: TOOLBAR_BUTTONS,
    buttonsMD: TOOLBAR_BUTTONS,
    buttonsSM: TOOLBAR_BUTTONS,
    buttonsXS: TOOLBAR_BUTTONS,
    extraButtons: [
      {
        name: 'importWord',
        text: 'Importar do Word',
        tooltip: 'Cole (Ctrl+V) o texto copiado do Word — a formatação é limpa automaticamente',
        exec: () => {
          toast('Cole o conteúdo copiado do Word com Ctrl+V. O editor vai perguntar se deseja limpar a formatação.', { icon: '📋', duration: 6000 })
        },
      },
    ],
  }
}

/* Caixa de texto rico (Jodit) com botão para expandir em um popup quase tela cheia */
export default function RichTextEditor({ value, onChange, title, placeholder }) {
  const [expanded, setExpanded] = useState(false)

  const inlineConfig = useMemo(() => buildConfig(220, placeholder), [placeholder])
  const modalConfig  = useMemo(() => buildConfig('calc(92vh - 80px)', placeholder), [placeholder])

  return (
    <div style={{ border:'1px solid #e2e8f0', borderRadius:10, overflow:'hidden' }}>
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'8px 12px', background:'#f8fafc', borderBottom:'1px solid #e2e8f0',
      }}>
        <span style={{ fontSize:13, fontWeight:600, color:'#1e293b' }}>{title}</span>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="btn btn-outline"
          title="Expandir"
          style={{ padding:'4px 8px' }}
        >
          <Ic n="expand" s={14} />
        </button>
      </div>

      <JoditEditor value={value} config={inlineConfig} onBlur={onChange} />

      {expanded && createPortal(
        <div className="overlay" style={{ zIndex:700 }} onMouseDown={e => { if (e.target === e.currentTarget) setExpanded(false) }}>
          <div className="mbox" style={{ maxWidth:'none', width:'95vw', height:'92vh', display:'flex', flexDirection:'column' }}>
            <div className="mhead">
              <span className="mtitle">{title}</span>
              <button className="mclose" onClick={() => setExpanded(false)}><Ic n="x" s={16} /></button>
            </div>
            <div className="mbody" style={{ flex:1, maxHeight:'none', overflow:'hidden', padding:12 }}>
              <JoditEditor value={value} config={modalConfig} onBlur={onChange} />
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
