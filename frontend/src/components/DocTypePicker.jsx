import { useState, useRef } from 'react'
import toast from 'react-hot-toast'
import { documentsApi } from '../api'
import { Ic } from './Icon'

export const DOC_TYPES = [
  { id: 'passport',    label: 'Passaporte',                icon: '🛂', color: '#2e6db4' },
  { id: 'rg',          label: 'Carteira de Identidade',    icon: '🪪', color: '#7c3aed' },
  { id: 'cnh',         label: 'Carteira de Motorista',     icon: '🚗', color: '#059669' },
  { id: 'visa',        label: 'Visto',                     icon: '✈️', color: '#0891b2' },
  { id: 'birth_cert',  label: 'Certidão de Nascimento',    icon: '📄', color: '#b45309' },
  { id: 'cpf_card',    label: 'Cartão CPF',                icon: '💳', color: '#6d28d9' },
  { id: 'voter_id',    label: 'Título de Eleitor',         icon: '🗳️', color: '#be185d' },
  { id: 'work_permit', label: 'Autorização de Trabalho',   icon: '💼', color: '#0f766e' },
  { id: 'residence',   label: 'Comprovante de Residência', icon: '🏠', color: '#92400e' },
  { id: 'other',       label: 'Outro documento',           icon: '📎', color: '#475569' },
]

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']
const MAX_SIZE_MB   = 15

export default function DocTypePicker({ passengerId, onUploaded }) {
  const [open,     setOpen]     = useState(false)
  const [step,     setStep]     = useState('type')  // 'type' | 'upload'
  const [selType,  setSelType]  = useState(null)
  const [label,    setLabel]    = useState('')
  const [notes,    setNotes]    = useState('')
  const [file,     setFile]     = useState(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const [uploading,setUploading]= useState(false)
  const fileRef   = useRef(null)
  const overlayRef= useRef(null)

  const reset = () => {
    setStep('type'); setSelType(null); setLabel('')
    setNotes(''); setFile(null); setProgress(0); setUploading(false)
  }

  const close = () => { setOpen(false); reset() }

  const pickType = (type) => {
    setSelType(type)
    setLabel('')
    setStep('upload')
  }

  const handleFile = (f) => {
    if (!f) return
    if (!ALLOWED_TYPES.includes(f.type)) {
      toast.error('Formato não suportado. Use JPEG, PNG ou PDF.'); return
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`Arquivo muito grande (máx. ${MAX_SIZE_MB} MB).`); return
    }
    setFile(f)
  }

  const onDrop = (e) => {
    e.preventDefault(); setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  const submit = async () => {
    if (!file) { toast.error('Selecione um arquivo.'); return }
    setUploading(true); setProgress(10)
    try {
      const fd = new FormData()
      fd.append('doc_type', selType.id)
      fd.append('label',    label)
      fd.append('notes',    notes)
      fd.append('file',     file)
      setProgress(40)
      await documentsApi.upload(passengerId, fd)
      setProgress(100)
      toast.success('Documento enviado com sucesso.')
      close()
      onUploaded?.()
    } catch (err) {
      const msg = err.response?.data?.file?.[0]
             ?? err.response?.data?.non_field_errors?.[0]
             ?? 'Erro ao enviar documento.'
      toast.error(msg)
    } finally { setUploading(false) }
  }

  const typeInfo = selType ? DOC_TYPES.find(d => d.id === selType.id) : null

  return (
    <>
      {/* Botão de abertura */}
      <button
        type="button"
        onClick={() => { setOpen(true); reset() }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', borderRadius: 6,
          border: '1px solid #e2e8f0', background: '#fff',
          color: '#475569', fontSize: 13, fontWeight: 500,
          cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2e6db4'; e.currentTarget.style.color = '#2e6db4' }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#475569' }}
      >
        <Ic n="plus" s={13} /> Adicionar documento
      </button>

      {/* Popup */}
      {open && (
        <div
          ref={overlayRef}
          onClick={(e) => { if (e.target === overlayRef.current) close() }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15,23,42,.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 400, padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, width: '100%',
              maxWidth: step === 'type' ? 520 : 460,
              boxShadow: '0 24px 64px rgba(0,0,0,.22)',
              animation: 'mIn .15s ease',
            }}
          >

            {/* ── STEP 1: Selecionar tipo ── */}
            {step === 'type' && (
              <>
                <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #e2e8f0' }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>
                    Que tipo de documento?
                  </p>
                  <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                    Selecione o tipo para continuar
                  </p>
                </div>

                <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {DOC_TYPES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => pickType(t)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                        padding: '14px 8px', borderRadius: 10,
                        border: '1.5px solid #e2e8f0', background: '#fff',
                        cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = t.color
                        e.currentTarget.style.background  = `${t.color}10`
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#e2e8f0'
                        e.currentTarget.style.background  = '#fff'
                      }}
                    >
                      <span style={{ fontSize: 28, lineHeight: 1 }}>{t.icon}</span>
                      <span style={{ fontSize: 11.5, fontWeight: 500, color: '#475569', textAlign: 'center', lineHeight: 1.3 }}>
                        {t.label}
                      </span>
                    </button>
                  ))}
                </div>

                <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={close} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancelar
                  </button>
                </div>
              </>
            )}

            {/* ── STEP 2: Upload ── */}
            {step === 'upload' && typeInfo && (
              <>
                <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    onClick={() => setStep('type')}
                    style={{ fontSize: 13, color: '#2e6db4', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                  >← Voltar</button>
                  <span style={{ color: '#cbd5e1' }}>·</span>
                  <span style={{ fontSize: 18 }}>{typeInfo.icon}</span>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>
                    {typeInfo.label}
                  </p>
                </div>

                <div style={{ padding: '16px 20px' }}>
                  {/* Nome personalizado */}
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>
                      Nome personalizado <span style={{ fontWeight: 400, textTransform: 'none' }}>(opcional)</span>
                    </label>
                    <input
                      className="fi"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder={`Ex.: ${typeInfo.label} EUA`}
                    />
                  </div>

                  {/* Área de drop */}
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    onClick={() => fileRef.current?.click()}
                    style={{
                      border: `2px dashed ${dragging ? typeInfo.color : file ? typeInfo.color : '#e2e8f0'}`,
                      borderRadius: 10, padding: '28px 20px', textAlign: 'center',
                      background: dragging ? `${typeInfo.color}08` : file ? `${typeInfo.color}06` : '#fafafa',
                      cursor: 'pointer', transition: 'all .15s', marginBottom: 14,
                    }}
                  >
                    <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.pdf" style={{ display: 'none' }}
                      onChange={(e) => handleFile(e.target.files[0])} />
                    {file ? (
                      <>
                        <div style={{ fontSize: 28, marginBottom: 6 }}>
                          {file.type === 'application/pdf' ? '📄' : '🖼️'}
                        </div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: typeInfo.color, margin: 0 }}>{file.name}</p>
                        <p style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 3 }}>
                          {(file.size / 1024).toFixed(0)} KB — clique para trocar
                        </p>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
                        <p style={{ fontSize: 13, fontWeight: 500, color: '#475569', margin: 0 }}>
                          Arraste o arquivo aqui ou <span style={{ color: typeInfo.color }}>clique para selecionar</span>
                        </p>
                        <p style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>
                          JPEG, PNG ou PDF • Máximo 15 MB
                        </p>
                      </>
                    )}
                  </div>

                  {/* Barra de progresso */}
                  {uploading && (
                    <div style={{ height: 4, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden', marginBottom: 14 }}>
                      <div style={{ height: '100%', background: typeInfo.color, width: `${progress}%`, transition: 'width .3s', borderRadius: 4 }} />
                    </div>
                  )}

                  {/* Notas */}
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>
                      Notas <span style={{ fontWeight: 400, textTransform: 'none' }}>(opcional)</span>
                    </label>
                    <textarea
                      className="fi"
                      rows={2}
                      style={{ resize: 'none' }}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Ex.: Válido até 10/2027, emitido nos EUA"
                    />
                  </div>
                </div>

                <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between' }}>
                  <button onClick={close} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancelar
                  </button>
                  <button
                    onClick={submit}
                    disabled={!file || uploading}
                    style={{
                      padding: '6px 20px', borderRadius: 6, border: 'none',
                      background: file && !uploading ? typeInfo.color : '#e2e8f0',
                      color: '#fff', fontSize: 13, fontWeight: 600,
                      cursor: file && !uploading ? 'pointer' : 'not-allowed',
                      fontFamily: 'inherit', transition: 'background .15s',
                    }}
                  >
                    {uploading ? 'Enviando…' : 'Enviar documento'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
