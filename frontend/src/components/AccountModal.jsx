import { useState, useEffect, useMemo } from 'react'
import { authApi, agendaApi, configApi } from '../api'
import { useAuth } from '../context/AuthContext'
import { usePrefs } from '../context/PrefsContext'
import FormSelect from './FormSelect'
import { fmtHour } from '../utils/timeFormat'

const FREQ_OPTS = [
  { value: 'daily',  label: 'Diário' },
  { value: 'weekly', label: 'Semanal (toda segunda-feira)' },
]

const FORMAT_OPTS = [
  { value: '24h', label: '24 horas  —  13:00, 22:00' },
  { value: '12h', label: '12 horas (AM/PM)  —  1:00 PM, 10:00 PM' },
]

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: 20,
}
const inp = {
  width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0',
  borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit',
  color: '#0f172a', boxSizing: 'border-box', transition: 'border-color .15s',
}
const lbl = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b',
  textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5,
}

function Toggle({ checked, onChange }) {
  return (
    <label style={{ position: 'relative', display: 'inline-block', width: 38, height: 22, flexShrink: 0, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} />
      <span style={{
        position: 'absolute', inset: 0, borderRadius: 22, transition: 'background .2s',
        background: checked ? '#1a2d4f' : '#cbd5e1',
      }} />
      <span style={{
        position: 'absolute', top: 4, left: checked ? 20 : 4, width: 14, height: 14,
        borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)',
      }} />
    </label>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 18 }}>
      <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.08em' }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  )
}

function NotifCard({ label, desc, checked, onToggle, hour, onHour, hourOpts, frequency, onFrequency }) {
  return (
    <div style={{
      borderRadius: 10, border: `1.5px solid ${checked ? '#c7d9f5' : '#e2e8f0'}`,
      background: checked ? '#f0f5fe' : '#f8fafc',
      transition: 'all .15s', overflow: 'hidden',
    }}>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 14px', cursor: 'pointer' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{label}</p>
          <p style={{ margin: 0, fontSize: 11.5, color: '#94a3b8', lineHeight: 1.4 }}>{desc}</p>
        </div>
        <Toggle checked={checked} onChange={onToggle} />
      </label>
      {checked && (
        <div style={{ padding: '0 14px 12px', borderTop: '1px solid #dbeafe', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {frequency !== undefined && (
            <div>
              <p style={{ margin: '10px 0 4px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em' }}>Frequência</p>
              <FormSelect value={frequency} onChange={onFrequency} options={FREQ_OPTS} placeholder="Selecione a frequência…" />
            </div>
          )}
          <div>
            <p style={{ margin: frequency !== undefined ? '0 0 4px' : '10px 0 4px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em' }}>Horário de envio</p>
            <FormSelect value={hour} onChange={onHour} options={hourOpts} placeholder="Selecione o horário…" />
          </div>
        </div>
      )}
    </div>
  )
}

export default function AccountModal({ onClose, onSaved }) {
  const { user } = useAuth()
  const { setTimeFormat } = usePrefs()
  const [firstName, setFirstName] = useState(user?.first_name || '')
  const [lastName,  setLastName]  = useState(user?.last_name  || '')
  const [email,     setEmail]     = useState(user?.email      || '')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState(false)

  const [prefs, setPrefs] = useState({
    time_format:             '24h',
    digest_enabled:          false,
    digest_frequency:        'daily',
    digest_send_hour:        8,
    receive_deadline_emails: false,
    receive_task_emails:     false,
    receive_birthday_emails: false,
    send_hour:               8,
    dashboard_currencies:    [],
  })

  // Lista de câmbios disponíveis para o usuário escolher quais ver na Visão Geral.
  const canSeeExchange = user?.is_superuser || !!user?.permissions?.settings_exchange_rates_view
  const [rates, setRates] = useState([])

  const hourOpts = useMemo(() =>
    Array.from({length: 24}, (_, h) => ({ value: h, label: fmtHour(h, prefs.time_format) })),
    [prefs.time_format]
  )

  const canSeeSensitive = user?.is_superuser || !!user?.permissions?.passengers_view_full

  useEffect(() => {
    agendaApi.getPrefs()
      .then(r => setPrefs(p => ({
        ...p,
        time_format:             r.data.time_format    || '24h',
        digest_enabled:          !!r.data.digest_enabled,
        digest_frequency:        r.data.digest_frequency || 'daily',
        digest_send_hour:        r.data.digest_send_hour ?? 8,
        receive_deadline_emails: !!r.data.receive_deadline_emails,
        receive_task_emails:     !!r.data.receive_task_emails,
        receive_birthday_emails: !!r.data.receive_birthday_emails,
        send_hour:               r.data.send_hour ?? 8,
        dashboard_currencies:    Array.isArray(r.data.dashboard_currencies) ? r.data.dashboard_currencies : [],
      })))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!canSeeExchange) return
    configApi.exchangeRates()
      .then(r => setRates(r.data || []))
      .catch(() => {})
  }, [canSeeExchange])

  const set = (key, val) => setPrefs(p => ({ ...p, [key]: val }))

  const toggleCurrency = (id) => setPrefs(p => {
    const cur = p.dashboard_currencies || []
    return { ...p, dashboard_currencies: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] }
  })

  const handleSave = async (e) => {
    e.preventDefault()
    if (!email.trim()) { setError('O e-mail é obrigatório.'); return }
    setLoading(true); setError('')
    try {
      await authApi.updateMe({ first_name: firstName, last_name: lastName, email: email.trim().toLowerCase() })
      await agendaApi.updatePrefs({
        time_format:             prefs.time_format,
        digest_enabled:          prefs.digest_enabled,
        digest_frequency:        prefs.digest_frequency,
        digest_send_hour:        prefs.digest_send_hour,
        receive_deadline_emails: prefs.receive_deadline_emails,
        receive_task_emails:     prefs.receive_task_emails,
        receive_birthday_emails: prefs.receive_birthday_emails,
        send_hour:               prefs.send_hour,
        dashboard_currencies:    prefs.dashboard_currencies,
      })
      setTimeFormat(prefs.time_format)
      await onSaved()
      setSuccess(true)
      setTimeout(onClose, 900)
    } catch (err) {
      setError(err.response?.data?.error ?? 'Erro ao salvar. Tente novamente.')
    } finally { setLoading(false) }
  }

  return (
    <div style={overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 24px 60px rgba(0,0,0,.25)', display: 'flex', flexDirection: 'column', maxHeight: '92vh' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Minha conta</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 22, lineHeight: 1, padding: 2 }}>×</button>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSave} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto', flex: 1 }}>

          {/* Dados pessoais */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Nome</label>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Nome" style={inp}
                onFocus={e => e.target.style.borderColor='#1a2d4f'} onBlur={e => e.target.style.borderColor='#e2e8f0'} />
            </div>
            <div>
              <label style={lbl}>Sobrenome</label>
              <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Sobrenome" style={inp}
                onFocus={e => e.target.style.borderColor='#1a2d4f'} onBlur={e => e.target.style.borderColor='#e2e8f0'} />
            </div>
          </div>
          <div>
            <label style={lbl}>E-mail</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" style={inp}
              onFocus={e => e.target.style.borderColor='#1a2d4f'} onBlur={e => e.target.style.borderColor='#e2e8f0'} />
          </div>

          {/* Formato de horário */}
          <Section title="Formato de horário">
            <div style={{ display:'flex', gap:0, borderRadius:8, border:'1.5px solid #e2e8f0', overflow:'hidden', alignSelf:'flex-start' }}>
              {[{v:'24h', label:'24 horas'},{v:'12h', label:'AM / PM'}].map(({v, label}) => {
                const active = prefs.time_format === v
                return (
                  <button key={v} type="button" onClick={() => set('time_format', v)} style={{
                    padding:'8px 20px', border:'none', borderRight: v==='24h' ? '1.5px solid #e2e8f0' : 'none',
                    background: active ? '#1a2d4f' : '#fff', color: active ? '#fff' : '#64748b',
                    fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', transition:'all .15s',
                  }}>{label}</button>
                )
              })}
            </div>
          </Section>

          {/* Moedas no câmbio da Visão Geral */}
          {canSeeExchange && (
            <Section title="Moedas no câmbio (Visão Geral)">
              <p style={{ margin: '0 0 10px', fontSize: 12, color: '#94a3b8', lineHeight: 1.45 }}>
                Escolha quais moedas aparecem na faixa de câmbio do seu painel. Sem nenhuma marcada, mostramos as moedas favoritas (★).
              </p>
              {rates.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12.5, color: '#94a3b8' }}>Nenhuma moeda cadastrada em Configurações.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 220, overflowY: 'auto', border: '1px solid #eef2f7', borderRadius: 10, padding: 6 }}>
                  {rates.map(r => {
                    const checked = (prefs.dashboard_currencies || []).includes(r.id)
                    return (
                      <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', borderRadius: 8, cursor: 'pointer', background: checked ? '#f1f5f9' : 'transparent' }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleCurrency(r.id)} style={{ width: 16, height: 16, accentColor: '#1a2d4f', cursor: 'pointer' }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{r.from_currency} → {r.to_currency}</span>
                        {r.is_favorite && <span style={{ fontSize: 12, color: '#f59e0b' }}>★</span>}
                      </label>
                    )
                  })}
                </div>
              )}
            </Section>
          )}

          {/* Resumo do calendário */}
          <Section title="Resumo do calendário">
            <NotifCard
              label="Resumo automático periódico"
              desc="E-mail com seus próximos eventos e prazos do calendário"
              checked={prefs.digest_enabled}
              onToggle={v => set('digest_enabled', v)}
              hour={prefs.digest_send_hour}
              onHour={v => set('digest_send_hour', v)}
              hourOpts={hourOpts}
              frequency={prefs.digest_frequency}
              onFrequency={v => set('digest_frequency', v)}
            />
          </Section>

          {/* Notificações diárias */}
          <Section title="Notificações diárias">
            <NotifCard
              label="Prazos de confirmação"
              desc="Passageiros com prazo vencendo hoje ou em 2 dias"
              checked={prefs.receive_deadline_emails}
              onToggle={v => set('receive_deadline_emails', v)}
              hour={prefs.send_hour}
              onHour={v => set('send_hour', v)}
              hourOpts={hourOpts}
            />
            <NotifCard
              label="Pendências"
              desc="Tarefas com prazo vencendo hoje"
              checked={prefs.receive_task_emails}
              onToggle={v => set('receive_task_emails', v)}
              hour={prefs.send_hour}
              onHour={v => set('send_hour', v)}
              hourOpts={hourOpts}
            />
            {canSeeSensitive && (
              <NotifCard
                label="Aniversários de passageiros"
                desc="Passageiros que fazem aniversário hoje"
                checked={prefs.receive_birthday_emails}
                onToggle={v => set('receive_birthday_emails', v)}
                hour={prefs.send_hour}
                onHour={v => set('send_hour', v)}
                hourOpts={hourOpts}
              />
            )}
            {(prefs.receive_deadline_emails || prefs.receive_task_emails || prefs.receive_birthday_emails) && (
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#94a3b8' }}>
                As notificações diárias são enviadas em um único e-mail no horário acima.
              </p>
            )}
          </Section>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', color: '#dc2626', fontSize: 13 }}>
              {error}
            </div>
          )}
        </form>

        {/* Footer fixo */}
        <div style={{ padding: '14px 24px 20px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button type="button" onClick={onClose}
            style={{ padding: '9px 18px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={loading || success}
            style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: success ? '#16a34a' : loading ? '#94a3b8' : '#1a2d4f', color: '#fff', fontSize: 13, fontWeight: 700, cursor: (loading || success) ? 'default' : 'pointer', fontFamily: 'inherit', transition: 'background .15s' }}>
            {success ? '✓ Salvo' : loading ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
