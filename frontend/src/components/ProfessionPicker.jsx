import { useState, useRef, useEffect } from 'react'
import { Ic } from './Icon'

const PROFESSIONS = [
  'Acadêmico', 'Açougueiro', 'Administrador', 'Advogado', 'Agente de viagens',
  'Agrônomo', 'Analista de sistemas', 'Anestesista', 'Antropólogo', 'Aposentado',
  'Arqueólogo', 'Arquiteto', 'Arquivista', 'Artista plástico', 'Assistente social',
  'Astronomo', 'Atleta', 'Auditor', 'Auxiliar administrativo', 'Auxiliar de enfermagem',
  'Biólogo', 'Biomédico', 'Bioquímico', 'Bombeiro', 'Cantor',
  'Carpinteiro', 'Cirurgião', 'Coach', 'Comerciante', 'Contador',
  'Corretor de imóveis', 'Corretor de seguros', 'Dentista', 'Designer', 'Designer gráfico',
  'Diplomata', 'Diretor', 'Economista', 'Eletricista', 'Empresário',
  'Enfermeiro', 'Engenheiro aeronáutico', 'Engenheiro agrônomo', 'Engenheiro ambiental',
  'Engenheiro civil', 'Engenheiro de produção', 'Engenheiro de software',
  'Engenheiro elétrico', 'Engenheiro mecânico', 'Engenheiro químico',
  'Escritor', 'Estudante', 'Farmacêutico', 'Filósofo', 'Físico',
  'Fisioterapeuta', 'Fotógrafo', 'Funcionário público', 'Geógrafo', 'Geólogo',
  'Gerente', 'Historiador', 'Jornalista', 'Juiz', 'Magistrado',
  'Matemático', 'Médico', 'Médico veterinário', 'Militar', 'Motorista',
  'Músico', 'Nutricionista', 'Odontólogo', 'Oficial de justiça', 'Operador',
  'Pedagogo', 'Personal trainer', 'Piloto', 'Policial', 'Professor',
  'Profissional liberal', 'Programador', 'Promotor de justiça', 'Psicólogo', 'Psiquiatra',
  'Publicitário', 'Químico', 'Radialista', 'Recepcionista', 'Relações públicas',
  'Segurança', 'Servidor público', 'Sociólogo', 'Superintendente', 'Técnico',
  'Técnico de enfermagem', 'Técnico em informática', 'Tecnólogo', 'Terapeuta',
  'Tradutor', 'Urbanista', 'Vendedor',
].sort((a, b) => a.localeCompare(b, 'pt'))

export default function ProfessionPicker({ value, onChange }) {
  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState('')
  const overlayRef = useRef(null)
  const searchRef  = useRef(null)

  useEffect(() => {
    if (open) {
      setSearch('')
      setTimeout(() => searchRef.current?.focus(), 80)
    }
  }, [open])

  const pick = (prof) => {
    onChange(prof)
    setOpen(false)
  }

  const handleOverlay = (e) => {
    if (e.target === overlayRef.current) setOpen(false)
  }

  const filtered = PROFESSIONS.filter((p) =>
    p.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <>
      <input
        className="fi"
        readOnly
        value={value ?? ''}
        placeholder="Clique para selecionar…"
        onClick={() => setOpen(true)}
        style={{ cursor: 'pointer', caretColor: 'transparent' }}
      />

      {open && (
        <div
          ref={overlayRef}
          onClick={handleOverlay}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15,23,42,.42)',
            backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 400, padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 440,
              boxShadow: '0 24px 64px rgba(0,0,0,.22)',
              display: 'flex', flexDirection: 'column',
              maxHeight: '80vh', animation: 'mIn .15s ease',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 10 }}>
                Selecionar profissão
              </p>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', display: 'flex' }}>
                  <Ic n="search" s={14} />
                </span>
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar profissão…"
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
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>
                    Nenhuma profissão encontrada
                  </p>
                  <button
                    onClick={() => pick(search)}
                    style={{
                      padding: '6px 14px', borderRadius: 6,
                      border: '1px solid #2e6db4', background: '#fff',
                      color: '#2e6db4', fontSize: 13, cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Usar "{search}"
                  </button>
                </div>
              ) : (
                filtered.map((prof) => {
                  const selected = value === prof
                  return (
                    <ProfRow
                      key={prof}
                      label={prof}
                      selected={selected}
                      onClick={() => pick(prof)}
                    />
                  )
                })
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
              <button
                onClick={() => setOpen(false)}
                style={{
                  padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0',
                  background: '#fff', color: '#475569', fontSize: 13,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ProfRow({ label, selected, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 18px', cursor: 'pointer',
        background: selected ? '#f0f6ff' : hover ? '#f8fafc' : 'transparent',
        transition: 'background .1s',
      }}
    >
      <span style={{ fontSize: 13, color: '#1e293b', fontWeight: selected ? 600 : 400 }}>
        {label}
      </span>
      {selected && <span style={{ color: '#2e6db4' }}><Ic n="check" s={14} /></span>}
    </div>
  )
}
