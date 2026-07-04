import Dropdown from './Dropdown'

/* Campos das Opções de pagamento à vista (desconto valor/% + forma), reutilizados
   pelo botão global (Configurações) e pelo override por roteiro. Apresentacional:
   recebe os valores e um onChange(patch). */
const inpS = { padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', color: '#1e293b', boxSizing: 'border-box', width: '100%' }
const lblS = { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }

export default function AVistaOptionsFields({ mode = 'percent', value = '', method = '', methodOptions = [], canEdit = true, hint, onChange }) {
  const set = (patch) => onChange && onChange(patch)
  const methodOpts = Array.from(new Set([...methodOptions, method].filter(Boolean))).map(m => ({ value: m, label: m }))
  const modeBtn = (m, label) => (
    <button type="button" onClick={() => canEdit && set({ mode: m })} disabled={!canEdit}
      style={{ padding: '8px 14px', border: 'none', background: mode === m ? '#1a2d4f' : '#fff', color: mode === m ? '#fff' : '#475569', fontSize: 13, fontWeight: mode === m ? 700 : 500, cursor: canEdit ? 'pointer' : 'default', fontFamily: 'inherit' }}>
      {label}
    </button>
  )
  return (
    <>
      <div>
        <label style={lblS}>Desconto à vista</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <input style={inpS} type="number" min="0" step="0.01" value={value} disabled={!canEdit}
            onChange={e => set({ value: e.target.value })} placeholder={mode === 'valor' ? 'Ex.: 500' : 'Ex.: 5'} />
          <div style={{ display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
            {modeBtn('valor', 'R$')}
            {modeBtn('percent', '%')}
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '6px 0 0' }}>{hint || '0 = sem desconto. Pode ser em reais ou porcentagem.'}</p>
      </div>
      <div>
        <label style={lblS}>Forma de pagamento à vista</label>
        <Dropdown value={method || null} options={methodOpts} disabled={!canEdit}
          placeholder="Selecione a forma" searchable clearable onChange={v => set({ method: v || '' })} />
      </div>
    </>
  )
}
