import { useState, useRef, useMemo, useEffect } from 'react'
import toast from 'react-hot-toast'
import { documentsApi } from '../api'
import { Ic } from './Icon'
import CountryPicker from './CountryPicker'
import BrazilCityPicker from './BrazilCityPicker'
import CnhClassPicker from './CnhClassPicker'
import DatePicker from './DatePicker'

export const DOC_TYPES = [
  { id: 'passport',   label: 'Passaporte',                icon: '🛂', color: '#2e6db4' },
  { id: 'rg',         label: 'Carteira de Identidade',    icon: '🪪', color: '#7c3aed' },
  { id: 'cnh',        label: 'Carteira de Motorista',     icon: '🚗', color: '#059669' },
  { id: 'visa',       label: 'Visto',                     icon: '✈️', color: '#0891b2' },
  { id: 'birth_cert', label: 'Certidão de Nascimento',    icon: '📄', color: '#b45309' },
  { id: 'residence',  label: 'Comprovante de Residência', icon: '🏠', color: '#92400e' },
  { id: 'vaccine',    label: 'Vacina',                    icon: '💉', color: '#0f766e' },
  { id: 'other',      label: 'Outro documento',           icon: '📎', color: '#475569' },
]

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']
const MAX_SIZE_MB   = 15

/* Campos por tipo de documento */
const DOC_FIELDS = {
  passport: [
    { key: 'doc_number',  label: 'Número do passaporte', type: 'text',    required: true },
    { key: 'issued_date', label: 'Data de emissão',       type: 'date',    required: true },
    { key: 'expiry_date', label: 'Validade',               type: 'date',    required: true },
    { key: 'issued_by',   label: 'País emissor',           type: 'country', required: true },
  ],
  rg: [
    { key: 'doc_number',  label: 'Número do RG',       type: 'text',        modelFilter: 'antigo', required: true },
    { key: 'issued_date', label: 'Data de expedição',   type: 'date',        required: true },
    { key: 'issued_by',   label: 'Local de expedição',  type: 'brazil_city', required: true },
    { key: 'expiry_date', label: 'Validade',             type: 'date',        modelFilter: 'novo', required: true },
  ],
  cnh: [
    { key: 'doc_number',   label: 'Número da CNH',      type: 'text',        required: true },
    { key: 'doc_category', label: 'Categoria / Classe',  type: 'cnh_class',   required: true },
    { key: 'issued_date',  label: 'Data de emissão',     type: 'date',        required: true },
    { key: 'expiry_date',  label: 'Validade',             type: 'date',        required: true },
    { key: 'issued_by',    label: 'Local de expedição',  type: 'brazil_city', required: true },
  ],
  visa: [
    { key: 'doc_number',  label: 'Número do visto', type: 'text',    required: true },
    { key: 'issued_date', label: 'Data de emissão',  type: 'date',    required: true },
    { key: 'expiry_date', label: 'Validade',          type: 'date',    required: true },
    { key: 'issued_by',   label: 'País emissor',      type: 'country', required: true },
  ],
  birth_cert: [
    { key: 'doc_number',  label: 'Número do documento', type: 'text', required: true },
    { key: 'issued_date', label: 'Data de emissão',      type: 'date', required: true },
    { key: 'issued_by',   label: 'Cartório / Órgão',     type: 'text', required: true },
  ],
  residence: [
    { key: 'issued_date', label: 'Data do comprovante', type: 'date', required: true },
    { key: 'issued_by',   label: 'Emissor',              type: 'text', required: true },
  ],
  vaccine: [
    { key: 'doc_number',  label: 'Nome da vacina',      type: 'text', required: true },
    { key: 'issued_date', label: 'Data da vacinação',   type: 'date', required: true },
    { key: 'expiry_date', label: 'Data de validade',    type: 'date', required: false },
  ],
  other: [
    { key: 'doc_number',  label: 'Número do documento', type: 'text' },
    { key: 'issued_date', label: 'Data de emissão',      type: 'date' },
    { key: 'expiry_date', label: 'Validade',              type: 'date' },
  ],
}

export default function DocTypePicker({ passengerId, onUploaded }) {
  const [open,      setOpen]     = useState(false)
  const [step,      setStep]     = useState('type')
  const [selType,   setSelType]  = useState(null)
  const [search,    setSearch]   = useState('')
  const searchRef   = useRef(null)
  const [label,     setLabel]    = useState('')
  const [notes,     setNotes]    = useState('')
  const [docMeta,   setDocMeta]  = useState({})
  const [rgModel,   setRgModel]  = useState('novo')
  const [metaErrors, setMetaErrors] = useState({})
  const [fileError,  setFileError]  = useState(false)
  const [file,       setFile]      = useState(null)
  const [previewUrl, setPreviewUrl]= useState(null)
  const [lightbox,   setLightbox]  = useState(false)
  const [zoom,       setZoom]      = useState(1)
  const [origin,     setOrigin]    = useState({ x: 50, y: 50 })  // % do cursor na imagem
  const imgRef = useRef(null)
  const [dragging,   setDragging]  = useState(false)
  const [progress,   setProgress]  = useState(0)
  const [uploading,  setUploading] = useState(false)

  /* Libera URL de preview ao trocar arquivo ou fechar */
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }
  }, [previewUrl])
  const fileRef   = useRef(null)
  const overlayRef= useRef(null)

  const reset = () => {
    setStep('type'); setSelType(null); setLabel('')
    setNotes(''); setDocMeta({}); setRgModel('novo'); setMetaErrors({}); setFileError(false);
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null); setPreviewUrl(null)
    setLightbox(false); setZoom(1); setProgress(0); setUploading(false); setSearch('')
  }

  // Lista filtrada pela busca (excluindo "Outro" — aparece como botão no header)
  const DOC_LIST = DOC_TYPES.filter(t => t.id !== 'other')
  const filtered = useMemo(() =>
    DOC_LIST.filter(t => t.label.toLowerCase().includes(search.toLowerCase()))
  , [search])

  const close = () => { setOpen(false); reset() }

  const pickType = (type) => {
    setSelType(type)
    setLabel('')
    setDocMeta({})
    setNotes('')
    setMetaErrors({})
    setFileError(false)
    setRgModel('novo')
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl(null)
    setZoom(1)
    setProgress(0)
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
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(f)
    setFileError(false)
    setZoom(1)
    setPreviewUrl(f.type.startsWith('image/') ? URL.createObjectURL(f) : null)
  }

  const isImage = file?.type?.startsWith('image/')

  /* Atualiza docMeta; auto-preenche validade do RG antigo (+10 anos) */
  const setMeta = (key, value) => {
    setDocMeta((prev) => {
      const next = { ...prev, [key]: value }
      if (typeInfo?.id === 'rg' && rgModel === 'antigo' && key === 'issued_date' && value) {
        const d = new Date(value)
        d.setFullYear(d.getFullYear() + 10)
        next.expiry_date = d.toISOString().split('T')[0]
      }
      return next
    })
    if (metaErrors[key]) setMetaErrors(prev => { const n = {...prev}; delete n[key]; return n })
  }

  const errStyle = { borderColor: '#dc2626', background: '#fef2f2' }

  /* Zoom no ponto do cursor */
  const handleImgMouseMove = (e) => {
    if (!imgRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    setOrigin({
      x: ((e.clientX - rect.left) / rect.width)  * 100,
      y: ((e.clientY - rect.top)  / rect.height) * 100,
    })
  }

  const handleWheel = (e) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.25 : -0.25
    setZoom(z => Math.min(8, Math.max(1, parseFloat((z + delta).toFixed(2)))))
  }

  const onDrop = (e) => {
    e.preventDefault(); setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  const submit = async () => {
    // Valida campos obrigatórios do tipo de documento
    const requiredFields = (DOC_FIELDS[typeInfo?.id] ?? [])
      .filter(f => f.required && (!f.modelFilter || f.modelFilter === rgModel))
    const errs = {}
    requiredFields.forEach(f => {
      if (!docMeta[f.key]?.trim?.() && !docMeta[f.key]) errs[f.key] = true
    })

    const hasFieldErrors = Object.keys(errs).length > 0
    const hasFileError   = !file

    if (hasFieldErrors) setMetaErrors(errs)
    if (hasFileError)   setFileError(true)

    if (hasFileError || hasFieldErrors) {
      toast.error('Preencha os campos obrigatórios marcados em vermelho.')
      return
    }
    setMetaErrors({})
    setUploading(true); setProgress(10)
    try {
      const fd = new FormData()
      fd.append('doc_type', selType.id)
      fd.append('label',    label)
      fd.append('notes',    notes)
      fd.append('file',     file)
      // Campos de metadado do documento
      if (docMeta.doc_number)  fd.append('doc_number',  docMeta.doc_number)
      if (docMeta.issued_date) fd.append('issued_date', docMeta.issued_date)
      if (docMeta.expiry_date) fd.append('expiry_date', docMeta.expiry_date)
      if (docMeta.issued_by)   fd.append('issued_by',   docMeta.issued_by)
      if (typeInfo?.id === 'rg')         fd.append('doc_model',    rgModel)
      if (docMeta.doc_category)          fd.append('doc_category', docMeta.doc_category)
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
              maxWidth: step === 'upload' ? 680 : 460,
              boxShadow: '0 24px 64px rgba(0,0,0,.22)',
              animation: 'mIn .15s ease',
            }}
          >

            {/* ── STEP 1: Selecionar tipo — lista com busca ── */}
            {step === 'type' && (
              <>
                {/* Header: título + botão Outro */}
                <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>
                      Que tipo de documento?
                    </p>
                    <button
                      type="button"
                      onClick={() => pickType(DOC_TYPES.find(t => t.id === 'other'))}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '4px 11px', borderRadius: 6,
                        border: '1px solid #e2e8f0', background: '#f8fafc',
                        color: '#64748b', fontSize: 12, fontWeight: 500,
                        cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#475569'; e.currentTarget.style.color = '#1e293b' }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#64748b' }}
                    >
                      📎 Outro documento
                    </button>
                  </div>

                  {/* Busca */}
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', display: 'flex' }}>
                      <Ic n="search" s={14} />
                    </span>
                    <input
                      ref={searchRef}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Buscar tipo de documento…"
                      autoFocus
                      style={{
                        width: '100%', padding: '7px 11px 7px 31px',
                        border: '1px solid #e2e8f0', borderRadius: 6,
                        fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b',
                      }}
                      onFocus={(e) => e.target.style.borderColor = '#2e6db4'}
                      onBlur={(e)  => e.target.style.borderColor = '#e2e8f0'}
                    />
                  </div>
                </div>

                {/* Lista */}
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  {filtered.length === 0 ? (
                    <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '24px 0' }}>
                      Nenhum tipo encontrado
                    </p>
                  ) : filtered.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => pickType(t)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '11px 18px', cursor: 'pointer',
                        borderBottom: '1px solid #f8fafc',
                        transition: 'background .1s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = `${t.color}0d`}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{ fontSize: 22, flexShrink: 0, lineHeight: 1 }}>{t.icon}</span>
                      <span style={{ fontSize: 13.5, fontWeight: 500, color: '#1e293b' }}>{t.label}</span>
                      <span style={{ marginLeft: 'auto', color: '#cbd5e1', fontSize: 14 }}>›</span>
                    </div>
                  ))}
                </div>

                <div style={{ padding: '10px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={close} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancelar
                  </button>
                </div>
              </>
            )}

            {/* ── STEP 2: Upload — layout dois lados ── */}
            {step === 'upload' && typeInfo && (
              <>
                {/* Header */}
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    onClick={() => { setStep('type'); setMetaErrors({}); setFileError(false) }}
                    style={{ fontSize: 13, color: '#2e6db4', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
                    ← Voltar
                  </button>
                  <span style={{ color: '#cbd5e1' }}>·</span>
                  <span style={{ fontSize: 18 }}>{typeInfo.icon}</span>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>{typeInfo.label}</p>
                </div>

                {/* Corpo dois lados */}
                <div style={{ display: 'flex', gap: 0 }}>

                  {/* Esquerda: upload */}
                  <div style={{ flex: 1, padding: '16px 16px 16px 18px', borderRight: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* Área de drop */}
                    <div
                      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={onDrop}
                      onClick={() => fileRef.current?.click()}
                      style={{
                        border: `2px dashed ${
                          dragging ? typeInfo.color
                          : file    ? typeInfo.color
                          : fileError ? '#dc2626'
                          : '#e2e8f0'
                        }`,
                        borderRadius: 10, padding: '24px 14px', textAlign: 'center',
                        background: dragging ? `${typeInfo.color}08` : file ? `${typeInfo.color}06` : fileError ? '#fef2f2' : '#fafafa',
                        cursor: 'pointer', transition: 'all .15s', flex: 1,
                      }}
                    >
                      <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.pdf" style={{ display: 'none' }}
                        onChange={(e) => handleFile(e.target.files[0])} />
                      {file && isImage && previewUrl ? (
                        /* Preview da imagem — clica para abrir lightbox */
                        <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 140 }}>
                          <img
                            src={previewUrl}
                            alt="preview"
                            onClick={(e) => { e.stopPropagation(); setLightbox(true) }}
                            style={{
                              width: '100%', height: '100%', minHeight: 140,
                              objectFit: 'contain', borderRadius: 6,
                              cursor: 'zoom-in', display: 'block',
                            }}
                          />
                          <div style={{
                            position: 'absolute', bottom: 4, right: 4,
                            background: 'rgba(0,0,0,.45)', borderRadius: 4,
                            padding: '2px 7px', fontSize: 11, color: '#fff',
                          }}>
                            🔍 clique para ampliar
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); fileRef.current?.click() }}
                            style={{
                              position: 'absolute', top: 4, right: 4,
                              background: 'rgba(0,0,0,.45)', border: 'none', borderRadius: 4,
                              color: '#fff', fontSize: 11, padding: '2px 7px', cursor: 'pointer',
                            }}
                          >↺ trocar</button>
                        </div>
                      ) : file ? (
                        /* PDF ou arquivo sem preview */
                        <>
                          <div style={{ fontSize: 26, marginBottom: 6 }}>📄</div>
                          <p style={{ fontSize: 12.5, fontWeight: 600, color: typeInfo.color, margin: 0, wordBreak: 'break-all' }}>{file.name}</p>
                          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{(file.size / 1024).toFixed(0)} KB · clique para trocar</p>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 30, marginBottom: 8 }}>📁</div>
                          <p style={{ fontSize: 12.5, fontWeight: 500, color: '#475569', margin: 0 }}>
                            Arraste aqui ou{' '}
                            <span style={{ color: typeInfo.color }}>clique para selecionar</span>
                          </p>
                          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>JPEG, PNG ou PDF • Máx. 15 MB</p>
                        </>
                      )}
                    </div>

                    {/* Barra de progresso */}
                    {uploading && (
                      <div style={{ height: 3, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: typeInfo.color, width: `${progress}%`, transition: 'width .3s', borderRadius: 4 }} />
                      </div>
                    )}

                    {/* Título — só para "Outro documento" */}
                    {typeInfo.id === 'other' && (
                      <div>
                        <label className="fl">Título do documento</label>
                        <input className="fi" value={label} onChange={(e) => setLabel(e.target.value)}
                          placeholder="Ex.: Cartão de vacinação, Seguro viagem…" />
                      </div>
                    )}
                  </div>

                  {/* Direita: campos do documento */}
                  <div style={{ flex: 1, padding: '16px 18px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* Seletor modelo novo/antigo — só para RG */}
                    {typeInfo.id === 'rg' && (
                      <div style={{ marginBottom: 4 }}>
                        <label className="fl">Modelo do documento</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {[
                            { val: 'novo',   label: 'Modelo novo' },
                            { val: 'antigo', label: 'Modelo antigo' },
                          ].map(({ val, label }) => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => {
                                setRgModel(val)
                                // limpa validade ao trocar de modelo
                                setDocMeta(prev => ({ ...prev, expiry_date: '' }))
                              }}
                              style={{
                                flex: 1, padding: '6px 10px', borderRadius: 6,
                                border: `1.5px solid ${rgModel === val ? '#2e6db4' : '#e2e8f0'}`,
                                background: rgModel === val ? '#eff6ff' : '#fff',
                                color: rgModel === val ? '#2e6db4' : '#475569',
                                fontSize: 12.5, fontWeight: rgModel === val ? 600 : 400,
                                cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s',
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        {rgModel === 'antigo' && (
                          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 5 }}>
                            Validade calculada automaticamente (10 anos da emissão)
                          </p>
                        )}
                      </div>
                    )}

                    {/* Campos dinâmicos */}
                    {(() => {
                      const fields = (DOC_FIELDS[typeInfo.id] ?? [])
                        .filter(f => !f.modelFilter || f.modelFilter === rgModel)

                      // Para RG modelo novo: agrupa issued_date + expiry_date em grid 2 colunas
                      const dateKeys = ['issued_date', 'expiry_date']
                      const isRgNovo = typeInfo.id === 'rg' && rgModel === 'novo'
                      const dateFields = isRgNovo ? fields.filter(f => dateKeys.includes(f.key)) : []
                      const otherFields = isRgNovo ? fields.filter(f => !dateKeys.includes(f.key)) : fields

                      const renderField = (f) => {
                        const hasErr = !!metaErrors[f.key]
                        const redStyle = hasErr ? errStyle : {}
                        const lbl = (
                          <label className="fl">
                            {f.label}
                            {f.required && <span style={{ color: '#dc2626', marginLeft: 3 }}>*</span>}
                          </label>
                        )
                        return (
                          <div key={f.key}>
                            {lbl}
                            {f.type === 'country' ? (
                              <div style={hasErr ? { borderRadius: 6, outline: '1.5px solid #dc2626', background: '#fef2f2' } : {}}>
                                <CountryPicker value={docMeta[f.key] ?? ''} onChange={(v) => setMeta(f.key, v)} />
                              </div>
                            ) : f.type === 'brazil_city' ? (
                              <div style={hasErr ? { borderRadius: 6, outline: '1.5px solid #dc2626', background: '#fef2f2' } : {}}>
                                <BrazilCityPicker value={docMeta[f.key] ?? ''} onChange={(v) => setMeta(f.key, v)} />
                              </div>
                            ) : f.type === 'cnh_class' ? (
                              <div style={hasErr ? { borderRadius: 6, outline: '1.5px solid #dc2626', background: '#fef2f2' } : {}}>
                                <CnhClassPicker value={docMeta[f.key] ?? ''} onChange={(v) => setMeta(f.key, v)} />
                              </div>
                            ) : f.type === 'date' ? (
                              <div style={hasErr ? { borderRadius: 6, outline: '1.5px solid #dc2626' } : {}}>
                                <DatePicker value={docMeta[f.key] ?? ''} onChange={(v) => setMeta(f.key, v)} />
                              </div>
                            ) : (
                              <input className="fi" type={f.type} value={docMeta[f.key] ?? ''}
                                onChange={(e) => setMeta(f.key, e.target.value)}
                                style={redStyle} />
                            )}
                          </div>
                        )
                      }

                      return (
                        <>
                          {otherFields.map(renderField)}
                          {dateFields.length === 2 && (
                            <div>
                              <label className="fl" style={{ marginBottom: 4 }}>Datas</label>
                              <div style={{
                                display: 'flex', flexDirection: 'column', gap: 8,
                                padding: '10px 12px', borderRadius: 8, background: '#fafafa',
                                border: `1px solid ${dateFields.some(f => metaErrors[f.key]) ? '#dc2626' : '#e2e8f0'}`,
                              }}>
                                {dateFields.map(f => (
                                  <div key={f.key}>
                                    <label className="fl">
                                      {f.label}
                                      {f.required && <span style={{ color: '#dc2626', marginLeft: 3 }}>*</span>}
                                    </label>
                                    <div style={metaErrors[f.key] ? { borderRadius: 6, outline: '1.5px solid #dc2626' } : {}}>
                                      <DatePicker value={docMeta[f.key] ?? ''} onChange={(v) => setMeta(f.key, v)} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )
                    })()}

                    {/* Notas */}
                    <div style={{ marginTop: 'auto' }}>
                      <label className="fl">Notas <span style={{ color: '#94a3b8', fontWeight: 400 }}>(opcional)</span></label>
                      <textarea className="fi" rows={3} style={{ resize: 'none' }}
                        value={notes} onChange={(e) => setNotes(e.target.value)}
                        placeholder="Observações adicionais…" />
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between' }}>
                  <button onClick={close} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancelar
                  </button>
                  <button onClick={submit} disabled={uploading}
                    style={{ padding: '6px 20px', borderRadius: 6, border: 'none', background: uploading ? '#e2e8f0' : typeInfo.color, color: '#fff', fontSize: 13, fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'background .15s' }}>
                    {uploading ? 'Enviando…' : 'Enviar documento'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Lightbox com zoom no cursor ── */}
      {lightbox && previewUrl && (
        <div
          onClick={() => { setLightbox(false); setZoom(1); setOrigin({ x: 50, y: 50 }) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 600,
            background: 'rgba(0,0,0,.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {/* Botão fechar */}
          <button
            onClick={() => { setLightbox(false); setZoom(1); setOrigin({ x: 50, y: 50 }) }}
            style={{
              position: 'absolute', top: 16, right: 20, zIndex: 10,
              background: 'rgba(255,255,255,.18)', border: 'none', borderRadius: 8,
              color: '#fff', fontSize: 18, width: 36, height: 36,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>

          {/* Indicador de zoom */}
          <div style={{
            position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,.5)', borderRadius: 12, padding: '4px 12px',
            color: '#fff', fontSize: 12, userSelect: 'none',
          }}>
            {Math.round(zoom * 100)}% · scroll para zoom
          </div>

          {/* Área da imagem — intercepta scroll */}
          <div
            onClick={(e) => e.stopPropagation()}
            onWheel={handleWheel}
            onMouseMove={handleImgMouseMove}
            style={{
              overflow: 'hidden',
              maxWidth: '90vw', maxHeight: '88vh',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: zoom > 1 ? 'crosshair' : 'zoom-in',
            }}
          >
            <img
              ref={imgRef}
              src={previewUrl}
              alt="documento"
              draggable={false}
              style={{
                display: 'block',
                maxWidth: '90vw', maxHeight: '88vh',
                objectFit: 'contain',
                transform: `scale(${zoom})`,
                transformOrigin: `${origin.x}% ${origin.y}%`,
                transition: zoom === 1 ? 'transform .2s ease' : 'none',
                userSelect: 'none',
                borderRadius: 4,
              }}
            />
          </div>
        </div>
      )}
    </>
  )
}
