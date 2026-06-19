import { useState, useRef } from 'react'
import { Ic } from './Icon'

function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

/**
 * Pop-up global de importação CSV.
 *
 * Props:
 *   title          – título do modal
 *   sampleContent  – conteúdo do CSV de exemplo (string)
 *   sampleFilename – nome do arquivo de exemplo para download
 *   onClose()      – fechar sem importar
 *   onFile(File)   – chamado quando o usuário confirma com um arquivo
 */
export default function CsvImportPopup({ title, sampleContent, sampleFilename, onClose, onFile }) {
  const [file,     setFile]     = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [progress, setProgress] = useState(0)
  const fileRef = useRef(null)

  const pickFile = (f) => {
    if (f && (f.name.endsWith('.csv') || f.type === 'text/csv' || f.type === 'application/vnd.ms-excel')) {
      setFile(f)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = [...(e.dataTransfer.files || [])][0]
    if (dropped) pickFile(dropped)
  }

  const handleChange = (e) => {
    pickFile(e.target.files?.[0])
    e.target.value = ''
  }

  const handleConfirm = async () => {
    if (!file || loading) return
    setLoading(true)
    setProgress(4)
    let p = 4
    const interval = setInterval(() => {
      p = p + (88 - p) * 0.14
      setProgress(Math.min(p, 88))
    }, 220)
    try {
      await onFile(file)
      clearInterval(interval)
      setProgress(100)
      await new Promise(r => setTimeout(r, 380))
      onClose()
    } catch {
      clearInterval(interval)
      setLoading(false)
      setProgress(0)
    }
  }

  return (
    <div className="overlay" style={{ zIndex: 800 }}
      onMouseDown={e => { if (e.target === e.currentTarget && !loading) onClose() }}>
      <div className="mbox" style={{ maxWidth: 480, width: '100%' }}>

        <div className="mhead">
          <span className="mtitle">{title}</span>
          {!loading && <button className="mclose" onClick={onClose}><Ic n="x" s={14}/></button>}
        </div>

        <div className="mbody" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {loading ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:20, padding:'24px 0 8px' }}>
              <div style={{ color:'#2e6db4' }}><Ic n="ul" s={40}/></div>
              <div style={{ textAlign:'center' }}>
                <p style={{ margin:'0 0 4px', fontSize:14, fontWeight:600, color:'#1e293b' }}>Processando arquivo…</p>
                <p style={{ margin:0, fontSize:12.5, color:'#64748b' }}>Aguarde enquanto preparamos os dados.</p>
              </div>
              <div style={{ width:'100%', background:'#e2e8f0', borderRadius:99, height:8, overflow:'hidden' }}>
                <div style={{
                  height:'100%', borderRadius:99,
                  background: progress >= 100 ? '#22c55e' : '#2e6db4',
                  width:`${Math.round(progress)}%`,
                  transition:'width .22s ease, background .3s ease',
                }}/>
              </div>
              <p style={{ margin:0, fontSize:13, fontWeight:700, color: progress >= 100 ? '#16a34a' : '#2e6db4' }}>
                {Math.round(progress)}%
              </p>
            </div>
          ) : (
            <>
              {/* Sample download */}
              {sampleContent && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 12.5, color: '#166534' }}>
                    Não sabe o formato? Baixe um modelo de exemplo.
                  </span>
                  <button
                    onClick={() => downloadText(sampleContent, sampleFilename)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 6, border: '1px solid #86efac', background: '#fff', color: '#16a34a', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                    <Ic n="dl" s={13}/> Baixar modelo
                  </button>
                </div>
              )}

              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragEnter={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => !file && fileRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? '#2e6db4' : file ? '#22c55e' : '#cbd5e1'}`,
                  borderRadius: 10,
                  padding: '28px 20px',
                  textAlign: 'center',
                  background: dragOver ? '#e8f0fb' : file ? '#f0fdf4' : '#f8fafc',
                  cursor: file ? 'default' : 'pointer',
                  transition: 'border-color .15s, background .15s',
                }}>
                {file ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>📄</span>
                    <div style={{ textAlign: 'left' }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#166534' }}>{file.name}</p>
                      <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); setFile(null) }}
                      style={{ marginLeft: 8, background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 4px' }}
                      title="Remover arquivo">
                      ✕
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 28, marginBottom: 8, color: dragOver ? '#2e6db4' : '#94a3b8' }}>
                      <Ic n="upload" s={32}/>
                    </div>
                    <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                      Arraste um arquivo CSV aqui
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>
                      ou <span style={{ color: '#2e6db4', textDecoration: 'underline' }}>clique para selecionar</span>
                    </p>
                  </div>
                )}
              </div>

              <input ref={fileRef} type="file" accept=".csv,text/csv"
                style={{ display: 'none' }} onChange={handleChange} />
            </>
          )}

        </div>

        {!loading && (
          <div className="mfoot" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={onClose}
              style={{ padding: '8px 18px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancelar
            </button>
            <button
              disabled={!file}
              onClick={handleConfirm}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px', borderRadius: 7, border: 'none', background: file ? '#1a2d4f' : '#e2e8f0', color: file ? '#fff' : '#94a3b8', fontSize: 13, fontWeight: 600, cursor: file ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
              Avançar <Ic n="chevron-right" s={14}/>
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
