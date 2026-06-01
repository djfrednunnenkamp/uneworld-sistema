import { useState, useEffect } from 'react'
import { documentsApi, configApi } from '../api'

const DOC_FALLBACK = [
  { key:'passport',   label:'Passaporte',                icon:'🛂', color:'#2e6db4' },
  { key:'rg',         label:'Carteira de Identidade',    icon:'🪪', color:'#7c3aed' },
  { key:'cnh',        label:'Carteira de Motorista',     icon:'🚗', color:'#059669' },
  { key:'visa',       label:'Visto',                     icon:'✈️', color:'#0891b2' },
  { key:'birth_cert', label:'Certidão de Nascimento',    icon:'📄', color:'#b45309' },
  { key:'residence',  label:'Comprovante de Residência', icon:'🏠', color:'#92400e' },
  { key:'vaccine',    label:'Vacina',                    icon:'💉', color:'#0f766e' },
  { key:'other',      label:'Outro documento',           icon:'📎', color:'#475569' },
]

function fmt(d) {
  if (!d) return null
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' })
}

function expBadge(dateStr) {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(dateStr + 'T00:00:00')
  const days = Math.round((d - today) / 86400000)
  if (days < 0)   return { label:'Vencido',           color:'#dc2626', bg:'#fee2e2' }
  if (days <= 30) return { label:`Vence em ${days}d`, color:'#d97706', bg:'#fef3c7' }
  if (days <= 90) return { label:`Vence em ${days}d`, color:'#2563eb', bg:'#dbeafe' }
  return null
}

/* ── Popup de detalhe de um documento ── */
function DocDetail({ doc, typeInfo, onClose, onDownload, downloading }) {
  const exp = expBadge(doc.expiry_date)
  const fields = [
    { label: 'Número',          value: doc.doc_number },
    { label: 'Data de emissão', value: fmt(doc.issued_date) },
    { label: 'Vencimento',      value: fmt(doc.expiry_date), badge: exp },
    { label: 'Emissor / Local', value: doc.issued_by },
    { label: 'Notas',           value: doc.notes },
  ].filter(f => f.value)

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:700, padding:20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:420, boxShadow:'0 24px 64px rgba(0,0,0,.22)' }}>
        {/* Header */}
        <div style={{ padding:'14px 18px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:26 }}>{typeInfo.icon}</span>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontSize:14, fontWeight:700, color:'#1e293b', margin:0 }}>{doc.display_name}</p>
            <span style={{ padding:'1px 7px', borderRadius:6, fontSize:11, fontWeight:600, background:`${typeInfo.color}18`, color:typeInfo.color }}>
              {doc.doc_type_label}
            </span>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:20, lineHeight:1 }}>×</button>
        </div>

        {/* Campos */}
        <div style={{ padding:'12px 18px' }}>
          {fields.map(f => (
            <div key={f.label} style={{ display:'flex', gap:12, padding:'7px 0', borderBottom:'1px solid #f8fafc' }}>
              <span style={{ fontSize:12, fontWeight:700, color:'#94a3b8', minWidth:120, flexShrink:0 }}>{f.label}</span>
              <span style={{ fontSize:13, color:'#1e293b', display:'flex', alignItems:'center', gap:8 }}>
                {f.value}
                {f.badge && (
                  <span style={{ padding:'2px 7px', borderRadius:7, fontSize:11, fontWeight:700, background:f.badge.bg, color:f.badge.color }}>
                    {f.badge.label}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>

        {/* Rodapé */}
        <div style={{ padding:'12px 18px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'space-between' }}>
          <button onClick={onClose}
            style={{ padding:'7px 16px', borderRadius:7, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
            Fechar
          </button>
          <button onClick={onDownload} disabled={downloading}
            style={{ padding:'7px 18px', borderRadius:7, border:'none', background:'#1a2d4f', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:6, opacity:downloading?.6:1 }}>
            {downloading ? 'Baixando…' : '⬇ Baixar documento'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Popup principal: lista de documentos do passageiro ── */
export default function PassengerDocsPopup({ passenger, onClose }) {
  const [docs,      setDocs]      = useState([])
  const [docTypes,  setDocTypes]  = useState(DOC_FALLBACK)
  const [loading,   setLoading]   = useState(true)
  const [viewDoc,   setViewDoc]   = useState(null)
  const [dlId,      setDlId]      = useState(null)

  useEffect(() => {
    documentsApi.list(passenger.id)
      .then(r => setDocs(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
    configApi.docTypes()
      .then(r => { if (r.data?.length) setDocTypes(r.data) })
      .catch(() => {})
  }, [passenger.id])

  const typeInfo = (key) =>
    docTypes.find(t => t.key === key) ?? docTypes[docTypes.length - 1] ?? DOC_FALLBACK[DOC_FALLBACK.length - 1]

  const download = async (doc) => {
    setDlId(doc.id)
    try {
      const r = await documentsApi.download(doc.id)
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = doc.original_name || `documento_${doc.id}`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* silently */ }
    finally { setDlId(null) }
  }

  const current = docs.filter(d => {
    if (!d.expiry_date) return true
    return new Date(d.expiry_date + 'T00:00:00') >= new Date()
  })
  const expired = docs.filter(d => {
    if (!d.expiry_date) return false
    return new Date(d.expiry_date + 'T00:00:00') < new Date()
  })

  return (
    <>
      <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.45)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:600, padding:20 }}
        onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
        <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:520, maxHeight:'80vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 64px rgba(0,0,0,.24)' }}>

          {/* Header */}
          <div style={{ padding:'16px 20px 14px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
            <div>
              <h2 style={{ fontSize:15, fontWeight:700, color:'#1e293b', margin:0 }}>
                Documentos de {passenger.full_name || `${passenger.first_name} ${passenger.last_name}`}
              </h2>
              {!loading && <p style={{ fontSize:12, color:'#94a3b8', margin:'2px 0 0' }}>{docs.length} documento{docs.length!==1?'s':''}</p>}
            </div>
            <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:22, lineHeight:1, padding:4 }}>×</button>
          </div>

          {/* Lista */}
          <div style={{ flex:1, overflowY:'auto', padding:'8px 0' }}>
            {loading ? (
              <p style={{ textAlign:'center', padding:'32px 0', color:'#94a3b8', fontSize:13 }}>Carregando…</p>
            ) : docs.length === 0 ? (
              <div style={{ textAlign:'center', padding:'40px 0' }}>
                <p style={{ fontSize:32, marginBottom:8 }}>📂</p>
                <p style={{ color:'#94a3b8', fontSize:13 }}>Nenhum documento cadastrado.</p>
              </div>
            ) : (
              <>
                {[{ label: 'Atuais', list: current }, { label: 'Vencidos', list: expired }].map(({ label, list }) =>
                  list.length === 0 ? null : (
                    <div key={label}>
                      {expired.length > 0 && current.length > 0 && (
                        <p style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.06em', padding:'8px 20px 4px', margin:0 }}>{label}</p>
                      )}
                      {list.map(doc => {
                        const ti  = typeInfo(doc.doc_type)
                        const exp = expBadge(doc.expiry_date)
                        return (
                          <div key={doc.id}
                            onClick={() => setViewDoc(doc)}
                            style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 20px', cursor:'pointer', transition:'background .1s' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            {/* Ícone / thumbnail */}
                            {doc.preview_url
                              ? <img src={doc.preview_url} alt="" style={{ width:40, height:40, objectFit:'cover', borderRadius:6, border:'1px solid #e2e8f0', flexShrink:0 }} />
                              : <span style={{ fontSize:26, flexShrink:0, lineHeight:1 }}>{ti.icon}</span>
                            }

                            {/* Info */}
                            <div style={{ flex:1, minWidth:0 }}>
                              <p style={{ fontSize:13, fontWeight:600, color:'#1e293b', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                {doc.display_name}
                              </p>
                              <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:3 }}>
                                <span style={{ fontSize:11, fontWeight:600, color:ti.color, background:`${ti.color}15`, padding:'1px 7px', borderRadius:5 }}>{doc.doc_type_label}</span>
                                {doc.expiry_date && <span style={{ fontSize:11, color:'#94a3b8' }}>Vence {fmt(doc.expiry_date)}</span>}
                                {exp && <span style={{ fontSize:11, fontWeight:700, color:exp.color, background:exp.bg, padding:'1px 7px', borderRadius:5 }}>{exp.label}</span>}
                              </div>
                            </div>

                            {/* Botão download */}
                            <button
                              onClick={e => { e.stopPropagation(); download(doc) }}
                              disabled={dlId === doc.id}
                              title="Baixar documento"
                              style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:7, cursor:'pointer', color:'#475569', fontSize:13, padding:'6px 10px', flexShrink:0, transition:'all .1s' }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor='#1a2d4f'; e.currentTarget.style.color='#1a2d4f' }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.color='#475569' }}
                            >
                              {dlId === doc.id ? '…' : '⬇'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding:'12px 20px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'flex-end', flexShrink:0 }}>
            <button onClick={onClose}
              style={{ padding:'8px 20px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              Fechar
            </button>
          </div>
        </div>
      </div>

      {/* Detalhe de um documento específico */}
      {viewDoc && (
        <DocDetail
          doc={viewDoc}
          typeInfo={typeInfo(viewDoc.doc_type)}
          onClose={() => setViewDoc(null)}
          onDownload={() => download(viewDoc)}
          downloading={dlId === viewDoc.id}
        />
      )}
    </>
  )
}
