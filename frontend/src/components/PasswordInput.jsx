import { useState } from 'react'
import { Ic } from './Icon'

export default function PasswordInput({ style, ...props }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative', width: style?.width ?? '100%' }}>
      <input
        {...props}
        type={show ? 'text' : 'password'}
        style={{ ...style, width: '100%', paddingRight: 38 }}
      />
      <button
        type="button"
        tabIndex={-1}
        title={show ? 'Ocultar senha' : 'Mostrar senha'}
        onClick={() => setShow(s => !s)}
        style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26, padding: 0, border: 'none', background: 'none',
          color: '#94a3b8', cursor: 'pointer',
        }}
      >
        <Ic n={show ? 'eyeOff' : 'eye'} s={16} />
      </button>
    </div>
  )
}
